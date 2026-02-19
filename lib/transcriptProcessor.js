/**
 * Shared transcript analysis logic for child and teacher assessments.
 * Used by whisperController and classroomWhisperController.
 */

export const KEYWORDS = {
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

export const analyzeTranscript = (transcript) => {
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
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

    Object.keys(KEYWORDS).forEach(category => {
        KEYWORDS[category].forEach(keyword => {
            if (keyword.includes(' ')) {
                const phraseRegex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi');
                const phraseMatches = lowerTranscript.match(phraseRegex);
                if (phraseMatches) counts[category] += phraseMatches.length;
            } else {
                const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                const matches = lowerTranscript.match(regex);
                if (matches) counts[category] += matches.length;
            }
        });
    });

    return counts;
};

export const calculateScores = (counts) => {
    const maxPerCategory = 20;
    return {
        scienceTalk: Math.min(100, Math.round((counts.science / maxPerCategory) * 100)),
        socialTalk: Math.min(100, Math.round((counts.social / maxPerCategory) * 100)),
        literatureTalk: Math.min(100, Math.round((counts.literature / maxPerCategory) * 100)),
        languageDevelopment: Math.min(100, Math.round((counts.language / maxPerCategory) * 100))
    };
};

export const extractKeywordSegments = (transcript) => {
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
        return [];
    }

    const segments = [];
    Object.keys(KEYWORDS).forEach(category => {
        KEYWORDS[category].forEach(keyword => {
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = keyword.includes(' ')
                ? new RegExp(`\\b${escapedKeyword.replace(/\s+/g, '\\s+')}\\b`, 'gi')
                : new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
            let match;
            while ((match = pattern.exec(transcript)) !== null) {
                segments.push({
                    text: match[0],
                    category,
                    startIndex: match.index,
                    endIndex: match.index + match[0].length
                });
            }
        });
    });

    return segments;
};
