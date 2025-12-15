#!/usr/bin/env node

/**
 * Authentication Access Control Test Suite
 * Tests access control by validating which tokens can access which endpoint types
 * 
 * Endpoint Types:
 * 1. Admin-Only: Requires API Key
 * 2. Shared (Admin + User): Accepts Admin JWT or User Keystone JWT
 * 
 * Token Types:
 * 1. Admin API Key
 * 2. Admin Internal JWT
 * 3. User Keystone JWT
 * 4. Invalid/Missing tokens
 * 
 * Test Matrix: Each token type is tested against each endpoint type
 */

require('dotenv').config({ path: __dirname + '/.env.test' });
const axios = require('axios');
const { performance } = require('perf_hooks');
const fs = require('fs');

// Configuration
const CONFIG = {
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3001',
  adminUsername: process.env.TEST_ADMIN_USERNAME || 'admin',
  adminPassword: process.env.TEST_ADMIN_PASSWORD,
  keystoneJWT: process.env.TEST_KEYSTONE_JWT || '',
  verbose: process.env.TEST_VERBOSE === 'true'
};

// Test endpoints (READ-ONLY)
const ENDPOINTS = {
  adminOnly: [
    { path: '/api/v1/system', name: 'System Settings' },
    { path: '/api/v1/system/vector-count', name: 'Vector Count' },
  ],
  shared: [
    { path: '/api/v1/workspaces', name: 'Workspaces List' },
    { path: '/api/v1/openai/models', name: 'OpenAI Models' },
  ]
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  matrix: {},
  performance: {},
  bugs: [],
  securityGaps: [],
  startTime: Date.now(),
  endTime: null
};

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name, status, details = {}) {
  const statusSymbol = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  const statusColor = status === 'pass' ? 'green' : status === 'fail' ? 'red' : 'yellow';
  
  log(`${statusSymbol} ${status.toUpperCase()}: ${name}`, statusColor);
  
  if (details.expected) {
    log(`   Expected: ${details.expected}`, 'blue');
  }
  
  if (details.actual) {
    log(`   Actual: ${details.actual}`, details.actualColor || 'reset');
  }
  
  if (details.duration) {
    log(`   Duration: ${details.duration.toFixed(2)}ms`, 'cyan');
  }
  
  if (status === 'pass') results.passed++;
  else if (status === 'fail') results.failed++;
  else results.skipped++;
}

