# Backend API Tests

This directory contains automated API tests for the Bainum Project backend using Playwright.

## Test Structure

```
tests/
└── api/
    ├── auth.test.js        # Authentication endpoint tests
    ├── assessments.test.js # Assessments API tests (accept, get by child)
    ├── centers.test.js     # Centers API tests
    ├── children.test.js    # Children API tests
    ├── teachers.test.js    # Teachers API tests
    └── whisper.test.js     # Whisper/audio processing validation tests
```

## Running Tests

### Install Dependencies
```bash
npm install
npx playwright install chromium
```

### Run All Tests
```bash
npm test
```

### Run API Tests Only
```bash
npm run test:api
```

## Test Configuration

Tests are configured in `playwright.config.js`. The base URL is set to:
- Production: `https://bainum-project-backend.onrender.com`
- Override with `API_URL` environment variable

## Environment Variables

Set these for authenticated tests:

```bash
API_URL=https://bainum-project-backend.onrender.com
TEST_ADMIN_EMAIL=admin@example.com
TEST_ADMIN_PASSWORD=password123
```

## Test Coverage

### Authentication Tests
- ✅ Login with valid credentials
- ✅ Login with invalid credentials
- ✅ Missing required fields validation

### Children API Tests
- ✅ Authentication required
- ✅ Get children list
- ✅ Get child by ID

### Teachers API Tests
- ✅ Authentication required
- ✅ Get teachers list

### Assessments API Tests
- ✅ GET assessments by child
- ✅ GET latest assessment
- ✅ POST accept assessment (requires childId)
- ✅ RAG segments and classification method support

### Whisper API Tests
- ✅ Requires childId
- ✅ Requires audio file

## CI/CD Integration

Tests run automatically in GitHub Actions on:
- Every push to `main` or `develop`
- Every pull request

## Writing New Tests

Example API test:

```javascript
import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'https://bainum-project-backend.onrender.com/api';

test('GET /api/endpoint - should work', async ({ request }) => {
  const response = await request.get(`${API_BASE}/endpoint`);
  expect(response.status()).toBe(200);
});
```
