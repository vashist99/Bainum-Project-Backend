import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

async function login(request, email, password) {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { email, password },
  });
  if (response.status() !== 200) return null;
  const body = await response.json();
  return body.user || null;
}

test.describe('Recording Locations API', () => {
  let teacherToken = null;
  let parentToken = null;

  test.beforeAll(async ({ request }) => {
    teacherToken = await login(
      request,
      process.env.TEST_TEACHER_EMAIL || 'teacher@example.com',
      process.env.TEST_TEACHER_PASSWORD || 'password123'
    );
    parentToken = await login(
      request,
      process.env.TEST_PARENT_EMAIL || 'parent@example.com',
      process.env.TEST_PARENT_PASSWORD || 'password123'
    );
  });

  test('POST /api/locations/validate - requires authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/locations/validate`, {
      data: { location: 'Classroom' },
    });
    expect([401, 404]).toContain(response.status());
  });

  test('POST /api/locations/validate - rejects missing location', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/locations/validate`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: {},
    });
    expect([400, 404]).toContain(response.status());
  });

  test('teacher predefined school location accepted without LLM', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/locations/validate`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: { location: 'Playground' },
    });
    if (response.status() === 404) {
      test.skip();
      return;
    }
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.predefined).toBe(true);
    expect(body.context).toBe('school');
  });

  test('parent predefined home location accepted; school-only value is not predefined', async ({ request }) => {
    if (!parentToken) {
      test.skip();
      return;
    }
    const home = await request.post(`${API_BASE}/locations/validate`, {
      headers: { Authorization: `Bearer ${parentToken}` },
      data: { location: 'Grocery / big box store' },
    });
    if (home.status() === 404) {
      test.skip();
      return;
    }
    expect(home.status()).toBe(200);
    const homeBody = await home.json();
    expect(homeBody.accepted).toBe(true);
    expect(homeBody.predefined).toBe(true);
    expect(homeBody.context).toBe('home');

    // "Excursion" is school-only: for a parent it must go through custom
    // vetting (predefined=false) regardless of the LLM verdict.
    const crossContext = await request.post(`${API_BASE}/locations/validate`, {
      headers: { Authorization: `Bearer ${parentToken}` },
      data: { location: 'Excursion' },
    });
    expect(crossContext.status()).toBe(200);
    const crossBody = await crossContext.json();
    expect(crossBody.predefined).toBe(false);
  });

  test('activity accept route rejects nonsensical custom location', async ({ request }) => {
    if (!parentToken) {
      test.skip();
      return;
    }
    // Server-side re-validation: a garbage location must 400 before any save.
    // (Predefined activity keeps the activity check green so the location
    // check is what trips.)
    const response = await request.post(`${API_BASE}/assessments/activity/accept`, {
      headers: { Authorization: `Bearer ${parentToken}` },
      data: {
        activity: 'Puzzles',
        activityContext: 'home',
        location: 'qwxzy 9 blorp',
        transcript: 'test transcript',
      },
    });
    expect([400, 404]).toContain(response.status());
  });

  test('classroom accept route rejects nonsensical custom activity', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/assessments/teacher/accept`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: {
        teacherId: '64b0000000000000000000aa',
        activity: 'qwxzy 9 blorp',
        location: 'Classroom',
        transcript: 'test transcript',
      },
    });
    expect([400, 403, 404]).toContain(response.status());
  });
});
