import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import HomeViewGrant from "../../models/HomeViewGrant.js";
import Notification from "../../models/Notification.js";
import { Parent, Teacher, Child } from "../../models/User.js";
import {
    staffHasHomeTranscriptAccess,
    stripHomeTranscriptFields,
} from "../../lib/talkDataAccess.js";
import { roleHasCapability } from "../../lib/permissions.js";
import {
    grantHomeAccess,
    setHomeTranscriptAccess,
} from "../../controllers/homeAccessController.js";

const CHILD_ID = "64b0000000000000000000c1";
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

describe("HomeViewGrant — transcript tier fields", () => {
    test("transcriptAccess defaults to false with no decision recorded", () => {
        const grant = new HomeViewGrant({
            childId: CHILD_ID,
            scope: "all-staff",
            initiatedBy: "parent",
            status: "active",
        });
        assert.equal(grant.transcriptAccess, false);
        assert.equal(grant.transcriptDecidedBy, null);
        assert.equal(grant.transcriptDecidedAt, null);
    });
});

describe("grantHomeTranscriptAccess capability", () => {
    test("admins only", () => {
        assert.equal(roleHasCapability("admin", "grantHomeTranscriptAccess"), true);
        assert.equal(roleHasCapability("teacher", "grantHomeTranscriptAccess"), false);
        assert.equal(roleHasCapability("parent", "grantHomeTranscriptAccess"), false);
        assert.equal(roleHasCapability("coach", "grantHomeTranscriptAccess"), false);
    });
});

describe("staffHasHomeTranscriptAccess", () => {
    const teacher = { id: TEACHER_ID, role: "teacher" };

    test("query requires an ACTIVE covering grant WITH transcriptAccess", async (t) => {
        let captured = null;
        t.mock.method(HomeViewGrant, "exists", async (query) => {
            captured = query;
            return { _id: new mongoose.Types.ObjectId() };
        });
        assert.equal(await staffHasHomeTranscriptAccess(teacher, CHILD_ID), true);
        assert.equal(captured.status, "active");
        assert.equal(captured.transcriptAccess, true);
        assert.deepEqual(captured.$or, [
            { scope: "all-staff" },
            { scope: "user", granteeId: TEACHER_ID },
        ]);
    });

    test("false when no flagged grant exists (aggregate tier only)", async (t) => {
        t.mock.method(HomeViewGrant, "exists", async () => null);
        assert.equal(await staffHasHomeTranscriptAccess(teacher, CHILD_ID), false);
    });

    test("false for parents and malformed callers without querying", async (t) => {
        const exists = t.mock.method(HomeViewGrant, "exists", async () => {
            throw new Error("should not query");
        });
        assert.equal(
            await staffHasHomeTranscriptAccess({ id: PARENT_ID, role: "parent" }, CHILD_ID),
            false
        );
        assert.equal(await staffHasHomeTranscriptAccess(null, CHILD_ID), false);
        assert.equal(await staffHasHomeTranscriptAccess(teacher, null), false);
        assert.equal(exists.mock.callCount(), 0);
    });
});

describe("stripHomeTranscriptFields — aggregate-tier projection", () => {
    const fullRow = {
        _id: "a1",
        childId: CHILD_ID,
        date: "2026-07-01",
        activity: "Mealtime",
        activityContext: "home",
        transcript: "we talked about dinosaurs",
        ragSegments: [{ text: "dinosaurs", category: "science" }],
        audioFileName: "rec-123.webm",
        keywordCounts: { science: 3, social: 1, literature: 0, language: 2 },
        categoryWordCount: { science: 12, social: 4, literature: 0, language: 9 },
        categoryWPM: { science: 6, social: 2, literature: 0, language: 4.5 },
        wordCount: 200,
        durationSeconds: 120,
        wordsPerMinute: 100,
    };

    test("removes transcript, ragSegments, and audioFileName only", () => {
        const stripped = stripHomeTranscriptFields({ ...fullRow });
        assert.equal(stripped.transcript, undefined);
        assert.equal(stripped.ragSegments, undefined);
        assert.equal(stripped.audioFileName, undefined);
        assert.deepEqual(stripped.keywordCounts, fullRow.keywordCounts);
        assert.deepEqual(stripped.categoryWordCount, fullRow.categoryWordCount);
        assert.deepEqual(stripped.categoryWPM, fullRow.categoryWPM);
        assert.equal(stripped.wordsPerMinute, 100);
        assert.equal(stripped.activity, "Mealtime");
        assert.equal(stripped.date, "2026-07-01");
    });

    test("unwraps mongoose documents via toObject", () => {
        const doc = { toObject: () => ({ ...fullRow }) };
        const stripped = stripHomeTranscriptFields(doc);
        assert.equal(stripped.transcript, undefined);
        assert.equal(stripped.wordCount, 200);
    });

    test("does not mutate the input object", () => {
        const input = { ...fullRow };
        stripHomeTranscriptFields(input);
        assert.equal(input.transcript, "we talked about dinosaurs");
    });

    test("passes through null/undefined", () => {
        assert.equal(stripHomeTranscriptFields(null), null);
        assert.equal(stripHomeTranscriptFields(undefined), undefined);
    });
});

