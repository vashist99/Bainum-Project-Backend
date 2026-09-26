import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { coachPerformanceAccess, selectCoachPerformanceRows } from "../../lib/coachPerformance.js";

const LEAD = "teacher-lead";
const ASSISTANT = "teacher-assistant";
const OTHER = "teacher-other";
const ROOM_A = "room-a";
const ROOM_B = "room-b";

const classrooms = [
    { _id: ROOM_A, teacher: LEAD, assistantTeacher: null },
    { _id: ROOM_B, teacher: OTHER, assistantTeacher: ASSISTANT },
];

describe("selectCoachPerformanceRows", () => {
    test("keeps both assigned teachers, including a classroom with no grant, and drops everyone else", () => {
        const rows = selectCoachPerformanceRows({
            assignedTeacherIds: [LEAD, ASSISTANT],
            classrooms,
            assessments: [
                {
                    teacherId: LEAD,
                    classroomId: ROOM_A,
                    date: "2026-03-01",
                    wordsPerMinute: 120,
                    transcript: "Lead words",
                    observationComments: [{ text: "a note" }],
                },
                {
                    teacherId: ASSISTANT,
                    classroomId: ROOM_B,
                    date: "2026-04-01",
                    wordsPerMinute: 80,
                    transcript: "Assistant words",
                },
                {
                    teacherId: OTHER,
                    classroomId: ROOM_B,
                    date: "2026-04-02",
                    wordsPerMinute: 200,
                    transcript: "Co-teacher words",
                },
                {
                    teacherId: LEAD,
                    classroomId: null,
                    transcript: "Unscoped words",
                    wordsPerMinute: 10,
                },
                {
                    teacherId: LEAD,
                    classroomId: ROOM_A,
                    hidden: true,
                    transcript: "Hidden words",
                    wordsPerMinute: 5,
                },
                {
                    teacherId: LEAD,
                    classroomId: ROOM_A,
                    activityContext: "home",
                    transcript: "Home words",
                    wordsPerMinute: 7,
                },
            ],
        });

        assert.equal(rows.length, 2);
        assert.deepEqual(
            rows.map((row) => row.wordsPerMinute),
            [120, 80]
        );
        for (const row of rows) {
            assert.equal("transcript" in row, false);
            assert.equal("observationComments" in row, false);
            assert.equal("hidden" in row, false);
        }
    });
});

describe("coachPerformanceAccess", () => {
    test("allows an admin and that coach, and rejects everyone else", () => {
        assert.equal(coachPerformanceAccess({ role: "admin", id: "admin-1" }, "coach-1"), true);
        assert.equal(coachPerformanceAccess({ role: "coach", id: "coach-1" }, "coach-1"), true);
        assert.equal(coachPerformanceAccess({ role: "coach", id: "coach-2" }, "coach-1"), false);
        assert.equal(coachPerformanceAccess({ role: "teacher", id: "teacher-1" }, "coach-1"), false);
        assert.equal(coachPerformanceAccess({ role: "parent", id: "parent-1" }, "coach-1"), false);
    });
});
