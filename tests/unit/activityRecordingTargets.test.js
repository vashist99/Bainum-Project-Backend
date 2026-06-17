import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
    resolveActivityRecordingTargets,
    resolveParentAcceptTarget,
} from "../../lib/activityRecordingTargets.js";
import { Parent, Child } from "../../models/User.js";

const PARENT_ID = new mongoose.Types.ObjectId();
const CHILD_A = new mongoose.Types.ObjectId();
const CHILD_B = new mongoose.Types.ObjectId();

const parentDoc = {
    _id: PARENT_ID,
    childIds: [CHILD_A, CHILD_B],
};

function queryReturning(value) {
    const promise = Promise.resolve(value);
    const chain = {
        select() {
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

let parentFindByIdMock;
let childFindByIdMock;
let childFindMock;

beforeEach(() => {
    parentFindByIdMock = mock.method(Parent, "findById", async () => parentDoc);
    childFindByIdMock = mock.method(Child, "findById", async (id) => {
        if (String(id) === String(CHILD_A)) return { _id: CHILD_A, name: "Alex" };
        return null;
    });
    childFindMock = mock.method(Child, "find", (query) => {
        if (query?.parents) {
            return queryReturning([]);
        }
        return queryReturning([{ _id: CHILD_A, name: "Alex" }]);
    });
});

afterEach(() => {
    parentFindByIdMock.mock.restore();
    childFindByIdMock.mock.restore();
    childFindMock.mock.restore();
});

describe("resolveActivityRecordingTargets — parent", () => {
    test("requires childId", async () => {
        const result = await resolveActivityRecordingTargets(
            { role: "parent", id: String(PARENT_ID) },
            ""
        );
        assert.equal(result.error?.status, 400);
        assert.match(result.error.message, /select a child/i);
    });

    test("rejects foreign childId", async () => {
        const foreign = new mongoose.Types.ObjectId();
        const result = await resolveActivityRecordingTargets(
            { role: "parent", id: String(PARENT_ID) },
            String(foreign)
        );
        assert.equal(result.error?.status, 403);
    });

    test("returns one child when childId is linked", async () => {
        const result = await resolveActivityRecordingTargets(
            { role: "parent", id: String(PARENT_ID) },
            String(CHILD_A)
        );
        assert.equal(result.context, "home");
        assert.equal(result.children.length, 1);
        assert.equal(String(result.children[0]._id), String(CHILD_A));
    });
});

describe("resolveParentAcceptTarget", () => {
    test("requires childId on accept", async () => {
        const result = await resolveParentAcceptTarget(parentDoc, "");
        assert.equal(result.error?.status, 400);
    });

    test("returns one child for valid childId", async () => {
        const result = await resolveParentAcceptTarget(parentDoc, String(CHILD_A));
        assert.equal(result.children.length, 1);
        assert.equal(String(result.children[0]._id), String(CHILD_A));
    });
});