async function testEndpoint(endpoint, token, tokenType) {
  const start = performance.now();
  try {
    const response = await axios.get(`${CONFIG.baseUrl}${endpoint}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    const duration = performance.now() - start;
    
    // Track performance
    const perfKey = `${tokenType}_${endpoint}`;
    if (!results.performance[perfKey]) {
      results.performance[perfKey] = [];
    }
    results.performance[perfKey].push(duration);
    
    return { 
      success: true, 
      status: response.status, 
      duration,
      data: response.data 
    };
  } catch (error) {
    const duration = performance.now() - start;
    return { 
      success: false, 
      status: error.response?.status || 'ERROR',
      duration,
      error: error.message 
    };
  }
}

class AccessControlTestSuite {
  constructor() {
    this.adminJWT = null;
    this.adminApiKey = null;
  }

  async setup() {
    log('\n' + '='.repeat(70), 'cyan');
    log('AUTHENTICATION ACCESS CONTROL TEST SUITE', 'cyan');
    log('='.repeat(70) + '\n', 'cyan');
    
    log('Configuration:', 'blue');
    log(`  Base URL: ${CONFIG.baseUrl}`);
    log(`  Admin Username: ${CONFIG.adminUsername}`);
    log(`  Keystone JWT: ${CONFIG.keystoneJWT ? 'Provided ✓' : 'Not provided (will skip user tests)'}`);
    
    log('\n=== SETUP: Obtaining Admin Credentials ===\n', 'cyan');
    
    if (!CONFIG.adminPassword) {
      throw new Error('TEST_ADMIN_PASSWORD environment variable is required');
    }

    // Get admin JWT
    try {
      const response = await axios.post(`${CONFIG.baseUrl}/api/request-token`, {
        username: CONFIG.adminUsername,
        password: CONFIG.adminPassword
      });
      
      if (response.data.valid && response.data.token) {
        this.adminJWT = response.data.token;
        log('✅ Admin JWT obtained successfully', 'green');
      } else {
        throw new Error(`Failed to obtain admin JWT: ${response.data.message}`);
      }
    } catch (error) {
      throw new Error(`Error obtaining admin JWT: ${error.message}`);
    }

    // Get admin API key
    try {
      const response = await axios.post(
        `${CONFIG.baseUrl}/api/system/generate-api-key`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.adminJWT}`
          }
        }
      );
      
      if (response.data.apiKey) {
        this.adminApiKey = response.data.apiKey;
        log('✅ Admin API key obtained successfully', 'green');
      } else {
        throw new Error('Failed to obtain admin API key');
      }
    } catch (error) {
      throw new Error(`Error obtaining admin API key: ${error.message}`);
    }

    log('\n=== SETUP COMPLETE ===\n', 'cyan');
  }

  async testAdminOnlyEndpoints() {
    log('\n' + '='.repeat(70), 'magenta');
    log('TEST CATEGORY: ADMIN-ONLY ENDPOINTS', 'magenta');
    log('='.repeat(70) + '\n', 'magenta');
    
    log('Expected Behavior:', 'blue');
    log('  ✓ Admin API Key → 200 (Success)');
    log('  ✗ Admin JWT → 401 (Rejected)');
    log('  ✗ User Keystone JWT → 401 (Rejected)');
    log('  ✗ No Token → 401 (Rejected)\n');

    for (const endpoint of ENDPOINTS.adminOnly) {
      log(`\n--- Testing: ${endpoint.name} (${endpoint.path}) ---\n`, 'cyan');
      
      // Test 1: Admin API Key (should succeed)
      log('Test 1: Admin API Key', 'blue');
      const apiKeyResult = await testEndpoint(endpoint.path, this.adminApiKey, 'admin_apikey');
      const apiKeyPassed = apiKeyResult.success && apiKeyResult.status === 200;
      
      logTest(
        `Admin API Key on ${endpoint.name}`,
        apiKeyPassed ? 'pass' : 'fail',
        {
          expected: '200 (Access granted)',
          actual: `${apiKeyResult.status} (${apiKeyResult.success ? 'Success' : 'Failed'})`,
          actualColor: apiKeyPassed ? 'green' : 'red',
          duration: apiKeyResult.duration
        }
      );
      
      if (!apiKeyPassed) {
        results.bugs.push({
          test: `Admin API Key on ${endpoint.name}`,
          endpoint: endpoint.path,
          expected: '200',
          actual: apiKeyResult.status,
          error: apiKeyResult.error
        });
      }

      // Test 2: Admin JWT (should be rejected)
      log('\nTest 2: Admin Internal JWT', 'blue');
      const adminJWTResult = await testEndpoint(endpoint.path, this.adminJWT, 'admin_jwt');
      const adminJWTPassed = !adminJWTResult.success && adminJWTResult.status === 401;
      
      logTest(
        `Admin JWT rejected on ${endpoint.name}`,
        adminJWTPassed ? 'pass' : 'fail',
        {
          expected: '401 (Rejected)',
          actual: `${adminJWTResult.status} (${adminJWTResult.success ? 'Accepted' : 'Rejected'})`,
          actualColor: adminJWTPassed ? 'green' : 'red',
          duration: adminJWTResult.duration
        }
      );
      
      if (!adminJWTPassed) {
        results.securityGaps.push({
          issue: 'Admin JWT accepted on admin-only endpoint',
          endpoint: endpoint.path,
          severity: 'HIGH',
          expected: '401',
          actual: adminJWTResult.status
        });
      }

      // Test 3: User Keystone JWT (should be rejected)
      if (CONFIG.keystoneJWT) {
        log('\nTest 3: User Keystone JWT', 'blue');
        const keystoneResult = await testEndpoint(endpoint.path, CONFIG.keystoneJWT, 'keystone_jwt');
        const keystonePassed = !keystoneResult.success && keystoneResult.status === 401;
        
        logTest(
          `Keystone JWT rejected on ${endpoint.name}`,
          keystonePassed ? 'pass' : 'fail',
          {
            expected: '401 (Rejected)',
            actual: `${keystoneResult.status} (${keystoneResult.success ? 'Accepted' : 'Rejected'})`,
            actualColor: keystonePassed ? 'green' : 'red',
            duration: keystoneResult.duration
          }
        );
        
        if (!keystonePassed) {
          results.securityGaps.push({
            issue: 'Keystone JWT accepted on admin-only endpoint',
            endpoint: endpoint.path,
            severity: 'CRITICAL',
            expected: '401',
            actual: keystoneResult.status
          });
        }
      } else {
        log('\nTest 3: User Keystone JWT - SKIPPED (no token provided)', 'yellow');
        results.skipped++;
      }

      // Test 4: No token (should be rejected)
      log('\nTest 4: No Authorization Token', 'blue');
      const noTokenResult = await testEndpoint(endpoint.path, null, 'no_token');
      const noTokenPassed = !noTokenResult.success && noTokenResult.status === 401;
      
      logTest(
        `No token rejected on ${endpoint.name}`,
        noTokenPassed ? 'pass' : 'fail',
        {
          expected: '401 (Rejected)',
          actual: `${noTokenResult.status} (${noTokenResult.success ? 'Accepted' : 'Rejected'})`,
          actualColor: noTokenPassed ? 'green' : 'red',
          duration: noTokenResult.duration
        }
      );
    }
  }

  async testSharedEndpoints() {
    log('\n' + '='.repeat(70), 'magenta');
    log('TEST CATEGORY: SHARED ENDPOINTS (Admin + User)', 'magenta');
    log('='.repeat(70) + '\n', 'magenta');
    
    log('Expected Behavior:', 'blue');
    log('  ✓ Admin JWT → 200 (Success)');
    log('  ✓ User Keystone JWT → 200 (Success, scoped)');
    log('  ✗ Admin API Key → Variable (may work but not intended)');
    log('  ✗ No Token → 401 (Rejected)\n');

    for (const endpoint of ENDPOINTS.shared) {
      log(`\n--- Testing: ${endpoint.name} (${endpoint.path}) ---\n`, 'cyan');
      
      // Test 1: Admin JWT (should succeed)
      log('Test 1: Admin Internal JWT', 'blue');
      const adminJWTResult = await testEndpoint(endpoint.path, this.adminJWT, 'admin_jwt');
      const adminJWTPassed = adminJWTResult.success && adminJWTResult.status === 200;
      
      logTest(
        `Admin JWT on ${endpoint.name}`,
        adminJWTPassed ? 'pass' : 'fail',
        {
          expected: '200 (Access granted)',
          actual: `${adminJWTResult.status} (${adminJWTResult.success ? 'Success' : 'Failed'})`,
          actualColor: adminJWTPassed ? 'green' : 'red',
          duration: adminJWTResult.duration
        }
      );
      
      if (!adminJWTPassed) {
        results.bugs.push({
          test: `Admin JWT on ${endpoint.name}`,
          endpoint: endpoint.path,
          expected: '200',
          actual: adminJWTResult.status,
          error: adminJWTResult.error
        });
      }

      // Test 2: User Keystone JWT (should succeed with scoped data)
      if (CONFIG.keystoneJWT) {
        log('\nTest 2: User Keystone JWT', 'blue');
        const keystoneResult = await testEndpoint(endpoint.path, CONFIG.keystoneJWT, 'keystone_jwt');
        const keystonePassed = keystoneResult.success && keystoneResult.status === 200;
        
        logTest(
          `Keystone JWT on ${endpoint.name}`,
          keystonePassed ? 'pass' : 'fail',
          {
            expected: '200 (Access granted, scoped)',
            actual: `${keystoneResult.status} (${keystoneResult.success ? 'Success' : 'Failed'})`,
            actualColor: keystonePassed ? 'green' : 'red',
            duration: keystoneResult.duration
          }
        );
        
        if (!keystonePassed) {
          results.bugs.push({
            test: `Keystone JWT on ${endpoint.name}`,
            endpoint: endpoint.path,
            expected: '200',
            actual: keystoneResult.status,
            error: keystoneResult.error
          });
        }
      } else {
        log('\nTest 2: User Keystone JWT - SKIPPED (no token provided)', 'yellow');
        results.skipped++;
      }

      // Test 3: Admin API Key (should be rejected - not intended for shared endpoints)
      log('\nTest 3: Admin API Key', 'blue');
      const apiKeyResult = await testEndpoint(endpoint.path, this.adminApiKey, 'admin_apikey');
      const apiKeyPassed = !apiKeyResult.success && apiKeyResult.status === 401;
      
      logTest(
        `Admin API Key rejected on ${endpoint.name}`,
        apiKeyPassed ? 'pass' : 'fail',
        {
          expected: '401 (Rejected - API keys not for shared endpoints)',
          actual: `${apiKeyResult.status} (${apiKeyResult.success ? 'Accepted' : 'Rejected'})`,
          actualColor: apiKeyPassed ? 'green' : 'yellow',
          duration: apiKeyResult.duration
        }
      );
      
      // Note: This is informational, not necessarily a bug
      if (apiKeyResult.success) {
        log('   Note: API key worked but should use JWT for shared endpoints', 'yellow');
      }

      // Test 4: No token (should be rejected)
      log('\nTest 4: No Authorization Token', 'blue');
      const noTokenResult = await testEndpoint(endpoint.path, null, 'no_token');
      const noTokenPassed = !noTokenResult.success && noTokenResult.status === 401;
      
      logTest(
        `No token rejected on ${endpoint.name}`,
        noTokenPassed ? 'pass' : 'fail',
        {
          expected: '401 (Rejected)',
          actual: `${noTokenResult.status} (${noTokenResult.success ? 'Accepted' : 'Rejected'})`,
          actualColor: noTokenPassed ? 'green' : 'red',
          duration: noTokenResult.duration
        }
      );
    }
  }

  async testInvalidTokens() {
    log('\n' + '='.repeat(70), 'magenta');
    log('TEST CATEGORY: INVALID TOKEN HANDLING', 'magenta');
    log('='.repeat(70) + '\n', 'magenta');
    
    const testEndpoint = ENDPOINTS.shared[0].path; // Use first shared endpoint
    
    // Test 1: Invalid JWT format
    log('Test 1: Invalid JWT Format', 'blue');
    const invalidResult = await testEndpoint(testEndpoint, 'invalid.jwt.token', 'invalid_jwt');
    const invalidPassed = !invalidResult.success && invalidResult.status === 401;
    
    logTest(
      'Invalid JWT rejected',
      invalidPassed ? 'pass' : 'fail',
      {
        expected: '401 (Rejected)',
        actual: `${invalidResult.status}`,
        actualColor: invalidPassed ? 'green' : 'red'
      }
    );

    // Test 2: Malformed Authorization header
    log('\nTest 2: Malformed Authorization Header', 'blue');
    try {
      await axios.get(`${CONFIG.baseUrl}${testEndpoint}`, {
        headers: { 'Authorization': 'InvalidFormat' }
      });
      logTest('Malformed header rejected', 'fail', {
        expected: '401 (Rejected)',
        actual: '200 (Accepted)',
        actualColor: 'red'
      });
    } catch (error) {
      const passed = error.response && error.response.status === 401;
      logTest('Malformed header rejected', passed ? 'pass' : 'fail', {
        expected: '401 (Rejected)',
        actual: `${error.response?.status || 'ERROR'}`,
        actualColor: passed ? 'green' : 'red'
      });
    }
  }

  async runAll() {
    try {
      await this.setup();
      await this.testAdminOnlyEndpoints();
      await this.testSharedEndpoints();
      await this.testInvalidTokens();
    } catch (error) {
      log(`\n❌ Test suite failed: ${error.message}`, 'red');
      throw error;
    }
  }
}

