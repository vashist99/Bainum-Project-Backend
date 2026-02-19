import dotenv from "dotenv";
import Assessment from "../models/Assessment.js";
import fs from "fs";
import revai from "../lib/revai.js";
import ragClassifier from "../lib/ragClassifier.js";
import hybridScorer from "../lib/hybridScorer.js";
import { analyzeTranscript, calculateScores, extractKeywordSegments } from "../lib/transcriptProcessor.js";

dotenv.config();

const revaiController = async (req, res) => {
    let filePath = null;
    
    try {
        console.log("=== Audio Processing Request ===");
        console.log("Body:", { 
            childId: req.body?.childId, 
            uploadedBy: req.body?.uploadedBy,
            hasFile: !!req.file
        });

        const { childId, uploadedBy, recordingDate } = req.body;

        if (!childId) {
            console.error("Missing childId in request");
            return res.status(400).json({ message: "Child ID is required" });
        }

        if (!req.file) {
            console.error("No file uploaded in request");
            return res.status(400).json({ 
                message: "Audio file is required. Please select an audio file to upload." 
            });
        }

        filePath = req.file.path;
        console.log(`File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);
        console.log(`File saved to: ${filePath}`);

        // Verify file exists
        if (!fs.existsSync(filePath)) {
            console.error(`File does not exist at path: ${filePath}`);
            return res.status(500).json({ 
                message: "Uploaded file not found on server" 
            });
        }

        // Check if RevAI API key exists
        const config = revai.getConfig();
        console.log(`RevAI configuration:`, {
            apiBaseUrl: config.apiBaseUrl,
            apiKeySet: config.apiKeySet
        });

        if (!config.apiKeySet) {
            console.warn("⚠️  RevAI API key not set - transcription may fail");
        }

        // Check RevAI service health (non-blocking, just a warning)
        try {
            const isHealthy = await revai.isHealthy();
            if (!isHealthy) {
                console.warn("⚠️  RevAI service health check failed - will attempt transcription anyway");
            } else {
                console.log("✓ RevAI service is ready");
            }
        } catch (healthError) {
            console.warn("⚠️  Could not check RevAI service health:", healthError.message);
        }

        // Transcribe audio using RevAI
        console.log(`Starting transcription for file: ${req.file.filename}`);
        
        // Optimize for speed: skip diarization (speaker identification) for faster processing
        const transcriptionResult = await revai.transcribeFromFile(filePath, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            skipDiarization: true, // Skip speaker diarization for faster processing
            language: 'en' // Specify language for faster processing
        });

        console.log("RevAI Response received:", {
            hasText: !!transcriptionResult.text,
            hasRaw: !!transcriptionResult.raw,
            jobId: transcriptionResult.jobId
        });
        
        const transcript = revai.getTranscript(transcriptionResult);
        console.log(`Transcript extracted (${transcript.length} characters):`, transcript.substring(0, 100) + "...");

        // Validate transcript
        if (!transcript || transcript.trim().length === 0) {
            console.warn("⚠️  Empty transcript received from RevAI");
            // Continue processing even with empty transcript
        }

        // Analyze transcript for keywords
        const keywordCounts = analyzeTranscript(transcript || "");
        const keywordScores = calculateScores(keywordCounts);

        console.log("=== Keyword Analysis Complete ===");
        console.log("Transcript length:", transcript?.length || 0, "characters");
        console.log("Total words in transcript:", transcript?.split(/\s+/).filter(w => w.length > 0).length || 0);
        console.log("Keyword counts:", keywordCounts);
        console.log("Keyword scores:", keywordScores);

        // RAG Classification (if enabled)
        let ragScores = null;
        let ragSegments = null;
        let finalScores = keywordScores;
        // Check RAG_ENABLED - handle string 'true', boolean true, or case variations
        const ragEnabledValue = process.env.RAG_ENABLED?.toString().toLowerCase().trim();
        const ragEnabled = ragEnabledValue === 'true';
        
        // Debug logging for RAG configuration
        console.log("=== RAG Configuration Debug ===");
        console.log("RAG_ENABLED env value:", process.env.RAG_ENABLED);
        console.log("RAG_ENABLED normalized:", ragEnabledValue);
        console.log("ragEnabled computed:", ragEnabled);
        console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);

        if (ragEnabled && transcript && transcript.trim().length > 0) {
            try {
                console.log("=== Starting RAG Classification ===");
                const ragResult = await ragClassifier.classifyWithSegments(transcript);
                ragScores = ragResult.scores;
                ragSegments = ragResult.segments || [];
                console.log("RAG scores:", ragScores);
                console.log("RAG segments found:", ragSegments.length);

                // Combine RAG and keyword scores using hybrid scorer
                finalScores = hybridScorer.combineScores(ragScores, keywordScores);
                console.log("=== Hybrid Scoring Complete ===");
                console.log("Final combined scores:", finalScores);
                console.log("Weights:", hybridScorer.getWeights());
            } catch (ragError) {
                console.error("⚠️  RAG classification failed, falling back to keyword-only:", ragError.message);
                // Use keyword scores as fallback
                finalScores = keywordScores;
                ragScores = null;
                ragSegments = null;
            }
        } else {
            if (!ragEnabled) {
                console.log("RAG classification is disabled (RAG_ENABLED=false or not set)");
            } else {
                console.log("Skipping RAG classification (empty transcript)");
            }
        }

        // Fallback: always generate segments for highlighting (keyword-based when RAG has none)
        if (!ragSegments || ragSegments.length === 0) {
            ragSegments = extractKeywordSegments(transcript || "");
            if (ragSegments.length > 0) {
                console.log("Using keyword-based segments for highlighting:", ragSegments.length, "segments");
            }
        }

        // Prepare assessment data (but don't save yet - wait for user acceptance)
        console.log("Preparing assessment data...");
        
        // Use provided recordingDate or default to current date
        let assessmentDate = new Date();
        if (recordingDate) {
            const parsedDate = new Date(recordingDate);
            if (!isNaN(parsedDate.getTime())) {
                assessmentDate = parsedDate;
                console.log("Using provided recording date:", assessmentDate.toISOString());
            } else {
                console.warn("Invalid recordingDate provided, using current date");
            }
        } else {
            console.log("No recordingDate provided, using current date");
        }
        
        const assessmentData = {
            childId,
            audioFileName: req.file.filename,
            transcript: transcript || "",
            scienceTalk: finalScores.scienceTalk,
            socialTalk: finalScores.socialTalk,
            literatureTalk: finalScores.literatureTalk,
            languageDevelopment: finalScores.languageDevelopment,
            keywordCounts,
            uploadedBy: uploadedBy || "Unknown",
            date: assessmentDate
        };

        // Store RAG scores and segments (segments enable transcript highlighting)
        if (ragScores) {
            assessmentData.ragScores = ragScores;
            assessmentData.ragSegments = ragSegments;
            assessmentData.classificationMethod = 'hybrid';
        } else {
            assessmentData.classificationMethod = 'keyword-only';
        }
        // Always include segments when available (keyword-based fallback enables highlighting)
        if (ragSegments && ragSegments.length > 0) {
            assessmentData.ragSegments = ragSegments;
        }

        // Don't save yet - return data for user review
        console.log("✓ Assessment data prepared (awaiting user acceptance)");

        // Clean up uploaded file
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`✓ Cleaned up file: ${filePath}`);
            } catch (cleanupError) {
                console.warn("⚠️  Could not delete uploaded file:", cleanupError.message);
            }
        }

        console.log("=== Audio Processing Complete ===");
        
        res.status(200).json({
            message: "Audio processed successfully - please review transcript",
            assessment: assessmentData, // Return assessment data without saving
            transcript,
            keywordCounts,
            scores: finalScores,
            keywordScores: keywordScores,
            ragScores: ragScores || null,
            ragSegments: ragSegments || null,
            classificationMethod: assessmentData.classificationMethod
        });
    } catch (error) {
        console.error("=== ERROR PROCESSING AUDIO ===");
        console.error("Error type:", error.constructor.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
        
        // Provide more specific error messages
        let errorMessage = "Failed to process audio";
        let statusCode = 500;

        if (error.message.includes("unreachable") || error.message.includes("ECONNREFUSED")) {
            errorMessage = "RevAI service is not reachable. Please check your internet connection and API key.";
            statusCode = 503;
        } else if (error.message.includes("timeout") || error.message.includes("timed out")) {
            errorMessage = "Audio transcription timed out. The audio file may be too long or the service is overloaded.";
            statusCode = 504;
        } else if (error.message.includes("not found")) {
            errorMessage = "Audio file not found on server.";
            statusCode = 404;
        } else if (error.message.includes("API error") || error.message.includes("RevAI")) {
            errorMessage = `RevAI API error: ${error.message}`;
            statusCode = 502;
        } else if (error.message.includes("API key")) {
            errorMessage = "RevAI API key is required. Please set REVAI_API_KEY environment variable.";
            statusCode = 401;
        } else {
            errorMessage = error.message || "Failed to process audio. Check server logs for details.";
        }

        // Clean up file if it exists
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`✓ Cleaned up file after error: ${filePath}`);
            } catch (cleanupError) {
                console.warn("⚠️  Could not delete uploaded file after error:", cleanupError.message);
            }
        }

        res.status(statusCode).json({ 
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

export default revaiController;
