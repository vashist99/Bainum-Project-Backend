import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createNote } from "../../controllers/noteController.js";

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

const TEACHER_ID = "64b000000000000000000002";

describe("noteController — createNote", () => {
    test("400 when scope is invalid", async () => {
        const req = {
            body: { content: "hello" },
            user: { id: TEACHER_ID, role: "teacher", name: "T" },
        };
        const res = mockRes();
        await createNote(req, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /required/i);
    });

    test("400 when content is empty", async () => {
        const req = {
            body: { childId: "64b0000000000000000000c1", content: "   " },
            user: { id: TEACHER_ID, role: "teacher", name: "T" },
        };
        const res = mockRes();
        await createNote(req, res);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /content/i);
    });
});
