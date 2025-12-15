# Authentication Flow Testing Suite

This testing suite validates access control for the AnythingLLM API by testing which tokens can access which endpoint types.

## Overview

The test suite uses a **matrix approach** to validate access control:

### Endpoint Types
1. **Admin-Only Endpoints**: Require Admin API Key
   - `/v1/system` - System settings
   - `/v1/system/vector-count` - Vector count

2. **Shared Endpoints**: Accept Admin JWT or User Keystone JWT
   - `/v1/workspaces` - Workspaces list
   - `/v1/openai/models` - OpenAI models

### Token Types
1. **Admin API Key** - For admin-only endpoints
2. **Admin Internal JWT** - For shared endpoints (admin access)
3. **User Keystone JWT** - For shared endpoints (user access)
4. **Invalid/Missing tokens** - Should be rejected

### Test Matrix

**Admin-Only Endpoints:**
| Token Type | Expected Result |
|------------|----------------|
| Admin API Key | ✅ 200 (Success) |
| Admin JWT | ❌ 401 (Rejected) |
| User Keystone JWT | ❌ 401 (Rejected) |
| No Token | ❌ 401 (Rejected) |

**Shared Endpoints:**
| Token Type | Expected Result |
|------------|----------------|
| Admin JWT | ✅ 200 (Success) |
| User Keystone JWT | ✅ 200 (Success, scoped) |
| Admin API Key | ❌ 401 (Rejected) |
| No Token | ❌ 401 (Rejected) |

## Setup

### 1. Install Dependencies

The test runner uses `axios` and `dotenv` which should already be installed. If not:

```bash
npm install axios dotenv
```

### 2. Configure Environment

Copy the example environment file:

```bash
cp __tests__/.env.test.example __tests__/.env.test
```

Edit `__tests__/.env.test` and configure:

```env
# Base URL for the API server
TEST_BASE_URL=http://localhost:3001

# Admin credentials for obtaining admin JWT
TEST_ADMIN_USERNAME=admin
TEST_ADMIN_PASSWORD=your_admin_password_here

# Keystone JWT for testing default user flow
# Obtain this from your Keystone service and paste it here
TEST_KEYSTONE_JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. Start the Server

Make sure your AnythingLLM server is running:

```bash
npm run dev
# or
npm start
```

## Running Tests

### Standalone Test Runner

Run the test script:

```bash
node __tests__/run-auth-tests.js
```

This will:
1. Obtain admin JWT from `/api/request-token`
2. Generate admin API key using the JWT
3. Run access control matrix tests
4. Generate detailed reports
5. Save results to `test-results.json` and `TEST_RESULTS.md`

## Test Coverage

### Access Control Validation

For each endpoint type, the suite tests:
- ✅ Correct token type grants access
- ✅ Wrong token types are rejected
- ✅ Missing tokens are rejected
- ✅ Invalid tokens are rejected

### Security Validation

- ✅ Admin JWT cannot access admin-only endpoints
- ✅ User JWT cannot access admin-only endpoints
- ✅ API keys cannot access shared endpoints
- ✅ Invalid tokens are properly rejected

### Performance Metrics

- ✅ Response time measurements for each token/endpoint combination
- ✅ Average response times
- ✅ Performance baseline

## Understanding Results

### Console Output

The test runner provides color-coded output:
- 🟢 Green: Passed tests
- 🔴 Red: Failed tests
- 🟡 Yellow: Skipped tests
- 🔵 Blue: Info messages

### JSON Results (`test-results.json`)

Contains detailed results including:
- Test pass/fail status
- Performance metrics for each endpoint
- Bugs discovered
- Security gaps identified
- Performance issues

### Markdown Report (`TEST_RESULTS.md`)

Human-readable report with:
- Summary statistics
- Detailed test results
- Performance metrics
- Bug list
- Security gap analysis
- Performance issue recommendations

## Expected Results

### Successful Test Run

```
=== SETUP: Obtaining Admin Credentials ===
✅ Admin JWT obtained successfully
✅ Admin API key obtained successfully

--- Test: Admin JWT on Shared Endpoints ---
✅ PASS: Admin JWT on /v1/workspaces
   Duration: 45.23ms
✅ PASS: Admin JWT on /v1/openai/models
   Duration: 32.15ms

--- Test: Admin JWT Rejection on Admin-Only Endpoints ---
✅ PASS: Admin JWT rejected on /v1/system

--- Test: Admin API Key on Admin-Only Endpoints ---
✅ PASS: Admin API key on /v1/system
   Duration: 38.67ms
✅ PASS: Admin API key on /v1/system/vector-count
   Duration: 29.42ms

...

=== TEST RESULTS SUMMARY ===
Total Tests: 12
Passed: 12
Failed: 0
Success Rate: 100.00%
```

## Troubleshooting

### "TEST_ADMIN_PASSWORD environment variable is required"

Make sure you've created `__tests__/.env.test` and set the admin password.

### "Error obtaining admin JWT: Request failed with status code 401"

Check that:
- The server is running
- `TEST_BASE_URL` is correct
- Admin credentials are correct

### "Keystone JWT tests skipped"

This is normal if you haven't provided `TEST_KEYSTONE_JWT`. To test default user flow:
1. Obtain a JWT from your Keystone service
2. Add it to `__tests__/.env.test`
3. Re-run the tests

### Performance Issues Reported

If the test suite reports performance issues:
- Check server load
- Review database query performance
- Consider caching strategies
- Check network latency

## Credentials Management

### For Admin Tests

The test suite automatically:
1. Obtains admin JWT using credentials from `.env.test`
2. Generates an API key using the admin JWT
3. Uses both for testing

**You only need to provide:**
- Admin username
- Admin password

### For Default User Tests

You need to manually obtain a Keystone JWT:
1. Log in to your Keystone service
2. Copy the JWT token
3. Paste it into `TEST_KEYSTONE_JWT` in `.env.test`

**Do NOT commit `.env.test` with real credentials!**

## Security Notes

- ⚠️ Never commit `.env.test` with real credentials
- ⚠️ Use test credentials only
- ⚠️ Run tests in a development/staging environment
- ⚠️ Review security gaps reported by the test suite

## Contributing

When adding new authentication features:
1. Add corresponding tests to `run-auth-tests.js`
2. Update this README with new test coverage
3. Run the full test suite before submitting PR
4. Include test results in your PR description

## License

Same as AnythingLLM project
