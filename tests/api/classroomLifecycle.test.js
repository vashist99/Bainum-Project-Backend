import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

// Tests in this file are intentionally tolerant of a missing seeded test
// environment: when login credentials aren't provided they skip cleanly,
// matching the convention in the sibling classrooms.test.js file. The
// shared smoke checks (401/400 paths) run unconditionally so a deploy
// without test creds still gets some coverage.
async function login(request, email, password) {
    const response = await request.post(`${API_BASE}/auth/login`, {
        data: { email, password },
    });
    if (response.status() !== 200) return null;
    const body = await response.json();
    return body.user || null;
}

test.describe('Classroom Lifecycle API Endpoints', () => {
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

    // ─── DELETE /api/classrooms/:id ──────────────────────────────────────
    test('DELETE /api/classrooms/:id - requires authentication', async ({ request }) => {
        const response = await request.delete(`${API_BASE}/classrooms/64b0000000000000000000ff`);
        expect([401, 404]).toContain(response.status());
    });

    test('DELETE /api/classrooms/:id - parent forbidden', async ({ request }) => {
        if (!parentToken) {
            test.skip();
            return;
        }
        const response = await request.delete(
            `${API_BASE}/classrooms/64b0000000000000000000ff`,
            { headers: { Authorization: `Bearer ${parentToken}` } }
        );
        // 403 (auth ok, role wrong) or 404 (classroom not found) — both
        // prove the parent was authenticated and could not bypass authz
        // to actually delete a real row.
        expect([403, 404]).toContain(response.status());
    });

    test('DELETE /api/classrooms/:id - 400 on invalid id', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.delete(`${API_BASE}/classrooms/not-an-id`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        expect([400, 404]).toContain(response.status());
    });

    test('DELETE /api/classrooms/:id - 404 on unknown id', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.delete(
            `${API_BASE}/classrooms/64b0000000000000000000ff`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(response.status()).toBe(404);
    });

    test('DELETE /api/classrooms/:id - admin creates, deletes, gets summary', async ({ request }) => {
        if (!adminToken || !teacherToken) {
            test.skip();
            return;
        }
        // Find a teacher to lead the throwaway classroom.
        const teachers = await request.get(`${API_BASE}/teachers`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (teachers.status() !== 200) {
            test.skip();
            return;
        }
        const teacherList = (await teachers.json()).teachers || [];
        if (teacherList.length === 0) {
            test.skip();
            return;
        }
        const teacher = teacherList[0];

        const created = await request.post(`${API_BASE}/classrooms`, {
            headers: { Authorization: `Bearer ${adminToken}` },
            data: {
                name: `Deletion Smoke Test ${Date.now()}`,
                center: teacher.center,
                teacherId: teacher._id || teacher.id,
            },
        });
        if (created.status() !== 201) {
            test.skip();
            return;
        }
        const classroom = (await created.json()).classroom;

        const deleted = await request.delete(
            `${API_BASE}/classrooms/${classroom.id}`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(deleted.status()).toBe(200);
        const body = await deleted.json();
        expect(body.ok).toBe(true);
        expect(body.summary).toBeTruthy();
        expect(body.summary).toHaveProperty('childrenUnlinked');
        expect(body.summary).toHaveProperty('parentsUnlinked');
        expect(body.summary).toHaveProperty('assessmentsDisassociated');
        expect(body.summary).toHaveProperty('teacherAssessmentsDisassociated');
        expect(body.summary).toHaveProperty('invitationsDeleted');

        // Subsequent GET should now 404 — the row is gone.
        const after = await request.get(
            `${API_BASE}/classrooms/${classroom.id}`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(after.status()).toBe(404);
    });

    // ─── DELETE /api/classrooms/:id/children/:childId ────────────────────
    //
    // Smoke checks: 401 on no auth, 400 on bad ids, 404 on missing
    // room, 403 for unauthorized roles. Deeper assertions on the
    // parent-prune + notification fan-out live in the unit tests in
    // backend/tests/unit/classroomControllerLifecycle.test.js.
    test('DELETE /api/classrooms/:id/children/:childId - requires authentication', async ({ request }) => {
        const response = await request.delete(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children/64b0000000000000000000c1`
        );
        expect([401, 404]).toContain(response.status());
    });

    test('DELETE /api/classrooms/:id/children/:childId - 400 on bad ids', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.delete(
            `${API_BASE}/classrooms/not-an-id/children/64b0000000000000000000c1`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect([400, 404]).toContain(response.status());
    });

    test('DELETE /api/classrooms/:id/children/:childId - parent forbidden', async ({ request }) => {
        if (!parentToken) {
            test.skip();
            return;
        }
        const response = await request.delete(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children/64b0000000000000000000c1`,
            { headers: { Authorization: `Bearer ${parentToken}` } }
        );
        // 403 (auth ok, role wrong) or 404 (room doesn't exist) — both
        // prove the parent could not bypass auth.
        expect([403, 404]).toContain(response.status());
    });

    test('DELETE /api/classrooms/:id/children/:childId - 404 on unknown classroom for admin', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.delete(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children/64b0000000000000000000c1`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(response.status()).toBe(404);
    });

    // PATCH /api/classrooms/:id/children no longer exists. A stale
    // client that still calls it should get a 404 from express.
    test('PATCH /api/classrooms/:id/children - endpoint is gone (404 / 405)', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.patch(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children`,
            {
                headers: { Authorization: `Bearer ${adminToken}` },
                data: { addChildId: '64b0000000000000000000c1' },
            }
        );
        // Express returns 404 by default for unknown routes; some
        // proxies translate it to 405. Both are acceptable proofs
        // that the endpoint is no longer mounted.
        expect([404, 405]).toContain(response.status());
    });

    // ─── GET /api/classrooms/:id/transcripts ─────────────────────────────
    test('GET /api/classrooms/:id/transcripts - requires authentication', async ({ request }) => {
        const response = await request.get(
            `${API_BASE}/classrooms/64b0000000000000000000ff/transcripts`
        );
        expect([401, 404]).toContain(response.status());
    });

    test('GET /api/classrooms/:id/transcripts - 404 on unknown id', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.get(
            `${API_BASE}/classrooms/64b0000000000000000000ff/transcripts`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(response.status()).toBe(404);
    });

    test('GET /api/classrooms/:id/transcripts - parent denied for a classroom they do not co-own', async ({ request }) => {
        if (!parentToken) {
            test.skip();
            return;
        }
        // Use an unrelated id so the response is unambiguous.
        const response = await request.get(
            `${API_BASE}/classrooms/64b0000000000000000000ff/transcripts`,
            { headers: { Authorization: `Bearer ${parentToken}` } }
        );
        expect([403, 404]).toContain(response.status());
    });

    test('GET /api/classrooms/:id/transcripts - admin returns recordings array + counts', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const list = await request.get(`${API_BASE}/classrooms`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (list.status() !== 200) {
            test.skip();
            return;
        }
        const classroom = ((await list.json()).classrooms || [])[0];
        if (!classroom) {
            test.skip();
            return;
        }
        const response = await request.get(
            `${API_BASE}/classrooms/${classroom.id}/transcripts`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(Array.isArray(body.recordings)).toBe(true);
        expect(typeof body.childAssessmentCount).toBe('number');
        expect(typeof body.teacherAssessmentCount).toBe('number');

        // Sort: dates DESC. Cheap sanity check using ISO comparisons.
        for (let i = 1; i < body.recordings.length; i++) {
            const prev = body.recordings[i - 1].date
                ? new Date(body.recordings[i - 1].date).getTime()
                : 0;
            const curr = body.recordings[i].date
                ? new Date(body.recordings[i].date).getTime()
                : 0;
            expect(prev).toBeGreaterThanOrEqual(curr);
        }
    });

    test('GET /api/classrooms/:id/transcripts - lead teacher gets their classroom transcripts', async ({ request }) => {
        if (!teacherToken) {
            test.skip();
            return;
        }
        const list = await request.get(`${API_BASE}/classrooms`, {
            headers: { Authorization: `Bearer ${teacherToken}` },
        });
        if (list.status() !== 200) {
            test.skip();
            return;
        }
        const led = ((await list.json()).classrooms || []).find(
            (c) => c.role === 'lead' || c.role === 'assistant'
        );
        if (!led) {
            test.skip();
            return;
        }
        const response = await request.get(
            `${API_BASE}/classrooms/${led.id}/transcripts`,
            { headers: { Authorization: `Bearer ${teacherToken}` } }
        );
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(Array.isArray(body.recordings)).toBe(true);
    });
});
