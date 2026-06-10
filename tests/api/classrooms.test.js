import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

// Helper: login and return the JWT, or null if the account doesn't exist.
async function login(request, email, password) {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { email, password },
  });
  if (response.status() !== 200) return null;
  const body = await response.json();
  return body.user || null;
}

test.describe('Classrooms API Endpoints', () => {
  let adminToken = null;
  let teacherToken = null;
  let parentToken = null;

  test.beforeAll(async ({ request }) => {
    adminToken = await login(
      request,
      process.env.TEST_ADMIN_EMAIL || 'admin@example.com',
      process.env.TEST_ADMIN_PASSWORD || 'password123'
    );
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

  test('GET /api/classrooms - should require authentication', async ({ request }) => {
    const response = await request.get(`${API_BASE}/classrooms`);
    expect([401, 404]).toContain(response.status());
  });

  test('POST /api/classrooms - should require authentication', async ({ request }) => {
    const response = await request.post(`${API_BASE}/classrooms`, {
      data: { name: 'Unauthenticated Classroom' },
    });
    expect([401, 404]).toContain(response.status());
  });

  test('GET /api/classrooms - parent gets scoped list with enrolledChildren', async ({ request }) => {
    if (!parentToken) {
      test.skip();
      return;
    }
    const response = await request.get(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${parentToken}` },
    });
    if (response.status() === 404) {
      test.skip();
      return;
    }
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.classrooms)).toBe(true);
    // Every row a parent sees must carry their enrolled children.
    for (const c of body.classrooms) {
      expect(Array.isArray(c.enrolledChildren)).toBe(true);
    }
  });

  test('POST /api/classrooms - parent cannot create (403)', async ({ request }) => {
    if (!parentToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${parentToken}` },
      data: { name: 'Parent Classroom' },
    });
    expect([403, 404]).toContain(response.status());
  });

  test('POST /api/classrooms - rejects missing name', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: { name: '   ' },
    });
    expect([400, 404]).toContain(response.status());
  });

  test('POST /api/classrooms - admin must supply center and teacher', async ({ request }) => {
    if (!adminToken) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: 'Admin Classroom Without Teacher' },
    });
    expect([400, 404]).toContain(response.status());
  });

  test('teacher can create multiple classrooms (1:N lead) and list flags role', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const created = [];
    for (const name of ['API Test Classroom A', 'API Test Classroom B']) {
      const response = await request.post(`${API_BASE}/classrooms`, {
        headers: { Authorization: `Bearer ${teacherToken}` },
        data: { name },
      });
      if (response.status() === 404) {
        test.skip();
        return;
      }
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.classroom?.name).toBe(name);
      created.push(body.classroom.id);
    }
    // Same teacher now leads two classrooms — both must appear, flagged "lead".
    const listResponse = await request.get(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(listResponse.status()).toBe(200);
    const listBody = await listResponse.json();
    const mine = (listBody.classrooms || []).filter((c) => created.includes(String(c.id)));
    expect(mine.length).toBe(2);
    for (const c of mine) {
      expect(c.role).toBe('lead');
      expect(c.teacher?.name).toBeTruthy();
      expect(c.center).toBeTruthy();
    }
  });

  test('POST /api/classrooms - assistant equal to lead is rejected', async ({ request }) => {
    if (!adminToken || !teacherToken) {
      test.skip();
      return;
    }
    // Find any classroom led by the test teacher to learn their id/center.
    const listResponse = await request.get(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    if (listResponse.status() !== 200) {
      test.skip();
      return;
    }
    const listBody = await listResponse.json();
    const led = (listBody.classrooms || []).find((c) => c.role === 'lead');
    if (!led?.teacher?.id) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        name: 'Assistant Equals Lead',
        center: led.center,
        teacherId: led.teacher.id,
        assistantTeacherId: led.teacher.id,
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/same as the lead/i);
  });

  test('GET /api/classrooms/:id - invalid id rejected, unknown id 404', async ({ request }) => {
    if (!adminToken) {
      test.skip();
      return;
    }
    const badId = await request.get(`${API_BASE}/classrooms/not-an-id`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect([400, 404]).toContain(badId.status());

    const missing = await request.get(`${API_BASE}/classrooms/64b0000000000000000000ff`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(missing.status()).toBe(404);
  });

  test('classroom detail, eligible parents, and assessments respect access', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const listResponse = await request.get(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    if (listResponse.status() !== 200) {
      test.skip();
      return;
    }
    const listBody = await listResponse.json();
    const classroom = (listBody.classrooms || [])[0];
    if (!classroom) {
      test.skip();
      return;
    }

    const detail = await request.get(`${API_BASE}/classrooms/${classroom.id}`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(detail.status()).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.classroom?.name).toBeTruthy();
    expect(Array.isArray(detailBody.classroom?.children)).toBe(true);

    const eligible = await request.get(`${API_BASE}/classrooms/${classroom.id}/eligible-parents`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(eligible.status()).toBe(200);
    const eligibleBody = await eligible.json();
    expect(Array.isArray(eligibleBody.parents)).toBe(true);
    // Every eligible parent row must expose children names for "Parent of X" labels.
    for (const p of eligibleBody.parents) {
      expect(Array.isArray(p.children)).toBe(true);
    }

    const assessments = await request.get(`${API_BASE}/classrooms/${classroom.id}/assessments`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(assessments.status()).toBe(200);
    const assessmentsBody = await assessments.json();
    expect(Array.isArray(assessmentsBody.assessments)).toBe(true);
    expect(assessmentsBody.cohortStats).toBeTruthy();

    if (parentToken) {
      const parentDetail = await request.get(`${API_BASE}/classrooms/${classroom.id}`, {
        headers: { Authorization: `Bearer ${parentToken}` },
      });
      expect(parentDetail.status()).toBe(403);
    }
  });

  test('POST /api/classrooms/:id/invite - requires parent selection', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    const listResponse = await request.get(`${API_BASE}/classrooms`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    if (listResponse.status() !== 200) {
      test.skip();
      return;
    }
    const classroom = ((await listResponse.json()).classrooms || [])[0];
    if (!classroom) {
      test.skip();
      return;
    }
    const response = await request.post(`${API_BASE}/classrooms/${classroom.id}/invite`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: { parentIds: [] },
    });
    expect(response.status()).toBe(400);

    // New invites shape: empty list and malformed entries are also rejected.
    const emptyInvites = await request.post(`${API_BASE}/classrooms/${classroom.id}/invite`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: { invites: [] },
    });
    expect(emptyInvites.status()).toBe(400);

    const missingParent = await request.post(`${API_BASE}/classrooms/${classroom.id}/invite`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: { invites: [{ childIds: ['64b0000000000000000000c1'] }] },
    });
    expect(missingParent.status()).toBe(400);
  });

  test('teacher accept route rejects classroom the user cannot manage', async ({ request }) => {
    if (!teacherToken) {
      test.skip();
      return;
    }
    // Unknown classroomId on the classroom-scoped accept path must 404 before
    // any assessment is written (legacy path without classroomId is untouched).
    const response = await request.post(`${API_BASE}/assessments/teacher/accept`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: {
        teacherId: '64b0000000000000000000aa',
        classroomId: '64b0000000000000000000ff',
        transcript: 'test',
      },
    });
    expect([400, 403, 404]).toContain(response.status());
  });
});
