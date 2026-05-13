import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com';
const API = `${API_BASE.replace(/\/$/, '')}/api`;

test.describe('Activity Recording Endpoints – auth + validation', () => {
    test('POST /api/whisper/activity – requires authentication', async ({ request }) => {
        const response = await request.post(`${API}/whisper/activity`, {
            multipart: {
                activity: 'Bath time',
            },
        });

        // authMiddleware should reject (401), or in pathological setups (403). Never a 5xx.
        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/activities/validate – requires authentication', async ({ request }) => {
        const response = await request.post(`${API}/activities/validate`, {
            data: { activity: 'Bath time' },
        });

        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/assessments/activity/accept – requires authentication', async ({ request }) => {
        const response = await request.post(`${API}/assessments/activity/accept`, {
            data: {
                activity: 'Bath time',
                transcript: 'hi',
                date: new Date().toISOString(),
            },
        });

        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/whisper/activity – rejects bogus bearer tokens with 401/403', async ({ request }) => {
        const response = await request.post(`${API}/whisper/activity`, {
            headers: { Authorization: 'Bearer not-a-real-token' },
            multipart: { activity: 'Bath time' },
        });

        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/activities/validate – rejects bogus bearer tokens with 401/403', async ({ request }) => {
        const response = await request.post(`${API}/activities/validate`, {
            headers: { Authorization: 'Bearer not-a-real-token' },
            data: { activity: 'Bath time' },
        });

        expect([401, 403]).toContain(response.status());
    });

    test('POST /api/assessments/activity/accept – rejects bogus bearer tokens with 401/403', async ({ request }) => {
        const response = await request.post(`${API}/assessments/activity/accept`, {
            headers: { Authorization: 'Bearer not-a-real-token' },
            data: { activity: 'Bath time' },
        });

        expect([401, 403]).toContain(response.status());
    });
});

test.describe('Activity Recording Endpoints – with admin auth (best-effort)', () => {
    let adminToken = null;

    test.beforeAll(async ({ request }) => {
        try {
            const testEmail = process.env.TEST_ADMIN_EMAIL;
            const testPassword = process.env.TEST_ADMIN_PASSWORD;
            if (!testEmail || !testPassword) return;

            const loginResponse = await request.post(`${API}/auth/login`, {
                data: { email: testEmail, password: testPassword },
                timeout: 30_000,
            });
            if (loginResponse.status() === 200) {
                const body = await loginResponse.json();
                adminToken = body.user || body.token || null;
            }
        } catch {
            // Cold-start / network – fall through; tests skip below.
        }
    });

    test('POST /api/activities/validate – admin role is rejected (parents/teachers only)', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.post(`${API}/activities/validate`, {
            headers: { Authorization: `Bearer ${adminToken}` },
            data: { activity: 'Bath time' },
        });
        // Admins are intentionally not allowed to validate (only parents/teachers).
        expect([400, 403]).toContain(response.status());
    });

    test('POST /api/assessments/activity/accept – admin role is rejected (parents/teachers only)', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.post(`${API}/assessments/activity/accept`, {
            headers: { Authorization: `Bearer ${adminToken}` },
            data: { activity: 'Bath time' },
        });
        expect([400, 403]).toContain(response.status());
    });
});
