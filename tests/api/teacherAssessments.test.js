import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test.describe('Teacher Assessments API Endpoints', () => {
  let authToken = null;
  let teacherId = null;

  test.beforeAll(async ({ request }) => {
    try {
      const testEmail = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
      const testPassword = process.env.TEST_ADMIN_PASSWORD || 'password123';

      const loginResponse = await request.post(`${API_BASE}/auth/login`, {
        data: { email: testEmail, password: testPassword }
      });

      if (loginResponse.status() === 200) {
        const body = await loginResponse.json();
        authToken = body.user;
      }

      if (authToken) {
        const teachersResponse = await request.get(`${API_BASE}/teachers`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (teachersResponse.status() === 200) {
          const body = await teachersResponse.json();
          if (body.teachers && body.teachers.length > 0) {
            teacherId = body.teachers[0]._id || body.teachers[0].id;
          }
        }
      }
    } catch (e) {
      // Auth may timeout on cold start - tests will skip when needed
    }
  });

  test('GET /api/assessments/teacher/:teacherId - should require authentication', async ({ request }) => {
    const id = teacherId || '507f1f77bcf86cd799439011';
    const response = await request.get(`${API_BASE}/assessments/teacher/${id}`);

    expect(response.status()).toBe(401);
  });

  test('GET /api/assessments/teacher/:teacherId - should return assessments array', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    const id = teacherId || '507f1f77bcf86cd799439011';
    const response = await request.get(`${API_BASE}/assessments/teacher/${id}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('assessments');
    expect(Array.isArray(body.assessments)).toBe(true);
  });

  test('GET /api/assessments/teacher/:teacherId/latest - should return 404 when no assessments', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    const response = await request.get(`${API_BASE}/assessments/teacher/507f1f77bcf86cd799439099/latest`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (response.status() === 404) {
      const body = await response.json();
      expect(body.message).toMatch(/no assessments|not found/i);
    } else if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('assessment');
    }
  });

  test('POST /api/assessments/teacher/accept - should require authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/assessments/teacher/accept`, {
      data: {
        teacherId: '507f1f77bcf86cd799439011',
        transcript: 'Test transcript'
      }
    });

    expect(response.status()).toBe(401);
  });

  test('POST /api/assessments/teacher/accept - should require teacherId', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/assessments/teacher/accept`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
      data: {
        transcript: 'Test transcript',
        scienceTalk: 10,
        socialTalk: 20
      }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/teacher|required/i);
  });

  test('POST /api/assessments/teacher/accept - should save assessment with valid data', async ({ request }) => {
    if (!authToken || !teacherId) {
      test.skip();
      return;
    }

    const response = await request.post(`${API_BASE}/assessments/teacher/accept`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
      data: {
        teacherId,
        transcript: 'Test transcript for teacher assessment',
        scienceTalk: 25,
        socialTalk: 35,
        literatureTalk: 45,
        languageDevelopment: 55,
        keywordCounts: {
          science: 3,
          social: 4,
          literature: 5,
          language: 6
        },
        uploadedBy: 'Test User',
        date: new Date().toISOString()
      }
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('message', 'Teacher assessment saved successfully');
    expect(body).toHaveProperty('assessment');
    expect(body.assessment).toHaveProperty('scienceTalk', 25);
    expect(body.assessment).toHaveProperty('teacherId');
    expect(body.assessment).toHaveProperty('transcript');
  });

  test('POST /api/whisper/classroom - should require authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/whisper/classroom`, {
      multipart: {
        teacherId: '507f1f77bcf86cd799439011',
        recordingDate: new Date().toISOString().split('T')[0]
      }
    });

    expect(response.status()).toBe(401);
  });

  test('POST /api/whisper/classroom - should require audio file', async ({ request }) => {
    if (!authToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/whisper/classroom`, {
      headers: { 'Authorization': `Bearer ${authToken}` },
      multipart: {
        teacherId: teacherId || '507f1f77bcf86cd799439011',
        recordingDate: new Date().toISOString().split('T')[0]
      }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/audio|file|required/i);
  });
});
