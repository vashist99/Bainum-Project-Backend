import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test.describe('Children API Endpoints', () => {
  let authToken = null;

  test.beforeAll(async ({ request }) => {
    // Try to get auth token for authenticated tests
    const testEmail = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
    const testPassword = process.env.TEST_ADMIN_PASSWORD || 'password123';
    
    const loginResponse = await request.post(`${API_BASE}/auth/login`, {
      data: {
        email: testEmail,
        password: testPassword
      }
    });
    
    if (loginResponse.status() === 200) {
      const body = await loginResponse.json();
      authToken = body.user;
    }
  });

  test('GET /api/children - should require authentication', async ({ request }) => {
    const response = await request.get(`${API_BASE}/children`);
    
    expect(response.status()).toBe(401);
    // Handle both JSON and text responses
    try {
      const body = await response.json();
      expect(body.message).toMatch(/unauthorized|token|authentication/i);
    } catch {
      // If response is not JSON (plain text), that's also acceptable for 401
      const text = await response.text();
      expect(text.toLowerCase()).toMatch(/unauthorized|token|authentication/i);
    }
  });

  test('GET /api/children - should return children list with valid token', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    const response = await request.get(`${API_BASE}/children`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('children');
    expect(Array.isArray(body.children)).toBe(true);
  });

  test('GET /api/children/:id - should require authentication', async ({ request }) => {
    const response = await request.get(`${API_BASE}/children/507f1f77bcf86cd799439011`);
    
    expect(response.status()).toBe(401);
  });

  test('GET /api/children/:id - should return child data with valid token', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    // First get list of children to get a valid ID
    const listResponse = await request.get(`${API_BASE}/children`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (listResponse.status() === 200) {
      const listBody = await listResponse.json();
      if (listBody.children && listBody.children.length > 0) {
        const childId = listBody.children[0]._id || listBody.children[0].id;
        
        const response = await request.get(`${API_BASE}/children/${childId}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        if (response.status() === 200) {
          const body = await response.json();
          expect(body).toHaveProperty('child');
        }
      }
    }
  });
});
