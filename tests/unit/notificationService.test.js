import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import Notification from "../../models/Notification.js";
import {
    NOTIFICATION_TTL_MS,
    createClassroomAddedNotification,
    createClassroomRemovedNotification,
    createChildNoteAddedNotification,
    createClassroomNoteAddedNotification,
    createClassroomRecordingAddedNotification,
    fanOutClassroomAddedNotifications,
    fanOutClassroomRemovedNotification,
    fanOutChildNoteAddedNotifications,
    fanOutClassroomNoteAddedNotifications,
    fanOutClassroomRecordingAddedNotifications,
} from "../../lib/notificationService.js";

// In-process inserts intercepted via t.mock — these tests do NOT hit a
// real MongoDB. They cover the pure parts of the service: payload
// shape, TTL window, classroomName snapshotting, idempotency dedupe,
// graceful failure on Notification.create rejection.

const CLASSROOM = {
    _id: new mongoose.Types.ObjectId("64b0000000000000000000aa"),
    name: "Pre-K Owls",
};

const PARENT_ID = new mongoose.Types.ObjectId("64b000000000000000000001");
const TEACHER_ID = new mongoose.Types.ObjectId("64b000000000000000000002");
const CHILD_ID = new mongoose.Types.ObjectId("64b0000000000000000000c1");

describe("notificationService — TTL & payload shape", () => {
    test("expiresAt equals createdAt + 10 days", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const before = Date.now();
        await createClassroomAddedNotification({
            recipientId: PARENT_ID,
            recipientRole: "parent",
            classroom: CLASSROOM,
        });
        const after = Date.now();

        assert.equal(captured.length, 1);
        const { expiresAt } = captured[0];
        const ms = expiresAt.getTime();
        assert.ok(ms >= before + NOTIFICATION_TTL_MS);
        assert.ok(ms <= after + NOTIFICATION_TTL_MS);
        assert.equal(NOTIFICATION_TTL_MS, 10 * 24 * 60 * 60 * 1000);
    });

    test("classroomName is snapshotted from the input", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        await createClassroomAddedNotification({
            recipientId: PARENT_ID,
            recipientRole: "parent",
            classroom: { _id: CLASSROOM._id, name: "Original Name" },
        });

        assert.equal(captured[0].classroomName, "Original Name");
        assert.equal(
            captured[0].message,
            'You have been added to a classroom: "Original Name"'
        );
    });

    test("added vs removed produce the right type and message", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        await createClassroomAddedNotification({
            recipientId: PARENT_ID,
            recipientRole: "parent",
            classroom: CLASSROOM,
        });
        await createClassroomRemovedNotification({
            recipientId: PARENT_ID,
            recipientRole: "parent",
            classroom: CLASSROOM,
        });

        assert.equal(captured.length, 2);
        assert.equal(captured[0].type, "classroom-added");
        assert.equal(
            captured[0].message,
            'You have been added to a classroom: "Pre-K Owls"'
        );
        assert.equal(captured[1].type, "classroom-removed");
        assert.equal(
            captured[1].message,
            'You have been removed from classroom: "Pre-K Owls"'
        );
    });

    test("create returns null on Notification.create failure (no throw)", async (t) => {
        t.mock.method(Notification, "create", async () => {
            throw new Error("db down");
        });

        const result = await createClassroomAddedNotification({
            recipientId: PARENT_ID,
            recipientRole: "parent",
            classroom: CLASSROOM,
        });
        assert.equal(result, null);
    });

    test("missing required inputs short-circuit to null without inserting", async (t) => {
        const created = t.mock.method(Notification, "create", async () => {
            throw new Error("should not be called");
        });

        assert.equal(
            await createClassroomAddedNotification({
                recipientId: null,
                recipientRole: "parent",
                classroom: CLASSROOM,
            }),
            null
        );
        assert.equal(
            await createClassroomAddedNotification({
                recipientId: PARENT_ID,
                recipientRole: null,
                classroom: CLASSROOM,
            }),
            null
        );
        assert.equal(
            await createClassroomAddedNotification({
                recipientId: PARENT_ID,
                recipientRole: "parent",
                classroom: null,
            }),
            null
        );
        assert.equal(created.mock.callCount(), 0);
    });
});

describe("notificationService — note-added notifications", () => {
    test("child note payload shape", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        await createChildNoteAddedNotification({
            recipientId: PARENT_ID,
            child: { _id: CHILD_ID, name: "Mia" },
        });

        assert.equal(captured.length, 1);
        assert.equal(captured[0].type, "child-note-added");
        assert.equal(captured[0].childName, "Mia");
        assert.equal(captured[0].message, "New note on Mia's page");
        assert.equal(captured[0].recipientRole, "parent");
    });

    test("classroom note payload shape", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        await createClassroomNoteAddedNotification({
            recipientId: PARENT_ID,
            classroom: CLASSROOM,
        });

        assert.equal(captured.length, 1);
        assert.equal(captured[0].type, "classroom-note-added");
        assert.equal(captured[0].classroomName, "Pre-K Owls");
        assert.equal(
            captured[0].message,
            'New note in classroom: "Pre-K Owls"'
        );
    });

    test("fanOutChildNoteAddedNotifications fans out to each parent", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const out = await fanOutChildNoteAddedNotifications({
            child: { _id: CHILD_ID, name: "Mia" },
            parentIds: [PARENT_ID, TEACHER_ID],
        });

        assert.equal(out.length, 2);
        assert.equal(captured.length, 2);
    });

    test("fanOutClassroomNoteAddedNotifications fans out to classroom parents", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const out = await fanOutClassroomNoteAddedNotifications({
            classroom: CLASSROOM,
            parentIds: [PARENT_ID],
        });

        assert.equal(out.length, 1);
        assert.equal(captured[0].type, "classroom-note-added");
    });
});

