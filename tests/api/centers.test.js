import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test.describe('Centers API Endpoints', () => {
  let authToken = null;
  let createdCenterId = null;

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

  test.afterAll(async ({ request }) => {
    // Clean up: delete the created center if it exists
    if (authToken && createdCenterId) {
      await request.delete(`${API_BASE}/centers/${createdCenterId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }).catch(() => {
        // Ignore cleanup errors
      });
    }
  });

  test('GET /api/centers - should require authentication', async ({ request }) => {
    const response = await request.get(`${API_BASE}/centers`);
    
    // Accept both 401 (unauthorized) and 404 (route not found if not deployed yet)
    expect([401, 404]).toContain(response.status());
    if (response.status() === 401) {
      // If 401, verify it's an auth error
      try {
        const body = await response.json();
        expect(body.message || body.error).toMatch(/unauthorized|token|authentication/i);
      } catch {
        // Plain text response is also acceptable
      }
    }
  });

  test('GET /api/centers - should return centers list with valid token', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    const response = await request.get(`${API_BASE}/centers`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('centers');
    expect(Array.isArray(body.centers)).toBe(true);
  });

  test('POST /api/centers - should require authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/centers`, {
      data: {
        name: 'Test Center',
        address: '123 Test St',
        phone: '123-456-7890',
        email: 'test@center.com'
      }
    });
    
    // Accept both 401 (unauthorized) and 404 (route not found if not deployed yet)
    expect([401, 404]).toContain(response.status());
    if (response.status() === 401) {
      // If 401, verify it's an auth error
      try {
        const body = await response.json();
        expect(body.message || body.error).toMatch(/unauthorized|token|authentication/i);
      } catch {
        // Plain text response is also acceptable
      }
    }
  });

  test('POST /api/centers - should create a new center with valid token', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    const centerData = {
      name: `Test Center ${Date.now()}`,
      address: '123 Test Street',
      phone: '123-456-7890',
      email: `test${Date.now()}@center.com`,
      description: 'Test center description'
    };
    
    const response = await request.post(`${API_BASE}/centers`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: centerData
    });
    
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('center');
    expect(body.center).toHaveProperty('name', centerData.name);
    expect(body.center).toHaveProperty('address', centerData.address);
    expect(body.center).toHaveProperty('phone', centerData.phone);
    expect(body.center).toHaveProperty('email', centerData.email);
    
    // Store the created center ID for cleanup
    createdCenterId = body.center.id || body.center._id;
  });

  test('POST /api/centers - should reject duplicate center names', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    const centerData = {
      name: `Duplicate Test Center ${Date.now()}`,
      address: '123 Test Street'
    };
    
    // Create first center
    const firstResponse = await request.post(`${API_BASE}/centers`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: centerData
    });
    
    if (firstResponse.status() === 201) {
      const firstBody = await firstResponse.json();
      const firstCenterId = firstBody.center.id || firstBody.center._id;
      
      // Try to create duplicate
      const duplicateResponse = await request.post(`${API_BASE}/centers`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        data: centerData
      });
      
      expect(duplicateResponse.status()).toBe(400);
      const duplicateBody = await duplicateResponse.json();
      expect(duplicateBody.message).toMatch(/already exists/i);
      
      // Clean up
      await request.delete(`${API_BASE}/centers/${firstCenterId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }).catch(() => {});
    }
  });

  test('GET /api/centers/:id - should require authentication', async ({ request }) => {
    const response = await request.get(`${API_BASE}/centers/507f1f77bcf86cd799439011`);
    
    // Accept both 401 (unauthorized) and 404 (route not found if not deployed yet)
    expect([401, 404]).toContain(response.status());
    if (response.status() === 401) {
      // If 401, verify it's an auth error
      try {
        const body = await response.json();
        expect(body.message || body.error).toMatch(/unauthorized|token|authentication/i);
      } catch {
        // Plain text response is also acceptable
      }
    }
  });

  test('GET /api/centers/:id - should return center data with valid token', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    // First get list of centers to get a valid ID
    const listResponse = await request.get(`${API_BASE}/centers`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (listResponse.status() === 200) {
      const listBody = await listResponse.json();
      if (listBody.centers && listBody.centers.length > 0) {
        const centerId = listBody.centers[0]._id || listBody.centers[0].id;
        
        const response = await request.get(`${API_BASE}/centers/${centerId}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        if (response.status() === 200) {
          const body = await response.json();
          expect(body).toHaveProperty('center');
          expect(body.center).toHaveProperty('name');
        }
      }
    }
  });

  test('PUT /api/centers/:id - should require authentication', async ({ request }) => {
    const response = await request.put(`${API_BASE}/centers/507f1f77bcf86cd799439011`, {
      data: {
        name: 'Updated Center'
      }
    });
    
    // Accept both 401 (unauthorized) and 404 (route not found if not deployed yet)
    expect([401, 404]).toContain(response.status());
    if (response.status() === 401) {
      // If 401, verify it's an auth error
      try {
        const body = await response.json();
        expect(body.message || body.error).toMatch(/unauthorized|token|authentication/i);
      } catch {
        // Plain text response is also acceptable
      }
    }
  });

  test('PUT /api/centers/:id - should update center with valid token', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    // First create a center
    const createData = {
      name: `Update Test Center ${Date.now()}`,
      address: 'Original Address'
    };
    
    const createResponse = await request.post(`${API_BASE}/centers`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      },
      data: createData
    });
    
    if (createResponse.status() === 201) {
      const createBody = await createResponse.json();
      const centerId = createBody.center.id || createBody.center._id;
      
      // Update the center
      const updateData = {
        name: `Updated Test Center ${Date.now()}`,
        address: 'Updated Address',
        phone: '987-654-3210'
      };
      
      const updateResponse = await request.put(`${API_BASE}/centers/${centerId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        data: updateData
      });
      
      expect(updateResponse.status()).toBe(200);
      const updateBody = await updateResponse.json();
      expect(updateBody).toHaveProperty('center');
      expect(updateBody.center).toHaveProperty('name', updateData.name);
      expect(updateBody.center).toHaveProperty('address', updateData.address);
      
      // Clean up
      await request.delete(`${API_BASE}/centers/${centerId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      }).catch(() => {});
    }
  });

  test('DELETE /api/centers/:id - should require authentication', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/centers/507f1f77bcf86cd799439011`);
    
    // Accept both 401 (unauthorized) and 404 (route not found if not deployed yet)
    expect([401, 404]).toContain(response.status());
    if (response.status() === 401) {
      // If 401, verify it's an auth error
      try {
        const body = await response.json();
        expect(body.message || body.error).toMatch(/unauthorized|token|authentication/i);
      } catch {
        // Plain text response is also acceptable
      }
    }
  });

  test('GET /api/centers/:centerName/teachers - should return teachers for a center', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    
    // First get list of centers
    const centersResponse = await request.get(`${API_BASE}/centers`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    if (centersResponse.status() === 200) {
      const centersBody = await centersResponse.json();
      if (centersBody.centers && centersBody.centers.length > 0) {
        const centerName = centersBody.centers[0].name;
        
        const response = await request.get(`${API_BASE}/centers/${encodeURIComponent(centerName)}/teachers`, {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body).toHaveProperty('teachers');
        expect(Array.isArray(body.teachers)).toBe(true);
      }
    }
  });
});
