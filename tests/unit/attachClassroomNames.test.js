import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { attachClassroomNames } from "../../lib/attachClassroomNames.js";

describe("attachClassroomNames", () => {
    test("copies the classroom name and leaves classroomId as an id", () => {
        const rows = attachClassroomNames(
            [{ _id: "a1", classroomId: "room-butterflies", transcript: "Hello" }],
            [{ _id: "room-butterflies", name: "Butterflies" }]
        );
        assert.equal(rows[0].classroomId, "room-butterflies");
        assert.equal(rows[0].classroomName, "Butterflies");
    });

    test("labels a missing classroom Deleted classroom", () => {
        const rows = attachClassroomNames(
            [{ _id: "a1", classroomId: "room-gone" }],
            []
        );
        assert.equal(rows[0].classroomId, "room-gone");
        assert.equal(rows[0].classroomName, "Deleted classroom");
    });

    test("leaves classroomName empty when there is no classroom", () => {
        const rows = attachClassroomNames(
            [{ _id: "a1", classroomId: null }, { _id: "a2" }],
            [{ _id: "room-butterflies", name: "Butterflies" }]
        );
        assert.equal(rows[0].classroomName, null);
        assert.equal(rows[1].classroomName, null);
    });
});
