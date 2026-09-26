import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classroomEditDeps, updateClassroom } from "../../controllers/classroomController.js";
import Classroom from "../../models/Classroom.js";
import { Teacher } from "../../models/User.js";

const CLASSROOM_ID = "64b0000000000000000000aa";
const LEAD_ID = "64b000000000000000000001";
const ASSISTANT_ID = "64b000000000000000000002";
const OTHER_ID = "64b000000000000000000003";
const PARENT_ID = "64b000000000000000000004";
const COACH_ID = "64b000000000000000000005";

const teachers = {
    [LEAD_ID]: { _id: LEAD_ID, name: "Lead", center: "Center A" },
    [ASSISTANT_ID]: { _id: ASSISTANT_ID, name: "Aide", center: "Center A" },
    [OTHER_ID]: { _id: OTHER_ID, name: "Other", center: "Center B" },
};

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
    };
}

function classroomDoc(overrides = {}) {
    return {
        _id: CLASSROOM_ID,
        name: "Sunflowers",
        teacher: LEAD_ID,
        assistantTeacher: null,
        center: "Center A",
        ageGroup: null,
        saved: false,
        async save() {
            this.saved = true;
        },
        ...overrides,
    };
}

function stubTeachers(t) {
    t.mock.method(Teacher, "findById", async (id) => teachers[String(id)] || null);
}

describe("updateClassroom", () => {
    test("lead adds an assistant and an age group without changing the school", async (t) => {
        const doc = classroomDoc();
        t.mock.method(Classroom, "findById", async () => doc);
        stubTeachers(t);
        let synced = 0;
        t.mock.method(classroomEditDeps, "syncViewers", async () => {
            synced += 1;
        });

        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: LEAD_ID, role: "teacher" },
                body: {
                    name: "Sunflowers",
                    teacherId: LEAD_ID,
                    assistantTeacherId: ASSISTANT_ID,
                    ageGroup: "Pre-K",
                    school: "Center B",
                },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(doc.saved, true);
        assert.equal(String(doc.assistantTeacher), ASSISTANT_ID);
        assert.equal(doc.ageGroup, "Pre-K");
        assert.equal(doc.center, "Center A");
        assert.equal(synced, 1);
    });

    test("clearing the assistant syncs eligibility", async (t) => {
        const doc = classroomDoc({ assistantTeacher: ASSISTANT_ID });
        t.mock.method(Classroom, "findById", async () => doc);
        stubTeachers(t);
        let synced = 0;
        t.mock.method(classroomEditDeps, "syncViewers", async () => {
            synced += 1;
        });

        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: LEAD_ID, role: "teacher" },
                body: {
                    name: "Sunflowers",
                    teacherId: LEAD_ID,
                    assistantTeacherId: null,
                    ageGroup: null,
                },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(doc.assistantTeacher, null);
        assert.equal(synced, 1);
    });

    test("a name-only change does not sync eligibility", async (t) => {
        const doc = classroomDoc();
        t.mock.method(Classroom, "findById", async () => doc);
        stubTeachers(t);
        let synced = 0;
        t.mock.method(classroomEditDeps, "syncViewers", async () => {
            synced += 1;
        });

        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: LEAD_ID, role: "teacher" },
                body: { name: "Owls", teacherId: LEAD_ID, assistantTeacherId: null },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(doc.name, "Owls");
        assert.equal(synced, 0);
    });

    test("unknown age group is rejected and the classroom is unchanged", async (t) => {
        const doc = classroomDoc();
        t.mock.method(Classroom, "findById", async () => doc);
        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: LEAD_ID, role: "teacher" },
                body: { name: "Sunflowers", teacherId: LEAD_ID, ageGroup: "Kindergarten" },
            },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.equal(doc.saved, false);
    });

    test("a lead from another school is rejected", async (t) => {
        const doc = classroomDoc();
        t.mock.method(Classroom, "findById", async () => doc);
        stubTeachers(t);
        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { role: "admin", id: "64b000000000000000000009" },
                body: { name: "Sunflowers", teacherId: OTHER_ID },
            },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.equal(doc.saved, false);
        assert.equal(doc.center, "Center A");
    });

    test("assistant cannot be the lead or from another school", async (t) => {
        const doc = classroomDoc();
        t.mock.method(Classroom, "findById", async () => doc);
        stubTeachers(t);
        const same = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: LEAD_ID, role: "teacher" },
                body: { name: "Sunflowers", teacherId: LEAD_ID, assistantTeacherId: LEAD_ID },
            },
            same
        );
        assert.equal(same.statusCode, 400);

        const other = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: LEAD_ID, role: "teacher" },
                body: { name: "Sunflowers", teacherId: LEAD_ID, assistantTeacherId: OTHER_ID },
            },
            other
        );
        assert.equal(other.statusCode, 400);
        assert.equal(doc.saved, false);
    });

    test("a parent and an unrelated teacher are denied", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc());
        for (const user of [
            { id: PARENT_ID, role: "parent" },
            { id: OTHER_ID, role: "teacher" },
        ]) {
            const res = mockRes();
            await updateClassroom(
                { params: { id: CLASSROOM_ID }, user, body: { name: "Sunflowers", teacherId: LEAD_ID } },
                res
            );
            assert.equal(res.statusCode, 403);
        }
    });

    test("a revoked coach is denied", async (t) => {
        t.mock.method(Classroom, "findById", async () => classroomDoc());
        t.mock.method(classroomEditDeps, "coachMayEdit", async () => false);
        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: COACH_ID, role: "coach" },
                body: { name: "Sunflowers", teacherId: LEAD_ID, assistantTeacherId: ASSISTANT_ID },
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("a coach who can open the classroom can set the assistant and age group", async (t) => {
        const doc = classroomDoc();
        t.mock.method(Classroom, "findById", async () => doc);
        stubTeachers(t);
        t.mock.method(classroomEditDeps, "coachMayEdit", async () => true);
        t.mock.method(classroomEditDeps, "syncViewers", async () => {});
        const res = mockRes();
        await updateClassroom(
            {
                params: { id: CLASSROOM_ID },
                user: { id: COACH_ID, role: "coach" },
                body: { name: "Sunflowers", teacherId: LEAD_ID, assistantTeacherId: ASSISTANT_ID, ageGroup: "Toddler" },
            },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.equal(doc.ageGroup, "Toddler");
        assert.equal(String(doc.assistantTeacher), ASSISTANT_ID);
    });
});
