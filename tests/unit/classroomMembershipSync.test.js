import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Classroom from "../../models/Classroom.js";
import { Child } from "../../models/User.js";
import {
    materializeAndSyncClassroomChildren,
    enrichChildClassroomsFromRosters,
    resolveClassroomRosterChildIds,
} from "../../lib/classroomMembershipSync.js";

const CLASSROOM_ID = new mongoose.Types.ObjectId("64b0000000000000000000aa");
const CHILD_A = new mongoose.Types.ObjectId("64b0000000000000000000b1");
const CHILD_B = new mongoose.Types.ObjectId("64b0000000000000000000b2");
const STALE_ID = new mongoose.Types.ObjectId("64b0000000000000000000b3");

afterEach(() => {
    // node:test restores t.mock.method stubs per test.
});

function mockChildFind(t, handlers) {
    t.mock.method(Child, "find", (query) => {
        const handler =
            query?.classrooms != null
                ? handlers.onClassrooms
                : query?._id?.$in != null
                  ? handlers.onIds
                  : handlers.fallback;
        const result = handler ? handler(query) : [];
        return {
            select() {
                return this;
            },
            lean: () => Promise.resolve(result),
        };
    });
}

describe("resolveClassroomRosterChildIds", () => {
    test("unions roster array with Child.classrooms back-references", async (t) => {
        t.mock.method(Classroom, "findById", () => ({
            select() {
                return this;
            },
            lean: () => Promise.resolve({ children: [CHILD_A] }),
        }));
        mockChildFind(t, {
            onClassrooms: () => [{ _id: CHILD_B }],
        });

        const ids = await resolveClassroomRosterChildIds(CLASSROOM_ID);
        assert.equal(ids.length, 2);
        assert.deepEqual(ids.map(String).sort(), [String(CHILD_A), String(CHILD_B)].sort());
    });
});