function generateReport() {
  results.endTime = Date.now();
  const totalTime = ((results.endTime - results.startTime) / 1000).toFixed(2);
  
  log('\n\n' + '='.repeat(70), 'cyan');
  log('TEST RESULTS SUMMARY', 'cyan');
  log('='.repeat(70) + '\n', 'cyan');
  
  const total = results.passed + results.failed + results.skipped;
  log(`Total Tests: ${total}`, 'blue');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  log(`Skipped: ${results.skipped}`, 'yellow');
  
  const successRate = ((results.passed / (results.passed + results.failed || 1)) * 100).toFixed(2);
  log(`Success Rate: ${successRate}%`, successRate >= 90 ? 'green' : 'yellow');
  log(`Total Time: ${totalTime}s`, 'cyan');

  // Performance summary
  if (Object.keys(results.performance).length > 0) {
    log('\n' + '='.repeat(70), 'cyan');
    log('PERFORMANCE SUMMARY', 'cyan');
    log('='.repeat(70) + '\n', 'cyan');
    
    for (const [key, durations] of Object.entries(results.performance)) {
      if (durations.length > 0) {
        const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        log(`${key}: ${avg.toFixed(2)}ms avg`, 'blue');
      }
    }
  }

  // Bugs
  if (results.bugs.length > 0) {
    log('\n' + '='.repeat(70), 'cyan');
    log('BUGS DISCOVERED', 'cyan');
    log('='.repeat(70) + '\n', 'cyan');
    
    results.bugs.forEach((bug, index) => {
      log(`${index + 1}. ${bug.test}`, 'red');
      log(`   Endpoint: ${bug.endpoint}`);
      log(`   Expected: ${bug.expected}`);
      log(`   Actual: ${bug.actual}`);
      if (bug.error) log(`   Error: ${bug.error}`);
    });
  }

  // Security gaps
  if (results.securityGaps.length > 0) {
    log('\n' + '='.repeat(70), 'cyan');
    log('SECURITY GAPS', 'cyan');
    log('='.repeat(70) + '\n', 'cyan');
    
    results.securityGaps.forEach((gap, index) => {
      log(`${index + 1}. [${gap.severity}] ${gap.issue}`, 'red');
      log(`   Endpoint: ${gap.endpoint}`);
      log(`   Expected: ${gap.expected}`);
      log(`   Actual: ${gap.actual}`);
    });
  }

  // Save results
  const resultsPath = __dirname + '/test-results.json';
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  log(`\n✅ Test results saved to: ${resultsPath}`, 'green');
  
  // Save markdown report
  const mdReport = generateMarkdownReport();
  const mdPath = __dirname + '/TEST_RESULTS.md';
  fs.writeFileSync(mdPath, mdReport);
  log(`✅ Markdown report saved to: ${mdPath}`, 'green');
}