describe("setHomeTranscriptAccess — admin toggle", () => {
    const grantId = String(new mongoose.Types.ObjectId());
    const adminReq = (transcriptAccess, body = {}) => ({
        params: { childId: CHILD_ID },
        body: { grantId, transcriptAccess, ...body },
        user: { id: ADMIN_ID, role: "admin", name: "Ada Admin" },
    });

    function mockChildWithParents(t) {
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
        t.mock.method(Teacher, "findById", () => selectLeanQuery({ name: "Tia Teacher" }));
    }

    function activeUserGrant() {
        return {
            _id: new mongoose.Types.ObjectId(grantId),
            scope: "user",
            granteeId: new mongoose.Types.ObjectId(TEACHER_ID),
            granteeRole: "teacher",
            status: "active",
            transcriptAccess: false,
            transcriptDecidedBy: null,
            transcriptDecidedAt: null,
            saved: false,
            async save() {
                this.saved = true;
            },
        };
    }

    test("enables the tier on an active grant and notifies parent + grantee", async (t) => {
        const grant = activeUserGrant();
        t.mock.method(HomeViewGrant, "findOne", async () => grant);
        mockChildWithParents(t);
        const notifications = [];
        t.mock.method(Notification, "create", async (doc) => {
            notifications.push(doc);
            return doc;
        });

        const res = mockRes();
        await setHomeTranscriptAccess(adminReq(true), res);

        assert.equal(res.statusCode, 200);
        assert.equal(grant.transcriptAccess, true);
        assert.equal(String(grant.transcriptDecidedBy), ADMIN_ID);
        assert.ok(grant.transcriptDecidedAt instanceof Date);
        assert.equal(grant.saved, true);

        assert.equal(notifications.length, 2);
        const parentNote = notifications.find((n) => n.recipientRole === "parent");
        const granteeNote = notifications.find((n) => n.recipientRole === "teacher");
        assert.equal(parentNote.type, "home-transcript-access-changed");
        assert.match(parentNote.message, /enabled home talk transcript access for Tia Teacher/);
        assert.equal(String(granteeNote.recipientId), TEACHER_ID);
        assert.match(granteeNote.message, /You now have transcript access/);
    });

    test("disabling the tier notifies with removal wording", async (t) => {
        const grant = activeUserGrant();
        grant.transcriptAccess = true;
        t.mock.method(HomeViewGrant, "findOne", async () => grant);
        mockChildWithParents(t);
        const notifications = [];
        t.mock.method(Notification, "create", async (doc) => {
            notifications.push(doc);
            return doc;
        });

        const res = mockRes();
        await setHomeTranscriptAccess(adminReq(false), res);

        assert.equal(res.statusCode, 200);
        assert.equal(grant.transcriptAccess, false);
        assert.match(
            notifications.find((n) => n.recipientRole === "parent").message,
            /removed home talk transcript access/
        );
    });

    test("rejected on non-active grants", async (t) => {
        const grant = activeUserGrant();
        grant.status = "revoked";
        t.mock.method(HomeViewGrant, "findOne", async () => grant);
        const res = mockRes();
        await setHomeTranscriptAccess(adminReq(true), res);
        assert.equal(res.statusCode, 400);
        assert.equal(grant.saved, false);
    });

    test("404 when the grant does not exist for the child", async (t) => {
        t.mock.method(HomeViewGrant, "findOne", async () => null);
        const res = mockRes();
        await setHomeTranscriptAccess(adminReq(true), res);
        assert.equal(res.statusCode, 404);
    });

    test("transcriptAccess must be a boolean", async () => {
        const res = mockRes();
        await setHomeTranscriptAccess(adminReq("yes"), res);
        assert.equal(res.statusCode, 400);
    });

    test("toggle survives a notification failure", async (t) => {
        const grant = activeUserGrant();
        t.mock.method(HomeViewGrant, "findOne", async () => grant);
        mockChildWithParents(t);
        t.mock.method(Notification, "create", async () => {
            throw new Error("db hiccup");
        });
        const res = mockRes();
        await setHomeTranscriptAccess(adminReq(true), res);
        assert.equal(res.statusCode, 200);
        assert.equal(grant.transcriptAccess, true);
    });
});

describe("re-grant resets the transcript tier", () => {
    function mockVerifiedParent(t) {
        t.mock.method(Parent, "findById", async () => ({
            _id: new mongoose.Types.ObjectId(PARENT_ID),
            invitationAccepted: true,
            childIds: [new mongoose.Types.ObjectId(CHILD_ID)],
        }));
        t.mock.method(Child, "find", () => selectLeanQuery([]));
    }

    test("approving a revoked grant by grantId clears transcriptAccess", async (t) => {
        mockVerifiedParent(t);
        const doc = {
            _id: new mongoose.Types.ObjectId(),
            status: "revoked",
            transcriptAccess: true,
            transcriptDecidedBy: new mongoose.Types.ObjectId(ADMIN_ID),
            transcriptDecidedAt: new Date(),
            async save() {},
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
        assert.equal(doc.transcriptAccess, false);
        assert.equal(doc.transcriptDecidedBy, null);
        assert.equal(doc.transcriptDecidedAt, null);
    });

    test("re-granting all-staff after revoke resets the tier in the upsert", async (t) => {
        mockVerifiedParent(t);
        t.mock.method(HomeViewGrant, "findOne", () =>
            selectLeanQuery({ status: "revoked" })
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
                body: { scope: "all-staff" },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(captured.update.$set.status, "active");
        assert.equal(captured.update.$set.transcriptAccess, false);
        assert.equal(captured.update.$set.transcriptDecidedBy, null);
    });

    test("idempotent re-grant of an ACTIVE grant preserves the admin decision", async (t) => {
        mockVerifiedParent(t);
        t.mock.method(HomeViewGrant, "findOne", () =>
            selectLeanQuery({ status: "active" })
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
                body: { scope: "all-staff" },
                user: { id: PARENT_ID, role: "parent" },
            },
            res
        );

        assert.equal(res.statusCode, 200);
        assert.equal(captured.update.$set.transcriptAccess, undefined);
    });
});
