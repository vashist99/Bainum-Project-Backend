import { test, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
    listNotifications,
    dismissNotification,
} from "../../controllers/notificationController.js";
import Notification from "../../models/Notification.js";

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

const ME = new mongoose.Types.ObjectId("64b000000000000000000001");
const OTHER = new mongoose.Types.ObjectId("64b000000000000000000002");
const NOTIF_ID = new mongoose.Types.ObjectId("64b0000000000000000000aa");

function mockFindChain(rows) {
    // Mocks .sort().limit().lean() — returns the rows we provide.
    return () => ({
        sort: () => ({
            limit: () => ({
                lean: () => Promise.resolve(rows),
            }),
        }),
    });
}

describe("listNotifications", () => {
    test("401 when req.user is missing", async () => {
        const res = mockRes();
        await listNotifications({}, res);
        assert.equal(res.statusCode, 401);
    });

    test("returns mapped projection sorted by createdAt", async (t) => {
        const rows = [
            {
                _id: NOTIF_ID,
                type: "classroom-added",
                classroomId: new mongoose.Types.ObjectId(),
                classroomName: "Owls",
                message: "...",
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 1000),
            },
        ];
        t.mock.method(Notification, "find", mockFindChain(rows));

        const res = mockRes();
        await listNotifications({ user: { id: ME } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.notifications.length, 1);
        assert.equal(res.body.notifications[0].type, "classroom-added");
        assert.equal(res.body.notifications[0].classroomName, "Owls");
        assert.equal(String(res.body.notifications[0].id), String(NOTIF_ID));
    });

    test("caps query at MAX_LIST_SIZE (50)", async (t) => {
        const limitMock = t.mock.fn(() => ({
            lean: () => Promise.resolve([]),
        }));
        const sortMock = t.mock.fn(() => ({ limit: limitMock }));
        t.mock.method(Notification, "find", () => ({ sort: sortMock }));

        const res = mockRes();
        await listNotifications({ user: { id: ME } }, res);
        assert.equal(limitMock.mock.callCount(), 1);
        assert.equal(limitMock.mock.calls[0].arguments[0], 50);
    });
});

describe("dismissNotification", () => {
    test("401 when req.user is missing", async () => {
        const res = mockRes();
        await dismissNotification({ params: { id: String(NOTIF_ID) } }, res);
        assert.equal(res.statusCode, 401);
    });

    test("400 on invalid id", async () => {
        const res = mockRes();
        await dismissNotification(
            { user: { id: ME }, params: { id: "bad" } },
            res
        );
        assert.equal(res.statusCode, 400);
    });

    test("404 when notification not found", async (t) => {
        t.mock.method(Notification, "findById", () => Promise.resolve(null));
        const res = mockRes();
        await dismissNotification(
            { user: { id: ME }, params: { id: String(NOTIF_ID) } },
            res
        );
        assert.equal(res.statusCode, 404);
    });

    test("403 when notification belongs to another user", async (t) => {
        t.mock.method(Notification, "findById", () =>
            Promise.resolve({ _id: NOTIF_ID, recipientId: OTHER })
        );
        const deleteOneMock = t.mock.method(Notification, "deleteOne", () =>
            Promise.resolve({ deletedCount: 1 })
        );
        const res = mockRes();
        await dismissNotification(
            { user: { id: ME }, params: { id: String(NOTIF_ID) } },
            res
        );
        assert.equal(res.statusCode, 403);
        assert.equal(deleteOneMock.mock.callCount(), 0);
    });

    test("200 + deleteOne when caller owns the notification", async (t) => {
        t.mock.method(Notification, "findById", () =>
            Promise.resolve({ _id: NOTIF_ID, recipientId: ME })
        );
        const deleteOneMock = t.mock.method(Notification, "deleteOne", () =>
            Promise.resolve({ deletedCount: 1 })
        );
        const res = mockRes();
        await dismissNotification(
            { user: { id: ME }, params: { id: String(NOTIF_ID) } },
            res
        );
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assert.equal(deleteOneMock.mock.callCount(), 1);
    });
});
