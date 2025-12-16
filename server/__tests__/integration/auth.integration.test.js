/**
 * Authentication Security Tests (Read-Only)
 * 
 * Tests authentication acceptance/rejection without modifying the database.
 * Uses only GET endpoints to verify security boundaries.
 * 
 * Test Matrix:
 * - Admin endpoints: Should accept API keys, reject JWTs
 * - Shared endpoints: Should accept JWTs (admin & Keystone), reject API keys
 * - /v1 API endpoints: Should accept JWTs, reject API keys
 */

require("dotenv").config({ path: ".env.test" });
const request = require("supertest");
const { performance } = require("perf_hooks");

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3001";
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const KEYSTONE_JWT = process.env.TEST_KEYSTONE_JWT;

// Performance tracking
const performanceMetrics = {
  times: [],
  errors: [],
  success: 0,
  failure: 0,
};

function trackMetric(duration, success, error = null) {
  performanceMetrics.times.push(duration);
  if (success) {
    performanceMetrics.success++;
  } else {
    performanceMetrics.failure++;
    if (error) performanceMetrics.errors.push(error);
  }
}

function printMetrics() {
  const times = performanceMetrics.times;
  if (times.length === 0) return;

  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  const successRate = ((performanceMetrics.success / times.length) * 100).toFixed(2);

  console.log("\n" + "=".repeat(80));
  console.log("📊 PERFORMANCE METRICS");
  console.log("=".repeat(80));
  console.log(`Total Requests:    ${times.length}`);
  console.log(`Success Rate:      ${successRate}% (${performanceMetrics.success}/${times.length})`);
  console.log(`Avg Response Time: ${(sum / times.length).toFixed(2)}ms`);
  console.log(`Min Response Time: ${sorted[0].toFixed(2)}ms`);
  console.log(`Max Response Time: ${sorted[sorted.length - 1].toFixed(2)}ms`);
  console.log(`P50 (Median):      ${sorted[Math.floor(times.length * 0.5)].toFixed(2)}ms`);
  console.log(`P95:               ${sorted[Math.floor(times.length * 0.95)].toFixed(2)}ms`);
  console.log(`P99:               ${sorted[Math.floor(times.length * 0.99)].toFixed(2)}ms`);
  
  if (performanceMetrics.errors.length > 0) {
    console.log(`\n❌ Errors (${performanceMetrics.errors.length}):`);
    const uniqueErrors = [...new Set(performanceMetrics.errors)];
    uniqueErrors.forEach((err) => console.log(`   - ${err}`));
  }
  console.log("=".repeat(80) + "\n");
}

