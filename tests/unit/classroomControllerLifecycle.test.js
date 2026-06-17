import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
    deleteClassroom,
    removeChildFromClassroom,
} from "../../controllers/classroomController.js";
import Classroom from "../../models/Classroom.js";
import Assessment from "../../models/Assessment.js";
import TeacherAssessment from "../../models/TeacherAssessment.js";
import Invitation from "../../models/Invitation.js";
import Notification from "../../models/Notification.js";
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
// removeChildFromClassroom
// ────────────────────────────────────────────────────────────────────────
//
// Helper: classroomFindByIdMock returns a doc with a .populate() chain
// that resolves to the same doc, so the controller's
// `Classroom.findById(id).populate("parents", ...)` call works without
// touching a real DB.
function classroomFindByIdMock(doc) {
    return () => ({
        populate: () => Promise.resolve(doc),
    });
}

describe("removeChildFromClassroom", () => {
    test("400 on invalid classroom id", async (t) => {
        const req = {
            params: { id: "not-an-id", childId: VALID_ID },
            user: { role: "admin", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);
        assert.equal(res.statusCode, 400);
    });

    test("400 on invalid child id", async (t) => {
        const req = {
            params: { id: VALID_ID, childId: "bad-id" },
            user: { role: "admin", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);
        assert.equal(res.statusCode, 400);
    });

    test("401 when no req.user", async (t) => {
        const req = { params: { id: VALID_ID, childId: OTHER_VALID_ID } };
        const res = mockRes();
        await removeChildFromClassroom(req, res);
        assert.equal(res.statusCode, 401);
    });

    test("404 when classroom not found", async (t) => {
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock(null)
        );
        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "admin", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);
        assert.equal(res.statusCode, 404);
    });

    test("403 when caller is a parent", async (t) => {
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock({
                _id: VALID_ID,
                teacher: TEACHER_ID,
                children: [],
                parents: [],
            })
        );
        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "parent", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);
        assert.equal(res.statusCode, 403);
    });

    test("403 when caller is an assistant teacher (not the lead)", async (t) => {
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock({
                _id: VALID_ID,
                teacher: TEACHER_ID,
                assistantTeacher: ANOTHER_TEACHER_ID,
                children: [],
                parents: [],
            })
        );
        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "teacher", id: ANOTHER_TEACHER_ID },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);
        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /admins and the lead/i);
    });

    test("idempotent: returns 200 changed:false when child is not a member", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const someoneElseChildId = new mongoose.Types.ObjectId();
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock({
                _id: classroomId,
                teacher: TEACHER_ID,
                children: [someoneElseChildId],
                parents: [],
            })
        );
        const classroomUpdateMock = t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 0 })
        );
        const childUpdateMock = t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 0 })
        );

        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "admin", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.changed, false);
        assert.deepEqual(res.body.removedParents, []);
        // No writes fired on the no-op path.
        assert.equal(classroomUpdateMock.mock.calls.length, 0);
        assert.equal(childUpdateMock.mock.calls.length, 0);
    });

    test("admin removes a child whose parent still has a sibling: parent stays, no notification", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const childId = new mongoose.Types.ObjectId(OTHER_VALID_ID);
        const siblingId = new mongoose.Types.ObjectId();
        const parentId = new mongoose.Types.ObjectId();
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock({
                _id: classroomId,
                name: "Owls",
                teacher: TEACHER_ID,
                children: [childId, siblingId],
                parents: [
                    { _id: parentId, childIds: [childId, siblingId] },
                ],
            })
        );
        const classroomUpdateMock = t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );
        t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );
        const notificationCreateMock = t.mock.method(
            Notification,
            "create",
            () => Promise.resolve({})
        );

        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "admin", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.changed, true);
        assert.deepEqual(res.body.removedParents, []);
        // Exactly ONE Classroom.updateOne call (the child $pull). No
        // second call to pull the parent.
        assert.equal(classroomUpdateMock.mock.calls.length, 1);
        const op = classroomUpdateMock.mock.calls[0].arguments[1];
        assert.ok(op.$pull?.children);
        assert.equal(op.$pull?.parents, undefined);
        // No notifications since no parent was pruned.
        assert.equal(notificationCreateMock.mock.calls.length, 0);
    });

    test("admin removes the parent's LAST child: parent is pulled and notified", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const childId = new mongoose.Types.ObjectId(OTHER_VALID_ID);
        const parentId = new mongoose.Types.ObjectId();
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock({
                _id: classroomId,
                name: "Owls",
                teacher: TEACHER_ID,
                children: [childId],
                parents: [{ _id: parentId, childIds: [childId] }],
            })
        );
        const classroomUpdates = [];
        t.mock.method(Classroom, "updateOne", (filter, op) => {
            classroomUpdates.push(op);
            return Promise.resolve({ modifiedCount: 1 });
        });
        t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );
        const notificationCreates = [];
        t.mock.method(Notification, "create", (doc) => {
            notificationCreates.push(doc);
            return Promise.resolve({ ...doc, _id: new mongoose.Types.ObjectId() });
        });

        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "admin", id: "x" },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.changed, true);
        assert.deepEqual(res.body.removedParents.map(String), [
            String(parentId),
        ]);

        // Two writes on Classroom: $pull children, then $pull parents.
        assert.equal(classroomUpdates.length, 2);
        assert.ok(classroomUpdates[0].$pull?.children);
        assert.ok(classroomUpdates[1].$pull?.parents);

        // Exactly one classroom-removed notification was emitted for
        // the pruned parent.
        assert.equal(notificationCreates.length, 1);
        assert.equal(notificationCreates[0].type, "classroom-removed");
        assert.equal(
            String(notificationCreates[0].recipientId),
            String(parentId)
        );
        assert.equal(notificationCreates[0].recipientRole, "parent");
        assert.match(
            notificationCreates[0].message,
            /removed from classroom: "Owls"/
        );
    });

    test("lead teacher can remove a child; assistant teacher cannot (already covered above) — verify lead success path", async (t) => {
        const classroomId = new mongoose.Types.ObjectId(VALID_ID);
        const childId = new mongoose.Types.ObjectId(OTHER_VALID_ID);
        t.mock.method(
            Classroom,
            "findById",
            classroomFindByIdMock({
                _id: classroomId,
                name: "Owls",
                teacher: TEACHER_ID,
                children: [childId, new mongoose.Types.ObjectId()],
                parents: [],
            })
        );
        t.mock.method(Classroom, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );
        t.mock.method(Child, "updateOne", () =>
            Promise.resolve({ modifiedCount: 1 })
        );

        const req = {
            params: { id: VALID_ID, childId: OTHER_VALID_ID },
            user: { role: "teacher", id: TEACHER_ID },
        };
        const res = mockRes();
        await removeChildFromClassroom(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.changed, true);
    });
});
