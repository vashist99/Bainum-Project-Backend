import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import connectDB from "../config/db.js";
import embeddingService from "../lib/embeddingService.js";
import vectorStore from "../lib/vectorStore.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KNOWLEDGE_BASE_DIR = join(__dirname, "..", "lib", "knowledgeBase");
const CATEGORIES = ['science', 'social', 'literature', 'language'];

/**
 * Load knowledge base examples from JSON files
 */
function loadKnowledgeBase() {
    const knowledgeBase = {};

    for (const category of CATEGORIES) {
        const filePath = join(KNOWLEDGE_BASE_DIR, `${category}TalkExamples.json`);
        
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️  Knowledge base file not found: ${filePath}`);
            knowledgeBase[category] = { examples: [] };
            continue;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            knowledgeBase[category] = data;
            console.log(`✓ Loaded ${data.examples?.length || 0} examples for ${category}`);
        } catch (error) {
            console.error(`Error loading ${filePath}:`, error);
            knowledgeBase[category] = { examples: [] };
        }
    }

    return knowledgeBase;
}

/**
 * Initialize knowledge base embeddings
 */
async function initializeKnowledgeBase() {
    console.log("=== Initializing Knowledge Base Embeddings ===\n");

    // Connect to database
    try {
        await connectDB();
        console.log("✓ Connected to MongoDB\n");
    } catch (error) {
        console.error("Failed to connect to database:", error);
        process.exit(1);
    }

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
        console.error("❌ OPENAI_API_KEY not set in environment variables");
        process.exit(1);
    }

    // Load knowledge base
    console.log("Loading knowledge base files...");
    const knowledgeBase = loadKnowledgeBase();
    console.log("✓ Knowledge base loaded\n");

    // Option to clear existing embeddings
    const args = process.argv.slice(2);
    if (args.includes('--clear')) {
        console.log("Clearing existing embeddings...");
        await vectorStore.clearAll();
        console.log("✓ Existing embeddings cleared\n");
    }

    // Process each category
    let totalProcessed = 0;
    let totalErrors = 0;

    for (const category of CATEGORIES) {
        const examples = knowledgeBase[category]?.examples || [];
        
        if (examples.length === 0) {
            console.log(`⚠️  No examples found for ${category}, skipping...\n`);
            continue;
        }

        console.log(`Processing ${category} category (${examples.length} examples)...`);

        // Check existing embeddings
        const existingCount = await vectorStore.getCounts();
        const existing = existingCount[category] || 0;
        
        if (existing > 0 && !args.includes('--clear')) {
            console.log(`  Found ${existing} existing embeddings for ${category}`);
            console.log(`  Use --clear flag to re-initialize\n`);
            continue;
        }

        // Process examples in batches
        const batchSize = 10;
        for (let i = 0; i < examples.length; i += batchSize) {
            const batch = examples.slice(i, i + batchSize);
            const texts = batch.map(ex => ex.text);
            
            try {
                // Generate embeddings for batch
                const embeddings = await embeddingService.generateEmbeddingsBatch(texts, false);
                
                // Store each embedding
                for (let j = 0; j < batch.length; j++) {
                    const example = batch[j];
                    const embedding = embeddings[j];
                    
                    await vectorStore.storeEmbedding(
                        example.text,
                        category,
                        embedding,
                        {
                            indicators: example.indicators || [],
                            source: 'knowledgeBase'
                        }
                    );
                    
                    totalProcessed++;
                }
                
                console.log(`  Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(examples.length / batchSize)}`);
            } catch (error) {
                console.error(`  Error processing batch:`, error.message);
                totalErrors += batch.length;
            }
        }

        console.log(`✓ Completed ${category} category\n`);
    }

    // Summary
    console.log("=== Initialization Complete ===");
    console.log(`Total examples processed: ${totalProcessed}`);
    if (totalErrors > 0) {
        console.log(`Errors: ${totalErrors}`);
    }

    // Show final counts
    const counts = await vectorStore.getCounts();
    console.log("\nFinal embedding counts:");
    for (const category of CATEGORIES) {
        console.log(`  ${category}: ${counts[category] || 0}`);
    }

    process.exit(0);
}

// Run initialization
initializeKnowledgeBase().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
