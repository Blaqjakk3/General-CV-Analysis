import { Client, Databases, Query, Storage, ID } from 'node-appwrite';
import { GoogleGenerativeAI } from '@google/generative-ai';

const client = new Client();
const endpoint = process.env.APPWRITE_FUNCTION_ENDPOINT || 'https://cloud.appwrite.io/v1';

client
  .setEndpoint(endpoint)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || '67d074d0001dadc04f94')
  .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

const databases = new Databases(client);
const storage = new Storage(client);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const config = {
  databaseId: 'career4me',
  careerPathsCollectionId: 'careerPaths',
  talentsCollectionId: 'talents',
  storageId: 'avatars'
};

function extractAndCleanJSON(text) {
  try {
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const startIndex = cleaned.indexOf('{');
    const lastIndex = cleaned.lastIndexOf('}');
    
    if (startIndex === -1 || lastIndex === -1 || startIndex >= lastIndex) {
      throw new Error('No valid JSON object found in response');
    }
    
    cleaned = cleaned.substring(startIndex, lastIndex + 1)
      .replace(/,(\s*[}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return cleaned;
  } catch (error) {
    throw new Error(`Failed to clean JSON: ${error.message}`);
  }
}

async function extractTextFromCV(fileBuffer, fileName) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { maxOutputTokens: 2000, temperature: 0.3 }
    });

    // Convert buffer to base64 for Gemini
    const base64Data = fileBuffer.toString('base64');
    const mimeType = fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 
                    fileName.toLowerCase().match(/\.(jpg|jpeg|png)$/) ? `image/${fileName.split('.').pop()}` : 
                    'application/octet-stream';

    const prompt = `Extract all text content from this CV/Resume document. Return the complete text as it appears in the document, maintaining structure where possible. Focus on extracting:
- Personal information
- Contact details  
- Education
- Work experience
- Skills
- Certifications
- Projects
- Any other relevant information

Return only the extracted text, no additional formatting or commentary.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      }
    ]);

    return result.response.text();
  } catch (error) {
    throw new Error(`Failed to extract text from CV: ${error.message}`);
  }
}

async function analyzeCVContent(cvText, talent, careerPath) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { maxOutputTokens: 3000, temperature: 0.5 }
    });

    const talentSkills = talent.skills || [];
    const talentDegrees = talent.degrees || [];
    const talentCertifications = talent.certifications || [];
    const talentInterests = talent.interests || [];

    const careerPathInfo = careerPath ? {
      title: careerPath.title,
      requiredSkills: careerPath.requiredSkills || [],
      requiredCertifications: careerPath.requiredCertifications || [],
      suggestedDegrees: careerPath.suggestedDegrees || [],
      toolsAndTechnologies: careerPath.toolsAndTechnologies || []
    } : null;

    const prompt = `Analyze this CV content against the user's profile and career path. Provide detailed insights.

CV CONTENT:
${cvText}

USER PROFILE:
- Name: ${talent.fullname}
- Career Stage: ${talent.careerStage}
- Skills in Profile: ${talentSkills.join(', ') || 'None listed'}
- Degrees in Profile: ${talentDegrees.join(', ') || 'None listed'}
- Certifications in Profile: ${talentCertifications.join(', ') || 'None listed'}
- Interests in Profile: ${talentInterests.join(', ') || 'None listed'}

${careerPathInfo ? `SELECTED CAREER PATH:
- Title: ${careerPathInfo.title}
- Required Skills: ${careerPathInfo.requiredSkills.join(', ') || 'Not specified'}
- Required Certifications: ${careerPathInfo.requiredCertifications.join(', ') || 'Not specified'}
- Suggested Degrees: ${careerPathInfo.suggestedDegrees.join(', ') || 'Not specified'}
- Tools & Technologies: ${careerPathInfo.toolsAndTechnologies.join(', ') || 'Not specified'}` : 'NO CAREER PATH SELECTED'}

