import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import classroomWhisperController from "../../controllers/classroomWhisperController.js";
import { acceptTeacherAssessment } from "../../controllers/teacherAcceptController.js";
import { getClassroomTranscripts } from "../../controllers/classroomController.js";
import Classroom from "../../models/Classroom.js";
import CoachClassroomGrant from "../../models/CoachClassroomGrant.js";
import TeacherAssessment from "../../models/TeacherAssessment.js";
import Notification from "../../models/Notification.js";
import { Teacher } from "../../models/User.js";

const LEAD_ID = "64b000000000000000000001";
const COACH_ID = "64b000000000000000000004";
const PARENT_ID = "64b000000000000000000003";
const CLASSROOM_ID = "64b0000000000000000000aa";

const classroomDoc = {
    _id: new mongoose.Types.ObjectId(CLASSROOM_ID),
    name: "Sunflowers",
    teacher: LEAD_ID,
    assistantTeacher: null,
    parents: [PARENT_ID],
    center: "Main Street Center",
};

function mockRes() {
    return {
        statusCode: null,
        body: null,
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

function mockGrant(t, result) {
    t.mock.method(CoachClassroomGrant, "findOne", (query) => ({
        lean: async () => {
            if (result && query.status && query.status !== result.status) return null;
            return result;
        },
    }));
}

function classroomFindByIdChain(doc) {
    const chain = {
        populate() {
            return chain;
        },
        then(resolve, reject) {
            return Promise.resolve(doc).then(resolve, reject);
        },
    };
    return () => chain;
}

function acceptBody(overrides = {}) {
    return {
        teacherId: COACH_ID,
        classroomId: CLASSROOM_ID,
        transcript: "The children counted leaves.",
        activity: "Circle time",
        location: "Classroom",
        uploadedBy: "Should Be Overwritten",
        ...overrides,
    };
}

function coachReq(body = acceptBody()) {
    return {
        user: { id: COACH_ID, role: "coach", name: "Casey Coach" },
        body,
        file: null,
        on() {},
    };
}

describe("classroom whisper — coach upload gate", () => {
    test("active grant without a file is authorized (400 audio required, not 403)", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, { status: "active", transcriptAccess: false });
        const res = mockRes();
        await classroomWhisperController(
            {
                ...coachReq({ classroomId: CLASSROOM_ID, activity: "Circle time", location: "Classroom" }),
            },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /audio file/i);
    });

    test("pending grant is 403 and does not persist", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, { status: "pending", transcriptAccess: false });
        const save = t.mock.method(TeacherAssessment.prototype, "save", async () => {
            throw new Error("should not save");
        });
        const res = mockRes();
        await classroomWhisperController(
            {
                ...coachReq({ classroomId: CLASSROOM_ID, activity: "Circle time", location: "Classroom" }),
                file: { path: "x", filename: "x.webm", mimetype: "audio/webm" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
        assert.equal(save.mock.callCount(), 0);
    });

    test("revoked grant is 403", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, { status: "revoked", transcriptAccess: false });
        const res = mockRes();
        await classroomWhisperController(
            {
                ...coachReq({ classroomId: CLASSROOM_ID, activity: "Circle time", location: "Classroom" }),
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("no grant is 403", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, null);
        const res = mockRes();
        await classroomWhisperController(
            {
                ...coachReq({ classroomId: CLASSROOM_ID, activity: "Circle time", location: "Classroom" }),
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("admin is 403 by capability", async () => {
        const res = mockRes();
        await classroomWhisperController(
            {
                user: { id: "admin1", role: "admin", name: "Ada" },
                body: { classroomId: CLASSROOM_ID, activity: "Circle time", location: "Classroom" },
                file: null,
                on() {},
            },
            res
        );
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /permission/i);
    });

    test("parent is 403 by capability", async () => {
        const res = mockRes();
        await classroomWhisperController(
            {
                user: { id: PARENT_ID, role: "parent", name: "Pat" },
                body: { classroomId: CLASSROOM_ID, activity: "Circle time", location: "Classroom" },
                file: null,
                on() {},
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });
});

describe("teacher accept — coach classroom recording", () => {
    test("active grant accepts, attributes to lead, names the coach, notifies parents", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, { status: "active", transcriptAccess: false });
        const teacherLookups = [];
        t.mock.method(Teacher, "findById", async (id) => {
            teacherLookups.push(String(id));
            return { _id: id, center: "Main Street Center", name: "Lead Teacher" };
        });
        const saved = [];
        t.mock.method(TeacherAssessment.prototype, "save", async function save() {
            saved.push(this);
            this._id = new mongoose.Types.ObjectId();
            return this;
        });
        const notified = [];
        t.mock.method(Notification, "create", async (doc) => {
            notified.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const res = mockRes();
        await acceptTeacherAssessment(coachReq(), res);

        assert.equal(res.statusCode, 201, res.body?.message);
        assert.equal(saved.length, 1);
        assert.equal(String(saved[0].teacherId), LEAD_ID);
        assert.equal(saved[0].uploadedBy, "Casey Coach");
        assert.equal(teacherLookups[0], LEAD_ID);
        assert.ok(notified.length >= 1);
        assert.equal(notified[0].type, "classroom-recording-added");
        assert.equal(String(notified[0].recipientId), PARENT_ID);
    });

    test("pending grant cannot accept", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, { status: "pending", transcriptAccess: false });
        const save = t.mock.method(TeacherAssessment.prototype, "save", async () => {
            throw new Error("should not save");
        });
        const res = mockRes();
        await acceptTeacherAssessment(coachReq(), res);
        assert.equal(res.statusCode, 403);
        assert.equal(save.mock.callCount(), 0);
    });

    test("revoked grant cannot accept", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, { status: "revoked", transcriptAccess: false });
        const res = mockRes();
        await acceptTeacherAssessment(coachReq(), res);
        assert.equal(res.statusCode, 403);
    });

    test("no grant cannot accept", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc);
        mockGrant(t, null);
        const res = mockRes();
        await acceptTeacherAssessment(coachReq(), res);
        assert.equal(res.statusCode, 403);
    });

    test("admin cannot accept", async () => {
        const res = mockRes();
        await acceptTeacherAssessment(
            {
                user: { id: "admin1", role: "admin", name: "Ada" },
                body: acceptBody({ teacherId: LEAD_ID }),
            },
            res
        );
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /permission/i);
    });

    test("parent cannot accept", async () => {
        const res = mockRes();
        await acceptTeacherAssessment(
            {
                user: { id: PARENT_ID, role: "parent", name: "Pat" },
                body: acceptBody(),
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });
});

describe("saved classroom transcripts stay grant-gated for coaches", () => {
    test("aggregate-only coach is denied the transcripts endpoint", async (t) => {
        t.mock.method(Classroom, "findById", classroomFindByIdChain(classroomDoc));
        mockGrant(t, { status: "active", transcriptAccess: false });
        const findAssessments = t.mock.method(TeacherAssessment, "find", () => {
            throw new Error("should not query transcripts");
        });
        const res = mockRes();
        await getClassroomTranscripts(
            {
                user: { id: COACH_ID, role: "coach" },
                params: { id: CLASSROOM_ID },
            },
            res
        );
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /transcript access/i);
        assert.equal(findAssessments.mock.callCount(), 0);
    });
});
