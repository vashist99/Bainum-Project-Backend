import { test, describe } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";

import { Teacher, Coach } from "../../models/User.js";
import Classroom from "../../models/Classroom.js";
import AccessGrant from "../../models/AccessGrant.js";
import HomeViewGrant from "../../models/HomeViewGrant.js";
import CoachClassroomGrant from "../../models/CoachClassroomGrant.js";
import Notification from "../../models/Notification.js";
import PasswordReset from "../../models/PasswordReset.js";
import ActivityLog, { ACTIVITY_ACTIONS } from "../../models/ActivityLog.js";
import {
    deleteTeacherAccount,
    deleteCoachAccount,
} from "../../lib/accountDeletionService.js";
import {
    registerCoach,
    registerTeacher,
    deleteOwnAccount,
} from "../../controllers/authController.js";
import { roleHasCapability } from "../../lib/permissions.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const TEACHER_ID = "64b000000000000000000002";
const COACH_ID = "64b000000000000000000033";

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

describe("terms acceptance at registration", () => {
    test("registerCoach without termsAccepted is rejected before any DB access", async (t) => {
        const findOne = t.mock.method(Coach, "findOne", async () => null);
        for (const body of [
            { name: "C", email: "c@x.com", username: "coachc", password: "secret123" },
            { name: "C", email: "c@x.com", username: "coachc", password: "secret123", termsAccepted: false },
            { name: "C", email: "c@x.com", username: "coachc", password: "secret123", termsAccepted: "yes" },
        ]) {
            const res = mockRes();
            await registerCoach({ body }, res);
            assert.equal(res.statusCode, 400);
            assert.match(res.body.message, /terms and conditions/i);
        }
        assert.equal(findOne.mock.callCount(), 0);
    });

    test("registerCoach with termsAccepted stamps termsAcceptedAt", async (t) => {
        t.mock.method(Coach, "findOne", async () => null);
        let saved = null;
        t.mock.method(Coach.prototype, "save", async function save() {
            saved = this;
            return this;
        });
        const res = mockRes();
        await registerCoach(
            { body: { name: "C", email: "c@x.com", username: "coachc", password: "secret123", termsAccepted: true } },
            res
        );
        assert.equal(res.statusCode, 201);
        assert.ok(saved.termsAcceptedAt instanceof Date, "termsAcceptedAt must be stamped");
    });

    test("registerTeacher without termsAccepted is rejected", async () => {
        const res = mockRes();
        await registerTeacher(
            { body: { password: "secret123", invitationToken: "tok", username: "teach1" } },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /terms and conditions/i);
    });
});

describe("deleteOwnAccount capability", () => {
    test("teachers and coaches only", () => {
        assert.equal(roleHasCapability("teacher", "deleteOwnAccount"), true);
        assert.equal(roleHasCapability("coach", "deleteOwnAccount"), true);
        assert.equal(roleHasCapability("admin", "deleteOwnAccount"), false);
        assert.equal(roleHasCapability("parent", "deleteOwnAccount"), false);
    });

    test("account-deleted is a known activity action", () => {
        assert.ok(ACTIVITY_ACTIONS.includes("account-deleted"));
    });
});

