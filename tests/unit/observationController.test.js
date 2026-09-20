import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import TeacherAssessment from "../../models/TeacherAssessment.js";
import Classroom from "../../models/Classroom.js";
import ActivityLog from "../../models/ActivityLog.js";
import CohortStats from "../../models/CohortStats.js";
import {
    patchTeacherObservationNote,
    patchTeacherObservationHidden,
} from "../../controllers/observationController.js";

const RECORDER_ID = "64b0000000000000000000aa";
const ADMIN_ID = "64b0000000000000000000ad";
const OTHER_ID = "64b0000000000000000000bb";
const CLASSROOM_ID = "64b0000000000000000000c1";
const ASSESSMENT_ID = "64b0000000000000000000a1";

const classroomDoc = {
    _id: new mongoose.Types.ObjectId(CLASSROOM_ID),
    name: "Sunflowers",
    teacher: RECORDER_ID,
    assistantTeacher: null,
    parents: [],
};

function mockRes() {
    return {
        statusCode: undefined,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

function mockDoc(overrides = {}) {
    return {
        _id: new mongoose.Types.ObjectId(ASSESSMENT_ID),
        classroomId: new mongoose.Types.ObjectId(CLASSROOM_ID),
        teacherId: RECORDER_ID,
        recordedById: RECORDER_ID,
        hidden: false,
        observationNote: null,
        async save() {
            return this;
        },
        ...overrides,
    };
}

function mockPlaceAccess(t) {
    t.mock.method(Classroom, "findById", async () => classroomDoc);
    t.mock.method(TeacherAssessment, "find", () => ({
        select: async () => [],
    }));
    t.mock.method(CohortStats, "findOneAndUpdate", async () => ({}));
    t.mock.method(ActivityLog, "create", async () => ({}));
}

describe("observation PATCH authorization", () => {
    test("note PATCH is 403 when the observation is hidden from the caller", async (t) => {
        mockPlaceAccess(t);
        t.mock.method(TeacherAssessment, "findById", async () =>
            mockDoc({ hidden: true, recordedById: RECORDER_ID })
        );
        const res = mockRes();
        await patchTeacherObservationNote(
            {
                params: { assessmentId: ASSESSMENT_ID },
                body: { text: "Should not land" },
                user: { id: ADMIN_ID, role: "admin", name: "Ada" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("hidden PATCH is 403 for a non-recorder", async (t) => {
        mockPlaceAccess(t);
        t.mock.method(TeacherAssessment, "findById", async () => mockDoc());
        const res = mockRes();
        await patchTeacherObservationHidden(
            {
                params: { assessmentId: ASSESSMENT_ID },
                body: { hidden: true },
                user: { id: ADMIN_ID, role: "admin", name: "Ada" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /recorder/i);
    });

    test("hidden PATCH is 403 for another teacher", async (t) => {
        mockPlaceAccess(t);
        t.mock.method(TeacherAssessment, "findById", async () => mockDoc());
        const res = mockRes();
        await patchTeacherObservationHidden(
            {
                params: { assessmentId: ASSESSMENT_ID },
                body: { hidden: true },
                user: { id: OTHER_ID, role: "teacher", name: "Pat" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("recorder can hide and the note remains last-write", async (t) => {
        mockPlaceAccess(t);
        const doc = mockDoc();
        t.mock.method(TeacherAssessment, "findById", async () => doc);
        const hideRes = mockRes();
        await patchTeacherObservationHidden(
            {
                params: { assessmentId: ASSESSMENT_ID },
                body: { hidden: true },
                user: { id: RECORDER_ID, role: "teacher", name: "Riley" },
            },
            hideRes
        );
        assert.equal(hideRes.statusCode, 200);
        assert.equal(hideRes.body.hidden, true);
        assert.equal(hideRes.body.canHide, true);

        const noteRes = mockRes();
        await patchTeacherObservationNote(
            {
                params: { assessmentId: ASSESSMENT_ID },
                body: { text: "Recorder note" },
                user: { id: RECORDER_ID, role: "teacher", name: "Riley" },
            },
            noteRes
        );
        assert.equal(noteRes.statusCode, 200);
        assert.equal(noteRes.body.observationNote.text, "Recorder note");
    });
});
