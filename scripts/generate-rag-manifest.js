#!/usr/bin/env node
/**
 * Generates manifest.json for RAG classifier evaluation.
 * Uses knowledge base examples to create transcripts with ground-truth segments.
 * Run: node backend/scripts/generate-rag-manifest.js
 * Output: eval-data/rag/manifest.json (or path from EVAL_DATA_PATH)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const categories = ["science", "social", "literature", "language"];
const examplesByCategory = {};

// Load knowledge base
for (const cat of categories) {
  const filename =
    cat === "language"
      ? "languageDevelopmentExamples.json"
      : `${cat}TalkExamples.json`;
  const filepath = path.join(
    __dirname,
    "..",
    "lib",
    "knowledgeBase",
    filename
  );
  const data = JSON.parse(fs.readFileSync(filepath, "utf8"));
  examplesByCategory[cat] = data.examples.map((ex) => ({
    text: ex.text,
    category: data.category,
  }));
}

// Deterministic pick by index (reproducible)
function pick(arr, idx) {
  return arr[idx % arr.length];
}

// Build 100 test cases: 40 single, 40 two-segment, 20 three-segment
const manifest = [];
let id = 1;

// 40 single-segment (10 per category)
for (const cat of categories) {
  for (let i = 0; i < 10; i++) {
    const ex = examplesByCategory[cat][i];
    manifest.push({
      id: `rag-${String(id).padStart(3, "0")}`,
      transcript: ex.text,
      referenceSegments: [{ text: ex.text, category: ex.category }],
    });
    id++;
  }
}

// 40 two-segment (varied category pairs, deterministic indices)
const catPairs = [
  ["science", "social"],
  ["science", "literature"],
  ["science", "language"],
  ["social", "literature"],
  ["social", "language"],
  ["literature", "language"],
  ["science", "science"],
  ["social", "social"],
  ["literature", "literature"],
  ["language", "language"],
];

for (let i = 0; i < 40; i++) {
  const [cat1, cat2] = catPairs[i % catPairs.length];
  const ex1 = pick(examplesByCategory[cat1], i);
  const ex2 = pick(examplesByCategory[cat2], i + 7); // offset for variety
  manifest.push({
    id: `rag-${String(id).padStart(3, "0")}`,
    transcript: `${ex1.text} ${ex2.text}`,
    referenceSegments: [
      { text: ex1.text, category: ex1.category },
      { text: ex2.text, category: ex2.category },
    ],
  });
  id++;
}

// 20 three-segment
for (let i = 0; i < 20; i++) {
  const catOrder = [
    ["science", "social", "literature"],
    ["social", "literature", "language"],
    ["literature", "language", "science"],
    ["language", "science", "social"],
  ][i % 4];
  const segs = catOrder.map((c, j) =>
    pick(examplesByCategory[c], i + j * 3)
  );
  manifest.push({
    id: `rag-${String(id).padStart(3, "0")}`,
    transcript: segs.map((s) => s.text).join(" "),
    referenceSegments: segs.map((s) => ({
      text: s.text,
      category: s.category,
    })),
  });
  id++;
}

const finalManifest = manifest;

// Output directory
const baseDir =
  process.env.EVAL_DATA_PATH ||
  path.join(path.dirname(__dirname), "..", "eval-data");
const ragDir = path.join(baseDir, "rag");
fs.mkdirSync(ragDir, { recursive: true });

const outPath = path.join(ragDir, "manifest.json");
fs.writeFileSync(outPath, JSON.stringify(finalManifest, null, 2), "utf8");

console.log(`Generated ${finalManifest.length} RAG test cases`);
console.log(`Written to: ${outPath}`);
