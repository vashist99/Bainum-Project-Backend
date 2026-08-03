import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

// Non-admin 403 (teacher/coach/parent) is covered by the viewActivityLog
// capability unit test in tests/unit/activityLog.test.js — the route uses
// requireCapability("viewActivityLog"), which the API test would only
// re-verify with role credentials the suite does not provision.
test.describe('Activity Log API', () => {
  let adminToken = null;

  test.beforeAll(async ({ request }) => {
    try {
      const testEmail = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
      const testPassword = process.env.TEST_ADMIN_PASSWORD || 'password123';
      const loginResponse = await request.post(`${API_BASE}/auth/login`, {
        data: { email: testEmail, password: testPassword }
      });
      if (loginResponse.status() === 200) {
        const body = await loginResponse.json();
        adminToken = body.user;
      }
    } catch (e) {
      // Auth may timeout on cold start — tests skip when needed.
    }
  });

  test('GET /activity-log - anonymous requests get 401', async ({ request }) => {
    const response = await request.get(`${API_BASE}/activity-log`);
    expect([401, 403]).toContain(response.status());
  });

  test('GET /activity-log - admin gets paginated shape', async ({ request }) => {
    if (!adminToken) {
      test.skip(true, 'No admin token available');
      return;
    }
    const response = await request.get(`${API_BASE}/activity-log?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.page).toBe(1);
    expect(typeof body.total).toBe('number');
    expect(typeof body.totalPages).toBe('number');
  });

  test('GET /activity-log - invalid filter values get 400 for admins', async ({ request }) => {
    if (!adminToken) {
      test.skip(true, 'No admin token available');
      return;
    }
    const response = await request.get(`${API_BASE}/activity-log?role=parent`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(response.status()).toBe(400);
  });
});
