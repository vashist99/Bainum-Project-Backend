import { test, describe } from "node:test";
import assert from "node:assert/strict";

import ActivityLog, {
    ACTIVITY_ACTIONS,
    LOGGED_ROLES,
    ACTIVITY_LOG_RETENTION_DAYS,
} from "../../models/ActivityLog.js";
import { logActivity } from "../../lib/activityLogService.js";
import { listActivityLog } from "../../controllers/activityLogController.js";
import { roleHasCapability } from "../../lib/permissions.js";

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
        end() {
            return this;
        },
    };
}

/** Chainable stand-in for ActivityLog.find(...).sort().skip().limit().lean() */
function mockFindChain(result, calls) {
    return {
        sort(arg) {
            calls.sort = arg;
            return this;
        },
        skip(arg) {
            calls.skip = arg;
            return this;
        },
        limit(arg) {
            calls.limit = arg;
            return this;
        },
        lean: async () => result,
    };
}

describe("ActivityLog model", () => {
    test("action enum is the closed curated set", () => {
        for (const action of [
            "login",
            "recording-uploaded",
            "transcript-accepted",
            "transcript-rejected",
            "classroom-created",
            "classroom-deleted",
            "roster-parents-added",
            "roster-child-removed",
            "coach-access-requested",
            "coach-grant-approved",
            "home-access-requested",
            "profile-updated",
        ]) {
            assert.ok(ACTIVITY_ACTIONS.includes(action), `missing action ${action}`);
        }
    });

    test("actor roles limited to teacher and coach", () => {
        assert.deepEqual([...LOGGED_ROLES], ["teacher", "coach"]);
        const rolePath = ActivityLog.schema.path("actorRole");
        assert.deepEqual(rolePath.enumValues, ["teacher", "coach"]);
    });

    test("TTL index on expiresAt with expireAfterSeconds 0", () => {
        const ttl = ActivityLog.schema
            .indexes()
            .find(([fields]) => fields.expiresAt === 1);
        assert.ok(ttl, "expiresAt index missing");
        assert.equal(ttl[1].expireAfterSeconds, 0);
    });

    test("target fields and detail default empty/null", () => {
        const row = new ActivityLog({
            actorId: TEACHER_ID,
            actorRole: "teacher",
            action: "login",
            expiresAt: new Date(),
        });
        assert.equal(row.targetType, null);
        assert.equal(row.targetId, null);
        assert.equal(row.targetLabel, "");
        assert.equal(row.detail, "");
    });
});

describe("logActivity service", () => {
    test("drops admin and parent actors without touching the DB", async (t) => {
        const create = t.mock.method(ActivityLog, "create", async () => {
            throw new Error("should not be called");
        });
        for (const role of ["admin", "parent"]) {
            const out = await logActivity({
                actor: { id: TEACHER_ID, role, name: "X" },
                action: "login",
            });
            assert.equal(out, null);
        }
        assert.equal(create.mock.callCount(), 0);
    });

    test("records teacher action with 90-day expiry", async (t) => {
        let saved;
        t.mock.method(ActivityLog, "create", async (doc) => {
            saved = doc;
            return doc;
        });
        const before = Date.now();
        await logActivity({
            actor: { id: TEACHER_ID, role: "teacher", name: "Ms. Lee" },
            action: "classroom-created",
            targetType: "classroom",
            targetLabel: "Room A",
        });
        assert.equal(saved.actorRole, "teacher");
        assert.equal(saved.actorName, "Ms. Lee");
        assert.equal(saved.action, "classroom-created");
        assert.equal(saved.targetLabel, "Room A");
        const expectedMs = ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const delta = saved.expiresAt.getTime() - before;
        assert.ok(Math.abs(delta - expectedMs) < 5000, `expiry off by ${delta - expectedMs}ms`);
    });

    test("records coach actor", async (t) => {
        let saved;
        t.mock.method(ActivityLog, "create", async (doc) => {
            saved = doc;
            return doc;
        });
        await logActivity({
            actor: { id: COACH_ID, role: "coach", name: "Coach C" },
            action: "coach-access-requested",
        });
        assert.equal(saved.actorRole, "coach");
    });

    test("swallows insert failures and returns null", async (t) => {
        t.mock.method(ActivityLog, "create", async () => {
            throw new Error("db down");
        });
        const out = await logActivity({
            actor: { id: TEACHER_ID, role: "teacher" },
            action: "login",
        });
        assert.equal(out, null);
    });

    test("missing actor is a silent no-op", async () => {
        assert.equal(await logActivity({ action: "login" }), null);
        assert.equal(await logActivity(), null);
    });
});

