import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
    deleteClassroom,
    patchClassroomChildren,
} from "../../controllers/classroomController.js";
import Classroom from "../../models/Classroom.js";
import Assessment from "../../models/Assessment.js";
import TeacherAssessment from "../../models/TeacherAssessment.js";
import Invitation from "../../models/Invitation.js";
import { Child } from "../../models/User.js";

// Minimal express response double — captures status + json calls so tests
// can assert on what the controller wrote back.
function mockRes() {
    const res = {
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
    return res;
}

const VALID_ID = "64b0000000000000000000aa";
const OTHER_VALID_ID = "64b0000000000000000000bb";
const TEACHER_ID = "64b0000000000000000000c1";
const ANOTHER_TEACHER_ID = "64b0000000000000000000c2";

afterEach(() => {
    // node:test restores t.mock.method stubs automatically per test, but
    // when we patch *outside* a test scope we'd need manual cleanup — we
    // use t.mock exclusively, so this hook is just a safety net.
});

// ────────────────────────────────────────────────────────────────────────
// deleteClassroom
// ────────────────────────────────────────────────────────────────────────
describe("deleteClassroom", () => {
    test("400 on invalid classroom id", async (t) => {
        const req = { params: { id: "not-an-id" }, user: { role: "admin", id: "x" } };
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Invalid classroom id/i);
    });

    test("404 when classroom not found", async (t) => {
        t.mock.method(Classroom, "findById", () => Promise.resolve(null));
        const req = { params: { id: VALID_ID }, user: { role: "admin", id: "x" } };
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 404);
    });

    test("401 when no req.user (auth middleware bypassed)", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({ _id: VALID_ID, teacher: TEACHER_ID, children: [], parents: [] })
        );
        const req = { params: { id: VALID_ID } }; // no user
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 401);
    });

    test("403 when caller is a teacher but not the lead", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: VALID_ID,
                teacher: TEACHER_ID,
                children: [],
                parents: [],
            })
        );
        const req = {
            params: { id: VALID_ID },
            user: { role: "teacher", id: ANOTHER_TEACHER_ID },
        };
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /admin or the classroom's lead/i);
    });

    test("403 when caller is an assistant teacher (not the lead)", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: VALID_ID,
                teacher: TEACHER_ID,
                assistantTeacher: ANOTHER_TEACHER_ID,
                children: [],
                parents: [],
            })
        );
        const req = {
            params: { id: VALID_ID },
            user: { role: "teacher", id: ANOTHER_TEACHER_ID },
        };
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 403);
    });

    test("403 when caller is a parent", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: VALID_ID,
                teacher: TEACHER_ID,
                children: [],
                parents: [],
            })
        );
        const req = {
            params: { id: VALID_ID },
            user: { role: "parent", id: "parent-1" },
        };
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 403);
    });

    test("admin: full cascade + summary on success", async (t) => {
        const child1 = new mongoose.Types.ObjectId();
        const child2 = new mongoose.Types.ObjectId();
        const parent1 = new mongoose.Types.ObjectId();
        const classroomDoc = {
            _id: new mongoose.Types.ObjectId(VALID_ID),
            teacher: new mongoose.Types.ObjectId(TEACHER_ID),
            children: [child1, child2],
            parents: [parent1],
        };

        t.mock.method(Classroom, "findById", () => Promise.resolve(classroomDoc));
        const childUpdateMock = t.mock.method(Child, "updateMany", () =>
            Promise.resolve({ modifiedCount: 2 })
        );
        const assessmentUpdateMock = t.mock.method(Assessment, "updateMany", () =>
            Promise.resolve({ modifiedCount: 5 })
        );
        const teacherAssessmentUpdateMock = t.mock.method(
            TeacherAssessment,
            "updateMany",
            () => Promise.resolve({ modifiedCount: 3 })
        );
        const invitationDeleteMock = t.mock.method(Invitation, "deleteMany", () =>
            Promise.resolve({ deletedCount: 4 })
        );
        const classroomDeleteMock = t.mock.method(Classroom, "deleteOne", () =>
            Promise.resolve({ deletedCount: 1 })
        );

        const req = {
            params: { id: VALID_ID },
            user: { role: "admin", id: "admin-1" },
        };
        const res = mockRes();
        await deleteClassroom(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assert.deepEqual(res.body.summary, {
            childrenUnlinked: 2,
            parentsUnlinked: 1,
            assessmentsDisassociated: 5,
            teacherAssessmentsDisassociated: 3,
            invitationsDeleted: 4,
        });

        // Cascade order/filter assertions: every cleanup targets THIS classroom's id.
        assert.equal(
            String(childUpdateMock.mock.calls[0].arguments[0]._id.$in[0]),
            String(child1)
        );
        assert.deepEqual(
            childUpdateMock.mock.calls[0].arguments[1],
            { $pull: { classrooms: classroomDoc._id } }
        );
        // Pending invitations are HARD-deleted, not expired.
        assert.deepEqual(invitationDeleteMock.mock.calls[0].arguments[0], {
            classroomId: classroomDoc._id,
            status: "pending",
        });
        // The classroom doc itself is removed last.
        assert.equal(classroomDeleteMock.mock.calls.length, 1);
        assert.deepEqual(classroomDeleteMock.mock.calls[0].arguments[0], {
            _id: classroomDoc._id,
        });
    });

    test("lead teacher: succeeds when teacher.id matches classroom.teacher", async (t) => {
        const classroomDoc = {
            _id: new mongoose.Types.ObjectId(VALID_ID),
            teacher: new mongoose.Types.ObjectId(TEACHER_ID),
            children: [],
            parents: [],
        };
        t.mock.method(Classroom, "findById", () => Promise.resolve(classroomDoc));
        t.mock.method(Assessment, "updateMany", () => Promise.resolve({ modifiedCount: 0 }));
        t.mock.method(TeacherAssessment, "updateMany", () => Promise.resolve({ modifiedCount: 0 }));
        t.mock.method(Invitation, "deleteMany", () => Promise.resolve({ deletedCount: 0 }));
        t.mock.method(Classroom, "deleteOne", () => Promise.resolve({ deletedCount: 1 }));

        const req = {
            params: { id: VALID_ID },
            user: { role: "teacher", id: TEACHER_ID },
        };
        const res = mockRes();
        await deleteClassroom(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.summary.childrenUnlinked, 0);
    });

    test("zero-children classroom skips the bulk Child.updateMany call", async (t) => {
        const classroomDoc = {
            _id: new mongoose.Types.ObjectId(VALID_ID),
            teacher: new mongoose.Types.ObjectId(TEACHER_ID),
            children: [],
            parents: [],
        };
        t.mock.method(Classroom, "findById", () => Promise.resolve(classroomDoc));
        const childUpdateMock = t.mock.method(Child, "updateMany", () =>
            Promise.resolve({ modifiedCount: 999 })
        );
        t.mock.method(Assessment, "updateMany", () => Promise.resolve({ modifiedCount: 0 }));
        t.mock.method(TeacherAssessment, "updateMany", () => Promise.resolve({ modifiedCount: 0 }));
        t.mock.method(Invitation, "deleteMany", () => Promise.resolve({ deletedCount: 0 }));
        t.mock.method(Classroom, "deleteOne", () => Promise.resolve({ deletedCount: 1 }));

        const req = { params: { id: VALID_ID }, user: { role: "admin" } };
        const res = mockRes();
        await deleteClassroom(req, res);

        assert.equal(res.statusCode, 200);
        // Defensive: a no-op should not fire a wide Child.updateMany.
        assert.equal(childUpdateMock.mock.calls.length, 0);
    });
});

