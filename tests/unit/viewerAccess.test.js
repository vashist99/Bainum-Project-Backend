import { test, describe } from "node:test";
import assert from "node:assert/strict";

import ParentClassroomGrant from "../../models/ParentClassroomGrant.js";
import HomeViewGrant from "../../models/HomeViewGrant.js";
import {
    canViewerSeeHomeCharts,
    canViewerSeeHomeTranscripts,
    resolveParentClassroomAccess,
} from "../../lib/viewerAccessService.js";
import { goneRequestFlow } from "../../controllers/viewerAccessController.js";

const CHILD_ID = "64b0000000000000000000c1";
const PARENT_ID = "64b000000000000000000001";
const TEACHER_ID = "64b000000000000000000002";
const COACH_ID = "64b000000000000000000004";

describe("viewerAccess — home charts", () => {
    test("admin always sees home charts and transcripts", async () => {
        const admin = { id: "64b000000000000000000009", role: "admin" };
        assert.equal(await canViewerSeeHomeCharts(admin, CHILD_ID), true);
        assert.equal(await canViewerSeeHomeTranscripts(admin, CHILD_ID), true);
    });

    test("revoked home grant blocks teacher charts even if they were eligible", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () => ({ lean: async () => ({ status: "revoked" }) }));
        const teacher = { id: TEACHER_ID, role: "teacher" };
        assert.equal(await canViewerSeeHomeCharts(teacher, CHILD_ID), false);
    });

    test("active covering grant opens teacher charts", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () => ({ lean: async () => null }));
        t.mock.method(HomeViewGrant, "exists", async () => ({ _id: "g1" }));
        const teacher = { id: TEACHER_ID, role: "teacher" };
        assert.equal(await canViewerSeeHomeCharts(teacher, CHILD_ID), true);
    });

    test("home transcripts stay off unless an active grant has the admin flag", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () => ({ lean: async () => null }));
        t.mock.method(HomeViewGrant, "exists", async (query) => {
            if (query.transcriptAccess === true) return null;
            return { _id: "g1" };
        });
        const teacher = { id: TEACHER_ID, role: "teacher" };
        assert.equal(await canViewerSeeHomeCharts(teacher, CHILD_ID), true);
        assert.equal(await canViewerSeeHomeTranscripts(teacher, CHILD_ID), false);
    });

    test("coach uses the same home chart path as teacher", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () => ({ lean: async () => null }));
        t.mock.method(HomeViewGrant, "exists", async () => ({ _id: "g1" }));
        assert.equal(await canViewerSeeHomeCharts({ id: COACH_ID, role: "coach" }, CHILD_ID), true);
    });
});

describe("viewerAccess — parent classroom", () => {
    const classroom = { _id: "room1", parents: [PARENT_ID] };

    test("enrolled parent with no grant is on", async (t) => {
        t.mock.method(ParentClassroomGrant, "findOne", () => ({ lean: async () => null }));
        const access = await resolveParentClassroomAccess(PARENT_ID, classroom);
        assert.equal(access.allowed, true);
    });

    test("sticky revoke hides classroom charts for an enrolled parent", async (t) => {
        t.mock.method(ParentClassroomGrant, "findOne", () => ({ lean: async () => ({ status: "revoked" }) }));
        const access = await resolveParentClassroomAccess(PARENT_ID, classroom);
        assert.equal(access.allowed, false);
    });

    test("unenrolled parent is denied even without a revoke row", async (t) => {
        const find = t.mock.method(ParentClassroomGrant, "findOne", async () => {
            throw new Error("should not query");
        });
        const access = await resolveParentClassroomAccess(PARENT_ID, { parents: [] });
        assert.equal(access.allowed, false);
        assert.equal(find.mock.callCount(), 0);
    });
});

describe("request APIs are gone", () => {
    test("goneRequestFlow returns 410", () => {
        const res = {
            statusCode: 0,
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
        goneRequestFlow({}, res);
        assert.equal(res.statusCode, 410);
        assert.match(res.body.message, /no longer used/i);
    });
});

describe("models — grant roles", () => {
    test("HomeViewGrant accepts coach granteeRole and system initiator", () => {
        const grant = new HomeViewGrant({
            childId: CHILD_ID,
            scope: "user",
            granteeId: COACH_ID,
            granteeRole: "coach",
            initiatedBy: "system",
            status: "active",
        });
        assert.equal(grant.validateSync(), undefined);
    });

    test("ParentClassroomGrant is unique per parent and classroom", () => {
        const grant = new ParentClassroomGrant({
            parentId: PARENT_ID,
            classroomId: "64b0000000000000000000aa",
        });
        assert.equal(grant.status, "active");
        const indexes = ParentClassroomGrant.schema.indexes();
        const unique = indexes.find(
            ([fields, options]) =>
                options?.unique && fields.parentId === 1 && fields.classroomId === 1
        );
        assert.ok(unique);
    });
});
