import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    CAPABILITIES,
    roleHasCapability,
    requireRole,
    requireCapability,
    isEnrolledParent,
    canViewClassroomAggregates,
    canViewClassroomTranscripts,
} from "../../lib/permissions.js";

const LEAD_ID = "64b000000000000000000001";
const ASSISTANT_ID = "64b000000000000000000002";
const PARENT_ID = "64b000000000000000000003";
const COACH_ID = "64b000000000000000000004";
const OUTSIDER_ID = "64b000000000000000000005";

const classroom = {
    _id: "64b0000000000000000000aa",
    name: "Sunflowers",
    teacher: LEAD_ID,
    assistantTeacher: ASSISTANT_ID,
    parents: [PARENT_ID],
    center: "Main Street Center",
};

function fakeRes() {
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

describe("capability matrix", () => {
    test("admins manage schools and coaches; nobody else does", () => {
        assert.ok(roleHasCapability("admin", "manageSchools"));
        assert.ok(roleHasCapability("admin", "manageCoaches"));
        for (const role of ["teacher", "parent", "coach"]) {
            assert.ok(!roleHasCapability(role, "manageSchools"), role);
            assert.ok(!roleHasCapability(role, "manageCoaches"), role);
        }
    });

    test("classroom recording upload is teacher-only (admin removed, coach never)", () => {
        assert.ok(roleHasCapability("teacher", "uploadClassroomRecording"));
        assert.ok(!roleHasCapability("admin", "uploadClassroomRecording"));
        assert.ok(!roleHasCapability("coach", "uploadClassroomRecording"));
        assert.ok(!roleHasCapability("parent", "uploadClassroomRecording"));
    });

    test("home recording upload is parent-only", () => {
        assert.ok(roleHasCapability("parent", "uploadHomeRecording"));
        for (const role of ["admin", "teacher", "coach"]) {
            assert.ok(!roleHasCapability(role, "uploadHomeRecording"), role);
        }
    });

    test("aggregate approval is teacher/admin; transcript grant is admin-only", () => {
        assert.ok(roleHasCapability("teacher", "approveCoachAggregateAccess"));
        assert.ok(roleHasCapability("admin", "approveCoachAggregateAccess"));
        assert.ok(!roleHasCapability("coach", "approveCoachAggregateAccess"));
        assert.ok(roleHasCapability("admin", "grantCoachTranscriptAccess"));
        assert.ok(!roleHasCapability("teacher", "grantCoachTranscriptAccess"));
    });

    test("unknown capability fails closed for every role", () => {
        for (const role of ["admin", "teacher", "parent", "coach"]) {
            assert.ok(!roleHasCapability(role, "notARealCapability"), role);
        }
    });

    test("unknown or missing role fails closed", () => {
        assert.ok(!roleHasCapability("researcher", "manageSchools"));
        assert.ok(!roleHasCapability(undefined, "manageSchools"));
        for (const capability of Object.keys(CAPABILITIES)) {
            assert.ok(!roleHasCapability("unknown-role", capability), capability);
        }
    });
});

describe("requireRole middleware", () => {
    test("allows listed role", () => {
        const res = fakeRes();
        let called = false;
        requireRole("coach")({ user: { role: "coach" } }, res, () => { called = true; });
        assert.ok(called);
        assert.equal(res.statusCode, null);
    });

    test("rejects other roles with 403", () => {
        const res = fakeRes();
        let called = false;
        requireRole("admin")({ user: { role: "teacher" } }, res, () => { called = true; });
        assert.ok(!called);
        assert.equal(res.statusCode, 403);
    });

    test("rejects missing user with 403", () => {
        const res = fakeRes();
        let called = false;
        requireRole("admin")({}, res, () => { called = true; });
        assert.ok(!called);
        assert.equal(res.statusCode, 403);
    });
});

describe("requireCapability middleware", () => {
    test("allows role with the capability", () => {
        const res = fakeRes();
        let called = false;
        requireCapability("manageCoaches")({ user: { role: "admin" } }, res, () => { called = true; });
        assert.ok(called);
    });

    test("rejects role without the capability", () => {
        const res = fakeRes();
        let called = false;
        requireCapability("manageCoaches")({ user: { role: "coach" } }, res, () => { called = true; });
        assert.ok(!called);
        assert.equal(res.statusCode, 403);
    });

    test("unknown capability fails closed", () => {
        const res = fakeRes();
        let called = false;
        requireCapability("bogus")({ user: { role: "admin" } }, res, () => { called = true; });
        assert.ok(!called);
        assert.equal(res.statusCode, 403);
    });
});

describe("isEnrolledParent", () => {
    test("member parent is enrolled", () => {
        assert.ok(isEnrolledParent({ id: PARENT_ID, role: "parent" }, classroom));
    });

    test("non-member parent is not enrolled", () => {
        assert.ok(!isEnrolledParent({ id: OUTSIDER_ID, role: "parent" }, classroom));
    });

    test("non-parent roles never count as enrolled", () => {
        assert.ok(!isEnrolledParent({ id: PARENT_ID, role: "teacher" }, classroom));
        assert.ok(!isEnrolledParent({ id: PARENT_ID, role: "coach" }, classroom));
    });
});

describe("classroom view policy (non-coach paths, no DB)", () => {
    test("managers get both tiers", async () => {
        for (const user of [
            { id: OUTSIDER_ID, role: "admin" },
            { id: LEAD_ID, role: "teacher" },
            { id: ASSISTANT_ID, role: "teacher" },
        ]) {
            assert.ok(await canViewClassroomAggregates(user, classroom), user.role);
            assert.ok(await canViewClassroomTranscripts(user, classroom), user.role);
        }
    });

    test("enrolled parent gets both tiers", async () => {
        const parent = { id: PARENT_ID, role: "parent" };
        assert.ok(await canViewClassroomAggregates(parent, classroom));
        assert.ok(await canViewClassroomTranscripts(parent, classroom));
    });

    test("outsider teacher and non-member parent are denied", async () => {
        assert.ok(!(await canViewClassroomAggregates({ id: OUTSIDER_ID, role: "teacher" }, classroom)));
        assert.ok(!(await canViewClassroomTranscripts({ id: OUTSIDER_ID, role: "parent" }, classroom)));
    });

    test("missing user or classroom is denied", async () => {
        assert.ok(!(await canViewClassroomAggregates(null, classroom)));
        assert.ok(!(await canViewClassroomAggregates({ id: COACH_ID, role: "admin" }, null)));
    });
});
