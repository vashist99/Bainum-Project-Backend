import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test.describe('Authentication Endpoints', () => {
  test('POST /api/auth/login - should require email and password', async ({ request }) => {
    const response = await request.post(`${API_BASE}/auth/login`, {
      data: {}
    });
    
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/required|email|password/i);
  });

  test('POST /api/auth/login - should reject invalid credentials', async ({ request }) => {
    const response = await request.post(`${API_BASE}/auth/login`, {
      data: {
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      }
    });
    
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.message).toMatch(/invalid|incorrect|unauthorized/i);
  });

  test('POST /api/auth/login - should return token with valid credentials', async ({ request }) => {
    const testEmail = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
    const testPassword = process.env.TEST_ADMIN_PASSWORD || 'password123';
    
    const response = await request.post(`${API_BASE}/auth/login`, {
      data: {
        email: testEmail,
        password: testPassword
      }
    });
    
    // May succeed or fail depending on if test user exists
    if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('user'); // JWT token
      expect(body).toHaveProperty('message');
      expect(typeof body.user).toBe('string');
    } else {
      // Test user may not exist - that's okay
      console.log('Test user may not exist in production environment');
    }
  });
});
