# Authentication Security Tests - Read-Only

## Overview

These tests verify authentication boundaries **without modifying the database**. All tests use GET endpoints only to ensure no data is created, updated, or deleted.

## What Gets Tested

### ✅ Security Boundaries
- Admin endpoints accept API keys, reject JWTs
- Shared endpoints accept JWTs (admin & Keystone), reject API keys
- `/v1/*` API endpoints accept JWTs, reject API keys
- Invalid/missing tokens are properly rejected

### 📊 Performance Metrics
- Response times (avg, min, max, P50, P95, P99)
- Success rates
- Error tracking

## Setup

### 1. Copy Test Configuration
```bash
cp .env.test.example .env.test
```

### 2. Fill in Credentials

Edit `.env.test`:

```bash
# REQUIRED: Admin credentials
TEST_ADMIN_USERNAME=your-admin-username
TEST_ADMIN_PASSWORD=your-admin-password

# OPTIONAL: Keystone JWT (tests will skip if not provided)
TEST_KEYSTONE_JWT=your-keystone-jwt-token
```

### 3. Start Server
```bash
npm run dev
```

### 4. Run Tests
```bash
# Run all authentication tests
npm run test:auth

# Or run with Jest directly
npx jest __tests__/integration/auth.integration.test.js --verbose
```

## Test Flow

### Phase 1: Admin Authentication
1. Login with username/password → receive admin JWT
2. Use JWT to generate API key
3. Verify API key works on admin endpoints

### Phase 2: Security - Admin Endpoints
4. Verify admin JWT is REJECTED on admin endpoints
5. Verify Keystone JWT is REJECTED on admin endpoints

### Phase 3: Security - Shared Endpoints
6. Verify admin JWT WORKS on shared endpoints
7. Verify admin JWT WORKS on `/v1/*` API endpoints
8. Verify Keystone JWT WORKS on shared endpoints (if provided)

### Phase 4: Security - API Key Rejection
9. Verify API key is REJECTED on shared endpoints
10. Verify API key is REJECTED on `/v1/*` API endpoints

### Phase 5: Invalid Tokens
11. Verify missing tokens are rejected
12. Verify invalid tokens are rejected
13. Verify malformed headers are rejected

## Expected Output

```
Authentication Security Tests (Read-Only)

  Admin Authentication Flow
    ✓ Step 1: Admin should login with username/password and receive JWT (150ms)
    ✓ Step 2: Admin should generate API key using JWT (80ms)
    ✓ Step 3: API key should work on admin endpoints (GET /admin/users) (45ms)

  Security: Admin Endpoints Should REJECT JWTs
    ✓ Admin JWT should be REJECTED on admin endpoints (GET /admin/users) (25ms)
    ✓ Keystone JWT should be REJECTED on admin endpoints (GET /admin/users) (30ms)

  Security: Shared Endpoints Should ACCEPT JWTs
    ✓ Admin JWT should work on shared endpoints (GET /system/check-token) (40ms)
    ✓ Admin JWT should work on /v1 API endpoints (GET /v1/workspaces) (60ms)
    ✓ Keystone JWT should work on shared endpoints (GET /system/check-token) (120ms)

  Security: Shared Endpoints Should REJECT API Keys
    ✓ API key should be REJECTED on shared endpoints (GET /system/check-token) (20ms)
    ✓ API key should be REJECTED on /v1 API endpoints (GET /v1/workspaces) (25ms)

  Security: Invalid/Missing Tokens
    ✓ Missing token should be rejected (GET /admin/users) (15ms)
    ✓ Invalid token should be rejected (GET /admin/users) (18ms)
    ✓ Malformed Authorization header should be rejected (12ms)

================================================================================
📊 PERFORMANCE METRICS
================================================================================
Total Requests:    13
Success Rate:      100.00% (13/13)
Avg Response Time: 49.23ms
Min Response Time: 12.00ms
Max Response Time: 150.00ms
P50 (Median):      30.00ms
P95:               120.00ms
P99:               150.00ms
================================================================================
```

## What's NOT Tested

These tests are **read-only** and do NOT:
- Create users, workspaces, or documents
- Modify any database records
- Delete any data
- Test write operations (POST/PUT/DELETE with data changes)

## Troubleshooting

### Tests Fail with 401 Errors
- Check that your admin credentials in `.env.test` are correct
- Verify the server is running on the correct URL
- Ensure multi-user mode is enabled

### Keystone Tests Skipped
- This is normal if `TEST_KEYSTONE_JWT` is not provided
- To test Keystone authentication, add a valid JWT to `.env.test`

### Server Connection Errors
- Verify server is running: `npm run dev`
- Check `TEST_SERVER_URL` in `.env.test` matches your server

## Next Steps

After tests pass:
1. Review performance metrics
2. Document results in `TEST_RESULTS.md`
3. Run performance tests: `npm run test:performance`
