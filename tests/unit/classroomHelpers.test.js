import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeCenterName, isSameCenter } from "../../lib/centerNames.js";
import {
    canManageClassroom,
    classroomRoleForUser,
    validateAssistant,
    parseInvitePayload,
} from "../../lib/classroomHelpers.js";

const LEAD_ID = "64b000000000000000000001";
const ASSISTANT_ID = "64b000000000000000000002";
const OUTSIDER_ID = "64b000000000000000000003";

const classroom = {
    _id: "64b0000000000000000000aa",
    name: "Sunflowers",
    teacher: LEAD_ID,
    assistantTeacher: ASSISTANT_ID,
    center: "Main Street Center",
};

const classroomNoAssistant = { ...classroom, assistantTeacher: null };

describe("centerNames", () => {
    test("normalizeCenterName trims and lowercases", () => {
        assert.equal(normalizeCenterName("  Main Street Center  "), "main street center");
        assert.equal(normalizeCenterName(null), "");
        assert.equal(normalizeCenterName(undefined), "");
    });

    test("isSameCenter tolerates case and whitespace drift", () => {
        assert.ok(isSameCenter("Main Street Center", "  main street center "));
        assert.ok(!isSameCenter("Main Street Center", "Other Center"));
    });

    test("isSameCenter rejects empty values", () => {
        assert.ok(!isSameCenter("", ""));
        assert.ok(!isSameCenter(null, null));
        assert.ok(!isSameCenter("Main", ""));
    });
});

describe("canManageClassroom", () => {
    test("admin manages any classroom", () => {
        assert.ok(canManageClassroom({ id: OUTSIDER_ID, role: "admin" }, classroom));
    });

    test("lead teacher manages own classroom", () => {
        assert.ok(canManageClassroom({ id: LEAD_ID, role: "teacher" }, classroom));
    });

    test("assistant teacher manages the classroom", () => {
        assert.ok(canManageClassroom({ id: ASSISTANT_ID, role: "teacher" }, classroom));
    });

    test("outsider teacher is denied", () => {
        assert.ok(!canManageClassroom({ id: OUTSIDER_ID, role: "teacher" }, classroom));
    });

    test("parent is denied even if ids collide", () => {
        assert.ok(!canManageClassroom({ id: LEAD_ID, role: "parent" }, classroom));
    });

    test("no assistant set: only lead and admin pass", () => {
        assert.ok(canManageClassroom({ id: LEAD_ID, role: "teacher" }, classroomNoAssistant));
        assert.ok(!canManageClassroom({ id: ASSISTANT_ID, role: "teacher" }, classroomNoAssistant));
    });

    test("handles populated (object) teacher refs", () => {
        const populated = {
            ...classroom,
            teacher: { _id: LEAD_ID, name: "Lead" },
            assistantTeacher: { _id: ASSISTANT_ID, name: "Helper" },
        };
        assert.ok(canManageClassroom({ id: LEAD_ID, role: "teacher" }, populated));
        assert.ok(canManageClassroom({ id: ASSISTANT_ID, role: "teacher" }, populated));
        assert.ok(!canManageClassroom({ id: OUTSIDER_ID, role: "teacher" }, populated));
    });

    test("null user or classroom denied", () => {
        assert.ok(!canManageClassroom(null, classroom));
        assert.ok(!canManageClassroom({ id: LEAD_ID, role: "teacher" }, null));
    });
});

describe("classroomRoleForUser", () => {
    test("flags lead and assistant roles", () => {
        assert.equal(classroomRoleForUser({ id: LEAD_ID, role: "teacher" }, classroom), "lead");
        assert.equal(classroomRoleForUser({ id: ASSISTANT_ID, role: "teacher" }, classroom), "assistant");
    });

    test("admin and outsiders get null", () => {
        assert.equal(classroomRoleForUser({ id: LEAD_ID, role: "admin" }, classroom), null);
        assert.equal(classroomRoleForUser({ id: OUTSIDER_ID, role: "teacher" }, classroom), null);
    });
});

describe("parseInvitePayload", () => {
    test("new shape: per-child selection preserved", () => {
        const result = parseInvitePayload({
            invites: [{ parentId: "p1", childIds: ["c1", "c2"] }],
        });
        assert.ok(result.ok);
        assert.deepEqual(result.entries, [{ parentId: "p1", childIds: ["c1", "c2"] }]);
    });

    test("new shape: omitted childIds means all eligible", () => {
        const result = parseInvitePayload({ invites: [{ parentId: "p1" }] });
        assert.ok(result.ok);
        assert.deepEqual(result.entries, [{ parentId: "p1", childIds: null }]);
    });

    test("new shape: empty childIds list enrolls no children but adds parent", () => {
        const result = parseInvitePayload({ invites: [{ parentId: "p1", childIds: [] }] });
        assert.ok(result.ok);
        assert.deepEqual(result.entries[0].childIds, []);
    });

    test("legacy shape: parentIds expands to all-eligible entries", () => {
        const result = parseInvitePayload({ parentIds: ["p1", "p2"] });
        assert.ok(result.ok);
        assert.deepEqual(result.entries, [
            { parentId: "p1", childIds: null },
            { parentId: "p2", childIds: null },
        ]);
    });

    test("rejects empty or missing payloads", () => {
        assert.ok(!parseInvitePayload({}).ok);
        assert.ok(!parseInvitePayload({ invites: [] }).ok);
        assert.ok(!parseInvitePayload({ parentIds: [] }).ok);
        assert.ok(!parseInvitePayload(null).ok);
    });

    test("rejects malformed entries", () => {
        assert.ok(!parseInvitePayload({ invites: [{ childIds: ["c1"] }] }).ok);
        assert.ok(!parseInvitePayload({ invites: [{ parentId: "p1", childIds: "c1" }] }).ok);
    });
});

describe("validateAssistant", () => {
    test("accepts same-center assistant distinct from lead", () => {
        const result = validateAssistant({
            leadId: LEAD_ID,
            assistantDoc: { _id: ASSISTANT_ID, center: "  main street center " },
            classroomCenter: "Main Street Center",
        });
        assert.ok(result.ok);
    });

    test("rejects assistant equal to lead", () => {
        const result = validateAssistant({
            leadId: LEAD_ID,
            assistantDoc: { _id: LEAD_ID, center: "Main Street Center" },
            classroomCenter: "Main Street Center",
        });
        assert.ok(!result.ok);
        assert.match(result.message, /same as the lead/i);
    });

    test("rejects assistant from another center", () => {
        const result = validateAssistant({
            leadId: LEAD_ID,
            assistantDoc: { _id: ASSISTANT_ID, center: "Other Center" },
            classroomCenter: "Main Street Center",
        });
        assert.ok(!result.ok);
        assert.match(result.message, /classroom's center/i);
    });

    test("rejects missing assistant doc", () => {
        const result = validateAssistant({
            leadId: LEAD_ID,
            assistantDoc: null,
            classroomCenter: "Main Street Center",
        });
        assert.ok(!result.ok);
    });
});
