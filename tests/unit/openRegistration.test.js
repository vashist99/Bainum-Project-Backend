import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Admin, Teacher, Parent, Coach } from "../../models/User.js";
import { register } from "../../controllers/authController.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

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

function stubLookups(t) {
    t.mock.method(Admin, "findOne", async () => null);
    t.mock.method(Teacher, "findOne", async () => null);
    t.mock.method(Parent, "findOne", async () => null);
    t.mock.method(Coach, "findOne", async () => null);
}

const teacherBody = {
    name: "Test Teacher",
    email: "teacher@example.com",
    username: "test_teacher",
    password: "secret123",
    role: "teacher",
    termsAccepted: true,
};

const parentBody = {
    name: "Test Parent",
    email: "parent@example.com",
    username: "test_parent",
    password: "secret123",
    role: "parent",
};

describe("POST /api/auth/register — open (no-invitation) signup", () => {
    test("creates a teacher with required profile placeholders", async (t) => {
        stubLookups(t);
        let saved = null;
        t.mock.method(Teacher.prototype, "save", async function save() {
            saved = this;
            return this;
        });

        const res = mockRes();
        await register({ body: { ...teacherBody } }, res);

        assert.equal(res.statusCode, 201);
        assert.ok(res.body.user, "should return a JWT on user");
        assert.equal(saved.role, "teacher");
        assert.equal(saved.center, "Unassigned");
        assert.equal(saved.education, "Unspecified");
        assert.ok(saved.dateOfBirth instanceof Date);
        assert.ok(saved.termsAcceptedAt instanceof Date);
        assert.notEqual(saved.password, "secret123");
    });

    test("rejects teacher signup without terms acceptance", async (t) => {
        const findTeacher = t.mock.method(Teacher, "findOne", async () => null);
        const res = mockRes();
        await register({ body: { ...teacherBody, termsAccepted: false } }, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /terms and conditions/i);
        assert.equal(findTeacher.mock.callCount(), 0);
    });

    test("creates a parent who can sign in without an invitation", async (t) => {
        stubLookups(t);
        let saved = null;
        t.mock.method(Parent.prototype, "save", async function save() {
            saved = this;
            return this;
        });

        const res = mockRes();
        await register({ body: { ...parentBody } }, res);

        assert.equal(res.statusCode, 201);
        assert.equal(saved.role, "parent");
        assert.equal(saved.invitationAccepted, true);
    });

    test("still rejects coach on this endpoint", async () => {
        const res = mockRes();
        await register(
            { body: { ...teacherBody, role: "coach", username: "test_coach" } },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /invalid role/i);
    });
});