// ────────────────────────────────────────────────────────────────────────
// patchClassroomChildren
// ────────────────────────────────────────────────────────────────────────
describe("patchClassroomChildren", () => {
    test("400 on invalid classroom id", async (t) => {
        const req = {
            params: { id: "not-an-id" },
            user: { role: "admin" },
            body: { addChildId: VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 400);
    });

    test("401 when no req.user", async (t) => {
        const req = { params: { id: VALID_ID }, body: {} };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 401);
    });

    test("403 when caller is a teacher", async (t) => {
        const req = {
            params: { id: VALID_ID },
            user: { role: "teacher" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /Only admins/i);
    });

    test("403 when caller is a parent", async (t) => {
        const req = {
            params: { id: VALID_ID },
            user: { role: "parent" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 403);
    });

    test("400 when body has neither addChildId nor removeChildId", async (t) => {
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: {},
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /exactly one/i);
    });

    test("400 when body has BOTH addChildId and removeChildId", async (t) => {
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: OTHER_VALID_ID, removeChildId: VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 400);
    });

    test("404 when classroom not found", async (t) => {
        t.mock.method(Classroom, "findById", () => Promise.resolve(null));
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 404);
    });

    test("addChildId: 400 on invalid child id", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({ _id: VALID_ID, children: [], center: "C1" })
        );
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: "bad-id" },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 400);
    });

    test("addChildId: 404 when child not found", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({ _id: VALID_ID, children: [], center: "C1" })
        );
        t.mock.method(Child, "findById", () => Promise.resolve(null));
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 404);
    });

    test("addChildId: 409 when child center does not match classroom center", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({ _id: VALID_ID, children: [], center: "Center A" })
        );
        t.mock.method(Child, "findById", () =>
            Promise.resolve({
                _id: OTHER_VALID_ID,
                center: "Center B",
            })
        );
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 409);
        assert.match(res.body.message, /center does not match/i);
    });

    test("addChildId: same-center success → 200 changed:true, both writes fired", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const childId = new mongoose.Types.ObjectId(OTHER_VALID_ID);
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: classroomId,
                children: [], // child not yet a member
                center: "  Center A  ", // exercises whitespace tolerance
            })
        );
        t.mock.method(Child, "findById", () =>
            Promise.resolve({ _id: childId, center: "center a" })
        );
        const classroomUpdateMock = t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );
        const childUpdateMock = t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );

        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { ok: true, changed: true, op: "added" });

        // Both sides of the membership are updated symmetrically.
        assert.equal(classroomUpdateMock.mock.calls.length, 1);
        assert.deepEqual(
            classroomUpdateMock.mock.calls[0].arguments[1],
            { $addToSet: { children: childId } }
        );
        assert.equal(childUpdateMock.mock.calls.length, 1);
        assert.deepEqual(
            childUpdateMock.mock.calls[0].arguments[1],
            { $addToSet: { classrooms: classroomId } }
        );
    });

    test("addChildId: already-member returns 200 with changed:false (idempotent)", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const childId = new mongoose.Types.ObjectId(OTHER_VALID_ID);
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: classroomId,
                children: [childId],
                center: "C1",
            })
        );
        t.mock.method(Child, "findById", () =>
            Promise.resolve({ _id: childId, center: "C1" })
        );
        t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 0 })
        );
        t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 0 })
        );

        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { addChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.changed, false);
        assert.equal(res.body.op, "added");
    });

    test("removeChildId: 400 on invalid child id", async (t) => {
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({ _id: VALID_ID, children: [], center: "C1" })
        );
        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { removeChildId: "bad-id" },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);
        assert.equal(res.statusCode, 400);
    });

    test("removeChildId: idempotent → changed:false when not a member", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: classroomId,
                children: [], // child was never a member
            })
        );
        const classroomUpdateMock = t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 0 })
        );
        const childUpdateMock = t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 0 })
        );

        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { removeChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { ok: true, changed: false, op: "removed" });
        // The $pull is still fired (it's a no-op DB-side but keeps both
        // sides converging if state drifted).
        assert.equal(classroomUpdateMock.mock.calls.length, 1);
        assert.equal(childUpdateMock.mock.calls.length, 1);
    });

    test("removeChildId: changed:true when child was a member; parents never touched", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const childId = new mongoose.Types.ObjectId(OTHER_VALID_ID);
        const classroomFindMock = t.mock.method(Classroom, "findById", () =>
            Promise.resolve({
                _id: classroomId,
                children: [childId, new mongoose.Types.ObjectId()],
                parents: [new mongoose.Types.ObjectId()],
            })
        );
        const classroomUpdateMock = t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );
        const childUpdateMock = t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );

        const req = {
            params: { id: VALID_ID },
            user: { role: "admin" },
            body: { removeChildId: OTHER_VALID_ID },
        };
        const res = mockRes();
        await patchClassroomChildren(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.changed, true);

        // Critically, the classroom write must be a $pull on children only
        // (parents untouched).
        const update = classroomUpdateMock.mock.calls[0].arguments[1];
        assert.ok(update.$pull?.children, "expected $pull on children");
        assert.equal(update.$pull?.parents, undefined);
        assert.equal(update.$set, undefined);
        assert.equal(classroomFindMock.mock.calls.length, 1);
        assert.equal(childUpdateMock.mock.calls.length, 1);
    });
});
