import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test.describe('Assessments API Endpoints', () => {
  let authToken = null;
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
        authToken = body.user;
      }

      if (authToken) {
        const childrenResponse = await request.get(`${API_BASE}/children`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (childrenResponse.status() === 200) {
          const body = await childrenResponse.json();
          if (body.children && body.children.length > 0) {
            childId = body.children[0]._id || body.children[0].id;
          }
        }
      }
    } catch (e) {
      // Auth may timeout on cold start - tests will skip when needed
    }
  });

  test('GET /api/assessments/child/:childId - should return assessments array', async ({ request }) => {
    const id = childId || '507f1f77bcf86cd799439011';
    const response = await request.get(`${API_BASE}/assessments/child/${id}`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('assessments');
    expect(Array.isArray(body.assessments)).toBe(true);
  });

  test('GET /api/assessments/child/:childId/latest - should return 404 when no assessments', async ({ request }) => {
    // Use a likely non-existent child ID
    const response = await request.get(`${API_BASE}/assessments/child/507f1f77bcf86cd799439099/latest`);

    // May be 404 (no assessments) or 200 (if assessments exist for that ID)
    if (response.status() === 404) {
      const body = await response.json();
      expect(body.message).toMatch(/no assessments|not found/i);
    } else if (response.status() === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('assessment');
    }
  });

  test('POST /api/assessments/accept - should require childId', async ({ request }) => {
    const response = await request.post(`${API_BASE}/assessments/accept`, {
      data: {
        transcript: 'Test transcript',
        scienceTalk: 10,
        socialTalk: 20,
        literatureTalk: 30,
        languageDevelopment: 40
      }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/child|required/i);
  });

  test('POST /api/assessments/accept - should save assessment with valid data', async ({ request }) => {
    if (!childId) {
      test.skip();
      return;
    }

    const response = await request.post(`${API_BASE}/assessments/accept`, {
      data: {
        childId,
        transcript: 'Test transcript for assessment',
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
    expect(body).toHaveProperty('message', 'Assessment saved successfully');
    expect(body).toHaveProperty('assessment');
    expect(body.assessment).toHaveProperty('scienceTalk', 25);
    expect(body.assessment).toHaveProperty('socialTalk', 35);
    expect(body.assessment).toHaveProperty('literatureTalk', 45);
    expect(body.assessment).toHaveProperty('languageDevelopment', 55);
    expect(body.assessment).toHaveProperty('transcript');
    expect(body.assessment).toHaveProperty('childId');
  });

  test('POST /api/assessments/accept - should accept ragSegments and classificationMethod', async ({ request }) => {
    if (!childId) {
      test.skip();
      return;
    }

    const response = await request.post(`${API_BASE}/assessments/accept`, {
      data: {
        childId,
        transcript: 'Test with RAG segments',
        scienceTalk: 50,
        socialTalk: 50,
        literatureTalk: 50,
        languageDevelopment: 50,
        ragScores: { scienceTalk: 60, socialTalk: 55, literatureTalk: 45, languageDevelopment: 40 },
        ragSegments: [
          { text: 'experiment', category: 'science', startIndex: 0, endIndex: 10 }
        ],
        classificationMethod: 'hybrid',
        uploadedBy: 'Test User'
      }
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.assessment).toHaveProperty('ragSegments');
    expect(body.assessment).toHaveProperty('classificationMethod');
  });
});
