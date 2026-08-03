import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

// Role gating (admin/parent → 403) is covered by the deleteOwnAccount
// capability unit test; destructive success paths are exercised in unit
// tests against mocked models, never against a shared environment.
test.describe('Account Deletion & Terms API', () => {
  test('DELETE /auth/me - anonymous requests get 401', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/auth/me`, {
      data: { password: 'x', confirmation: 'DELETE' }
    });
    expect([401, 403]).toContain(response.status());
  });

  test('POST /auth/register-coach - missing terms acceptance gets 400', async ({ request }) => {
    const response = await request.post(`${API_BASE}/auth/register-coach`, {
      data: {
        name: 'No Terms',
        email: `no-terms-${Date.now()}@example.com`,
        username: `noterms${Date.now() % 100000}`,
        password: 'secret123'
      }
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/terms/i);
  });
});
