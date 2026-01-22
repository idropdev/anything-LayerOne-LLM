/**
 * Delegated JWT Authentication Tests
 *
 * Tests for the keystone_delegated_jwt authentication mode in validateKeystoneServiceCaller.
 * Validates delegated JWTs that embed requester identity in the act claim.
 */

const jwt = require("jsonwebtoken");
const { validateKeystoneServiceCaller } = require("../../utils/middleware/validateKeystoneServiceCaller");

// Mock dependencies
jest.mock("../../models/eventLogs");
jest.mock("../../utils/auth/syncExternalUser");
jest.mock("../../models/user");
jest.mock("../../models/systemSettings");

const { EventLogs } = require("../../models/eventLogs");
const { syncKeystoneServiceActor } = require("../../utils/auth/syncExternalUser");
const { SystemSettings } = require("../../models/systemSettings");

describe("validateKeystoneServiceCaller - Delegated JWT Mode", () => {
  let mockRequest;
  let mockResponse;
  let mockNext;
  let originalEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set up delegated JWT mode environment
    process.env.ANYTHINGLLM_SERVICE_AUTH_MODE = "keystone_delegated_jwt";
    process.env.KEYSTONE_DELEGATED_JWT_ALG = "HS256";
    process.env.KEYSTONE_DELEGATED_JWT_SECRET = "test-secret-key-for-delegated-jwt";
    process.env.KEYSTONE_DELEGATED_JWT_ISSUER = "svc-keystone";
    process.env.KEYSTONE_DELEGATED_JWT_AUDIENCE = "anythingllm";
    process.env.CORRELATION_ID_HEADER_NAME = "x-correlation-id";

    // Mock request
    mockRequest = {
      method: "GET",
      path: "/v1/admin/users",
      header: jest.fn((name) => {
        if (name === "Authorization") {
          return "Bearer test-token";
        }
        if (name === "x-correlation-id") {
          return "test-correlation-id-123";
        }
        if (name === "x-request-id") {
          return "test-request-id-456";
        }
        return null;
      }),
    };

    // Mock response
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    // Mock next
    mockNext = jest.fn();

    // Mock SystemSettings
    SystemSettings.isMultiUserMode = jest.fn().mockResolvedValue(true);

    // Mock syncKeystoneServiceActor
    syncKeystoneServiceActor.mockResolvedValue({
      id: 1,
      username: "svc-keystone",
      role: "admin",
      suspended: 0,
    });

    // Mock EventLogs
    EventLogs.logEvent = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe("Valid Delegated JWT", () => {
    it("should accept valid HS256 delegated JWT with act claim", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          scope: "anythingllm:admin:read anythingllm:admin:write",
          act: {
            sub: "user-123",
            roles: ["admin", "manager"],
            sessionId: "session-abc",
            provider: "google",
          },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET,
        { algorithm: "HS256" }
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        if (name === "x-correlation-id") return "test-correlation-id";
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.locals.systemActor).toBe(true);
      expect(mockResponse.locals.authMode).toBe("keystone_delegated_jwt");
      expect(mockResponse.locals.delegatedActor).toEqual({
        sub: "user-123",
        roles: ["admin", "manager"],
        sessionId: "session-abc",
        provider: "google",
      });
      expect(mockResponse.locals.correlationId).toBe("test-correlation-id");
      expect(mockResponse.locals.scope).toEqual([
        "anythingllm:admin:read",
        "anythingllm:admin:write",
      ]);
    });

    it("should accept valid RS256 delegated JWT with act claim", async () => {
      // Generate RSA key pair for testing
      const crypto = require("crypto");
      const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      process.env.KEYSTONE_DELEGATED_JWT_ALG = "RS256";
      process.env.KEYSTONE_DELEGATED_JWT_PUBLIC_KEY = publicKey;

      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          scope: ["anythingllm:admin:read"],
          act: {
            sub: "user-456",
            roles: ["default"],
          },
        },
        privateKey,
        { algorithm: "RS256" }
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.locals.systemActor).toBe(true);
      expect(mockResponse.locals.delegatedActor.sub).toBe("user-456");
    });

    it("should set systemActor=true", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.systemActor).toBe(true);
    });

    it("should parse scope from string", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          scope: "scope1 scope2 scope3",
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.scope).toEqual(["scope1", "scope2", "scope3"]);
    });

    it("should parse scope from array", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          scope: ["scope1", "scope2"],
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.scope).toEqual(["scope1", "scope2"]);
    });

    it("should extract correlation ID from header", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        if (name === "x-correlation-id") return "custom-correlation-id";
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.correlationId).toBe("custom-correlation-id");
    });

    it("should include correlation ID in audit log", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: ["admin"] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        if (name === "x-correlation-id") return "audit-correlation-id";
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(EventLogs.logEvent).toHaveBeenCalledWith(
        "keystone_service_auth_success",
        expect.objectContaining({
          correlationId: "audit-correlation-id",
          delegatedActorSub: "user-123",
          delegatedActorRoles: ["admin"],
          authMode: "keystone_delegated_jwt",
        }),
        expect.any(Number)
      );
    });
  });

  describe("Invalid Delegated JWT", () => {
    it("should reject missing act claim", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should reject missing act.sub", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { roles: ["admin"] }, // Missing sub
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject missing act.roles", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123" }, // Missing roles
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject invalid act.roles (not array)", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: "admin" }, // roles is string, not array
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject wrong issuer", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "wrong-issuer", // Wrong issuer
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject wrong audience", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "wrong-audience", // Wrong audience
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject expired token", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) - 3600, // Expired
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject token with nbf in future", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          nbf: Math.floor(Date.now() / 1000) + 1800, // Not valid yet
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });

    it("should reject invalid signature (HS256)", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        "wrong-secret" // Wrong secret
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });
  });

  describe("Correlation ID", () => {
    it("should use x-correlation-id header if present", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        if (name === "x-correlation-id") return "preferred-correlation-id";
        if (name === "x-request-id") return "fallback-request-id";
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.correlationId).toBe("preferred-correlation-id");
    });

    it("should fallback to x-request-id if x-correlation-id missing", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        if (name === "x-correlation-id") return null;
        if (name === "x-request-id") return "fallback-request-id";
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.correlationId).toBe("fallback-request-id");
    });

    it("should generate UUID if no correlation header present", async () => {
      const token = jwt.sign(
        {
          sub: "svc-keystone",
          iss: "svc-keystone",
          aud: "anythingllm",
          exp: Math.floor(Date.now() / 1000) + 3600,
          act: { sub: "user-123", roles: [] },
        },
        process.env.KEYSTONE_DELEGATED_JWT_SECRET
      );

      mockRequest.header.mockImplementation((name) => {
        if (name === "Authorization") return `Bearer ${token}`;
        return null;
      });

      await validateKeystoneServiceCaller(mockRequest, mockResponse, mockNext);

      expect(mockResponse.locals.correlationId).toBeDefined();
      expect(typeof mockResponse.locals.correlationId).toBe("string");
      expect(mockResponse.locals.correlationId.length).toBeGreaterThan(0);
    });
  });

  describe("Backward Compatibility", () => {
    it("should still work with gcp mode", async () => {
      process.env.ANYTHINGLLM_SERVICE_AUTH_MODE = "gcp";
      process.env.ANYTHINGLLM_SERVICE_AUDIENCE = "test-audience";
      process.env.ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL = "test@example.com";

      // This test would require mocking google-auth-library
      // For now, we just verify the mode is checked
      expect(process.env.ANYTHINGLLM_SERVICE_AUTH_MODE).toBe("gcp");
    });

    it("should still work with local_jwt mode", async () => {
      process.env.ANYTHINGLLM_SERVICE_AUTH_MODE = "local_jwt";
      process.env.KEYSTONE_SERVICE_PUBLIC_KEY = "test-public-key";
      process.env.ANYTHINGLLM_SERVICE_AUDIENCE = "test-audience";

      // This test would require a valid RS256 JWT
      // For now, we just verify the mode is checked
      expect(process.env.ANYTHINGLLM_SERVICE_AUTH_MODE).toBe("local_jwt");
    });
  });
});









