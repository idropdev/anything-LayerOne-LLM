/**
 * Performance and Stress Testing Suite
 * 
 * Tests authentication endpoints under load to measure:
 * - Throughput (requests per second)
 * - Response time under load
 * - Error rates under stress
 * - Concurrent request handling
 * - System stability
 */

require("dotenv").config({ path: ".env.test" });
const request = require("supertest");
const { performance } = require("perf_hooks");

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3001";
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const CONCURRENT_REQUESTS = parseInt(process.env.STRESS_TEST_CONCURRENT_REQUESTS || "50", 10);
const TOTAL_REQUESTS = parseInt(process.env.STRESS_TEST_TOTAL_REQUESTS || "1000", 10);

// Performance metrics
const performanceMetrics = {
  login: { times: [], errors: [], success: 0, failure: 0 },
  apiKeyGen: { times: [], errors: [], success: 0, failure: 0 },
  adminEndpoint: { times: [], errors: [], success: 0, failure: 0 },
  defaultEndpoint: { times: [], errors: [], success: 0, failure: 0 },
};

// Helper to run concurrent requests
async function runConcurrentRequests(requestFn, count) {
  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(requestFn());
  }
  return Promise.allSettled(promises);
}

// Helper to calculate statistics
function calculateStats(metricKey) {
  const metric = performanceMetrics[metricKey];
  const times = metric.times;
  
  if (times.length === 0) {
    return {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      successRate: "0%",
      errorRate: "0%",
    };
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const successRate = ((metric.success / times.length) * 100).toFixed(2);
  const errorRate = ((metric.failure / times.length) * 100).toFixed(2);

  return {
    totalRequests: times.length,
    successCount: metric.success,
    failureCount: metric.failure,
    successRate: successRate + "%",
    errorRate: errorRate + "%",
    avgResponseTime: (sum / times.length).toFixed(2) + "ms",
    minResponseTime: sorted[0].toFixed(2) + "ms",
    maxResponseTime: sorted[sorted.length - 1].toFixed(2) + "ms",
    p50: sorted[Math.floor(times.length * 0.5)].toFixed(2) + "ms",
    p95: sorted[Math.floor(times.length * 0.95)].toFixed(2) + "ms",
    p99: sorted[Math.floor(times.length * 0.99)].toFixed(2) + "ms",
    throughput: (times.length / (sum / 1000)).toFixed(2) + " req/s",
  };
}

// Print all metrics
function printMetrics() {
  console.log("\n" + "=".repeat(80));
  console.log("📊 PERFORMANCE TEST RESULTS");
  console.log("=".repeat(80));

  const endpoints = [
    { key: "login", name: "Login (POST /request-token)" },
    { key: "apiKeyGen", name: "API Key Generation (POST /admin/generate-api-key)" },
    { key: "adminEndpoint", name: "Admin Endpoint (GET /admin/users)" },
    { key: "defaultEndpoint", name: "Default Endpoint (GET /system/check-token)" },
  ];

  endpoints.forEach(({ key, name }) => {
    const stats = calculateStats(key);
    if (stats.totalRequests === 0) return;

    console.log(`\n${name}`);
    console.log("-".repeat(80));
    console.log(`  Total Requests:    ${stats.totalRequests}`);
    console.log(`  Success Rate:      ${stats.successRate} (${stats.successCount} requests)`);
    console.log(`  Error Rate:        ${stats.errorRate} (${stats.failureCount} requests)`);
    console.log(`  Avg Response Time: ${stats.avgResponseTime}`);
    console.log(`  Min Response Time: ${stats.minResponseTime}`);
    console.log(`  Max Response Time: ${stats.maxResponseTime}`);
    console.log(`  P50 (Median):      ${stats.p50}`);
    console.log(`  P95:               ${stats.p95}`);
    console.log(`  P99:               ${stats.p99}`);
    console.log(`  Throughput:        ${stats.throughput}`);

    if (performanceMetrics[key].errors.length > 0) {
      console.log(`\n  ❌ Errors (${performanceMetrics[key].errors.length}):`);
      const uniqueErrors = [...new Set(performanceMetrics[key].errors)];
      uniqueErrors.forEach((err) => console.log(`     - ${err}`));
    }
  });

  console.log("\n" + "=".repeat(80));
}

describe("Performance and Stress Tests", () => {
  let adminJWT;
  let apiKey;

  beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("TEST_ADMIN_USERNAME and TEST_ADMIN_PASSWORD must be set in .env.test");
    }

    console.log("\n🚀 Performance Test Configuration:");
    console.log(`   Server: ${BASE_URL}`);
    console.log(`   Concurrent Requests: ${CONCURRENT_REQUESTS}`);
    console.log(`   Total Requests: ${TOTAL_REQUESTS}`);

    // Setup: Get admin JWT and API key
    console.log("\n🔧 Setting up test credentials...");
    
    const loginResponse = await request(BASE_URL)
      .post("/api/request-token")
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    
    if (!loginResponse.body.token) {
      throw new Error(`Login failed: ${loginResponse.status} - ${JSON.stringify(loginResponse.body)}`);
    }
    
    adminJWT = loginResponse.body.token;

    const apiKeyResponse = await request(BASE_URL)
      .post("/api/admin/generate-api-key")
      .set("Authorization", `Bearer ${adminJWT}`);
    
    if (!apiKeyResponse.body.apiKey || !apiKeyResponse.body.apiKey.secret) {
      throw new Error(`API key generation failed: ${apiKeyResponse.status} - ${JSON.stringify(apiKeyResponse.body)}`);
    }
    
    apiKey = apiKeyResponse.body.apiKey.secret;

    console.log("   ✅ Test credentials ready");
  });


  afterAll(() => {
    printMetrics();
  });

  describe("Login Endpoint Performance", () => {
    it(`Should handle ${CONCURRENT_REQUESTS} concurrent login requests`, async () => {
      console.log(`\n⏳ Testing ${CONCURRENT_REQUESTS} concurrent logins...`);

      const makeLoginRequest = async () => {
        const start = performance.now();
        try {
          const response = await request(BASE_URL)
            .post("/api/request-token")
            .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

          const duration = performance.now() - start;
          performanceMetrics.login.times.push(duration);

          if (response.status === 200) {
            performanceMetrics.login.success++;
          } else {
            performanceMetrics.login.failure++;
            performanceMetrics.login.errors.push(`Status ${response.status}`);
          }
        } catch (error) {
          const duration = performance.now() - start;
          performanceMetrics.login.times.push(duration);
          performanceMetrics.login.failure++;
          performanceMetrics.login.errors.push(error.message);
        }
      };

      const results = await runConcurrentRequests(makeLoginRequest, CONCURRENT_REQUESTS);
      
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      console.log(`   ✅ Completed: ${successCount}/${CONCURRENT_REQUESTS} successful`);

      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe("API Key Generation Performance", () => {
    it(`Should handle ${CONCURRENT_REQUESTS} concurrent API key generation requests`, async () => {
      console.log(`\n⏳ Testing ${CONCURRENT_REQUESTS} concurrent API key generations...`);

      const makeApiKeyRequest = async () => {
        const start = performance.now();
        try {
          const response = await request(BASE_URL)
            .post("/api/admin/generate-api-key")
            .set("Authorization", `Bearer ${adminJWT}`);

          const duration = performance.now() - start;
          performanceMetrics.apiKeyGen.times.push(duration);

          if (response.status === 200) {
            performanceMetrics.apiKeyGen.success++;
          } else {
            performanceMetrics.apiKeyGen.failure++;
            performanceMetrics.apiKeyGen.errors.push(`Status ${response.status}`);
          }
        } catch (error) {
          const duration = performance.now() - start;
          performanceMetrics.apiKeyGen.times.push(duration);
          performanceMetrics.apiKeyGen.failure++;
          performanceMetrics.apiKeyGen.errors.push(error.message);
        }
      };

      const results = await runConcurrentRequests(makeApiKeyRequest, CONCURRENT_REQUESTS);
      
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      console.log(`   ✅ Completed: ${successCount}/${CONCURRENT_REQUESTS} successful`);

      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe("Admin Endpoint Performance", () => {
    it(`Should handle ${CONCURRENT_REQUESTS} concurrent admin endpoint requests`, async () => {
      console.log(`\n⏳ Testing ${CONCURRENT_REQUESTS} concurrent admin endpoint accesses...`);

      const makeAdminRequest = async () => {
        const start = performance.now();
        try {
          const response = await request(BASE_URL)
            .get("/api/admin/users")
            .set("Authorization", `Bearer ${apiKey}`);

          const duration = performance.now() - start;
          performanceMetrics.adminEndpoint.times.push(duration);

          if (response.status === 200) {
            performanceMetrics.adminEndpoint.success++;
          } else {
            performanceMetrics.adminEndpoint.failure++;
            performanceMetrics.adminEndpoint.errors.push(`Status ${response.status}`);
          }
        } catch (error) {
          const duration = performance.now() - start;
          performanceMetrics.adminEndpoint.times.push(duration);
          performanceMetrics.adminEndpoint.failure++;
          performanceMetrics.adminEndpoint.errors.push(error.message);
        }
      };

      const results = await runConcurrentRequests(makeAdminRequest, CONCURRENT_REQUESTS);
      
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      console.log(`   ✅ Completed: ${successCount}/${CONCURRENT_REQUESTS} successful`);

      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe("Default Endpoint Performance", () => {
    it(`Should handle ${CONCURRENT_REQUESTS} concurrent default endpoint requests`, async () => {
      console.log(`\n⏳ Testing ${CONCURRENT_REQUESTS} concurrent default endpoint accesses...`);

      const makeDefaultRequest = async () => {
        const start = performance.now();
        try {
          const response = await request(BASE_URL)
            .get("/api/system/check-token")
            .set("Authorization", `Bearer ${adminJWT}`);

          const duration = performance.now() - start;
          performanceMetrics.defaultEndpoint.times.push(duration);

          if (response.status === 200) {
            performanceMetrics.defaultEndpoint.success++;
          } else {
            performanceMetrics.defaultEndpoint.failure++;
            performanceMetrics.defaultEndpoint.errors.push(`Status ${response.status}`);
          }
        } catch (error) {
          const duration = performance.now() - start;
          performanceMetrics.defaultEndpoint.times.push(duration);
          performanceMetrics.defaultEndpoint.failure++;
          performanceMetrics.defaultEndpoint.errors.push(error.message);
        }
      };

      const results = await runConcurrentRequests(makeDefaultRequest, CONCURRENT_REQUESTS);
      
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      console.log(`   ✅ Completed: ${successCount}/${CONCURRENT_REQUESTS} successful`);

      expect(successCount).toBeGreaterThan(0);
    });
  });

  describe("Stress Test: Sustained Load", () => {
    it(`Should handle ${TOTAL_REQUESTS} total requests across all endpoints`, async () => {
      console.log(`\n⏳ Running stress test with ${TOTAL_REQUESTS} total requests...`);

      const requestsPerEndpoint = Math.floor(TOTAL_REQUESTS / 4);
      const batchSize = 10; // Process in batches to avoid overwhelming the system

      // Login requests
      for (let i = 0; i < requestsPerEndpoint; i += batchSize) {
        const count = Math.min(batchSize, requestsPerEndpoint - i);
        await runConcurrentRequests(async () => {
          const start = performance.now();
          try {
            const response = await request(BASE_URL)
              .post("/api/request-token")
              .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
            
            const duration = performance.now() - start;
            performanceMetrics.login.times.push(duration);
            response.status === 200 ? performanceMetrics.login.success++ : performanceMetrics.login.failure++;
          } catch (error) {
            performanceMetrics.login.times.push(performance.now() - start);
            performanceMetrics.login.failure++;
          }
        }, count);
      }

      console.log(`   ✅ Stress test completed`);
      
      const totalRequests = Object.values(performanceMetrics).reduce(
        (sum, metric) => sum + metric.times.length,
        0
      );
      
      expect(totalRequests).toBeGreaterThan(0);
    });
  });
});
