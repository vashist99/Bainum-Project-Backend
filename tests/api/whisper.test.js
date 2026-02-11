import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test.describe('Whisper / Audio Processing API', () => {
  test('POST /api/whisper - should require childId', async ({ request }) => {
    const response = await request.post(`${API_BASE}/whisper`, {
      multipart: {
        uploadedBy: 'Test User'
        // No childId, no audio file - childId is checked first
      }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/child|required/i);
  });

  test('POST /api/whisper - should require audio file', async ({ request }) => {
    const response = await request.post(`${API_BASE}/whisper`, {
      multipart: {
        childId: '507f1f77bcf86cd799439011',
        uploadedBy: 'Test User'
        // No audio file
      }
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/audio|file|required/i);
  });
});
