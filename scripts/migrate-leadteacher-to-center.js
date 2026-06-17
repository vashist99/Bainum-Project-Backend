#!/usr/bin/env node
/**
 * One-shot migration: backfill Child.center from the legacy
 * Child.leadTeacher name and then $unset the orphaned leadTeacher field.
 *
 * Run BEFORE the application is restarted on the new schema, so the new
 * `center: { required: true }` constraint sees a value on every existing
 * child. After the new code starts, the legacy `leadTeacher` value in
 * MongoDB is invisible to mongoose (strict mode), so this script does the
 * work using the raw collection.
 *
 * Usage:
 *   MONGODB_URI=... node scripts/migrate-leadteacher-to-center.js
 *   MONGODB_URI=... node scripts/migrate-leadteacher-to-center.js --dry-run
 *
 * Output summary:
 *   - matched (child rows with a non-empty leadTeacher)
 *   - updated (rows where we resolved center successfully)
 *   - skipped (rows whose leadTeacher did not resolve to a teacher)
 *   - alreadyHadCenter (rows that already carried a center value)
 *
 * IDempotent: re-running after a successful pass touches nothing.
 */

import "dotenv/config";
import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");

function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGODB_URI (or MONGO_URI) is required");
        process.exit(1);
    }

    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const children = db.collection("children");
    const teachers = db.collection("teachers");

    const cursor = children.find({}, { projection: { name: 1, leadTeacher: 1, center: 1 } });

    let matched = 0;
    let updated = 0;
    let skipped = 0;
    let alreadyHadCenter = 0;
    const unresolved = [];

    for await (const child of cursor) {
        const legacy = typeof child.leadTeacher === "string" ? child.leadTeacher.trim() : "";
        if (!legacy) {
            if (child.center) alreadyHadCenter += 1;
            continue;
        }
        matched += 1;

        if (child.center) {
            // Already migrated for this row; just drop the orphan field.
            alreadyHadCenter += 1;
            if (!DRY_RUN) {
                await children.updateOne({ _id: child._id }, { $unset: { leadTeacher: "" } });
            }
            continue;
        }

        // Try exact match first (fast, uses any unique index if present), then
        // case-insensitive whitespace-trimmed fallback — same heuristic as the
        // legacy getSupervisedChildrenForTeacher helper used for child lookup.
        let teacher = await teachers.findOne({ name: legacy }, { projection: { center: 1 } });
        if (!teacher) {
            teacher = await teachers.findOne(
                { name: { $regex: `^\\s*${escapeRegex(legacy)}\\s*$`, $options: "i" } },
                { projection: { center: 1 } }
            );
        }

        if (!teacher || !teacher.center) {
            skipped += 1;
            unresolved.push({ childId: String(child._id), name: child.name, leadTeacher: legacy });
            continue;
        }

        if (DRY_RUN) {
            updated += 1;
            continue;
        }

        await children.updateOne(
            { _id: child._id },
            { $set: { center: teacher.center }, $unset: { leadTeacher: "" } }
        );
        updated += 1;
    }

    console.log(JSON.stringify({
        dryRun: DRY_RUN,
        matched,
        updated,
        skipped,
        alreadyHadCenter,
        unresolved,
    }, null, 2));

    if (skipped > 0) {
        console.warn(
            `${skipped} children could not be auto-migrated. Their center must be set ` +
            `manually (or via re-enrollment in a classroom) before the new code starts ` +
            `— otherwise creating an Assessment for them will fail validation when the ` +
            `new schema is enforced. See "unresolved" above.`
        );
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
