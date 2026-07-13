#!/usr/bin/env node
/**
 * One-shot migration: delete the per-child Assessment copies that were
 * fanned out from classroom / teacher-activity recordings.
 *
 * Classroom recordings now live exactly once, as a TeacherAssessment;
 * the child data page serves home talk only. Historical fan-out copies
 * are therefore redundant — but a row is deleted ONLY when it is
 * provably a copy, i.e. a TeacherAssessment exists with the same
 * fingerprint (date + audioFileName + wordCount/transcript). Rows with
 * no teacher counterpart (pre-TeacherAssessment data, unusual ingests)
 * are KEPT and reported for manual review; they simply become invisible
 * to the home-only child endpoints.
 *
 * Home-context rows (activityContext: 'home') are never candidates.
 *
 * Usage:
 *   MONGODB_URI=... node scripts/migrate-remove-classroom-fanout.js            # dry-run (default)
 *   MONGODB_URI=... node scripts/migrate-remove-classroom-fanout.js --apply    # delete + recompute cohort stats
 *
 * Idempotent: re-running after a successful pass matches zero rows.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const ORPHAN_SAMPLE_LIMIT = 25;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Stable fingerprint key shared by a fan-out copy and its TeacherAssessment. */
function fingerprintKey(doc) {
    const ts = doc.date ? new Date(doc.date).getTime() : "no-date";
    const audio = doc.audioFileName || "";
    return `${ts}|${audio}`;
}

/** Secondary check: the row carries the same content as the teacher row. */
function contentMatches(assessment, teacherRows) {
    return teacherRows.some((t) => {
        const aWords = assessment.wordCount ?? null;
        const tWords = t.wordCount ?? null;
        if (aWords !== tWords) return false;
        const aText = assessment.transcript || "";
        const tText = t.transcript || "";
        // The retention purge blanks transcripts on both collections at the
        // same expiry, so equal (possibly empty) text is expected either way.
        return aText === tText;
    });
}

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGODB_URI (or MONGO_URI) is required");
        process.exit(1);
    }

    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    const assessments = db.collection("assessments");
    const teacherAssessments = db.collection("teacherassessments");

    // Index every TeacherAssessment by fingerprint for O(1) candidate lookup.
    const teacherByFingerprint = new Map();
    const teacherCursor = teacherAssessments.find(
        {},
        { projection: { date: 1, audioFileName: 1, wordCount: 1, transcript: 1 } }
    );
    for await (const t of teacherCursor) {
        const key = fingerprintKey(t);
        if (!teacherByFingerprint.has(key)) teacherByFingerprint.set(key, []);
        teacherByFingerprint.get(key).push(t);
    }

    // Candidates: every non-home child assessment (school-context, rows with a
    // legacy classroomId stamp, and pre-activityContext rows). Deletion still
    // requires a fingerprint match, so casting a wide candidate net is safe.
    const candidateFilter = { activityContext: { $ne: "home" } };
    const cursor = assessments.find(candidateFilter, {
        projection: {
            childId: 1,
            classroomId: 1,
            date: 1,
            audioFileName: 1,
            wordCount: 1,
            transcript: 1,
            activityContext: 1,
            uploadedBy: 1,
        },
    });

    let candidates = 0;
    const toDelete = [];
    let orphans = 0;
    const orphanSamples = [];

    for await (const a of cursor) {
        candidates += 1;
        const teacherRows = teacherByFingerprint.get(fingerprintKey(a)) || [];
        if (teacherRows.length > 0 && contentMatches(a, teacherRows)) {
            toDelete.push(a._id);
        } else {
            orphans += 1;
            if (orphanSamples.length < ORPHAN_SAMPLE_LIMIT) {
                orphanSamples.push({
                    assessmentId: String(a._id),
                    childId: String(a.childId ?? ""),
                    date: a.date ?? null,
                    audioFileName: a.audioFileName || "",
                    activityContext: a.activityContext ?? null,
                    uploadedBy: a.uploadedBy || "",
                });
            }
        }
    }

    let deleted = 0;
    let backupFile = null;
    if (APPLY && toDelete.length > 0) {
        // Full-document backup of everything we are about to delete, so the
        // apply step is reversible by re-inserting the JSON.
        const docs = await assessments.find({ _id: { $in: toDelete } }).toArray();
        const backupDir = path.join(__dirname, "backups");
        fs.mkdirSync(backupDir, { recursive: true });
        backupFile = path.join(
            backupDir,
            `fanout-deleted-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
        );
        fs.writeFileSync(backupFile, JSON.stringify(docs, null, 2));

        const result = await assessments.deleteMany({ _id: { $in: toDelete } });
        deleted = result.deletedCount ?? 0;
    }

    let cohortRecomputed = false;
    if (APPLY) {
        // Recompute the children cohort baseline from the remaining (home)
        // assessments. Imported lazily so a dry run never touches CohortStats.
        const { recomputeAndSaveChildrenCohortStats } = await import(
            "../lib/cohortStatsService.js"
        );
        await recomputeAndSaveChildrenCohortStats();
        cohortRecomputed = true;
    }

    console.log(
        JSON.stringify(
            {
                mode: APPLY ? "apply" : "dry-run",
                candidatesExamined: candidates,
                provenFanOutCopies: toDelete.length,
                deleted,
                backupFile,
                orphansKept: orphans,
                orphanSamples,
                cohortRecomputed,
            },
            null,
            2
        )
    );

    if (!APPLY && toDelete.length > 0) {
        console.warn(
            `Dry run: ${toDelete.length} fan-out copies would be deleted. ` +
                `Re-run with --apply (a JSON backup of the deleted documents ` +
                `is written to scripts/backups/ automatically).`
        );
    }
    if (orphans > 0) {
        console.warn(
            `${orphans} non-home child assessments have no matching TeacherAssessment ` +
                `and were KEPT. They are invisible to the home-only child endpoints; ` +
                `review the samples above and delete manually if appropriate.`
        );
    }

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
