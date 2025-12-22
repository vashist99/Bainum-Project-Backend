import dotenv from "dotenv";
import Assessment from "../models/Assessment.js";
import fs from "fs";
import revai from "../lib/revai.js";

dotenv.config();

// Comprehensive keyword lists for each category
const KEYWORDS = {
    science: [
        "experiment", "hypothesis", "observe", "predict", "measure", "test", "data", "result",
        "science", "scientist", "discover", "investigate", "analyze", "research", "study",
        "evidence", "theory", "fact", "prove", "conclusion", "question", "answer", "why",
        "how", "what", "when", "where", "because", "reason", "cause", "effect", "change",
        "grow", "plant", "animal", "nature", "weather", "water", "air", "earth", "space",
        "star", "planet", "moon", "sun", "light", "dark", "hot", "cold", "big", "small",
        "heavy", "light", "fast", "slow", "up", "down", "inside", "outside", "color",
        "shape", "size", "number", "count", "more", "less", "same", "different"
    ],
    social: [
        "friend", "share", "help", "together", "feelings", "happy", "sad", "angry", "excited",
        "scared", "worried", "proud", "sorry", "thank", "please", "welcome", "hello", "goodbye",
        "play", "game", "fun", "laugh", "smile", "cry", "hug", "love", "care", "kind",
        "nice", "mean", "fair", "unfair", "right", "wrong", "good", "bad", "yes", "no",
        "maybe", "okay", "sure", "family", "mom", "dad", "parent", "brother", "sister",
        "baby", "child", "people", "person", "group", "team", "class", "school", "teacher",
        "student", "learn", "teach", "listen", "talk", "say", "tell", "ask", "answer",
        "understand", "know", "think", "remember", "forget", "want", "need", "like", "dislike"
    ],
    literature: [
        "story", "character", "beginning", "ending", "imagine", "pretend", "make-believe",
        "fairy tale", "tale", "book", "read", "page", "chapter", "title", "author", "writer",
        "write", "draw", "picture", "illustration", "drawing", "art", "create", "make",
        "once upon a time", "once", "long ago", "happily ever after", "the end", "begin",
        "start", "finish", "end", "first", "last", "next", "then", "after", "before",
        "prince", "princess", "king", "queen", "castle", "dragon", "magic", "wizard",
        "witch", "fairy", "giant", "dwarf", "hero", "villain", "adventure", "journey",
        "travel", "visit", "go", "come", "arrive", "leave", "return", "home", "place",
        "where", "there", "here", "far", "near", "find", "lose", "search", "look", "see",
        "watch", "show", "hide", "appear", "disappear", "magic", "wish", "dream", "hope"
    ],
    language: [
        "word", "sentence", "speak", "listen", "communicate", "talk", "say", "tell",
        "speech", "language", "voice", "sound", "noise", "quiet", "loud", "soft",
        "whisper", "shout", "yell", "call", "name", "label", "describe", "explain",
        "mean", "meaning", "understand", "comprehend", "know", "learn", "teach",
        "question", "ask", "answer", "reply", "respond", "conversation", "discuss",
        "chat", "talk", "speak", "say", "tell", "speech", "pronounce", "pronunciation",
        "letter", "alphabet", "read", "write", "spell", "spelling", "grammar", "noun",
        "verb", "adjective", "sentence", "phrase", "paragraph", "story", "book",
        "dictionary", "vocabulary", "word", "term", "expression", "idiom", "phrase"
    ]
};

// Function to count keywords in transcript
const analyzeTranscript = (transcript) => {
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
        console.warn("Empty or invalid transcript provided for analysis");
        return {
            science: 0,
            social: 0,
            literature: 0,
            language: 0
        };
    }

    const lowerTranscript = transcript.toLowerCase();
    const counts = {
        science: 0,
        social: 0,
        literature: 0,
        language: 0
    };

    // Count occurrences of each keyword
    Object.keys(KEYWORDS).forEach(category => {
        KEYWORDS[category].forEach(keyword => {
            // Handle multi-word keywords (like "once upon a time", "fairy tale")
            if (keyword.includes(' ')) {
                // For multi-word phrases, count exact matches (case-insensitive)
                const phraseRegex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
                const phraseMatches = lowerTranscript.match(phraseRegex);
                if (phraseMatches) {
                    counts[category] += phraseMatches.length;
                }
            } else {
                // For single words, use word boundaries to match whole words only
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            const matches = lowerTranscript.match(regex);
            if (matches) {
                counts[category] += matches.length;
                }
            }
        });
    });

    const totalMatches = counts.science + counts.social + counts.literature + counts.language;
    console.log(`Keyword analysis: Found ${totalMatches} total keyword matches (Science: ${counts.science}, Social: ${counts.social}, Literature: ${counts.literature}, Language: ${counts.language})`);

    return counts;
};

// Calculate percentage scores based on keyword counts
const calculateScores = (counts) => {
    // Simple scoring: each keyword occurrence adds points, capped at 100
    const maxPerCategory = 20; // Max expected keywords per category
    
    return {
        scienceTalk: Math.min(100, Math.round((counts.science / maxPerCategory) * 100)),
        socialTalk: Math.min(100, Math.round((counts.social / maxPerCategory) * 100)),
        literatureTalk: Math.min(100, Math.round((counts.literature / maxPerCategory) * 100)),
        languageDevelopment: Math.min(100, Math.round((counts.language / maxPerCategory) * 100))
    };
};

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
        const scores = calculateScores(keywordCounts);

        console.log("=== Keyword Analysis Complete ===");
        console.log("Transcript length:", transcript?.length || 0, "characters");
        console.log("Total words in transcript:", transcript?.split(/\s+/).filter(w => w.length > 0).length || 0);
        console.log("Keyword counts:", keywordCounts);
        console.log("Scores:", scores);

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
            scienceTalk: scores.scienceTalk,
            socialTalk: scores.socialTalk,
            literatureTalk: scores.literatureTalk,
            languageDevelopment: scores.languageDevelopment,
            keywordCounts,
            uploadedBy: uploadedBy || "Unknown",
            date: assessmentDate
        };

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
            scores
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
