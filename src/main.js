const { Client, Databases, Query, Storage, ID } = require('node-appwrite');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Appwrite client
const client = new Client();
const endpoint = process.env.APPWRITE_FUNCTION_ENDPOINT || 'https://cloud.appwrite.io/v1';

client
  .setEndpoint(endpoint)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID || '67d074d0001dadc04f94')
  .setKey(process.env.APPWRITE_FUNCTION_API_KEY);

const databases = new Databases(client);
const storage = new Storage(client);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Configuration
const config = {
  databaseId: 'career4me',
  careerPathsCollectionId: 'careerPaths',
  talentsCollectionId: 'talents',
  storageId: 'avatars'
};

/**
 * Extract and clean JSON from AI response
 * @param {string} text - Raw AI response text
 * @returns {string} - Cleaned JSON string
 */
function extractAndCleanJSON(text) {
  try {
    // Remove markdown code blocks
    let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Find JSON object boundaries
    const startIndex = cleaned.indexOf('{');
    const lastIndex = cleaned.lastIndexOf('}');
    
    if (startIndex === -1 || lastIndex === -1 || startIndex >= lastIndex) {
      throw new Error('No valid JSON object found in response');
    }
    
    // Extract JSON portion
    cleaned = cleaned.substring(startIndex, lastIndex + 1)
      .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // Quote unquoted keys
      .replace(/:\s*'([^']*)'/g, ': "$1"')  // Convert single to double quotes
      .replace(/\n/g, ' ')  // Replace newlines with spaces
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim();
    
    return cleaned;
  } catch (error) {
    throw new Error(`Failed to clean JSON: ${error.message}`);
  }
}

/**
 * Extract text content from CV file using Gemini Vision
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original file name
 * @returns {Promise<string>} - Extracted text content
 */
async function extractTextFromCV(fileBuffer, fileName) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { 
        maxOutputTokens: 2000, 
        temperature: 0.3 
      }
    });

    // Convert buffer to base64 for Gemini
    const base64Data = fileBuffer.toString('base64');
    
    // Determine MIME type based on file extension
    const extension = fileName.toLowerCase().split('.').pop();
    let mimeType;
    
    switch (extension) {
      case 'pdf':
        mimeType = 'application/pdf';
        break;
      case 'jpg':
      case 'jpeg':
        mimeType = 'image/jpeg';
        break;
      case 'png':
        mimeType = 'image/png';
        break;
      case 'doc':
        mimeType = 'application/msword';
        break;
      case 'docx':
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
      default:
        mimeType = 'application/octet-stream';
    }

    const prompt = `Extract all text content from this CV/Resume document. Please provide a complete extraction of:

- Personal information and contact details
- Education background
- Work experience and employment history
- Technical and soft skills
- Certifications and licenses
- Projects and achievements
- Any other relevant professional information

Return only the extracted text content, maintaining the logical structure where possible. Do not add any commentary or analysis.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      }
    ]);

    const extractedText = result.response.text();
    
    if (!extractedText || extractedText.trim().length < 50) {
      throw new Error('Insufficient text extracted from document');
    }

    return extractedText;
    
  } catch (error) {
    console.error('Text extraction error:', error);
    throw new Error(`Failed to extract text from CV: ${error.message}`);
  }
}

/**
 * Analyze CV content using Gemini AI
 * @param {string} cvText - Extracted CV text
 * @param {Object} talent - Talent profile data
 * @param {Object} careerPath - Career path data (optional)
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeCVContent(cvText, talent, careerPath) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { 
        maxOutputTokens: 3000, 
        temperature: 0.5 
      }
    });

    // Prepare talent profile data
    const talentSkills = talent.skills || [];
    const talentDegrees = talent.degrees || [];
    const talentCertifications = talent.certifications || [];
    const talentInterests = talent.interests || [];

    // Prepare career path data
    const careerPathInfo = careerPath ? {
      title: careerPath.title,
      requiredSkills: careerPath.requiredSkills || [],
      requiredCertifications: careerPath.requiredCertifications || [],
      suggestedDegrees: careerPath.suggestedDegrees || [],
      toolsAndTechnologies: careerPath.toolsAndTechnologies || []
    } : null;

    const prompt = `Analyze this CV content comprehensively against the user's profile and career path requirements. Provide detailed, actionable insights.

CV CONTENT:
${cvText}