describe("deleteOwnAccount controller", () => {
    const reqUser = { id: TEACHER_ID, role: "teacher", name: "Ms. Lee" };

    test("confirmation text must be exactly DELETE", async (t) => {
        const findById = t.mock.method(Teacher, "findById", async () => null);
        for (const confirmation of [undefined, "", "delete", "DEL", "DELETE "]) {
            const res = mockRes();
            await deleteOwnAccount({ user: reqUser, body: { password: "x", confirmation } }, res);
            assert.equal(res.statusCode, 400, `confirmation=${JSON.stringify(confirmation)}`);
        }
        assert.equal(findById.mock.callCount(), 0);
    });

    test("missing password is rejected", async () => {
        const res = mockRes();
        await deleteOwnAccount({ user: reqUser, body: { confirmation: "DELETE" } }, res);
        assert.equal(res.statusCode, 400);
    });

    test("wrong password gets 401 and nothing is deleted", async (t) => {
        const hashed = await bcrypt.hash("right-password", 4);
        t.mock.method(Teacher, "findById", async () => ({ _id: TEACHER_ID, password: hashed }));
        const deleteOne = t.mock.method(Teacher, "deleteOne", async () => {
            throw new Error("must not delete");
        });
        const res = mockRes();
        await deleteOwnAccount(
            { user: reqUser, body: { password: "wrong-password", confirmation: "DELETE" } },
            res
        );
        assert.equal(res.statusCode, 401);
        assert.equal(deleteOne.mock.callCount(), 0);
    });

    test("correct password + DELETE removes a teacher account", async (t) => {
        const hashed = await bcrypt.hash("secret123", 4);
        t.mock.method(Teacher, "findById", async () => ({
            _id: TEACHER_ID,
            name: "Ms. Lee",
            email: "lee@x.com",
            password: hashed,
        }));
        t.mock.method(ActivityLog, "create", async (doc) => doc);
        const classroomUpdate = t.mock.method(Classroom, "updateMany", async () => ({}));
        t.mock.method(AccessGrant, "deleteMany", async () => ({}));
        t.mock.method(HomeViewGrant, "deleteMany", async () => ({}));
        t.mock.method(Notification, "deleteMany", async () => ({}));
        t.mock.method(PasswordReset, "deleteMany", async () => ({}));
        const deleteOne = t.mock.method(Teacher, "deleteOne", async () => ({ deletedCount: 1 }));

        const res = mockRes();
        await deleteOwnAccount(
            { user: reqUser, body: { password: "secret123", confirmation: "DELETE" } },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.match(res.body.message, /preserved/i);
        assert.equal(deleteOne.mock.callCount(), 1);
        assert.equal(classroomUpdate.mock.callCount(), 2, "lead and assistant slots cleared");
    });
});

describe("deleteTeacherAccount service", () => {
    test("preserves talk data, clears classroom slots, removes personal artifacts", async (t) => {
        t.mock.method(Teacher, "findById", async () => ({
            _id: TEACHER_ID,
            name: "Ms. Lee",
            email: "lee@x.com",
        }));
        let logged = null;
        t.mock.method(ActivityLog, "create", async (doc) => {
            logged = doc;
            return doc;
        });
        const classroomCalls = [];
        t.mock.method(Classroom, "updateMany", async (filter, update) => {
            classroomCalls.push([filter, update]);
            return {};
        });
        const accessDel = t.mock.method(AccessGrant, "deleteMany", async () => ({}));
        const homeDel = t.mock.method(HomeViewGrant, "deleteMany", async () => ({}));
        const notifDel = t.mock.method(Notification, "deleteMany", async () => ({}));
        const resetDel = t.mock.method(PasswordReset, "deleteMany", async () => ({}));
        const docDel = t.mock.method(Teacher, "deleteOne", async () => ({}));

        const result = await deleteTeacherAccount(TEACHER_ID);
        assert.equal(result.deleted, true);

        assert.equal(logged.action, "account-deleted");
        assert.equal(logged.actorName, "Ms. Lee");

        assert.deepEqual(classroomCalls[0][1], { $set: { teacher: null } });
        assert.deepEqual(classroomCalls[1][1], { $set: { assistantTeacher: null } });

        assert.equal(accessDel.mock.callCount(), 1);
        // Only user-scoped grants where the teacher is grantee.
        assert.equal(homeDel.mock.calls[0].arguments[0].scope, "user");
        assert.equal(notifDel.mock.callCount(), 1);
        assert.equal(resetDel.mock.calls[0].arguments[0].email, "lee@x.com");
        assert.equal(docDel.mock.callCount(), 1);
    });

    test("unknown id is a no-op", async (t) => {
        t.mock.method(Teacher, "findById", async () => null);
        const docDel = t.mock.method(Teacher, "deleteOne", async () => ({}));
        const result = await deleteTeacherAccount(TEACHER_ID);
        assert.equal(result.deleted, false);
        assert.equal(docDel.mock.callCount(), 0);
    });
});

describe("deleteCoachAccount service", () => {
    test("deletes grants, detaches teachers, removes the account", async (t) => {
        t.mock.method(Coach, "findById", async () => ({
            _id: COACH_ID,
            name: "Coach C",
            email: "coach@x.com",
        }));
        t.mock.method(ActivityLog, "create", async (doc) => doc);
        const grantDel = t.mock.method(CoachClassroomGrant, "deleteMany", async () => ({}));
        const detach = t.mock.method(Teacher, "updateMany", async (filter, update) => {
            assert.deepEqual(update, { $set: { coachId: null } });
            return {};
        });
        t.mock.method(Notification, "deleteMany", async () => ({}));
        t.mock.method(PasswordReset, "deleteMany", async () => ({}));
        const docDel = t.mock.method(Coach, "deleteOne", async () => ({}));

        const result = await deleteCoachAccount(COACH_ID);
        assert.equal(result.deleted, true);
        assert.equal(grantDel.mock.callCount(), 1);
        assert.equal(detach.mock.callCount(), 1);
        assert.equal(docDel.mock.callCount(), 1);
    });
});
