import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

// A syntactically valid but (almost certainly) nonexistent ObjectId.
const FAKE_ID = '507f1f77bcf86cd799439011';

test.describe('Home Access API — transcript tier', () => {
  let adminToken = null;
  let childId = null;

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

      if (adminToken) {
        const childrenResponse = await request.get(`${API_BASE}/children`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        if (childrenResponse.status() === 200) {
          const body = await childrenResponse.json();
          if (body.children && body.children.length > 0) {
            childId = body.children[0]._id || body.children[0].id;
          }
        }
      }
    } catch (e) {
      // Auth may timeout on cold start — tests skip when needed.
    }
  });

  test('POST /transcript-access - anonymous requests get 401', async ({ request }) => {
    const response = await request.post(
      `${API_BASE}/home-access/child/${FAKE_ID}/transcript-access`,
      { data: { grantId: FAKE_ID, transcriptAccess: true } }
    );
    expect([401, 403]).toContain(response.status());
  });

  test('POST /transcript-access - nonexistent grant returns 404 for admins', async ({ request }) => {
    if (!adminToken) {
      test.skip();
      return;
    }
    const response = await request.post(
      `${API_BASE}/home-access/child/${FAKE_ID}/transcript-access`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { grantId: FAKE_ID, transcriptAccess: true },
      }
    );
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.message).toMatch(/grant not found/i);
  });

  test('POST /transcript-access - non-boolean transcriptAccess is rejected', async ({ request }) => {
    if (!adminToken) {
      test.skip();
      return;
    }
    const response = await request.post(
      `${API_BASE}/home-access/child/${FAKE_ID}/transcript-access`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { grantId: FAKE_ID, transcriptAccess: 'yes' },
      }
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/boolean/i);
  });

  test('POST /transcript-access - invalid ids are rejected', async ({ request }) => {
    if (!adminToken) {
      test.skip();
      return;
    }
    const response = await request.post(
      `${API_BASE}/home-access/child/not-an-id/transcript-access`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { grantId: 'also-not-an-id', transcriptAccess: true },
      }
    );
    expect(response.status()).toBe(400);
  });

  test('GET /child/:childId - admin state includes transcriptAccess and grants list', async ({ request }) => {
    if (!adminToken || !childId) {
      test.skip();
      return;
    }
    const response = await request.get(`${API_BASE}/home-access/child/${childId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('transcriptAccess');
    expect(typeof body.transcriptAccess).toBe('boolean');
    expect(Array.isArray(body.grants)).toBe(true);
    for (const grant of body.grants) {
      expect(grant).toHaveProperty('grantId');
      expect(grant).toHaveProperty('scope');
      expect(grant).toHaveProperty('granteeName');
      expect(typeof grant.transcriptAccess).toBe('boolean');
    }
  });

  test('GET /assessments/child/:childId - staff home rows never include transcript without the tier', async ({ request }) => {
    if (!adminToken || !childId) {
      test.skip();
      return;
    }
    // Admin state tells us whether this admin holds the transcript tier.
    const stateRes = await request.get(`${API_BASE}/home-access/child/${childId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (stateRes.status() !== 200) {
      test.skip();
      return;
    }
    const state = await stateRes.json();

    const response = await request.get(`${API_BASE}/assessments/child/${childId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.assessments)).toBe(true);

    if (!state.transcriptAccess) {
      for (const row of body.assessments) {
        expect(row.transcript).toBeUndefined();
        expect(row.ragSegments).toBeUndefined();
        expect(row.audioFileName).toBeUndefined();
      }
    }
  });
});
