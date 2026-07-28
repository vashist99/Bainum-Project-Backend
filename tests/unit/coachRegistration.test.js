import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Coach } from "../../models/User.js";
import { registerCoach } from "../../controllers/authController.js";

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

const validBody = {
    name: "Coach Carter",
    email: "coach@example.com",
    username: "coachcarter",
    password: "secret123",
};

describe("registerCoach — open self-registration (no invitation)", () => {
    test("creates an account from name/email/username/password alone", async (t) => {
        t.mock.method(Coach, "findOne", async () => null);
        let saved = null;
        t.mock.method(Coach.prototype, "save", async function save() {
            saved = this;
            return this;
        });

        const res = mockRes();
        await registerCoach({ body: { ...validBody } }, res);

        assert.equal(res.statusCode, 201);
        assert.ok(res.body.user, "should return a JWT");
        assert.equal(saved.name, "Coach Carter");
        assert.equal(saved.email, "coach@example.com");
        assert.equal(saved.username, "coachcarter");
        assert.equal(saved.role, "coach");
        assert.notEqual(saved.password, "secret123", "password must be hashed");
    });

    test("no invitation token is required or consulted", async (t) => {
        t.mock.method(Coach, "findOne", async () => null);
        t.mock.method(Coach.prototype, "save", async function save() {
            return this;
        });
        const res = mockRes();
        // Legacy clients might still send invitationToken — it is ignored.
        await registerCoach({ body: { ...validBody, invitationToken: "stale" } }, res);
        assert.equal(res.statusCode, 201);
    });

    test("duplicate email is rejected", async (t) => {
        t.mock.method(Coach, "findOne", async (query) =>
            query.email ? { _id: "existing" } : null
        );
        const res = mockRes();
        await registerCoach({ body: { ...validBody } }, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /already exists/i);
    });

    test("duplicate username is rejected", async (t) => {
        t.mock.method(Coach, "findOne", async (query) =>
            query.username ? { _id: "existing" } : null
        );
        const res = mockRes();
        await registerCoach({ body: { ...validBody } }, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /username/i);
    });

    test("missing fields, bad email, bad username, short password are rejected", async (t) => {
        const find = t.mock.method(Coach, "findOne", async () => {
            throw new Error("should not query");
        });
        const cases = [
            {},
            { ...validBody, email: "not-an-email" },
            { ...validBody, username: "X!" },
            { ...validBody, password: "123" },
        ];
        for (const body of cases) {
            const res = mockRes();
            await registerCoach({ body }, res);
            assert.equal(res.statusCode, 400, JSON.stringify(body));
        }
        assert.equal(find.mock.callCount(), 0);
    });
});