USER PROFILE INFORMATION:
- Name: ${talent.fullname}
- Career Stage: ${talent.careerStage}
- Skills Listed in Profile: ${talentSkills.length ? talentSkills.join(', ') : 'None listed'}
- Educational Background in Profile: ${talentDegrees.length ? talentDegrees.join(', ') : 'None listed'}
- Certifications in Profile: ${talentCertifications.length ? talentCertifications.join(', ') : 'None listed'}
- Interests in Profile: ${talentInterests.length ? talentInterests.join(', ') : 'None listed'}

${careerPathInfo ? `SELECTED CAREER PATH:
- Career Title: ${careerPathInfo.title}
- Required Skills: ${careerPathInfo.requiredSkills.length ? careerPathInfo.requiredSkills.join(', ') : 'Not specified'}
- Required Certifications: ${careerPathInfo.requiredCertifications.length ? careerPathInfo.requiredCertifications.join(', ') : 'Not specified'}
- Suggested Educational Background: ${careerPathInfo.suggestedDegrees.length ? careerPathInfo.suggestedDegrees.join(', ') : 'Not specified'}
- Key Tools & Technologies: ${careerPathInfo.toolsAndTechnologies.length ? careerPathInfo.toolsAndTechnologies.join(', ') : 'Not specified'}` : 'NO CAREER PATH SELECTED - Provide general analysis'}

Please analyze and return ONLY a valid JSON object with this exact structure:

{
  "overallScore": 85,
  "strengths": [
    "Strong technical foundation with relevant programming languages",
    "Excellent educational background aligned with career goals",
    "Demonstrated project experience with real-world applications"
  ],
  "weaknesses": [
    "Missing key industry certifications",
    "Limited leadership or management experience",
    "Lack of specific technology mentioned in career requirements"
  ],
  "profileVsCvGaps": {
    "missingFromCV": [
      "JavaScript programming mentioned in profile",
      "Project management skills listed in interests"
    ],
    "missingFromProfile": [
      "Python development experience shown in CV",
      "AWS certification displayed in CV"
    ],
    "inconsistencies": [
      "Experience level appears higher in CV than profile suggests",
      "Different skill emphasis between profile and CV"
    ]
  },
  "careerPathAlignment": {
    "alignmentScore": 75,
    "matchingSkills": ["React", "Node.js", "Database Management"],
    "missingSkills": ["Docker", "Kubernetes", "Microservices"],
    "matchingCertifications": ["AWS Developer Associate"],
    "missingCertifications": ["AWS Solutions Architect", "Docker Certified Associate"],
    "relevantExperience": [
      "2+ years in full-stack development",
      "Experience with agile development processes"
    ],
    "additionalRequirements": [
      "Need more backend architecture experience",
      "Recommended to gain cloud deployment experience"
    ]
  },
  "recommendations": [
    "Update your profile to include Python skills evident in your CV",
    "Consider obtaining Docker and Kubernetes certifications for career advancement",
    "Highlight your project management experience more prominently in both profile and CV",
    "Add specific examples of leadership or mentoring roles if available"
  ],
  "nextSteps": [
    "Synchronize profile information with CV content for consistency",
    "Pursue missing certifications identified for your career path",
    "Gain hands-on experience with identified skill gaps through projects or training",
    "Consider adding quantifiable achievements to strengthen CV impact"
  ],
  "marketability": {
    "score": 78,
    "summary": "Strong technical foundation with good career trajectory, but needs strategic skill development in key areas to maximize market competitiveness",
    "competitiveAdvantages": [
      "Solid educational foundation",
      "Relevant project portfolio",
      "Clear career progression"
    ],
    "improvementAreas": [
      "Industry-standard certifications",
      "Leadership and soft skills demonstration",
      "Advanced technical specializations"
    ]
  }
}

Scoring Guidelines:
- Overall Score: 0-100 based on completeness, relevance, and market readiness
- Alignment Score: 0-100 based on how well CV matches career path requirements
- Marketability Score: 0-100 based on competitive positioning in job market

