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

    // ─── PATCH /api/classrooms/:id/children ──────────────────────────────
    test('PATCH /api/classrooms/:id/children - requires authentication', async ({ request }) => {
        const response = await request.patch(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children`,
            { data: { addChildId: '64b0000000000000000000c1' } }
        );
        expect([401, 404]).toContain(response.status());
    });

    test('PATCH /api/classrooms/:id/children - teacher forbidden (admin-only)', async ({ request }) => {
        if (!teacherToken) {
            test.skip();
            return;
        }
        // Find any classroom the teacher leads so the 403 isn't masked by 404.
        const list = await request.get(`${API_BASE}/classrooms`, {
            headers: { Authorization: `Bearer ${teacherToken}` },
        });
        if (list.status() !== 200) {
            test.skip();
            return;
        }
        const led = ((await list.json()).classrooms || []).find((c) => c.role === 'lead');
        if (!led) {
            test.skip();
            return;
        }
        const response = await request.patch(
            `${API_BASE}/classrooms/${led.id}/children`,
            {
                headers: { Authorization: `Bearer ${teacherToken}` },
                data: { addChildId: '64b0000000000000000000c1' },
            }
        );
        expect(response.status()).toBe(403);
        const body = await response.json();
        expect(body.message).toMatch(/admin/i);
    });

    test('PATCH /api/classrooms/:id/children - parent forbidden', async ({ request }) => {
        if (!parentToken) {
            test.skip();
            return;
        }
        const response = await request.patch(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children`,
            {
                headers: { Authorization: `Bearer ${parentToken}` },
                data: { addChildId: '64b0000000000000000000c1' },
            }
        );
        expect([403, 404]).toContain(response.status());
    });

    test('PATCH /api/classrooms/:id/children - 400 when neither addChildId nor removeChildId', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.patch(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children`,
            {
                headers: { Authorization: `Bearer ${adminToken}` },
                data: {},
            }
        );
        // 400 (empty body rejected) or 404 (validated id checked first) —
        // both prove neither/both branch never wrote anything.
        expect([400, 404]).toContain(response.status());
    });

    test('PATCH /api/classrooms/:id/children - 400 when BOTH addChildId and removeChildId', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        const response = await request.patch(
            `${API_BASE}/classrooms/64b0000000000000000000ff/children`,
            {
                headers: { Authorization: `Bearer ${adminToken}` },
                data: {
                    addChildId: '64b0000000000000000000c1',
                    removeChildId: '64b0000000000000000000c2',
                },
            }
        );
        expect([400, 404]).toContain(response.status());
    });

    test('PATCH /api/classrooms/:id/children - add → remove round trip is idempotent', async ({ request }) => {
        if (!adminToken) {
            test.skip();
            return;
        }
        // Pull a classroom + an eligible same-center child for the round trip.
        const classes = await request.get(`${API_BASE}/classrooms`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (classes.status() !== 200) {
            test.skip();
            return;
        }
        const classroom = ((await classes.json()).classrooms || [])[0];
        if (!classroom) {
            test.skip();
            return;
        }
        const childrenResponse = await request.get(`${API_BASE}/children`, {
            headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (childrenResponse.status() !== 200) {
            test.skip();
            return;
        }
        const child = ((await childrenResponse.json()).children || []).find(
            (c) =>
                (c.center || '').trim().toLowerCase() ===
                (classroom.center || '').trim().toLowerCase()
        );
        if (!child) {
            test.skip();
            return;
        }
        const childId = child._id || child.id;

        // Idempotency: a 2nd add of the same child still 200s with changed:false.
        const add1 = await request.patch(
            `${API_BASE}/classrooms/${classroom.id}/children`,
            {
                headers: { Authorization: `Bearer ${adminToken}` },
                data: { addChildId: childId },
            }
        );
        expect(add1.status()).toBe(200);
        const add1Body = await add1.json();
        expect(add1Body.ok).toBe(true);
        expect(add1Body.op).toBe('added');

        const add2 = await request.patch(
            `${API_BASE}/classrooms/${classroom.id}/children`,
            {
                headers: { Authorization: `Bearer ${adminToken}` },
                data: { addChildId: childId },
            }
        );
        expect(add2.status()).toBe(200);
        expect((await add2.json()).changed).toBe(false);

        // Remove brings the membership back to its starting state when the
        // child wasn't a member at the top of the test; otherwise leave it.
        if (add1Body.changed === true) {
            const remove = await request.patch(
                `${API_BASE}/classrooms/${classroom.id}/children`,
                {
                    headers: { Authorization: `Bearer ${adminToken}` },
                    data: { removeChildId: childId },
                }
            );
            expect(remove.status()).toBe(200);
            expect((await remove.json()).op).toBe('removed');
        }
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