Return ONLY valid JSON:
{
  "overallScore": 85,
  "strengths": ["Strong technical skills", "Relevant experience"],
  "weaknesses": ["Missing key certification", "Limited leadership experience"],
  "profileVsCvGaps": {
    "missingFromCV": ["JavaScript", "Project Management"],
    "missingFromProfile": ["Python", "AWS Certification"],
    "inconsistencies": ["Experience level mismatch"]
  },
  "careerPathAlignment": {
    "alignmentScore": 75,
    "matchingSkills": ["React", "Node.js"],
    "missingSkills": ["Docker", "Kubernetes"],
    "matchingCertifications": ["AWS Developer"],
    "missingCertifications": ["AWS Solutions Architect"],
    "relevantExperience": ["2 years in web development"],
    "additionalRequirements": ["Need more backend experience"]
  },
  "recommendations": [
    "Add missing JavaScript skills to your profile",
    "Consider obtaining Docker certification",
    "Highlight your project management experience more prominently"
  ],
  "nextSteps": [
    "Update your profile with skills found in CV",
    "Obtain missing certifications for your career path",
    "Gain experience in identified skill gaps"
  ],
  "marketability": {
    "score": 78,
    "summary": "Strong foundation with room for improvement in key areas",
    "competitiveAdvantages": ["Diverse skill set", "Relevant projects"],
    "improvementAreas": ["Industry certifications", "Leadership experience"]
  }
}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    const cleanedJson = extractAndCleanJSON(responseText);
    const analysis = JSON.parse(cleanedJson);
    
    // Validate required fields
    const requiredFields = ['overallScore', 'strengths', 'weaknesses', 'profileVsCvGPs', 'recommendations'];
    for (const field of requiredFields) {
      if (!analysis[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return analysis;
  } catch (error) {
    throw new Error(`Failed to analyze CV: ${error.message}`);
  }
}

function generateFallbackAnalysis(talent, careerPath) {
  return {
    overallScore: 65,
    strengths: [
      "Profile shows clear career direction",
      `Strong foundation for ${talent.careerStage} level`,
      "Diverse interests and background"
    ],
    weaknesses: [
      "Unable to fully analyze CV content",
      "Limited visibility into actual experience",
      "Cannot verify skill claims"
    ],
    profileVsCvGaps: {
      missingFromCV: ["Analysis unavailable"],
      missingFromProfile: ["Analysis unavailable"],
      inconsistencies: ["Could not perform comparison"]
    },
    careerPathAlignment: careerPath ? {
      alignmentScore: 50,
      matchingSkills: talent.skills?.filter(skill => 
        careerPath.requiredSkills?.includes(skill)) || [],
      missingSkills: careerPath.requiredSkills?.filter(skill => 
        !talent.skills?.includes(skill)) || [],
      matchingCertifications: talent.certifications?.filter(cert => 
        careerPath.requiredCertifications?.includes(cert)) || [],
      missingCertifications: careerPath.requiredCertifications?.filter(cert => 
        !talent.certifications?.includes(cert)) || [],
      relevantExperience: ["Based on profile information only"],
      additionalRequirements: ["Complete CV analysis for detailed insights"]
    } : {
      alignmentScore: 0,
      message: "No career path selected for comparison"
    },
    recommendations: [
      "Ensure CV is readable and properly formatted",
      "Update your profile with accurate information",
      careerPath ? `Focus on developing skills for ${careerPath.title}` : "Select a career path for targeted advice"
    ],
    nextSteps: [
      "Try uploading CV again with better quality",
      "Complete your profile information",
      "Consider selecting a career path for guidance"
    ],
    marketability: {
      score: 55,
      summary: "Basic analysis available - upload a clear CV for detailed insights",
      competitiveAdvantages: ["Profile information available"],
      improvementAreas: ["Need complete CV analysis", "Profile optimization"]
    }
  };
}

// Main function export - note the different export syntax
export default async function({ req, res, log, error }) {
  const startTime = Date.now();
  let uploadedFileId = null;
  
  try {
    log('=== CV Analysis Function Started ===');
    
    // Parse request
    let requestData;
    try {
      requestData = JSON.parse(req.body);
    } catch (e) {
      return res.json({ success: false, error: 'Invalid JSON input', statusCode: 400 }, 400);
    }

    const { talentId, fileData, fileName } = requestData;
    
    if (!talentId || !fileData || !fileName) {
      return res.json({ 
        success: false, 
        error: 'Missing required parameters: talentId, fileData, fileName', 
        statusCode: 400 
      }, 400);
    }

    // Validate file type
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    if (!allowedTypes.includes(fileExtension)) {
      return res.json({
        success: false,
        error: 'Unsupported file type. Please upload PDF, DOC, DOCX, or image files.',
        statusCode: 400
      }, 400);
    }

    // Fetch talent information
    let talent;
    try {
      const talentQuery = await databases.listDocuments(
        config.databaseId,
        config.talentsCollectionId,
        [Query.equal('talentId', talentId)]
      );

      if (talentQuery.documents.length === 0) {
        return res.json({ success: false, error: 'Talent not found', statusCode: 404 }, 404);
      }

      talent = talentQuery.documents[0];
      log(`Fetched talent: ${talent.fullname}`);
    } catch (e) {
      return res.json({ success: false, error: 'Failed to fetch talent information', statusCode: 500 }, 500);
    }

    // Fetch career path if selected
    let careerPath = null;
    if (talent.selectedPath) {
      try {
        careerPath = await databases.getDocument(
          config.databaseId,
          config.careerPathsCollectionId,
          talent.selectedPath
        );
        log(`Fetched career path: ${careerPath.title}`);
      } catch (e) {
        log(`Warning: Could not fetch career path: ${e.message}`);
      }
    }

    let analysis;
    let usedFallback = false;

    try {
      // Upload file to storage temporarily
      const fileBuffer = Buffer.from(fileData, 'base64');
      const tempFile = await storage.createFile(
        config.storageId,
        ID.unique(),
        fileBuffer,
        [
          `read("user:${talentId}")`,
          `delete("user:${talentId}")`
        ]
      );
      
      uploadedFileId = tempFile.$id;
      log(`Temporarily uploaded file: ${uploadedFileId}`);

      // Extract text from CV
      log('Extracting text from CV...');
      const cvText = await extractTextFromCV(fileBuffer, fileName);
      
      if (!cvText || cvText.trim().length < 50) {
        throw new Error('Could not extract sufficient text from CV');
      }

      log(`Extracted ${cvText.length} characters from CV`);

      // Analyze CV content
      log('Analyzing CV content...');
      analysis = await analyzeCVContent(cvText, talent, careerPath);
      
      log('Successfully completed AI analysis');

    } catch (aiError) {
      log(`AI analysis failed: ${aiError.message}, using fallback`);
      analysis = generateFallbackAnalysis(talent, careerPath);
      usedFallback = true;
    } finally {
      // Always clean up the uploaded file
      if (uploadedFileId) {
        try {
          await storage.deleteFile(config.storageId, uploadedFileId);
          log(`Deleted temporary file: ${uploadedFileId}`);
        } catch (deleteError) {
          error(`Failed to delete temporary file: ${deleteError.message}`);
        }
      }
    }

    const response = {
      success: true,
      statusCode: 200,
      analysis: analysis,
      metadata: {
        talent: {
          id: talent.$id,
          fullname: talent.fullname,
          careerStage: talent.careerStage
        },
        careerPath: careerPath ? {
          id: careerPath.$id,
          title: careerPath.title
        } : null,
        fileName: fileName,
        analyzedAt: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        usedFallback: usedFallback
      }
    };

    log(`Analysis completed in ${Date.now() - startTime}ms ${usedFallback ? '(fallback)' : '(AI)'}`);
    return res.json(response);

  } catch (err) {
    error(`Unexpected Error: ${err.message}`);
    
    // Clean up file if error occurred
    if (uploadedFileId) {
      try {
        await storage.deleteFile(config.storageId, uploadedFileId);
        log(`Cleaned up file after error: ${uploadedFileId}`);
      } catch (deleteError) {
        error(`Failed to cleanup file after error: ${deleteError.message}`);
      }
    }

    return res.json({
      success: false,
      error: 'Internal server error',
      statusCode: 500,
      executionTime: Date.now() - startTime
    }, 500);
  }
}