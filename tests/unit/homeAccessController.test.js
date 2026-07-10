import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import HomeViewGrant from "../../models/HomeViewGrant.js";
import Notification from "../../models/Notification.js";
import Classroom from "../../models/Classroom.js";
import { Parent, Child } from "../../models/User.js";
import {
    getHomeAccessState,
    grantHomeAccess,
    revokeHomeAccess,
    requestHomeAccess,
} from "../../controllers/homeAccessController.js";

const CHILD_ID = "64b0000000000000000000c1";
const CLASSROOM_ID = "64b0000000000000000000aa";
const TEACHER_ID = "64b000000000000000000002";
const ADMIN_ID = "64b000000000000000000009";
const PARENT_ID = "64b000000000000000000001";

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

function leanQuery(result) {
    return { lean: async () => result };
}

function selectLeanQuery(result) {
    return { select: () => leanQuery(result) };
}

/** Parent doc that passes parentMayAccessChild for CHILD_ID. */
function mockVerifiedParent(t) {
    t.mock.method(Parent, "findById", async () => ({
        _id: new mongoose.Types.ObjectId(PARENT_ID),
        invitationAccepted: true,
        childIds: [new mongoose.Types.ObjectId(CHILD_ID)],
    }));
    // getResolvedChildIdStringsForParent's back-link lookup
    t.mock.method(Child, "find", () => selectLeanQuery([]));
}

describe("homeAccessController — getHomeAccessState (staff)", () => {
    const teacherReq = { params: { childId: CHILD_ID }, user: { id: TEACHER_ID, role: "teacher" } };

    test("granted via active all-staff grant", async (t) => {
        t.mock.method(HomeViewGrant, "find", () =>
            leanQuery([{ scope: "all-staff", status: "active" }])
        );
        const res = mockRes();
        await getHomeAccessState(teacherReq, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { status: "granted" });
    });

    test("granted via own active user grant", async (t) => {
        t.mock.method(HomeViewGrant, "find", () =>
            leanQuery([{ scope: "user", granteeId: TEACHER_ID, status: "active" }])
        );
        const res = mockRes();
        await getHomeAccessState(teacherReq, res);
        assert.deepEqual(res.body, { status: "granted" });
    });

    test("pending own request reports pending", async (t) => {
        t.mock.method(HomeViewGrant, "find", () =>
            leanQuery([{ scope: "user", granteeId: TEACHER_ID, status: "pending" }])
        );
        const res = mockRes();
        await getHomeAccessState(teacherReq, res);
        assert.deepEqual(res.body, { status: "pending" });
    });

    test("revoked or absent grants report none", async (t) => {
        t.mock.method(HomeViewGrant, "find", () =>
            leanQuery([
                { scope: "all-staff", status: "revoked" },
                { scope: "user", granteeId: TEACHER_ID, status: "revoked" },
            ])
        );
        const res = mockRes();
        await getHomeAccessState(teacherReq, res);
        assert.deepEqual(res.body, { status: "none" });
    });

    test("invalid child id is rejected", async () => {
        const res = mockRes();
        await getHomeAccessState(
            { params: { childId: "nope" }, user: { id: TEACHER_ID, role: "teacher" } },
            res
        );
        assert.equal(res.statusCode, 400);
    });
});