describe("materializeAndSyncClassroomChildren", () => {
    test("returns summaries and mirrors classrooms onto children", async (t) => {
        const classroom = { _id: CLASSROOM_ID };

        t.mock.method(Classroom, "findById", () => ({
            select() {
                return this;
            },
            lean: () => Promise.resolve({ children: [CHILD_A, CHILD_B] }),
        }));
        mockChildFind(t, {
            onClassrooms: () => [],
            onIds: () => [
                { _id: CHILD_A, name: "Alice" },
                { _id: CHILD_B, name: "Bob" },
            ],
        });

        let updateManyArgs;
        t.mock.method(Child, "updateMany", (...args) => {
            updateManyArgs = args;
            return Promise.resolve({ modifiedCount: 2 });
        });

        t.mock.method(Classroom, "updateOne", () => Promise.resolve({ modifiedCount: 0 }));

        const { summaries } = await materializeAndSyncClassroomChildren(classroom);

        assert.equal(summaries.length, 2);
        assert.deepEqual(summaries.map((s) => s.name).sort(), ["Alice", "Bob"]);
        assert.equal(updateManyArgs[0]._id.$in.length, 2);
        assert.equal(String(updateManyArgs[1].$addToSet.classrooms), String(CLASSROOM_ID));
    });

    test("includes children enrolled only on Child.classrooms", async (t) => {
        const classroom = { _id: CLASSROOM_ID };

        t.mock.method(Classroom, "findById", () => ({
            select() {
                return this;
            },
            lean: () => Promise.resolve({ children: [CHILD_A] }),
        }));
        mockChildFind(t, {
            onClassrooms: () => [{ _id: CHILD_B }],
            onIds: () => [
                { _id: CHILD_A, name: "Alice" },
                { _id: CHILD_B, name: "Bob" },
            ],
        });

        t.mock.method(Child, "updateMany", () => Promise.resolve({ modifiedCount: 2 }));
        t.mock.method(Classroom, "updateOne", () => Promise.resolve({ modifiedCount: 1 }));

        const { summaries } = await materializeAndSyncClassroomChildren(classroom);

        assert.equal(summaries.length, 2);
        assert.deepEqual(summaries.map((s) => s.name).sort(), ["Alice", "Bob"]);
    });

    test("ignores null populate entries by reading raw roster from DB", async (t) => {
        const classroom = {
            _id: CLASSROOM_ID,
            // Simulates mongoose populate dropping a missing ref from the in-memory array.
            children: [{ _id: CHILD_A, name: "Alice" }],
        };

        t.mock.method(Classroom, "findById", () => ({
            select() {
                return this;
            },
            lean: () => Promise.resolve({ children: [CHILD_A, CHILD_B] }),
        }));
        mockChildFind(t, {
            onClassrooms: () => [],
            onIds: () => [
                { _id: CHILD_A, name: "Alice" },
                { _id: CHILD_B, name: "Bob" },
            ],
        });

        t.mock.method(Child, "updateMany", () => Promise.resolve({ modifiedCount: 2 }));
        t.mock.method(Classroom, "updateOne", () => Promise.resolve({ modifiedCount: 0 }));

        const { summaries } = await materializeAndSyncClassroomChildren(classroom);

        assert.equal(summaries.length, 2);
    });

    test("pulls stale child ids from classroom roster", async (t) => {
        const classroom = { _id: CLASSROOM_ID };

        t.mock.method(Classroom, "findById", () => ({
            select() {
                return this;
            },
            lean: () => Promise.resolve({ children: [CHILD_A, STALE_ID] }),
        }));
        mockChildFind(t, {
            onClassrooms: () => [],
            onIds: () => [{ _id: CHILD_A, name: "Alice" }],
        });

        t.mock.method(Child, "updateMany", () => Promise.resolve({ modifiedCount: 1 }));

        const updateOneCalls = [];
        t.mock.method(Classroom, "updateOne", (...args) => {
            updateOneCalls.push(args);
            return Promise.resolve({ modifiedCount: 1 });
        });

        const { summaries } = await materializeAndSyncClassroomChildren(classroom);

        assert.equal(summaries.length, 1);
        assert.equal(summaries[0].name, "Alice");
        const pullCall = updateOneCalls.find((args) => args[1]?.$pull);
        assert.ok(pullCall);
        assert.equal(String(pullCall[0]._id), String(CLASSROOM_ID));
        assert.equal(pullCall[1].$pull.children.$in.length, 1);
        assert.equal(String(pullCall[1].$pull.children.$in[0]), String(STALE_ID));
    });
});

describe("enrichChildClassroomsFromRosters", () => {
    test("merges roster classrooms onto child and mirrors child.classrooms", async (t) => {
        const childDoc = {
            _id: CHILD_A,
            classrooms: [],
        };

        t.mock.method(Classroom, "find", () => ({
            select() {
                return this;
            },
            lean: () =>
                Promise.resolve([
                    { _id: CLASSROOM_ID, name: "Room 1" },
                ]),
        }));

        let updateOneArgs;
        t.mock.method(Child, "updateOne", (...args) => {
            updateOneArgs = args;
            return Promise.resolve({ modifiedCount: 1 });
        });

        const enriched = await enrichChildClassroomsFromRosters(childDoc);

        assert.equal(enriched.classrooms.length, 1);
        assert.equal(enriched.classrooms[0].name, "Room 1");
        assert.equal(String(updateOneArgs[0]._id), String(CHILD_A));
        assert.equal(String(updateOneArgs[1].$addToSet.classrooms.$each[0]), String(CLASSROOM_ID));
    });

    test("does not use raw ObjectId string as classroom display name", async (t) => {
        const childDoc = {
            _id: CHILD_A,
            classrooms: [CLASSROOM_ID],
        };

        t.mock.method(Classroom, "find", () => ({
            select() {
                return this;
            },
            lean: () =>
                Promise.resolve([{ _id: CLASSROOM_ID, name: "Sunshine Room" }]),
        }));

        t.mock.method(Child, "updateOne", () => Promise.resolve({ modifiedCount: 0 }));

        const enriched = await enrichChildClassroomsFromRosters(childDoc);

        assert.equal(enriched.classrooms[0].name, "Sunshine Room");
        assert.notEqual(enriched.classrooms[0].name, String(CLASSROOM_ID));
    });
});
