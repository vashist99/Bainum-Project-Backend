#!/usr/bin/env node
/**
 * RAG classifier evaluation script.
 * Computes segment-level accuracy for RAG classification.
 *
 * Usage: node backend/scripts/eval/evaluate-rag.js (run from project root)
 * Or: node eval-data/scripts/evaluate-rag.js (via wrapper)
 *
 * Data: eval-data/data/rag/manifest.json
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root: backend/scripts/eval -> ../../ = project root
const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const DATA_DIR = path.join(projectRoot, "eval-data", "data");
const RAG_DIR = path.join(DATA_DIR, "rag");
const MANIFEST_PATH = path.join(RAG_DIR, "manifest.json");

function normalize(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findBestMatch(refSeg, predictedSegments, threshold = 0.5) {
  const refNorm = normalize(refSeg.text);
  const refWords = new Set(refNorm.split(/\s+/).filter(Boolean));
  if (refWords.size === 0) return { matched: false };

  let bestScore = 0;
  let bestCat = null;

  for (const pred of predictedSegments) {
    const predNorm = normalize(pred.text);
    const predWords = new Set(predNorm.split(/\s+/).filter(Boolean));
    const intersection = [...refWords].filter((w) => predWords.has(w)).length;
    const union = new Set([...refWords, ...predWords]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    const refInPred = [...refWords].filter((w) => predWords.has(w)).length / refWords.size;
    const predInRef = [...predWords].filter((w) => refWords.has(w)).length / (predWords.size || 1);
    const overlap = Math.max(jaccard, refInPred, predInRef);

    if (overlap > bestScore && overlap >= threshold) {
      bestScore = overlap;
      bestCat = pred.category;
    }
  }

  return bestCat ? { matched: true, predictedCategory: bestCat, overlap: bestScore } : { matched: false };
}

function evaluateSegments(referenceSegments, predictedSegments) {
  if (!referenceSegments || referenceSegments.length === 0) {
    return { correct: 0, total: 0, accuracy: 0, details: [] };
  }

  const details = [];
  let correct = 0;

  for (const ref of referenceSegments) {
    const match = findBestMatch(ref, predictedSegments);
    const isCorrect = match.matched && match.predictedCategory === ref.category;
    if (isCorrect) correct++;
    details.push({
      refText: ref.text.substring(0, 50) + (ref.text.length > 50 ? "..." : ""),
      refCategory: ref.category,
      matched: match.matched,
      predictedCategory: match.predictedCategory || null,
      correct: isCorrect,
    });
  }

  return {
    correct,
    total: referenceSegments.length,
    accuracy: referenceSegments.length > 0 ? correct / referenceSegments.length : 0,
    details,
  };
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 && process.argv[limitIdx + 1] ? parseInt(process.argv[limitIdx + 1], 10) : null;
  const toProcess = limit ? manifest.slice(0, limit) : manifest;

  const connectDB = (await import("../../config/db.js")).default;
  const ragClassifier = (await import("../../lib/ragClassifier.js")).default;

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set. Add it to .env");
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI not set. Add it to .env");
    process.exit(1);
  }

  await connectDB();

  console.log("=== RAG Classifier Evaluation ===\n");
  console.log(`Manifest: ${toProcess.length} samples${limit ? ` (--limit ${limit})` : ""}\n`);

  const results = [];
  let totalCorrect = 0;
  let totalSegments = 0;

  for (let idx = 0; idx < toProcess.length; idx++) {
    const entry = toProcess[idx];
    process.stdout.write(`  [${idx + 1}/${toProcess.length}] ${entry.id} ... `);

    try {
      const ragResult = await ragClassifier.classifyWithSegments(entry.transcript);
      const predictedSegments = ragResult.segments || [];

      const evalResult = evaluateSegments(entry.referenceSegments, predictedSegments);
      totalCorrect += evalResult.correct;
      totalSegments += evalResult.total;

      results.push({
        id: entry.id,
        accuracy: evalResult.accuracy,
        correct: evalResult.correct,
        total: evalResult.total,
        predictedCount: predictedSegments.length,
      });

      console.log(`Acc: ${(evalResult.accuracy * 100).toFixed(1)}% (${evalResult.correct}/${evalResult.total})`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ id: entry.id, error: err.message });
    }
  }

  const overallAccuracy = totalSegments > 0 ? totalCorrect / totalSegments : 0;
  console.log("\n=== Summary ===");
  console.log(`Samples processed: ${results.filter((r) => !r.error).length}/${toProcess.length}`);
  console.log(`Segment-level accuracy: ${(overallAccuracy * 100).toFixed(2)}%`);
  console.log(`Correct segments: ${totalCorrect}/${totalSegments}`);

  const outPath = path.join(RAG_DIR, "rag-eval-results.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        summary: { overallAccuracy, totalCorrect, totalSegments, samplesProcessed: results.filter((r) => !r.error).length },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nDetailed results saved to: ${outPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
