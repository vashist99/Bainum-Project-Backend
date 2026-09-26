import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    chartAccessAllowed,
    classroomTeacherIds,
    coachEligibleForChildHome,
    coachEligibleForClassroom,
    homeViewerSlot,
    parentEligibleForClassroom,
    teacherEligibleForChildHome,
} from "../../lib/viewerEligibility.js";

const LEAD = "t-lead";
const ASSISTANT = "t-asst";
const PARENT = "p1";
const CHILD = "c1";
const COACH = "coach1";
const OTHER_COACH = "coach2";

const classroom = {
    _id: "room1",
    teacher: LEAD,
    assistantTeacher: ASSISTANT,
    children: [CHILD],
    parents: [PARENT],
};

describe("viewerEligibility", () => {
    test("classroomTeacherIds includes lead and assistant once", () => {
        assert.deepEqual(classroomTeacherIds(classroom), [LEAD, ASSISTANT]);
        assert.deepEqual(classroomTeacherIds({ teacher: LEAD, assistantTeacher: LEAD }), [LEAD]);
        assert.deepEqual(classroomTeacherIds(null), []);
    });

    test("teacher is eligible for home when they share a classroom with the parent and child", () => {
        assert.equal(
            teacherEligibleForChildHome({
                teacherId: LEAD,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom],
            }),
            true
        );
        assert.equal(
            teacherEligibleForChildHome({
                teacherId: ASSISTANT,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom],
            }),
            true
        );
        assert.equal(
            teacherEligibleForChildHome({
                teacherId: "outsider",
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom],
            }),
            false
        );
        assert.equal(
            teacherEligibleForChildHome({
                teacherId: LEAD,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [{ ...classroom, children: [] }],
            }),
            false
        );
        assert.equal(
            teacherEligibleForChildHome({
                teacherId: LEAD,
                childId: CHILD,
                childParentIds: ["other-parent"],
                classrooms: [classroom],
            }),
            false
        );
    });

    test("coach is eligible for classroom and home when they supervise a classroom teacher", () => {
        const teacherCoachById = { [LEAD]: COACH };
        assert.equal(coachEligibleForClassroom({ coachId: COACH, classroom, teacherCoachById }), true);
        assert.equal(
            coachEligibleForClassroom({ coachId: OTHER_COACH, classroom, teacherCoachById }),
            false
        );
        assert.equal(
            coachEligibleForChildHome({
                coachId: COACH,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom],
                teacherCoachById,
            }),
            true
        );
        assert.equal(
            coachEligibleForChildHome({
                coachId: COACH,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [{ ...classroom, children: [] }],
                teacherCoachById,
            }),
            false
        );
    });

    test("home viewer slot is assistant, and lead wins when the teacher leads another shared room", () => {
        assert.equal(
            homeViewerSlot({
                teacherId: ASSISTANT,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom],
            }),
            "assistant"
        );
        assert.equal(
            homeViewerSlot({
                teacherId: LEAD,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom],
            }),
            "lead"
        );
        const alsoLeads = {
            _id: "room2",
            teacher: ASSISTANT,
            assistantTeacher: null,
            children: [CHILD],
            parents: [PARENT],
        };
        assert.equal(
            homeViewerSlot({
                teacherId: ASSISTANT,
                childId: CHILD,
                childParentIds: [PARENT],
                classrooms: [classroom, alsoLeads],
            }),
            "lead"
        );
        assert.equal(
            chartAccessAllowed({ eligible: true, revoked: false }),
            true
        );
        assert.equal(
            chartAccessAllowed({ eligible: true, revoked: true }),
            false
        );
    });

    test("parent is eligible only when enrolled", () => {
        assert.equal(parentEligibleForClassroom({ parentId: PARENT, classroom }), true);
        assert.equal(parentEligibleForClassroom({ parentId: "other", classroom }), false);
    });

    test("charts = eligible and not revoked; admin-style always-on is eligible + not revoked", () => {
        assert.equal(chartAccessAllowed({ eligible: true, revoked: false }), true);
        assert.equal(chartAccessAllowed({ eligible: true, revoked: true }), false);
        assert.equal(chartAccessAllowed({ eligible: false, revoked: false }), false);
        assert.equal(chartAccessAllowed({ eligible: false, revoked: true }), false);
    });
});
