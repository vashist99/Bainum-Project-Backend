import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { getSupervisedChildrenForTeacher } from "../../lib/teacherChildHelpers.js";
import Classroom from "../../models/Classroom.js";
import AccessGrant from "../../models/AccessGrant.js";
import { Child } from "../../models/User.js";

// We mock Mongoose statics rather than spinning up a Mongo instance.
// `Model.find` returns a query object that supports a fluent chain
// (`.select(...).lean()`), so the stub must return the same shape.
function queryReturning(value) {
    const promise = Promise.resolve(value);
    const chain = {
        select() {
            return chain;
        },
        populate() {
            return chain;
        },
        lean() {
            return promise;
        },
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
    };
    return chain;
}

const TEACHER_ID = new mongoose.Types.ObjectId();
const ROOM_A = new mongoose.Types.ObjectId();
const ROOM_B = new mongoose.Types.ObjectId();
const CHILD_1 = new mongoose.Types.ObjectId();
const CHILD_2 = new mongoose.Types.ObjectId();
const CHILD_3 = new mongoose.Types.ObjectId(); // grant-only

let classroomFindMock;
let accessGrantFindMock;
let childFindMock;

beforeEach(() => {
    // Fresh per-test stubs; assigned inside tests for the specific case.
});

afterEach(() => {
    classroomFindMock?.mock?.restore?.();
    accessGrantFindMock?.mock?.restore?.();
    childFindMock?.mock?.restore?.();
});

