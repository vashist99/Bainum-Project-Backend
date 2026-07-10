import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import HomeViewGrant from "../../models/HomeViewGrant.js";
import {
    staffHasHomeViewAccess,
    homeContextFilterForRequest,
    staffHomeContextFilter,
} from "../../lib/talkDataAccess.js";

const CHILD_ID = new mongoose.Types.ObjectId("64b0000000000000000000c1");
const TEACHER_ID = new mongoose.Types.ObjectId("64b000000000000000000002");

describe("HomeViewGrant model — schema constraints", () => {
    test("user-scoped grant requires granteeId and granteeRole", () => {
        const missingBoth = new HomeViewGrant({
            childId: CHILD_ID,
            scope: "user",
            initiatedBy: "parent",
        });
        const errors = missingBoth.validateSync();
        assert.ok(errors?.errors?.granteeId, "granteeId should be required");
        assert.ok(errors?.errors?.granteeRole, "granteeRole should be required");
    });

    test("all-staff grant validates without a grantee", () => {
        const grant = new HomeViewGrant({
            childId: CHILD_ID,
            scope: "all-staff",
            initiatedBy: "parent",
            status: "active",
        });
        assert.equal(grant.validateSync(), undefined);
        assert.equal(grant.granteeId, null);
    });

    test("status defaults to pending and only allows the lifecycle values", () => {
        const grant = new HomeViewGrant({
            childId: CHILD_ID,
            scope: "user",
            granteeId: TEACHER_ID,
            granteeRole: "teacher",
            initiatedBy: "staff",
        });
        assert.equal(grant.status, "pending");

        grant.status = "not-a-status";
        assert.ok(grant.validateSync()?.errors?.status);
    });

    test("unique index covers (childId, scope, granteeId)", () => {
        const indexes = HomeViewGrant.schema.indexes();
        const unique = indexes.find(
            ([fields, options]) =>
                options?.unique &&
                fields.childId === 1 &&
                fields.scope === 1 &&
                fields.granteeId === 1
        );
        assert.ok(unique, "expected unique index on (childId, scope, granteeId)");
    });
});

describe("staffHasHomeViewAccess", () => {
    const teacher = { id: String(TEACHER_ID), role: "teacher" };
    const admin = { id: "64b000000000000000000009", role: "admin" };

    test("true when an active all-staff grant exists", async (t) => {
        t.mock.method(HomeViewGrant, "exists", async (query) => {
            assert.equal(query.status, "active");
            return { _id: new mongoose.Types.ObjectId() };
        });
        assert.equal(await staffHasHomeViewAccess(teacher, CHILD_ID), true);
        assert.equal(await staffHasHomeViewAccess(admin, CHILD_ID), true);
    });

    test("query matches all-staff OR the caller's own user grant", async (t) => {
        let captured = null;
        t.mock.method(HomeViewGrant, "exists", async (query) => {
            captured = query;
            return null;
        });
        await staffHasHomeViewAccess(teacher, CHILD_ID);
        assert.equal(captured.childId, CHILD_ID);
        assert.equal(captured.status, "active");
        assert.deepEqual(captured.$or, [
            { scope: "all-staff" },
            { scope: "user", granteeId: teacher.id },
        ]);
    });

    test("false when no active grant matches (pending/revoked excluded by query)", async (t) => {
        t.mock.method(HomeViewGrant, "exists", async () => null);
        assert.equal(await staffHasHomeViewAccess(teacher, CHILD_ID), false);
    });

    test("false for parents and malformed callers without querying", async (t) => {
        const exists = t.mock.method(HomeViewGrant, "exists", async () => {
            throw new Error("should not query");
        });
        assert.equal(
            await staffHasHomeViewAccess({ id: "p1", role: "parent" }, CHILD_ID),
            false
        );
        assert.equal(await staffHasHomeViewAccess(null, CHILD_ID), false);
        assert.equal(await staffHasHomeViewAccess(teacher, null), false);
        assert.equal(exists.mock.callCount(), 0);
    });
});

describe("homeContextFilterForRequest — grant-aware child assessment filter", () => {
    const teacher = { id: String(TEACHER_ID), role: "teacher" };
    const admin = { id: "64b000000000000000000009", role: "admin" };
    const parent = { id: "64b000000000000000000001", role: "parent" };

    test("parents are never filtered", async (t) => {
        const exists = t.mock.method(HomeViewGrant, "exists", async () => null);
        assert.deepEqual(await homeContextFilterForRequest(parent, CHILD_ID), {});
        assert.equal(exists.mock.callCount(), 0);
    });

    test("ungranted staff get the home-exclusion filter", async (t) => {
        t.mock.method(HomeViewGrant, "exists", async () => null);
        assert.deepEqual(
            await homeContextFilterForRequest(teacher, CHILD_ID),
            staffHomeContextFilter()
        );
        assert.deepEqual(
            await homeContextFilterForRequest(admin, CHILD_ID),
            staffHomeContextFilter()
        );
    });

    test("granted staff get no filter (home rows included)", async (t) => {
        t.mock.method(HomeViewGrant, "exists", async () => ({
            _id: new mongoose.Types.ObjectId(),
        }));
        assert.deepEqual(await homeContextFilterForRequest(teacher, CHILD_ID), {});
        assert.deepEqual(await homeContextFilterForRequest(admin, CHILD_ID), {});
    });
});
