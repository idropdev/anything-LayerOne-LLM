# Quick Start: Running Authentication Tests

## 1. Setup (One-time)

```bash
# Navigate to tests directory
cd server/__tests__

# Copy environment template
cp .env.test.example .env.test

# Edit .env.test with your credentials
nano .env.test  # or use your preferred editor
```

## 2. Configure Credentials

Edit `.env.test`:

```env
TEST_BASE_URL=http://localhost:3001
TEST_ADMIN_USERNAME=admin
TEST_ADMIN_PASSWORD=your_password_here
TEST_KEYSTONE_JWT=  # Optional: paste Keystone JWT here
```

## 3. Start Server

```bash
# From project root
cd ../..
npm run dev
```

## 4. Run Tests

```bash
# From project root
node server/__tests__/run-auth-tests.js
```

## 5. View Results

```bash
# View JSON results
cat server/__tests__/test-results.json

# View markdown report
cat server/__tests__/TEST_RESULTS.md
```

## Expected Output

```
======================================================================
AUTHENTICATION ACCESS CONTROL TEST SUITE
======================================================================

Configuration:
  Base URL: http://localhost:3001
  Admin Username: admin
  Keystone JWT: Provided ✓

=== SETUP: Obtaining Admin Credentials ===

✅ Admin JWT obtained successfully
✅ Admin API key obtained successfully

======================================================================
TEST CATEGORY: ADMIN-ONLY ENDPOINTS
======================================================================

Expected Behavior:
  ✓ Admin API Key → 200 (Success)
  ✗ Admin JWT → 401 (Rejected)
  ✗ User Keystone JWT → 401 (Rejected)
  ✗ No Token → 401 (Rejected)

--- Testing: System Settings (/api/v1/system) ---

Test 1: Admin API Key
✅ PASS: Admin API Key on System Settings
   Expected: 200 (Access granted)
   Actual: 200 (Success)
   Duration: 45.23ms

Test 2: Admin Internal JWT
✅ PASS: Admin JWT rejected on System Settings
   Expected: 401 (Rejected)
   Actual: 401 (Rejected)
   Duration: 32.15ms

...

======================================================================
TEST RESULTS SUMMARY
======================================================================

Total Tests: 16
Passed: 16
Failed: 0
Success Rate: 100.00%
```

## Troubleshooting

### Server not running
```bash
# Start the server first
npm run dev
```

### Wrong credentials
```bash
# Check your .env.test file
cat server/__tests__/.env.test
```

### Port already in use
```bash
# Change TEST_BASE_URL in .env.test
TEST_BASE_URL=http://localhost:3002
```

## What Gets Tested

**Admin-Only Endpoints:**
- ✅ Admin API Key → 200 (Success)
- ✅ Admin JWT → 401 (Rejected)
- ✅ User JWT → 401 (Rejected)
- ✅ No Token → 401 (Rejected)

**Shared Endpoints:**
- ✅ Admin JWT → 200 (Success)
- ✅ User JWT → 200 (Success, scoped)
- ✅ Admin API Key → 401 (Rejected)
- ✅ No Token → 401 (Rejected)

**Invalid Tokens:**
- ✅ Invalid JWT format rejected
- ✅ Malformed headers rejected

## Files Generated

- `test-results.json` - Detailed JSON results
- `TEST_RESULTS.md` - Human-readable markdown report

## Next Steps

1. Review test results
2. Fix any bugs discovered
3. Address security gaps
4. Include results in your PR

## Files Generated

- `test-results.json` - Detailed JSON results
- `TEST_RESULTS.md` - Human-readable markdown report

## Next Steps

1. Review test results
2. Fix any bugs discovered
3. Address security gaps
4. Optimize performance issues
5. Include results in your PR