Ensure all arrays contain specific, actionable items and scores are realistic and well-justified.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Clean and parse JSON response
    const cleanedJson = extractAndCleanJSON(responseText);
    const analysis = JSON.parse(cleanedJson);
    
    // Validate required fields exist
    const requiredFields = [
      'overallScore', 'strengths', 'weaknesses', 'profileVsCvGaps', 
      'recommendations', 'nextSteps', 'marketability'
    ];
    
    for (const field of requiredFields) {
      if (!analysis[field]) {
        throw new Error(`Missing required field in analysis: ${field}`);
      }
    }

    // Validate score ranges
    if (analysis.overallScore < 0 || analysis.overallScore > 100) {
      analysis.overallScore = Math.max(0, Math.min(100, analysis.overallScore));
    }
    
    if (analysis.marketability?.score < 0 || analysis.marketability?.score > 100) {
      analysis.marketability.score = Math.max(0, Math.min(100, analysis.marketability.score || 50));
    }

    if (analysis.careerPathAlignment?.alignmentScore < 0 || analysis.careerPathAlignment?.alignmentScore > 100) {
      if (analysis.careerPathAlignment) {
        analysis.careerPathAlignment.alignmentScore = Math.max(0, Math.min(100, analysis.careerPathAlignment.alignmentScore));
      }
    }
    
    return analysis;
    
  } catch (error) {
    console.error('CV analysis error:', error);
    throw new Error(`Failed to analyze CV content: ${error.message}`);
  }
}

/**
 * Generate fallback analysis when AI analysis fails
 * @param {Object} talent - Talent profile data
 * @param {Object} careerPath - Career path data (optional)
 * @returns {Object} - Fallback analysis
 */
function generateFallbackAnalysis(talent, careerPath) {
  const baseScore = 65;
  
  return {
    overallScore: baseScore,
    strengths: [
      "Profile shows clear career direction and purpose",
      `Appropriate skill set for ${talent.careerStage} career stage`,
      "Demonstrates commitment to professional development"
    ],
    weaknesses: [
      "Unable to fully analyze CV content due to technical limitations",
      "Limited visibility into detailed work experience",
      "Cannot verify consistency between profile and CV"
    ],
    profileVsCvGaps: {
      missingFromCV: ["Analysis temporarily unavailable"],
      missingFromProfile: ["Analysis temporarily unavailable"],
      inconsistencies: ["Could not perform detailed comparison at this time"]
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
      relevantExperience: ["Analysis based on profile information only"],
      additionalRequirements: ["Complete detailed CV analysis for comprehensive insights"]
    } : {
      alignmentScore: 0,
      matchingSkills: [],
      missingSkills: [],
      matchingCertifications: [],
      missingCertifications: [],
      relevantExperience: ["No career path selected for comparison"],
      additionalRequirements: ["Select a career path for targeted guidance"]
    },
    recommendations: [
      "Ensure CV is in a clear, readable format (PDF recommended)",
      "Update your profile with complete and accurate information",
      careerPath ? `Focus on developing required skills for ${careerPath.title}` : "Consider selecting a career path for targeted recommendations",
      "Try re-uploading your CV if the format may have caused issues"
    ],
    nextSteps: [
      "Re-attempt CV upload with optimized file format",
      "Complete all sections of your professional profile",
      "Review and update your skills and certifications list",
      "Consider career path selection for personalized guidance"
    ],
    marketability: {
      score: 55,
      summary: "Basic assessment available - complete CV analysis needed for detailed insights",
      competitiveAdvantages: [
        "Professional profile information available",
        "Clear career stage identification"
      ],
      improvementAreas: [
        "Need comprehensive CV analysis",
        "Profile optimization required",
        "Detailed skill verification needed"
      ]
    }
  };
}

/**
 * Main function handler
 */
