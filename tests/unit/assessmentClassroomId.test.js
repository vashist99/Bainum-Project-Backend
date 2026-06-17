import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Assessment from "../../models/Assessment.js";
import TeacherAssessment from "../../models/TeacherAssessment.js";

const DUMMY_CHILD = new mongoose.Types.ObjectId();
const DUMMY_TEACHER = new mongoose.Types.ObjectId();
const DUMMY_CLASSROOM = new mongoose.Types.ObjectId();

describe("Assessment.classroomId", () => {
    test("schema declares classroomId as an optional indexed Classroom ref", () => {
        const path = Assessment.schema.paths.classroomId;
        assert.ok(path, "classroomId path missing");
        assert.equal(path.instance, "ObjectId");
        assert.equal(path.options.ref, "Classroom");
        assert.equal(path.options.required, false);
        assert.equal(path.options.index, true);
    });

    test("instantiating without classroomId leaves it undefined (non-classroom recording)", () => {
        const doc = new Assessment({ childId: DUMMY_CHILD });
        assert.equal(doc.classroomId, undefined);
    });

    test("instantiating with classroomId stores the ObjectId", () => {
        const doc = new Assessment({
            childId: DUMMY_CHILD,
            classroomId: DUMMY_CLASSROOM,
        });
        assert.equal(String(doc.classroomId), String(DUMMY_CLASSROOM));
    });
});

describe("TeacherAssessment.classroomId", () => {
    test("schema declares classroomId as an optional indexed Classroom ref", () => {
        const path = TeacherAssessment.schema.paths.classroomId;
        assert.ok(path, "classroomId path missing");
        assert.equal(path.instance, "ObjectId");
        assert.equal(path.options.ref, "Classroom");
        assert.equal(path.options.required, false);
        assert.equal(path.options.index, true);
    });

    test("instantiating without classroomId leaves it undefined", () => {
        const doc = new TeacherAssessment({ teacherId: DUMMY_TEACHER });
        assert.equal(doc.classroomId, undefined);
    });

    test("instantiating with classroomId stores the ObjectId", () => {
        const doc = new TeacherAssessment({
            teacherId: DUMMY_TEACHER,
            classroomId: DUMMY_CLASSROOM,
        });
        assert.equal(String(doc.classroomId), String(DUMMY_CLASSROOM));
    });
});