describe("homeAccessController — grantHomeAccess", () => {
    test("non-parent callers get 403", async (t) => {
        t.mock.method(Parent, "findById", async () => null);
        const res = mockRes();
        await grantHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { scope: "all-staff" },
                user: { id: TEACHER_ID, role: "teacher" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("parent not linked to the child gets 403", async (t) => {
        t.mock.method(Parent, "findById", async () => ({
            _id: new mongoose.Types.ObjectId(PARENT_ID),
            invitationAccepted: true,
            childIds: [], // no link to CHILD_ID
        }));
        t.mock.method(Child, "find", () => selectLeanQuery([]));
        const res = mockRes();
        await grantHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { scope: "all-staff" },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("all-staff grant upserts to active", async (t) => {
        mockVerifiedParent(t);
        let captured = null;
        t.mock.method(HomeViewGrant, "findOneAndUpdate", async (query, update) => {
            captured = { query, update };
            return { ...query, ...update.$set };
        });
        const res = mockRes();
        await grantHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { scope: "all-staff" },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.equal(captured.query.scope, "all-staff");
        assert.equal(captured.update.$set.status, "active");
        assert.equal(captured.update.$set.initiatedBy, "parent");
    });

    test("per-classroom grant resolves the current lead teacher", async (t) => {
        mockVerifiedParent(t);
        t.mock.method(Child, "findById", () =>
            selectLeanQuery({ classrooms: [new mongoose.Types.ObjectId(CLASSROOM_ID)] })
        );
        t.mock.method(Classroom, "findById", () =>
            selectLeanQuery({
                _id: new mongoose.Types.ObjectId(CLASSROOM_ID),
                teacher: new mongoose.Types.ObjectId(TEACHER_ID),
            })
        );
        let captured = null;
        t.mock.method(HomeViewGrant, "findOneAndUpdate", async (query, update) => {
            captured = { query, update };
            return { ...query, ...update.$set };
        });
        const res = mockRes();
        await grantHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { classroomId: CLASSROOM_ID },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.equal(captured.query.scope, "user");
        assert.equal(String(captured.query.granteeId), TEACHER_ID);
        assert.equal(captured.update.$set.status, "active");
        assert.equal(captured.update.$set.granteeRole, "teacher");
        assert.equal(String(captured.update.$set.classroomId), CLASSROOM_ID);
    });

    test("classroom not linked to the child is rejected", async (t) => {
        mockVerifiedParent(t);
        t.mock.method(Child, "findById", () => selectLeanQuery({ classrooms: [] }));
        const res = mockRes();
        await grantHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { classroomId: CLASSROOM_ID },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /not one of the child's classrooms/i);
    });

    test("approving a pending request by grantId activates it", async (t) => {
        mockVerifiedParent(t);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            status: "pending",
            saved: false,
            async save() {
                this.saved = true;
            },
        };
        t.mock.method(HomeViewGrant, "findOne", async () => doc);
        const res = mockRes();
        await grantHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { grantId: String(doc._id) },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.equal(doc.status, "active");
        assert.equal(doc.saved, true);
    });
});

describe("homeAccessController — revokeHomeAccess", () => {
    test("revoking sets status to revoked", async (t) => {
        mockVerifiedParent(t);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            status: "active",
            async save() {},
        };
        t.mock.method(HomeViewGrant, "findOne", async () => doc);
        const res = mockRes();
        await revokeHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { grantId: String(doc._id) },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.equal(doc.status, "revoked");
    });

    test("missing target grant returns 404", async (t) => {
        mockVerifiedParent(t);
        t.mock.method(HomeViewGrant, "findOne", async () => null);
        const res = mockRes();
        await revokeHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { scope: "all-staff" },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );
        assert.equal(res.statusCode, 404);
    });

    test("non-parent cannot revoke", async (t) => {
        t.mock.method(Parent, "findById", async () => null);
        const res = mockRes();
        await revokeHomeAccess(
            {
                params: { childId: CHILD_ID },
                body: { scope: "all-staff" },
                user: { id: ADMIN_ID, role: "admin" },
            },
            res
        );
        assert.equal(res.statusCode, 403);
    });
});

describe("homeAccessController — requestHomeAccess", () => {
    const adminReq = () => ({
        params: { childId: CHILD_ID },
        user: { id: ADMIN_ID, role: "admin", name: "Ada Admin" },
    });

    function mockChildWithParents(t) {
        // findParentsLinkedToChild: Child.findById().select().lean() + Parent.find().select().lean()
        t.mock.method(Child, "findById", () =>
            selectLeanQuery({
                _id: new mongoose.Types.ObjectId(CHILD_ID),
                name: "Casey",
                parents: [new mongoose.Types.ObjectId(PARENT_ID)],
            })
        );
        t.mock.method(Parent, "find", () =>
            selectLeanQuery([{ _id: new mongoose.Types.ObjectId(PARENT_ID) }])
        );
    }

    test("parents cannot request", async () => {
        const res = mockRes();
        await requestHomeAccess(
            { params: { childId: CHILD_ID }, user: { id: PARENT_ID, role: "parent" } },
            res
        );
        assert.equal(res.statusCode, 403);
    });

    test("new admin request creates a pending grant and notifies each parent once", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () => leanQuery(null));
        let capturedUpsert = null;
        t.mock.method(HomeViewGrant, "findOneAndUpdate", async (query, update) => {
            capturedUpsert = { query, update };
            return { ...query, ...update.$set };
        });
        mockChildWithParents(t);
        const notifications = [];
        t.mock.method(Notification, "create", async (doc) => {
            notifications.push(doc);
            return doc;
        });

        const res = mockRes();
        await requestHomeAccess(adminReq(), res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.status, "pending");
        assert.equal(capturedUpsert.query.scope, "user");
        assert.equal(capturedUpsert.query.granteeId, ADMIN_ID);
        assert.equal(capturedUpsert.update.$set.status, "pending");
        assert.equal(capturedUpsert.update.$set.granteeRole, "admin");
        assert.equal(capturedUpsert.update.$set.initiatedBy, "staff");

        assert.equal(notifications.length, 1);
        assert.equal(notifications[0].type, "home-access-requested");
        assert.equal(String(notifications[0].recipientId), PARENT_ID);
        assert.equal(notifications[0].childName, "Casey");
        assert.match(notifications[0].message, /Ada Admin \(admin\) requested access to Casey's home talk data/);
    });

    test("repeat request is idempotent: no new grant, no new notification", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () =>
            leanQuery({ scope: "user", granteeId: ADMIN_ID, status: "pending" })
        );
        const upsert = t.mock.method(HomeViewGrant, "findOneAndUpdate", async () => {
            throw new Error("should not upsert");
        });
        const create = t.mock.method(Notification, "create", async () => {
            throw new Error("should not notify");
        });

        const res = mockRes();
        await requestHomeAccess(adminReq(), res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, "pending");
        assert.equal(upsert.mock.callCount(), 0);
        assert.equal(create.mock.callCount(), 0);
    });

    test("active all-staff grant reports granted without a new request", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () =>
            leanQuery({ scope: "all-staff", status: "active" })
        );
        const res = mockRes();
        await requestHomeAccess(adminReq(), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, "granted");
    });

    test("request succeeds even when the notification write throws", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", () => leanQuery(null));
        t.mock.method(HomeViewGrant, "findOneAndUpdate", async (query, update) => ({
            ...query,
            ...update.$set,
        }));
        mockChildWithParents(t);
        t.mock.method(Notification, "create", async () => {
            throw new Error("db hiccup");
        });

        const res = mockRes();
        await requestHomeAccess(adminReq(), res);

        assert.equal(res.statusCode, 201);
        assert.equal(res.body.status, "pending");
    });
});