function generateMarkdownReport() {
  const totalTime = ((results.endTime - results.startTime) / 1000).toFixed(2);
  const total = results.passed + results.failed + results.skipped;
  const successRate = ((results.passed / (results.passed + results.failed || 1)) * 100).toFixed(2);
  
  let md = `# Authentication Access Control Test Results\n\n`;
  md += `**Date:** ${new Date().toISOString()}\n\n`;
  md += `**Duration:** ${totalTime}s\n\n`;
  
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Tests | ${total} |\n`;
  md += `| Passed | ${results.passed} |\n`;
  md += `| Failed | ${results.failed} |\n`;
  md += `| Skipped | ${results.skipped} |\n`;
  md += `| Success Rate | ${successRate}% |\n\n`;
  
  md += `## Test Matrix\n\n`;
  md += `### Admin-Only Endpoints\n\n`;
  md += `| Endpoint | Admin API Key | Admin JWT | User JWT | No Token |\n`;
  md += `|----------|--------------|-----------|----------|----------|\n`;
  md += `| Expected | ✅ 200 | ❌ 401 | ❌ 401 | ❌ 401 |\n\n`;
  
  md += `### Shared Endpoints\n\n`;
  md += `| Endpoint | Admin JWT | User JWT | Admin API Key | No Token |\n`;
  md += `|----------|-----------|----------|---------------|----------|\n`;
  md += `| Expected | ✅ 200 | ✅ 200 | ❌ 401 | ❌ 401 |\n\n`;
  
  if (results.bugs.length > 0) {
    md += `## Bugs Discovered\n\n`;
    results.bugs.forEach((bug, index) => {
      md += `${index + 1}. **${bug.test}**\n`;
      md += `   - Endpoint: ${bug.endpoint}\n`;
      md += `   - Expected: ${bug.expected}\n`;
      md += `   - Actual: ${bug.actual}\n`;
      if (bug.error) md += `   - Error: ${bug.error}\n`;
      md += `\n`;
    });
  }
  
  if (results.securityGaps.length > 0) {
    md += `## Security Gaps\n\n`;
    results.securityGaps.forEach((gap, index) => {
      md += `${index + 1}. **[${gap.severity}]** ${gap.issue}\n`;
      md += `   - Endpoint: ${gap.endpoint}\n`;
      md += `   - Expected: ${gap.expected}\n`;
      md += `   - Actual: ${gap.actual}\n\n`;
    });
  }
  
  return md;
}

// Main execution
async function main() {
  const suite = new AccessControlTestSuite();
  
  try {
    await suite.runAll();
    generateReport();
    
    log('\n' + '='.repeat(70), 'cyan');
    log('TEST SUITE COMPLETED', 'cyan');
    log('='.repeat(70) + '\n', 'cyan');
    
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    log(`\n❌ Test suite failed: ${error.message}`, 'red');
    if (CONFIG.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}

main();
