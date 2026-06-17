import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
    parseNoteScope,
    canWriteClassroomNotes,
    canReadClassroomNotes,
} from "../../lib/noteAccessHelpers.js";

const VALID_CHILD = "64b0000000000000000000c1";
const VALID_CLASSROOM = "64b0000000000000000000aa";
const PARENT_ID = "64b000000000000000000001";
const TEACHER_ID = "64b000000000000000000002";

describe("noteAccessHelpers — parseNoteScope", () => {
    test("accepts childId only", () => {
        const result = parseNoteScope({ childId: VALID_CHILD });
        assert.equal(result.ok, true);
        assert.equal(result.childId, VALID_CHILD);
        assert.equal(result.classroomId, null);
    });

    test("accepts classroomId only", () => {
        const result = parseNoteScope({ classroomId: VALID_CLASSROOM });
        assert.equal(result.ok, true);
        assert.equal(result.classroomId, VALID_CLASSROOM);
        assert.equal(result.childId, null);
    });

    test("rejects both scopes", () => {
        const result = parseNoteScope({
            childId: VALID_CHILD,
            classroomId: VALID_CLASSROOM,
        });
        assert.equal(result.ok, false);
        assert.match(result.message, /not both/i);
    });

    test("rejects missing scope", () => {
        const result = parseNoteScope({});
        assert.equal(result.ok, false);
        assert.match(result.message, /required/i);
    });

    test("rejects invalid ids", () => {
        assert.equal(parseNoteScope({ childId: "bad" }).ok, false);
        assert.equal(parseNoteScope({ classroomId: "bad" }).ok, false);
    });
});

describe("noteAccessHelpers — classroom access", () => {
    const classroom = {
        _id: new mongoose.Types.ObjectId(VALID_CLASSROOM),
        teacher: new mongoose.Types.ObjectId(TEACHER_ID),
        assistantTeacher: null,
        parents: [new mongoose.Types.ObjectId(PARENT_ID)],
        name: "Owls",
    };

    test("enrolled parent can read but not write", async () => {
        const parentUser = { id: PARENT_ID, role: "parent" };
        assert.equal(await canReadClassroomNotes(parentUser, classroom), true);
        assert.equal(await canWriteClassroomNotes(parentUser, classroom), false);
    });

    test("lead teacher can read and write", async () => {
        const teacherUser = { id: TEACHER_ID, role: "teacher" };
        assert.equal(await canReadClassroomNotes(teacherUser, classroom), true);
        assert.equal(await canWriteClassroomNotes(teacherUser, classroom), true);
    });
});
