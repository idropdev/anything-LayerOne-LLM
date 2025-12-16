/**
 * Authentication Middleware Tests
 * 
 * Tests the authentication matrix for admin and default user endpoints:
 * - API keys for admin endpoints
 * - Internal admin JWTs for default endpoints
 * - External Keystone JWTs for default endpoints
 * 
 * Test Matrix:
 * | Auth Method                 | Admin Endpoint | Default Endpoint |
 * |-----------------------------|----------------|------------------|
 * | API Key                     | ✅ 200 OK      | ❌ 401           |
 * | Admin JWT                   | ❌ 401         | ✅ 200 OK        |
 * | Keystone JWT (default user) | ❌ 401         | ✅ 200 OK        |
 * | Invalid/Missing Token       | ❌ 401         | ❌ 401           |
 */

const request = require("supertest");
const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { ApiKey } = require("../../models/apiKeys");
const JWT = require("jsonwebtoken");

// Mock the app - you'll need to import your actual Express app
// For now, this is a placeholder structure
let app;

beforeAll(async () => {
  // Setup: Enable multi-user mode and external auth
  // This would typically be done in a test setup file
  // app = require("../../index"); // Import your Express app
});

afterAll(async () => {
  // Cleanup: Reset test database, close connections, etc.
});

describe("Authentication Matrix Tests", () => {
  let adminUser;
  let defaultUser;
  let apiKey;
  let adminJWT;
  let keystoneJWT;

  beforeEach(async () => {
    // Create test admin user
    adminUser = await User.create({
      username: "test-admin",
      password: "admin-password",
      role: "admin",
    });

    // Create test default user
    defaultUser = await User.create({
      username: "test-user",
      password: "user-password",
      role: "default",
    });

    // Generate API key for admin
    const apiKeyResult = await ApiKey.create(adminUser.user.id);
    apiKey = apiKeyResult.apiKey.secret;

    // Generate internal admin JWT
    adminJWT = JWT.sign(
      {
        id: adminUser.user.id,
        username: adminUser.user.username,
        role: "admin",
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    // Mock Keystone JWT (this would come from Keystone API in real scenario)
    // For testing, we'll create a JWT that looks like a Keystone token
    keystoneJWT = "mock-keystone-jwt-token";
  });

  afterEach(async () => {
    // Cleanup test data
    await User.delete({ id: adminUser.user.id });
    await User.delete({ id: defaultUser.user.id });
    await ApiKey.delete({ secret: apiKey });
  });

  describe("Admin Endpoint: GET /admin/users", () => {
    const adminEndpoint = "/admin/users";

    it("should return 200 OK with valid API key", async () => {
      const response = await request(app)
        .get(adminEndpoint)
        .set("Authorization", `Bearer ${apiKey}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("users");
    });

    it("should return 401 Unauthorized with admin JWT", async () => {
      const response = await request(app)
        .get(adminEndpoint)
        .set("Authorization", `Bearer ${adminJWT}`);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 401 Unauthorized with Keystone JWT", async () => {
      const response = await request(app)
        .get(adminEndpoint)
        .set("Authorization", `Bearer ${keystoneJWT}`);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 401 Unauthorized with invalid API key", async () => {
      const response = await request(app)
        .get(adminEndpoint)
        .set("Authorization", "Bearer invalid-api-key");

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 401 Unauthorized with missing token", async () => {
      const response = await request(app).get(adminEndpoint);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("Default Endpoint: GET /system/check-token", () => {
    const defaultEndpoint = "/system/check-token";

    it("should return 401 Unauthorized with API key", async () => {
      // API keys are admin-only, not for default endpoints
      const response = await request(app)
        .get(defaultEndpoint)
        .set("Authorization", `Bearer ${apiKey}`);

      expect(response.status).toBe(401);
    });

    it("should return 200 OK with admin JWT", async () => {
      const response = await request(app)
        .get(defaultEndpoint)
        .set("Authorization", `Bearer ${adminJWT}`);

      expect(response.status).toBe(200);
    });

    it("should return 200 OK with Keystone JWT", async () => {
      // Note: This test requires mocking the Keystone introspection endpoint
      // In a real test, you'd mock the fetch call to Keystone API
      const response = await request(app)
        .get(defaultEndpoint)
        .set("Authorization", `Bearer ${keystoneJWT}`);

      expect(response.status).toBe(200);
    });

    it("should return 401 Unauthorized with invalid token", async () => {
      const response = await request(app)
        .get(defaultEndpoint)
        .set("Authorization", "Bearer invalid-token");

      expect(response.status).toBe(401);
    });

    it("should return 401 Unauthorized with missing token", async () => {
      const response = await request(app).get(defaultEndpoint);

      expect(response.status).toBe(401);
    });
  });

  describe("API Key Generation: POST /admin/generate-api-key", () => {
    const generateEndpoint = "/admin/generate-api-key";

    it("should return 200 OK with admin JWT", async () => {
      const response = await request(app)
        .post(generateEndpoint)
        .set("Authorization", `Bearer ${adminJWT}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("apiKey");
    });

    it("should return 401 Unauthorized with API key", async () => {
      // API key generation requires JWT, not API key
      const response = await request(app)
        .post(generateEndpoint)
        .set("Authorization", `Bearer ${apiKey}`);

      expect(response.status).toBe(401);
    });

    it("should return 401 Unauthorized with Keystone JWT", async () => {
      const response = await request(app)
        .post(generateEndpoint)
        .set("Authorization", `Bearer ${keystoneJWT}`);

      expect(response.status).toBe(401);
    });

    it("should return 401 Unauthorized with missing token", async () => {
      const response = await request(app).post(generateEndpoint);

      expect(response.status).toBe(401);
    });
  });
});