describe("getSupervisedChildrenForTeacher", () => {
    test("returns [] when teacher is null/undefined (no DB hit)", async (t) => {
        // If the guard ever regresses, an unexpected mongoose call would
        // throw against the real DB and fail this test loudly.
        const result = await getSupervisedChildrenForTeacher(null);
        assert.deepEqual(result, []);

        const result2 = await getSupervisedChildrenForTeacher({});
        assert.deepEqual(result2, []);
    });

    test("unions classroom-member children with active grant children, deduped", async (t) => {
        classroomFindMock = t.mock.method(Classroom, "find", () =>
            queryReturning([
                { _id: ROOM_A, children: [CHILD_1, CHILD_2] },
                { _id: ROOM_B, children: [CHILD_2] }, // overlap → must dedupe
            ])
        );
        accessGrantFindMock = t.mock.method(AccessGrant, "find", () =>
            queryReturning([
                { childId: CHILD_3 },
                { childId: CHILD_1 }, // overlap with classroom → must dedupe
            ])
        );
        const found = [
            { _id: CHILD_1, name: "Alice" },
            { _id: CHILD_2, name: "Bob" },
            { _id: CHILD_3, name: "Carol" },
        ];
        childFindMock = t.mock.method(Child, "find", (filter) => {
            if (filter?.classrooms?.$in) {
                return queryReturning([]);
            }
            if (filter?._id?.$in) {
                return queryReturning(found);
            }
            assert.fail(`Unexpected Child.find filter: ${JSON.stringify(filter)}`);
        });

        const result = await getSupervisedChildrenForTeacher({ _id: TEACHER_ID });
        const names = result.map((c) => c.name).sort();
        assert.deepEqual(names, ["Alice", "Bob", "Carol"]);

        // Classroom.find was queried with the teacher under either role.
        const classroomFilter = classroomFindMock.mock.calls[0].arguments[0];
        assert.deepEqual(classroomFilter, {
            $or: [
                { teacher: TEACHER_ID },
                { assistantTeacher: TEACHER_ID },
            ],
        });

        // Grants query is scoped to active grants only.
        const grantFilter = accessGrantFindMock.mock.calls[0].arguments[0];
        assert.equal(String(grantFilter.teacherId), String(TEACHER_ID));
        assert.equal(grantFilter.status, "active");

        // Child.find by ids (second call) was invoked with the deduped id set (3 unique).
        const childFilter = childFindMock.mock.calls[1].arguments[0];
        assert.equal(childFilter._id.$in.length, 3);
    });

    test("returns [] when teacher leads no classrooms and has no grants", async (t) => {
        classroomFindMock = t.mock.method(Classroom, "find", () =>
            queryReturning([])
        );
        accessGrantFindMock = t.mock.method(AccessGrant, "find", () =>
            queryReturning([])
        );
        // Child.find must never be called when the id set is empty.
        childFindMock = t.mock.method(Child, "find", () => {
            assert.fail("Child.find should not run when there are no ids");
        });

        const result = await getSupervisedChildrenForTeacher({ _id: TEACHER_ID });
        assert.deepEqual(result, []);
        assert.equal(childFindMock.mock.calls.length, 0);
    });

    test("dedupes children that appear in multiple classrooms AND a grant", async (t) => {
        classroomFindMock = t.mock.method(Classroom, "find", () =>
            queryReturning([
                { _id: ROOM_A, children: [CHILD_1] },
                { _id: ROOM_B, children: [CHILD_1] },
            ])
        );
        accessGrantFindMock = t.mock.method(AccessGrant, "find", () =>
            queryReturning([{ childId: CHILD_1 }])
        );
        childFindMock = t.mock.method(Child, "find", (filter) => {
            if (filter?.classrooms?.$in) {
                return queryReturning([]);
            }
            if (filter?._id?.$in) {
                return queryReturning([{ _id: CHILD_1, name: "Solo" }]);
            }
            assert.fail(`Unexpected Child.find filter: ${JSON.stringify(filter)}`);
        });

        const result = await getSupervisedChildrenForTeacher({ _id: TEACHER_ID });
        assert.equal(result.length, 1);
        assert.equal(result[0].name, "Solo");
    });

    test("skips grant rows with no childId (defensive)", async (t) => {
        classroomFindMock = t.mock.method(Classroom, "find", () =>
            queryReturning([{ _id: ROOM_A, children: [CHILD_1] }])
        );
        accessGrantFindMock = t.mock.method(AccessGrant, "find", () =>
            queryReturning([{}, { childId: null }, { childId: CHILD_2 }])
        );
        childFindMock = t.mock.method(Child, "find", (filter) => {
            if (filter?.classrooms?.$in) {
                return queryReturning([]);
            }
            if (filter?._id?.$in) {
                return queryReturning([
                    { _id: CHILD_1, name: "Alice" },
                    { _id: CHILD_2, name: "Bob" },
                ]);
            }
            assert.fail(`Unexpected Child.find filter: ${JSON.stringify(filter)}`);
        });

        const result = await getSupervisedChildrenForTeacher({ _id: TEACHER_ID });
        assert.equal(result.length, 2);
    });

    test("does NOT consult Child.leadTeacher (legacy field is gone)", async (t) => {
        // Regression guard: the rewrite must not silently fall back to a
        // name-matched query. If anyone re-introduces a leadTeacher lookup,
        // the absence of this lean-chain query would still pass — so we
        // assert the exact set of Child.find filters used in this code path.
        classroomFindMock = t.mock.method(Classroom, "find", () =>
            queryReturning([{ _id: ROOM_A, children: [CHILD_1] }])
        );
        accessGrantFindMock = t.mock.method(AccessGrant, "find", () =>
            queryReturning([])
        );
        childFindMock = t.mock.method(Child, "find", (filter) => {
            if (filter?.classrooms?.$in) {
                return queryReturning([]);
            }
            if (filter?._id?.$in) {
                return queryReturning([{ _id: CHILD_1 }]);
            }
            assert.fail(`Unexpected Child.find filter: ${JSON.stringify(filter)}`);
        });

        await getSupervisedChildrenForTeacher({ _id: TEACHER_ID });

        // Final Child.find by ids (populate) plus one classrooms back-ref lookup.
        assert.equal(childFindMock.mock.calls.length, 2);
        const filter = childFindMock.mock.calls[1].arguments[0];
        assert.ok(filter._id?.$in, "Expected an _id $in filter");
        assert.equal(filter.leadTeacher, undefined);
    });
});
