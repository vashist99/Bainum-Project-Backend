#!/usr/bin/env node
/**
 * Fill languageFeatures on assessments that still have transcript text.
 *
 * Usage:
 *   MONGODB_URI=... node scripts/backfill-language-features.js
 *   MONGODB_URI=... node scripts/backfill-language-features.js --apply
 *
 * Empty transcripts are skipped. Rows already at the current schema version are skipped.
 */

import "dotenv/config";
import mongoose from "mongoose";
import {
    LANGUAGE_FEATURES_SCHEMA_VERSION,
    languageFeaturesForTranscript,
} from "../lib/languageFeatures.js";

const APPLY = process.argv.includes("--apply");
const COLLECTIONS = ["assessments", "teacherassessments"];

function needsBackfill(doc) {
    const transcript = typeof doc.transcript === "string" ? doc.transcript.trim() : "";
    if (!transcript) return false;
    const version = doc.languageFeatures?.schemaVersion;
    return version == null || version < LANGUAGE_FEATURES_SCHEMA_VERSION;
}

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGODB_URI (or MONGO_URI) is required");
        process.exit(1);
    }
    await mongoose.connect(uri);
    const summary = [];
    for (const name of COLLECTIONS) {
        const collection = mongoose.connection.db.collection(name);
        const cursor = collection.find(
            { transcript: { $exists: true, $nin: [null, ""] } },
            { projection: { transcript: 1, languageFeatures: 1 } }
        );
        let matched = 0;
        let updated = 0;
        let skippedEmpty = 0;
        for await (const doc of cursor) {
            if (!needsBackfill(doc)) {
                if (!String(doc.transcript || "").trim()) skippedEmpty += 1;
                continue;
            }
            matched += 1;
            if (!APPLY) continue;
            const features = languageFeaturesForTranscript(doc.transcript);
            await collection.updateOne({ _id: doc._id }, { $set: features });
            updated += 1;
        }
        summary.push({ name, matched, updated, skippedEmpty });
    }
    console.log(JSON.stringify({ apply: APPLY, schemaVersion: LANGUAGE_FEATURES_SCHEMA_VERSION, summary }, null, 2));
    await mongoose.disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
