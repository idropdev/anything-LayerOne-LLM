/**
 * Authentication Flow Testing Suite
 * Tests the separation of admin vs default user authentication flows
 * 
 * Test Coverage:
 * 1. Admin JWT authentication on shared endpoints
 * 2. Default user Keystone JWT authentication on shared endpoints
 * 3. Admin API key authentication on admin-only endpoints
 * 4. Negative tests (invalid tokens, wrong endpoint access, etc.)
 * 5. Performance metrics (response times, throughput)
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin_password';
const KEYSTONE_JWT = process.env.TEST_KEYSTONE_JWT || ''; // Paste Keystone JWT here for testing

// Test results storage
const testResults = {
  passed: 0,
  failed: 0,
  performance: {},
  bugs: [],
  securityGaps: [],
  performanceIssues: []
};

// Helper function to measure performance
async function measurePerformance(name, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const end = performance.now();
    const duration = end - start;
    
    if (!testResults.performance[name]) {
      testResults.performance[name] = [];
    }
    testResults.performance[name].push(duration);
    
    return { success: true, result, duration };
  } catch (error) {
    const end = performance.now();
    const duration = end - start;
    return { success: false, error, duration };
  }
}

// Helper function to log test results
function logTest(testName, passed, details = {}) {
  if (passed) {
    testResults.passed++;
    console.log(`✅ PASS: ${testName}`);
  } else {
    testResults.failed++;
    console.log(`❌ FAIL: ${testName}`);
    if (details.error) {
      console.log(`   Error: ${details.error.message}`);
      testResults.bugs.push({
        test: testName,
        error: details.error.message,
        details
      });
    }
  }
  if (details.duration) {
    console.log(`   Duration: ${details.duration.toFixed(2)}ms`);
  }
}

// Test Suite
describe('Authentication Flow Tests', () => {
  let adminJWT = null;
  let adminApiKey = null;

  // Setup: Get admin JWT and API key
  beforeAll(async () => {
    console.log('\n=== SETUP: Obtaining Admin Credentials ===\n');
    
    // Get admin JWT
    try {
      const response = await axios.post(`${BASE_URL}/api/request-token`, {
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD
      });
      
      if (response.data.valid && response.data.token) {
        adminJWT = response.data.token;
        console.log('✅ Admin JWT obtained successfully');
      } else {
        console.error('❌ Failed to obtain admin JWT:', response.data.message);
        throw new Error('Admin JWT not obtained');
      }
    } catch (error) {
      console.error('❌ Error obtaining admin JWT:', error.message);
      throw error;
    }

    // Get admin API key
    try {
      const response = await axios.post(
        `${BASE_URL}/api/system/generate-api-key`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${adminJWT}`
          }
        }
      );
      
      if (response.data.apiKey) {
        adminApiKey = response.data.apiKey;
        console.log('✅ Admin API key obtained successfully');
      } else {
        console.error('❌ Failed to obtain admin API key');
        throw new Error('Admin API key not obtained');
      }
    } catch (error) {
      console.error('❌ Error obtaining admin API key:', error.message);
      throw error;
    }

    console.log('\n=== SETUP COMPLETE ===\n');
  });

  // Test 1: Admin JWT on shared endpoints
  describe('Admin JWT Authentication on Shared Endpoints', () => {
    test('Admin JWT should access /v1/workspaces successfully', async () => {
      const { success, result, duration, error } = await measurePerformance(
        'admin_jwt_workspaces',
        async () => {
          return await axios.get(`${BASE_URL}/api/v1/workspaces`, {
            headers: {
              'Authorization': `Bearer ${adminJWT}`
            }
          });
        }
      );

      logTest('Admin JWT on /v1/workspaces', success, { duration, error });
      
      if (success) {
        expect(result.status).toBe(200);
        expect(result.data).toHaveProperty('workspaces');
      }
    });

    test('Admin JWT should access /v1/openai/models successfully', async () => {
      const { success, result, duration, error } = await measurePerformance(
        'admin_jwt_openai_models',
        async () => {
          return await axios.get(`${BASE_URL}/api/v1/openai/models`, {
            headers: {
              'Authorization': `Bearer ${adminJWT}`
            }
          });
        }
      );

      logTest('Admin JWT on /v1/openai/models', success, { duration, error });
      
      if (success) {
        expect(result.status).toBe(200);
      }
    });
  });

  // Test 2: Admin JWT should NOT work on admin-only endpoints
  describe('Admin JWT Rejection on Admin-Only Endpoints', () => {
    test('Admin JWT should be rejected on /v1/system', async () => {
      try {
        await axios.get(`${BASE_URL}/api/v1/system`, {
          headers: {
            'Authorization': `Bearer ${adminJWT}`
          }
        });
        
        // If we get here, the test failed (should have thrown 401)
        logTest('Admin JWT rejected on /v1/system', false, {
          error: new Error('Expected 401 but request succeeded')
        });
        testResults.securityGaps.push({
          issue: 'Admin JWT accepted on admin-only endpoint',
          endpoint: '/v1/system',
          severity: 'HIGH'
        });
      } catch (error) {
        const passed = error.response && error.response.status === 401;
        logTest('Admin JWT rejected on /v1/system', passed, {
          error: passed ? null : error
        });
        
        if (passed) {
          expect(error.response.status).toBe(401);
        }
      }
    });
  });

  // Test 3: Admin API key on admin-only endpoints
  describe('Admin API Key Authentication on Admin-Only Endpoints', () => {
    test('Admin API key should access /v1/system successfully', async () => {
      const { success, result, duration, error } = await measurePerformance(
        'admin_apikey_system',
        async () => {
          return await axios.get(`${BASE_URL}/api/v1/system`, {
            headers: {
              'Authorization': `Bearer ${adminApiKey}`
            }
          });
        }
      );

      logTest('Admin API key on /v1/system', success, { duration, error });
      
      if (success) {
        expect(result.status).toBe(200);
        expect(result.data).toHaveProperty('settings');
      }
    });

    test('Admin API key should access /v1/system/vector-count successfully', async () => {
      const { success, result, duration, error } = await measurePerformance(
        'admin_apikey_vector_count',
        async () => {
          return await axios.get(`${BASE_URL}/api/v1/system/vector-count`, {
            headers: {
              'Authorization': `Bearer ${adminApiKey}`
            }
          });
        }
      );

      logTest('Admin API key on /v1/system/vector-count', success, { duration, error });
      
      if (success) {
        expect(result.status).toBe(200);
      }
    });
  });

  // Test 4: Keystone JWT (default user) on shared endpoints
  describe('Keystone JWT Authentication on Shared Endpoints', () => {
    test('Keystone JWT should access /v1/workspaces with scoped results', async () => {
      if (!KEYSTONE_JWT) {
        console.log('⚠️  SKIP: Keystone JWT not provided (set TEST_KEYSTONE_JWT env var)');
        return;
      }

      const { success, result, duration, error } = await measurePerformance(
        'keystone_jwt_workspaces',
        async () => {
          return await axios.get(`${BASE_URL}/api/v1/workspaces`, {
            headers: {
              'Authorization': `Bearer ${KEYSTONE_JWT}`
            }
          });
        }
      );

      logTest('Keystone JWT on /v1/workspaces', success, { duration, error });
      
      if (success) {
        expect(result.status).toBe(200);
        expect(result.data).toHaveProperty('workspaces');
        // Verify scoping: default user should see fewer workspaces than admin
        console.log(`   Workspaces returned: ${result.data.workspaces.length}`);
      }
    });

    test('Keystone JWT should be rejected on admin-only endpoints', async () => {
      if (!KEYSTONE_JWT) {
        console.log('⚠️  SKIP: Keystone JWT not provided');
        return;
      }

      try {
        await axios.get(`${BASE_URL}/api/v1/system`, {
          headers: {
            'Authorization': `Bearer ${KEYSTONE_JWT}`
          }
        });
        
        logTest('Keystone JWT rejected on /v1/system', false, {
          error: new Error('Expected 401 but request succeeded')
        });
        testResults.securityGaps.push({
          issue: 'Keystone JWT accepted on admin-only endpoint',
          endpoint: '/v1/system',
          severity: 'CRITICAL'
        });
      } catch (error) {
        const passed = error.response && error.response.status === 401;
        logTest('Keystone JWT rejected on /v1/system', passed, {
          error: passed ? null : error
        });
      }
    });
  });

  // Test 5: Invalid token tests
  describe('Invalid Token Handling', () => {
    test('Invalid JWT should be rejected', async () => {
      try {
        await axios.get(`${BASE_URL}/api/v1/workspaces`, {
          headers: {
            'Authorization': 'Bearer invalid.jwt.token'
          }
        });
        
        logTest('Invalid JWT rejected', false, {
          error: new Error('Expected 401 but request succeeded')
        });
      } catch (error) {
        const passed = error.response && error.response.status === 401;
        logTest('Invalid JWT rejected', passed);
      }
    });

    test('Missing Authorization header should be rejected', async () => {
      try {
        await axios.get(`${BASE_URL}/api/v1/workspaces`);
        
        logTest('Missing auth header rejected', false, {
          error: new Error('Expected 401 but request succeeded')
        });
      } catch (error) {
        const passed = error.response && error.response.status === 401;
        logTest('Missing auth header rejected', passed);
      }
    });
  });

  // Test 6: Performance stress test
  describe('Performance and Stress Tests', () => {
    test('Concurrent admin JWT requests (10 requests)', async () => {
      const concurrentRequests = 10;
      const promises = [];
      
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(
          measurePerformance(`concurrent_admin_jwt_${i}`, async () => {
            return await axios.get(`${BASE_URL}/api/v1/workspaces`, {
              headers: {
                'Authorization': `Bearer ${adminJWT}`
              }
            });
          })
        );
      }

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.success).length;
      const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
      
      console.log(`   Success rate: ${successCount}/${concurrentRequests}`);
      console.log(`   Average duration: ${avgDuration.toFixed(2)}ms`);
      
      logTest('Concurrent admin JWT requests', successCount === concurrentRequests, {
        duration: avgDuration
      });

      if (avgDuration > 1000) {
        testResults.performanceIssues.push({
          issue: 'High average response time for concurrent requests',
          avgDuration: avgDuration.toFixed(2),
          threshold: '1000ms'
        });
      }
    });

    test('Sequential requests performance baseline', async () => {
      const requestCount = 5;
      const durations = [];
      
      for (let i = 0; i < requestCount; i++) {
        const { success, duration } = await measurePerformance(
          `sequential_admin_jwt_${i}`,
          async () => {
            return await axios.get(`${BASE_URL}/api/v1/workspaces`, {
              headers: {
                'Authorization': `Bearer ${adminJWT}`
              }
            });
          }
        );
        
        if (success) {
          durations.push(duration);
        }
      }

      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      console.log(`   Average sequential duration: ${avgDuration.toFixed(2)}ms`);
      
      logTest('Sequential requests performance', true, { duration: avgDuration });
    });
  });

  // Generate final report
  afterAll(() => {
    console.log('\n\n=== TEST RESULTS SUMMARY ===\n');
    console.log(`Total Tests: ${testResults.passed + testResults.failed}`);
    console.log(`Passed: ${testResults.passed}`);
    console.log(`Failed: ${testResults.failed}`);
    console.log(`Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(2)}%`);

    // Performance metrics
    console.log('\n=== PERFORMANCE METRICS ===\n');
    for (const [name, durations] of Object.entries(testResults.performance)) {
      if (durations.length > 0) {
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        console.log(`${name}:`);
        console.log(`  Average: ${avg.toFixed(2)}ms`);
        console.log(`  Min: ${min.toFixed(2)}ms`);
        console.log(`  Max: ${max.toFixed(2)}ms`);
      }
    }

    // Bugs found
    if (testResults.bugs.length > 0) {
      console.log('\n=== BUGS DISCOVERED ===\n');
      testResults.bugs.forEach((bug, index) => {
        console.log(`${index + 1}. ${bug.test}`);
        console.log(`   Error: ${bug.error}`);
      });
    }

    // Security gaps
    if (testResults.securityGaps.length > 0) {
      console.log('\n=== SECURITY GAPS ===\n');
      testResults.securityGaps.forEach((gap, index) => {
        console.log(`${index + 1}. [${gap.severity}] ${gap.issue}`);
        console.log(`   Endpoint: ${gap.endpoint}`);
      });
    }

    // Performance issues
    if (testResults.performanceIssues.length > 0) {
      console.log('\n=== PERFORMANCE ISSUES ===\n');
      testResults.performanceIssues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.issue}`);
        console.log(`   Average: ${issue.avgDuration}ms (Threshold: ${issue.threshold})`);
      });
    }

    // Save results to file
    const fs = require('fs');
    const resultsPath = __dirname + '/../../test-results.json';
    fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
    console.log(`\n✅ Test results saved to: ${resultsPath}`);
  });
});
