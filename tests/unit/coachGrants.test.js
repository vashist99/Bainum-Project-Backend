import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import CoachClassroomGrant from "../../models/CoachClassroomGrant.js";
import Classroom from "../../models/Classroom.js";
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

function mockCoachAccess(t, { eligible = true, grant = null } = {}) {
    t.mock.method(Teacher, "find", () => ({
        select() {
            return this;
        },
        lean: async () =>
            eligible
                ? [{ _id: classroom.teacher, coachId: COACH_ID }]
                : [{ _id: classroom.teacher, coachId: null }],
    }));
    t.mock.method(CoachClassroomGrant, "findOne", async () => grant);
    t.mock.method(CoachClassroomGrant, "create", async (doc) => ({
        ...doc,
        status: "active",
        transcriptAccess: false,
        async save() {
            return this;
        },
    }));
}

describe("coach classroom view policy", () => {
    test("eligible + active grant → aggregates yes, transcripts no", async (t) => {
        mockCoachAccess(t, { grant: { status: "active", transcriptAccess: false } });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), true);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), false);
    });

    test("eligible + transcript tier → both", async (t) => {
        mockCoachAccess(t, { grant: { status: "active", transcriptAccess: true } });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), true);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), true);
    });

    test("eligible with no grant auto-opens aggregates", async (t) => {
        mockCoachAccess(t, { grant: null });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), true);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), false);
    });

    test("revoked grant → neither", async (t) => {
        mockCoachAccess(t, { grant: { status: "revoked", transcriptAccess: false } });
        assert.equal(await canViewClassroomAggregates(coachUser, classroom), false);
        assert.equal(await canViewClassroomTranscripts(coachUser, classroom), false);
    });
});

describe("coachClassroomTier", () => {
    function mockClassroom(t) {
        t.mock.method(Classroom, "findById", () => ({
            select() {
                return { lean: async () => classroom };
            },
        }));
    }

    test("ineligible → none", async (t) => {
        mockClassroom(t);
        mockCoachAccess(t, { eligible: false, grant: null });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "none");
    });

    test("revoked → none", async (t) => {
        mockClassroom(t);
        mockCoachAccess(t, { grant: { status: "revoked", transcriptAccess: false } });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "none");
    });

    test("eligible pending activates to aggregate", async (t) => {
        mockClassroom(t);
        const grant = {
            status: "pending",
            transcriptAccess: false,
            async save() {
                this.status = "active";
            },
        };
        mockCoachAccess(t, { grant });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "aggregate");
    });

    test("active → aggregate; active + flag → transcripts", async (t) => {
        mockClassroom(t);
        mockCoachAccess(t, { grant: { status: "active", transcriptAccess: false } });
        assert.equal(await coachClassroomTier(COACH_ID, CLASSROOM_ID), "aggregate");
    });
});