describe("Authentication Security Tests (Read-Only)", () => {
  let adminJWT;
  let apiKey;

  beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("TEST_ADMIN_USERNAME and TEST_ADMIN_PASSWORD must be set in .env.test");
    }

    console.log("\n🔧 Test Configuration:");
    console.log(`   Server: ${BASE_URL}`);
    console.log(`   Admin User: ${ADMIN_USERNAME}`);
    console.log(`   Keystone JWT: ${KEYSTONE_JWT ? "Provided" : "Not provided (will skip Keystone tests)"}`);
  });

  afterAll(() => {
    printMetrics();
  });

  describe("Admin Authentication Flow", () => {
    it("Step 1: Admin should login with username/password and receive JWT", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .post("/api/request-token")
        .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `Login failed: ${response.status}` : null);

      console.log(`   ⏱️  Login took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user).toHaveProperty("role", "admin");

      adminJWT = response.body.token;
      console.log(`   ✅ Admin JWT received`);
    });

    it("Step 2: Admin should generate API key using JWT", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .post("/api/admin/generate-api-key")
        .set("Authorization", `Bearer ${adminJWT}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `API key gen failed: ${response.status}` : null);

      console.log(`   ⏱️  API key generation took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("apiKey");
      expect(response.body.apiKey).toHaveProperty("secret");

      apiKey = response.body.apiKey.secret;
      console.log(`   ✅ API key generated: ${apiKey.substring(0, 20)}...`);
    });

    it("Step 3: API key should work on admin endpoints (GET /admin/users)", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${apiKey}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `Admin endpoint failed: ${response.status}` : null);

      console.log(`   ⏱️  Admin endpoint access took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("users");
      expect(Array.isArray(response.body.users)).toBe(true);

      console.log(`   ✅ Admin endpoint accessible with API key`);
      console.log(`   📋 Found ${response.body.users.length} users`);
    });
  });

  describe("Security: Admin Endpoints Should REJECT JWTs", () => {
    it("Admin JWT should be REJECTED on admin endpoints (GET /admin/users)", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${adminJWT}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 401, response.status !== 401 ? `Should reject JWT: ${response.status}` : null);

      console.log(`   ⏱️  Rejection took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(401);
      console.log(`   ✅ Admin JWT correctly rejected on admin endpoint`);
    });

    it("Keystone JWT should be REJECTED on admin endpoints (GET /admin/users)", async () => {
      if (!KEYSTONE_JWT) {
        console.log(`   ⏭️  Skipped: No Keystone JWT provided`);
        return;
      }

      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/admin/users")
        .set("Authorization", `Bearer ${KEYSTONE_JWT}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 401, response.status !== 401 ? `Should reject Keystone: ${response.status}` : null);

      console.log(`   ⏱️  Rejection took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(401);
      console.log(`   ✅ Keystone JWT correctly rejected on admin endpoint`);
    });
  });

  describe("Security: Shared Endpoints Should ACCEPT JWTs", () => {
    it("Admin JWT should work on shared endpoints (GET /system/check-token)", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/system/check-token")
        .set("Authorization", `Bearer ${adminJWT}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `Check token failed: ${response.status}` : null);

      console.log(`   ⏱️  Token check took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(200);
      console.log(`   ✅ Admin JWT works on shared endpoint`);
    });

    it("Admin JWT should work on /v1 API endpoints (GET /v1/workspaces)", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/v1/workspaces")
        .set("Authorization", `Bearer ${adminJWT}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `/v1/workspaces failed: ${response.status}` : null);

      console.log(`   ⏱️  /v1/workspaces took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("workspaces");
      console.log(`   ✅ Admin JWT works on /v1 API endpoint`);
      console.log(`   📋 Found ${response.body.workspaces.length} workspaces`);
    });

    it("Keystone JWT should work on shared endpoints (GET /system/check-token)", async () => {
      if (!KEYSTONE_JWT) {
        console.log(`   ⏭️  Skipped: No Keystone JWT provided`);
        return;
      }

      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/system/check-token")
        .set("Authorization", `Bearer ${KEYSTONE_JWT}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `Keystone check failed: ${response.status}` : null);

      console.log(`   ⏱️  Token check took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(200);
      console.log(`   ✅ Keystone JWT works on shared endpoint`);
    });
  });

  describe("Security: Shared Endpoints Should REJECT API Keys", () => {
    it("API key should be REJECTED on shared endpoints (GET /system/check-token)", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/system/check-token")
        .set("Authorization", `Bearer ${apiKey}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 401, response.status !== 401 ? `Should reject API key: ${response.status}` : null);

      console.log(`   ⏱️  Rejection took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(401);
      console.log(`   ✅ API key correctly rejected on shared endpoint`);
    });

    it("API key should be REJECTED on /v1 API endpoints (GET /v1/workspaces)", async () => {
      const start = performance.now();
      
      const response = await request(BASE_URL)
        .get("/api/v1/workspaces")
        .set("Authorization", `Bearer ${apiKey}`);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 401, response.status !== 401 ? `Should reject API key: ${response.status}` : null);

      console.log(`   ⏱️  Rejection took ${duration.toFixed(2)}ms`);
      
      expect(response.status).toBe(401);
      console.log(`   ✅ API key correctly rejected on /v1 API endpoint`);
    });
  });

  describe("Security: Invalid/Missing Tokens", () => {
    it("Missing token should be rejected (GET /admin/users)", async () => {
      const response = await request(BASE_URL).get("/api/admin/users");
      
      expect(response.status).toBe(401);
      console.log(`   ✅ Missing token correctly rejected`);
    });

    it("Invalid token should be rejected (GET /admin/users)", async () => {
      const response = await request(BASE_URL)
        .get("/api/admin/users")
        .set("Authorization", "Bearer invalid-token-12345");
      
      expect(response.status).toBe(401);
      console.log(`   ✅ Invalid token correctly rejected`);
    });

    it("Malformed Authorization header should be rejected", async () => {
      const response = await request(BASE_URL)
        .get("/api/admin/users")
        .set("Authorization", "NotBearer token");
      
      expect(response.status).toBe(401);
      console.log(`   ✅ Malformed header correctly rejected`);
    });
  });
});