describe("viewActivityLog capability", () => {
    test("admin only", () => {
        assert.equal(roleHasCapability("admin", "viewActivityLog"), true);
        for (const role of ["teacher", "coach", "parent"]) {
            assert.equal(roleHasCapability(role, "viewActivityLog"), false);
        }
    });
});

describe("listActivityLog controller", () => {
    test("rejects unknown role and action filters with 400", async () => {
        for (const query of [{ role: "parent" }, { role: "admin" }, { action: "made-coffee" }]) {
            const res = mockRes();
            await listActivityLog({ query }, res);
            assert.equal(res.statusCode, 400, JSON.stringify(query));
        }
    });

    test("rejects invalid dates and non-positive pagination with 400", async () => {
        for (const query of [
            { from: "not-a-date" },
            { to: "also-bad" },
            { page: "0" },
            { page: "-2" },
            { limit: "abc" },
        ]) {
            const res = mockRes();
            await listActivityLog({ query }, res);
            assert.equal(res.statusCode, 400, JSON.stringify(query));
        }
    });

    test("applies filters, caps limit at 100, returns newest first", async (t) => {
        const calls = {};
        let capturedQuery;
        t.mock.method(ActivityLog, "countDocuments", async (q) => {
            capturedQuery = q;
            return 250;
        });
        t.mock.method(ActivityLog, "find", (q) => {
            capturedQuery = q;
            return mockFindChain(
                [
                    {
                        _id: "a",
                        actorId: TEACHER_ID,
                        actorRole: "teacher",
                        actorName: "Ms. Lee",
                        action: "login",
                        createdAt: new Date(),
                    },
                ],
                calls
            );
        });

        const res = mockRes();
        await listActivityLog(
            {
                query: {
                    page: "3",
                    limit: "500",
                    role: "teacher",
                    action: "login",
                    actorId: TEACHER_ID,
                    from: "2026-01-01",
                    to: "2026-02-01",
                },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(calls.limit, 100, "limit must be capped at 100");
        assert.equal(calls.skip, 200, "skip = (page-1) * cappedLimit");
        assert.deepEqual(calls.sort, { createdAt: -1 });
        assert.equal(capturedQuery.actorRole, "teacher");
        assert.equal(capturedQuery.action, "login");
        assert.equal(capturedQuery.actorId, TEACHER_ID);
        assert.ok(capturedQuery.createdAt.$gte instanceof Date);
        // date-only "to" is extended to end of day
        assert.equal(capturedQuery.createdAt.$lte.getUTCHours(), 23);
        assert.equal(res.body.total, 250);
        assert.equal(res.body.totalPages, 3);
        assert.equal(res.body.page, 3);
        assert.equal(res.body.entries.length, 1);
        assert.equal(res.body.entries[0].actorName, "Ms. Lee");
    });

    test("empty result yields totalPages 1", async (t) => {
        t.mock.method(ActivityLog, "countDocuments", async () => 0);
        t.mock.method(ActivityLog, "find", () => mockFindChain([], {}));
        const res = mockRes();
        await listActivityLog({ query: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.totalPages, 1);
        assert.deepEqual(res.body.entries, []);
    });
});
