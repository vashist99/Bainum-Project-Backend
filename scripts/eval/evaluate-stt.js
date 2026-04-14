#!/usr/bin/env node
/**
 * STT (Speech-to-Text) evaluation script.
 * Computes Word Error Rate (WER) for RevAI transcription.
 *
 * Usage: node backend/scripts/eval/evaluate-stt.js (run from project root)
 *
 * Data: eval-data/data/stt/manifest.json, audio/, transcripts/
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

const DATA_DIR = path.join(projectRoot, "eval-data", "data");
const STT_DIR = path.join(DATA_DIR, "stt");
const MANIFEST_PATH = path.join(STT_DIR, "manifest.json");

function wordEditDistance(refWords, hypWords) {
  const R = refWords.length;
  const H = hypWords.length;
  const d = Array(R + 1)
    .fill(null)
    .map(() => Array(H + 1).fill(0));

  for (let i = 0; i <= R; i++) d[i][0] = i;
  for (let j = 0; j <= H; j++) d[0][j] = j;

  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= H; j++) {
      const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }

  let s = 0,
    i = 0,
    del = 0;
  let r = R,
    h = H;
  while (r > 0 || h > 0) {
    if (r > 0 && h > 0 && refWords[r - 1] === hypWords[h - 1]) {
      r--;
      h--;
    } else if (r > 0 && d[r][h] === d[r - 1][h] + 1) {
      del++;
      r--;
    } else if (h > 0 && d[r][h] === d[r][h - 1] + 1) {
      i++;
      h--;
    } else {
      s++;
      r--;
      h--;
    }
  }

  return { distance: d[R][H], substitutions: s, insertions: i, deletions: del };
}

function computeWER(reference, hypothesis) {
  const refWords = reference
    .toLowerCase()
    .replace(/<unk>/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const hypWords = hypothesis
    .toLowerCase()
    .replace(/<unk>/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const n = refWords.length;
  if (n === 0) {
    return {
      wer: hypWords.length > 0 ? 1 : 0,
      refWords: 0,
      hypWords: hypWords.length,
      ...wordEditDistance(refWords, hypWords),
    };
  }

  const { distance, substitutions, insertions, deletions } = wordEditDistance(refWords, hypWords);
  return {
    wer: distance / n,
    refWords: n,
    hypWords: hypWords.length,
    substitutions,
    insertions,
    deletions,
    distance,
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

  const revai = (await import("../../lib/revai.js")).default;

  if (!revai.getConfig?.().apiKeySet && !process.env.REVAI_API_KEY) {
    console.error("REVAI_API_KEY not set. Add it to .env");
    process.exit(1);
  }

  console.log("=== STT Evaluation (RevAI) ===\n");
  console.log(`Manifest: ${toProcess.length} samples${limit ? ` (--limit ${limit})` : ""}\n`);

  const results = [];
  let totalWER = 0;
  let totalRefWords = 0;

  for (let idx = 0; idx < toProcess.length; idx++) {
    const entry = toProcess[idx];
    const audioPath = path.join(STT_DIR, entry.audioPath);
    const refPath = path.join(STT_DIR, entry.referencePath);

    if (!fs.existsSync(audioPath)) {
      console.warn(`  [${entry.id}] Audio not found: ${audioPath}`);
      continue;
    }
    if (!fs.existsSync(refPath)) {
      console.warn(`  [${entry.id}] Reference not found: ${refPath}`);
      continue;
    }

    const reference = fs.readFileSync(refPath, "utf8").trim();
    process.stdout.write(`  [${idx + 1}/${toProcess.length}] ${entry.id} ... `);

    try {
      const result = await revai.transcribeFromFile(audioPath, {
        filename: path.basename(audioPath),
        mimetype: "audio/wav",
        skipDiarization: true,
        language: "en",
      });
      const hypothesis = revai.getTranscript(result) || "";

      const metrics = computeWER(reference, hypothesis);
      totalWER += metrics.wer * metrics.refWords;
      totalRefWords += metrics.refWords;

      results.push({
        id: entry.id,
        wer: metrics.wer,
        refWords: metrics.refWords,
        hypWords: metrics.hypWords,
        substitutions: metrics.substitutions,
        insertions: metrics.insertions,
        deletions: metrics.deletions,
      });

      console.log(`WER: ${(metrics.wer * 100).toFixed(2)}%`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ id: entry.id, error: err.message });
    }
  }

  const avgWER = totalRefWords > 0 ? totalWER / totalRefWords : 0;
  console.log("\n=== Summary ===");
  console.log(`Samples processed: ${results.filter((r) => !r.error).length}/${toProcess.length}`);
  console.log(`Average WER: ${(avgWER * 100).toFixed(2)}%`);
  console.log(`Total reference words: ${totalRefWords}`);

  const outPath = path.join(STT_DIR, "stt-eval-results.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        summary: {
          avgWER,
          totalRefWords,
          samplesProcessed: results.filter((r) => !r.error).length,
        },
        results,
      },
      null,
      2
    )
  );
  console.log(`\nDetailed results saved to: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
