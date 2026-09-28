#!/usr/bin/env node
/**
 * One-shot migration: convert classroom age groups stored as former named
 * bands (Infant, Toddler, Preschool, Pre-K) to year ranges.
 *
 * The app already reports and saves the converted value, so this only
 * cleans storage.
 *
 * Usage:
 *   MONGODB_URI=... node scripts/migrate-age-group-year-ranges.js            # dry-run (default)
 *   MONGODB_URI=... node scripts/migrate-age-group-year-ranges.js --apply    # write
 *
 * Idempotent: re-running after a successful pass matches zero rows.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { LEGACY_AGE_GROUPS } from "../lib/classroomHelpers.js";

const APPLY = process.argv.includes("--apply");

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGODB_URI (or MONGO_URI) is required");
        process.exit(1);
    }

    await mongoose.connect(uri);
    const classrooms = mongoose.connection.db.collection("classrooms");

    const conversions = [];
    for (const [from, to] of Object.entries(LEGACY_AGE_GROUPS)) {
        const matched = await classrooms.countDocuments({ ageGroup: from });
        let updated = 0;
        if (APPLY && matched > 0) {
            const result = await classrooms.updateMany({ ageGroup: from }, { $set: { ageGroup: to } });
            updated = result.modifiedCount ?? 0;
        }
        conversions.push({ from, to, matched, updated });
    }

    console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", conversions }, null, 2));

    const pending = conversions.reduce((sum, row) => sum + row.matched, 0);
    if (!APPLY && pending > 0) {
        console.warn(`Dry run: ${pending} classrooms would be converted. Re-run with --apply.`);
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