module.exports = async function({ req, res, log, error }) {
  const startTime = Date.now();
  let uploadedFileId = null;
  
  try {
    log('=== CV Analysis Function Started ===');
    
    // Validate environment variables
    if (!process.env.GEMINI_API_KEY) {
      error('GEMINI_API_KEY environment variable is required');
      return res.json({ 
        success: false, 
        error: 'Server configuration error', 
        statusCode: 500 
      }, 500);
    }

    // Parse request body
    let requestData;
    try {
      requestData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (parseError) {
      error('Failed to parse request body:', parseError);
      return res.json({ 
        success: false, 
        error: 'Invalid JSON input', 
        statusCode: 400 
      }, 400);
    }

    const { talentId, fileData, fileName } = requestData;
    log(`Processing request for talent: ${talentId}, file: ${fileName}`);
    
    // Validate required parameters
    if (!talentId || !fileData || !fileName) {
      return res.json({ 
        success: false, 
        error: 'Missing required parameters: talentId, fileData, fileName', 
        statusCode: 400 
      }, 400);
    }

    // Validate file type
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    
    if (!allowedExtensions.includes(fileExtension)) {
      return res.json({
        success: false,
        error: 'Unsupported file type. Please upload PDF, DOC, DOCX, JPG, or PNG files.',
        statusCode: 400
      }, 400);
    }

    // Validate file size (base64 length approximation)
    const fileSizeBytes = (fileData.length * 3) / 4; // Approximate original size
    const maxSizeBytes = 5 * 1024 * 1024; // 5MB
    
    if (fileSizeBytes > maxSizeBytes) {
      return res.json({
        success: false,
        error: 'File size too large. Please upload files smaller than 5MB.',
        statusCode: 400
      }, 400);
    }

    // Fetch talent information
    // Fetch talent information
let talent;
try {
  log(`Fetching talent with ID: ${talentId}`);
  const talentQuery = await databases.listDocuments(
    config.databaseId,
    config.talentsCollectionId,
    [Query.equal('talentId', talentId)] // Changed from Query.equal('$id', talentId)
  );

  if (talentQuery.documents.length === 0) {
    log(`Talent not found with ID: ${talentId}`);
    return res.json({ 
      success: false, 
      error: 'Talent profile not found', 
      statusCode: 404 
    }, 404);
  }

  talent = talentQuery.documents[0];
  log(`Successfully fetched talent: ${talent.fullname} (${talent.careerStage})`);
  
} catch (dbError) {
  error('Database error fetching talent:', dbError);
  return res.json({ 
    success: false, 
    error: 'Failed to fetch talent information', 
    statusCode: 500 
  }, 500);
}

    // Fetch career path if selected
    let careerPath = null;
    if (talent.selectedPath) {
      try {
        log(`Fetching career path: ${talent.selectedPath}`);
        careerPath = await databases.getDocument(
          config.databaseId,
          config.careerPathsCollectionId,
          talent.selectedPath
        );
        log(`Successfully fetched career path: ${careerPath.title}`);
      } catch (pathError) {
        log(`Warning: Could not fetch career path (${talent.selectedPath}): ${pathError.message}`);
        // Continue without career path - this is not a critical error
      }
    } else {
      log('No career path selected for this talent');
    }

    // Perform CV analysis
    let analysis;
    let usedFallback = false;

    try {
      // Convert base64 to buffer
      const fileBuffer = Buffer.from(fileData, 'base64');
      log(`File buffer created: ${fileBuffer.length} bytes`);

      // Create temporary file in storage for processing
      try {
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
        log(`Temporary file uploaded: ${uploadedFileId}`);
      } catch (uploadError) {
        log(`Warning: Could not upload to storage, proceeding with buffer: ${uploadError.message}`);
      }

      // Extract text from CV
      log('Extracting text content from CV...');
      const cvText = await extractTextFromCV(fileBuffer, fileName);
      log(`Successfully extracted ${cvText.length} characters from CV`);

      // Analyze CV content with AI
      log('Starting AI analysis of CV content...');
      analysis = await analyzeCVContent(cvText, talent, careerPath);
      log('AI analysis completed successfully');

    } catch (analysisError) {
      error(`AI analysis failed: ${analysisError.message}`);
      log('Falling back to basic analysis...');
      
      // Generate fallback analysis
      analysis = generateFallbackAnalysis(talent, careerPath);
      usedFallback = true;
      log('Fallback analysis generated');
    } finally {
      // Clean up temporary file
      if (uploadedFileId) {
        try {
          await storage.deleteFile(config.storageId, uploadedFileId);
          log(`Temporary file deleted: ${uploadedFileId}`);
        } catch (deleteError) {
          error(`Failed to delete temporary file: ${deleteError.message}`);
        }
      }
    }

    // Prepare response
    const executionTime = Date.now() - startTime;
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
        executionTime: executionTime,
        usedFallback: usedFallback
      }
    };

    log(`=== CV Analysis Completed Successfully ===`);
    log(`Execution time: ${executionTime}ms`);
    log(`Analysis method: ${usedFallback ? 'Fallback' : 'AI-powered'}`);
    
    return res.json(response);

  } catch (unexpectedError) {
    const executionTime = Date.now() - startTime;
    error(`Unexpected error in CV analysis: ${unexpectedError.message}`);
    error(`Stack trace: ${unexpectedError.stack}`);
    
    // Clean up temporary file if it exists
    if (uploadedFileId) {
      try {
        await storage.deleteFile(config.storageId, uploadedFileId);
        log(`Cleaned up temporary file after error: ${uploadedFileId}`);
      } catch (deleteError) {
        error(`Failed to cleanup temporary file: ${deleteError.message}`);
      }
    }

    return res.json({
      success: false,
      error: 'Internal server error occurred during analysis',
      statusCode: 500,
      executionTime: executionTime
    }, 500);
  }
};