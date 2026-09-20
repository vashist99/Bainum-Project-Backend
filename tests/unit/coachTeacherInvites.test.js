import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Teacher } from "../../models/User.js";
import TeacherInvitation from "../../models/TeacherInvitation.js";
import { sendTeacherInvitation } from "../../controllers/teacherInvitationController.js";
import { registerTeacher } from "../../controllers/authController.js";
import {
    COACH_TEACHER_SLOT_LIMIT,
    countCoachTeacherSlots,
    coachTeacherSlotCount,
} from "../../lib/coachTeacherSlots.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const COACH_ID = "64b0000000000000000000c1";
const OTHER_COACH_ID = "64b0000000000000000000c2";

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

function leanQuery(rows) {
    return {
        select() {
            return this;
        },
        lean: async () => rows,
    };
}

const inviteBody = {
    email: "new.teacher@example.com",
    firstName: "New",
    lastName: "Teacher",
    education: "BA",
    dateOfBirth: "1990-01-15",
    school: "Main Street Center",
};

describe("countCoachTeacherSlots", () => {
    test("counts assigned teachers only", () => {
        assert.equal(
            countCoachTeacherSlots({
                assigned: [{ email: "a@x.com" }, { email: "b@x.com" }],
                pending: [],
            }),
            2
        );
    });

    test("pending emails that are not assigned add slots", () => {
        assert.equal(
            countCoachTeacherSlots({
                assigned: [{ email: "a@x.com" }],
                pending: [{ email: "c@x.com" }, { email: "d@x.com" }],
            }),
            3
        );
    });

    test("re-invite of an assigned teacher does not consume a second slot", () => {
        assert.equal(
            countCoachTeacherSlots({
                assigned: [{ email: "a@x.com" }, { email: "b@x.com" }],
                pending: [{ email: "A@x.com" }, { email: "c@x.com" }],
            }),
            3
        );
    });

    test("limit constant is 20", () => {
        assert.equal(COACH_TEACHER_SLOT_LIMIT, 20);
    });
});

describe("coachTeacherSlotCount query", () => {
    test("ignores expired invites by querying expiresAt > now", async (t) => {
        t.mock.method(Teacher, "find", () => leanQuery([{ email: "a@x.com" }]));
        let invitationQuery;
        t.mock.method(TeacherInvitation, "find", (query) => {
            invitationQuery = query;
            return leanQuery([]);
        });

        const used = await coachTeacherSlotCount(COACH_ID);
        assert.equal(used, 1);
        assert.equal(invitationQuery.sentBy, COACH_ID);
        assert.equal(invitationQuery.sentByRole, "coach");
        assert.equal(invitationQuery.status, "pending");
        assert.ok(invitationQuery.expiresAt?.$gt instanceof Date);
    });
});

describe("sendTeacherInvitation — coach rules", () => {
    test("teacher and parent are rejected with 403", async () => {
        for (const role of ["teacher", "parent"]) {
            const res = mockRes();
            await sendTeacherInvitation(
                { body: inviteBody, user: { id: "u1", role, name: "User" } },
                res
            );
            assert.equal(res.statusCode, 403, role);
            assert.match(res.body.message, /permission/i);
        }
    });

    test("400 when the email is already assigned to another coach", async (t) => {
        t.mock.method(Teacher, "findOne", async () => ({
            email: inviteBody.email,
            coachId: OTHER_COACH_ID,
        }));
        const res = mockRes();
        await sendTeacherInvitation(
            { body: inviteBody, user: { id: COACH_ID, role: "coach", name: "Coach" } },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /another coach/i);
    });

    test("400 at the 20-slot cap for a new email", async (t) => {
        t.mock.method(Teacher, "findOne", async () => null);
        t.mock.method(Teacher, "find", () =>
            leanQuery(Array.from({ length: 20 }, (_, i) => ({ email: `t${i}@x.com` })))
        );
        t.mock.method(TeacherInvitation, "find", () => leanQuery([]));
        const res = mockRes();
        await sendTeacherInvitation(
            { body: inviteBody, user: { id: COACH_ID, role: "coach", name: "Coach" } },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /at most 20/i);
        assert.equal(res.body.used, 20);
        assert.equal(res.body.limit, 20);
    });
});

describe("registerTeacher — coach invite assigns coachId", () => {
    function pendingCoachInvite() {
        return {
            email: "assigned@example.com",
            firstName: "Ann",
            lastName: "Signed",
            education: "BA",
            dateOfBirth: new Date("1990-01-15"),
            center: "Main Street Center",
            sentBy: COACH_ID,
            sentByRole: "coach",
            status: "pending",
            isExpired: () => false,
            save: async function save() {
                return this;
            },
        };
    }

    test("new teacher is created with coachId", async (t) => {
        t.mock.method(TeacherInvitation, "findOne", async () => pendingCoachInvite());
        t.mock.method(Teacher, "findOne", async () => null);
        let saved = null;
        t.mock.method(Teacher.prototype, "save", async function save() {
            saved = this;
            return this;
        });

        const res = mockRes();
        await registerTeacher(
            {
                body: {
                    username: "annsigned",
                    password: "secret123",
                    invitationToken: "tok",
                    termsAccepted: true,
                },
            },
            res
        );

        assert.equal(res.statusCode, 201);
        assert.equal(String(saved.coachId), COACH_ID);
    });

    test("existing teacher gets coachId on accept", async (t) => {
        const invitation = pendingCoachInvite();
        const teacher = {
            _id: { toString: () => "64b0000000000000000000t1" },
            email: invitation.email,
            save: async function save() {
                return this;
            },
        };
        t.mock.method(TeacherInvitation, "findOne", async () => invitation);
        t.mock.method(Teacher, "findOne", async (query) => {
            if (query?.email) return teacher;
            return null;
        });

        const res = mockRes();
        await registerTeacher(
            {
                body: {
                    username: "annsigned",
                    password: "secret123",
                    invitationToken: "tok",
                    termsAccepted: true,
                },
            },
            res
        );

        assert.equal(res.statusCode, 201);
        assert.equal(String(teacher.coachId), COACH_ID);
    });
});
