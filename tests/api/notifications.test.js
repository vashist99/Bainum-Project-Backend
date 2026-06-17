import { test, expect } from "@playwright/test";

const API_BASE =
    process.env.API_URL || "https://bainum-project-backend.onrender.com/api";

async function login(request, email, password) {
    const response = await request.post(`${API_BASE}/auth/login`, {
        data: { email, password },
    });
    if (response.status() !== 200) return null;
    const body = await response.json();
    return body.user || null;
}

test.describe("Notifications API Endpoints", () => {
    let adminToken = null;
    let parentToken = null;

    test.beforeAll(async ({ request }) => {
        adminToken = await login(
            request,
            process.env.TEST_ADMIN_EMAIL || "admin@example.com",
            process.env.TEST_ADMIN_PASSWORD || "password123"
        );
        parentToken = await login(
            request,
            process.env.TEST_PARENT_EMAIL || "parent@example.com",
            process.env.TEST_PARENT_PASSWORD || "password123"
        );
    });

    test("GET /api/notifications - requires authentication", async ({ request }) => {
        const response = await request.get(`${API_BASE}/notifications`);
        expect([401, 404]).toContain(response.status());
    });

    test("GET /api/notifications - returns array for authenticated user", async ({
        request,
    }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.get(`${API_BASE}/notifications`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(Array.isArray(body.notifications)).toBe(true);
        if (body.notifications.length > 0) {
            const row = body.notifications[0];
            expect(row).toHaveProperty("id");
            expect(row).toHaveProperty("type");
            expect(row).toHaveProperty("message");
            expect(row).toHaveProperty("createdAt");
            expect(row).toHaveProperty("expiresAt");
        }
    });

    test("GET /api/notifications - list capped at 50 rows", async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.get(`${API_BASE}/notifications`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.notifications.length).toBeLessThanOrEqual(50);
    });

    test("DELETE /api/notifications/:id - requires authentication", async ({
        request,
    }) => {
        const response = await request.delete(
            `${API_BASE}/notifications/64b0000000000000000000aa`
        );
        expect([401, 404]).toContain(response.status());
    });

    test("DELETE /api/notifications/:id - 404 on unknown id", async ({
        request,
    }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.delete(
            `${API_BASE}/notifications/64b0000000000000000000ff`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(response.status()).toBe(404);
    });

    test("DELETE /api/notifications/:id - 400 on invalid id", async ({
        request,
    }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.delete(`${API_BASE}/notifications/not-an-id`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect(response.status()).toBe(400);
    });

    test("DELETE /api/notifications/:id - cross-user dismiss is 403", async ({
        request,
    }) => {
        if (!adminToken || !parentToken) {
            test.skip();
            return;
        }
        const listRes = await request.get(`${API_BASE}/notifications`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (listRes.status() !== 200) {
            test.skip();
            return;
        }
        const adminRows = (await listRes.json()).notifications || [];
        if (adminRows.length === 0) {
            test.skip();
            return;
        }
        const targetId = adminRows[0].id;
        const response = await request.delete(
            `${API_BASE}/notifications/${targetId}`,
            { headers: { Authorization: `Bearer ${parentToken}` } }
        );
        expect(response.status()).toBe(403);
    });

    test("DELETE /api/notifications/:id - owner can dismiss", async ({
        request,
    }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const listRes = await request.get(`${API_BASE}/notifications`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (listRes.status() !== 200) {
            test.skip();
            return;
        }
        const rows = (await listRes.json()).notifications || [];
        if (rows.length === 0) {
            test.skip();
            return;
        }
        const targetId = rows[0].id;
        const response = await request.delete(
            `${API_BASE}/notifications/${targetId}`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.ok).toBe(true);
        expect(body.dismissedId).toBe(String(targetId));
    });
});