describe("notificationService — classroom-recording-added notifications", () => {
    test("recording payload shape", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        await createClassroomRecordingAddedNotification({
            recipientId: PARENT_ID,
            classroom: CLASSROOM,
        });

        assert.equal(captured.length, 1);
        assert.equal(captured[0].type, "classroom-recording-added");
        assert.equal(captured[0].classroomName, "Pre-K Owls");
        assert.equal(
            captured[0].message,
            'New recording in classroom: "Pre-K Owls"'
        );
        assert.equal(captured[0].recipientRole, "parent");
    });

    test("create returns null on Notification.create failure (no throw)", async (t) => {
        t.mock.method(Notification, "create", async () => {
            throw new Error("db down");
        });

        const result = await createClassroomRecordingAddedNotification({
            recipientId: PARENT_ID,
            classroom: CLASSROOM,
        });
        assert.equal(result, null);
    });

    test("fanOutClassroomRecordingAddedNotifications fans out to each parent", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const out = await fanOutClassroomRecordingAddedNotifications({
            classroom: CLASSROOM,
            parentIds: [PARENT_ID, TEACHER_ID],
        });

        assert.equal(out.length, 2);
        assert.equal(captured.length, 2);
        assert.equal(captured[0].type, "classroom-recording-added");
    });
});

describe("notificationService — fanOutClassroomAddedNotifications idempotency", () => {
    test("skips recipients that already have a row for this classroom", async (t) => {
        const captured = [];
        t.mock.method(Notification, "exists", async (filter) => {
            if (String(filter.recipientId) === String(TEACHER_ID)) {
                // Pre-existing notification for the teacher — should be
                // de-duped.
                return { _id: new mongoose.Types.ObjectId() };
            }
            return null;
        });
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const out = await fanOutClassroomAddedNotifications({
            classroom: CLASSROOM,
            recipients: [
                { id: PARENT_ID, role: "parent" },
                { id: TEACHER_ID, role: "teacher" },
            ],
        });

        assert.equal(out.length, 1);
        assert.equal(captured.length, 1);
        assert.equal(String(captured[0].recipientId), String(PARENT_ID));
        assert.equal(captured[0].recipientRole, "parent");
    });

    test("empty / missing recipients produces no inserts", async (t) => {
        const created = t.mock.method(Notification, "create", async () => {
            throw new Error("should not be called");
        });
        t.mock.method(Notification, "exists", async () => null);

        assert.deepEqual(
            await fanOutClassroomAddedNotifications({
                classroom: CLASSROOM,
                recipients: [],
            }),
            []
        );
        assert.deepEqual(
            await fanOutClassroomAddedNotifications({
                classroom: CLASSROOM,
                recipients: null,
            }),
            []
        );
        assert.deepEqual(
            await fanOutClassroomAddedNotifications({
                classroom: null,
                recipients: [{ id: PARENT_ID, role: "parent" }],
            }),
            []
        );
        assert.equal(created.mock.callCount(), 0);
    });

    test("recipients missing id or role are silently skipped", async (t) => {
        const captured = [];
        t.mock.method(Notification, "exists", async () => null);
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const out = await fanOutClassroomAddedNotifications({
            classroom: CLASSROOM,
            recipients: [
                { id: null, role: "parent" },
                { id: PARENT_ID, role: null },
                { id: PARENT_ID, role: "parent" },
            ],
        });

        assert.equal(out.length, 1);
        assert.equal(captured.length, 1);
    });
});

describe("notificationService — fanOutClassroomRemovedNotification", () => {
    test("emits exactly one removed notification for the parent", async (t) => {
        const captured = [];
        t.mock.method(Notification, "create", async (doc) => {
            captured.push(doc);
            return { ...doc, _id: new mongoose.Types.ObjectId() };
        });

        const result = await fanOutClassroomRemovedNotification({
            classroom: CLASSROOM,
            parentId: PARENT_ID,
        });

        assert.ok(result);
        assert.equal(captured.length, 1);
        assert.equal(captured[0].type, "classroom-removed");
        assert.equal(captured[0].recipientRole, "parent");
        assert.equal(String(captured[0].recipientId), String(PARENT_ID));
    });

    test("no parentId → no insert, returns null", async (t) => {
        const created = t.mock.method(Notification, "create", async () => {
            throw new Error("should not be called");
        });

        assert.equal(
            await fanOutClassroomRemovedNotification({
                classroom: CLASSROOM,
                parentId: null,
            }),
            null
        );
        assert.equal(created.mock.callCount(), 0);
    });
});
