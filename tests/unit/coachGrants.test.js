import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import CoachClassroomGrant from "../../models/CoachClassroomGrant.js";
import { Coach, Teacher } from "../../models/User.js";
import {
    canViewClassroomAggregates,
    canViewClassroomTranscripts,
    coachClassroomTier,
} from "../../lib/permissions.js";

const COACH_ID = new mongoose.Types.ObjectId("64b000000000000000000004");
const CLASSROOM_ID = new mongoose.Types.ObjectId("64b0000000000000000000aa");

const classroom = {
    _id: CLASSROOM_ID,
    name: "Sunflowers",
    teacher: "64b000000000000000000001",
    assistantTeacher: null,
    parents: [],
};

const coachUser = { id: String(COACH_ID), role: "coach" };

describe("CoachClassroomGrant model — schema constraints", () => {
    test("defaults: pending status, no transcript access", () => {
        const grant = new CoachClassroomGrant({
            coachId: COACH_ID,
            classroomId: CLASSROOM_ID,
        });
        assert.equal(grant.validateSync(), undefined);
        assert.equal(grant.status, "pending");
        assert.equal(grant.transcriptAccess, false);
    });

    test("status only allows the lifecycle values", () => {
        const grant = new CoachClassroomGrant({
            coachId: COACH_ID,
            classroomId: CLASSROOM_ID,
            status: "not-a-status",
        });
        assert.ok(grant.validateSync()?.errors?.status);
    });

    test("unique index covers (coachId, classroomId)", () => {
        const indexes = CoachClassroomGrant.schema.indexes();
        const unique = indexes.find(
            ([fields, options]) =>
                options?.unique && fields.coachId === 1 && fields.classroomId === 1
        );
        assert.ok(unique, "expected unique index on (coachId, classroomId)");
    });
});

describe("Coach and Teacher models — coach plumbing", () => {
    test("Coach role enum only allows 'coach'", () => {
        const coach = new Coach({
            name: "Coach Carter",
            email: "coach@example.com",
            role: "teacher",
            password: "x",
        });
        assert.ok(coach.validateSync()?.errors?.role);
    });

    test("Teacher.coachId is an optional Coach ref defaulting to null", () => {
        const path = Teacher.schema.path("coachId");
        assert.ok(path, "Teacher schema should define coachId");
        assert.equal(path.options.ref, "Coach");
        assert.equal(path.options.default, null);
    });
});

function mockFindOne(t, result) {
    t.mock.method(CoachClassroomGrant, "findOne", (query) => ({
        lean: async () => {
            // The policy layer must only ever consider ACTIVE grants for access.
            if (result && query.status && query.status !== result.status) return null;
            return result;
        },
    }));
}

describe("coach classroom view policy", () => {
    test("active grant → aggregates yes, transcripts no", async (t) => {
        mockFindOne(t, { status: "active", transcriptAccess: false });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), true);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), false);
    });

    test("active grant with transcript tier → both", async (t) => {
        mockFindOne(t, { status: "active", transcriptAccess: true });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), true);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), true);
    });

    test("no grant → neither", async (t) => {
        mockFindOne(t, null);
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), false);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), false);
    });

    test("pending grant → neither (query filters on active)", async (t) => {
        mockFindOne(t, { status: "pending", transcriptAccess: false });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), false);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), false);
    });
});

describe("coachClassroomTier", () => {
    function mockTierFindOne(t, result) {
        t.mock.method(CoachClassroomGrant, "findOne", () => ({
            lean: async () => result,
        }));
    }

    test("no grant → none", async (t) => {
        mockTierFindOne(t, null);
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "none");
    });

    test("revoked → none", async (t) => {
        mockTierFindOne(t, { status: "revoked", transcriptAccess: false });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "none");
    });

    test("pending → requested", async (t) => {
        mockTierFindOne(t, { status: "pending", transcriptAccess: false });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "requested");
    });

    test("active → aggregate; active + flag → transcripts", async (t) => {
        mockTierFindOne(t, { status: "active", transcriptAccess: false });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "aggregate");
        mockTierFindOne(t, { status: "active", transcriptAccess: true });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "transcripts");
    });
});
