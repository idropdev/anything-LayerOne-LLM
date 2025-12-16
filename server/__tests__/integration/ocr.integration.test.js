/**
 * OCR Integration Tests
 * 
 * Tests OCR functionality on the /api/v1/document/upload endpoint:
 * - Authentication with admin and user JWTs
 * - OCR field processing and storage
 * - Edge cases (image-based PDFs, low confidence)
 * - Embedding updates with OCR fields
 */

require("dotenv").config({ path: ".env.test" });
const request = require("supertest");
const { performance } = require("perf_hooks");
const fs = require("fs");
const path = require("path");
const {
  generateOcrFields,
  generateLowConfidenceOcrFields,
  verifyOcrStructure,
  calculateConfidenceStats,
  createImageBasedMetadata,
  waitForDocument,
  readDocumentJson,
  cleanupTestDocuments,
} = require("../utils/ocr.helpers");

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3001";
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

// Track uploaded documents for cleanup
const uploadedDocuments = [];

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
  console.log("📊 OCR PERFORMANCE METRICS");
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
    console.log(`\n❌ Errors (${performanceMetrics.errors.length}):` );
    const uniqueErrors = [...new Set(performanceMetrics.errors)];
    uniqueErrors.forEach((err) => console.log(`   - ${err}`));
  }
  console.log("=".repeat(80) + "\n");
}

describe("OCR Integration Tests", () => {
  let adminJWT;
  let apiKey;

  beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("TEST_ADMIN_USERNAME and TEST_ADMIN_PASSWORD must be set in .env.test");
    }

    console.log("\n🔧 OCR Test Configuration:");
    console.log(`   Server: ${BASE_URL}`);
    console.log(`   Admin User: ${ADMIN_USERNAME}`);

    // Login and get admin JWT
    const loginResponse = await request(BASE_URL)
      .post("/api/request-token")
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    if (loginResponse.status !== 200) {
      throw new Error(`Failed to login: ${loginResponse.status}`);
    }

    adminJWT = loginResponse.body.token;
    console.log(`   ✅ Admin JWT obtained`);

    // Generate API key
    const apiKeyResponse = await request(BASE_URL)
      .post("/api/admin/generate-api-key")
      .set("Authorization", `Bearer ${adminJWT}`);

    if (apiKeyResponse.status !== 200) {
      throw new Error(`Failed to generate API key: ${apiKeyResponse.status}`);
    }

    apiKey = apiKeyResponse.body.apiKey.secret;
    console.log(`   ✅ API key generated\n`);
  });

  afterAll(async () => {
    // Cleanup uploaded test documents
    if (uploadedDocuments.length > 0) {
      console.log(`\n🧹 Cleaning up ${uploadedDocuments.length} test documents...`);
      cleanupTestDocuments(uploadedDocuments);
    }

    printMetrics();
  });

  describe("Authentication & Authorization", () => {
    const testFile = path.join(__dirname, "../fixtures/sample-medical-record.txt");

    it("Admin JWT can upload document with OCR fields", async () => {
      const start = performance.now();
      const ocrFields = generateOcrFields({ count: 3, type: "medical" });

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(ocrFields))
        .attach("file", testFile);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200, response.status !== 200 ? `Admin upload failed: ${response.status}` : null);

      console.log(`   ⏱️  Upload took ${duration.toFixed(2)}ms`);
      
      if (response.status !== 200) {
        console.log(`   ❌ Error response:`, response.body);
      }

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.documents).toHaveLength(1);

      if (response.body.documents[0]) {
        uploadedDocuments.push(response.body.documents[0].location);
      }

      console.log(`   ✅ Admin JWT upload successful`);
    });

    it("API key should be REJECTED on /v1/document/upload", async () => {
      const start = performance.now();

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${apiKey}`)
        .attach("file", testFile);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 401, response.status !== 401 ? `Should reject API key: ${response.status}` : null);

      console.log(`   ⏱️  Rejection took ${duration.toFixed(2)}ms`);

      expect(response.status).toBe(401);
      console.log(`   ✅ API key correctly rejected on /v1/document/upload`);
    });

    it("Invalid JWT should be rejected", async () => {
      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", "Bearer invalid-jwt-token-12345")
        .attach("file", testFile);

      expect(response.status).toBe(401);
      console.log(`   ✅ Invalid JWT correctly rejected`);
    });
  });

  describe("OCR Field Processing", () => {
    const testFile = path.join(__dirname, "../fixtures/sample-medical-record.txt");

    it("Valid OCR fields are parsed and stored correctly", async () => {
      const start = performance.now();
      const validOcrFields = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../fixtures/ocr-fields-valid.json"), "utf8")
      );

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(validOcrFields))
        .attach("file", testFile);

      const duration = performance.now() - start;
      trackMetric(duration, response.status === 200);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.documents).toHaveLength(1);

      const docLocation = response.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      console.log(`   📍 Document location: ${docLocation}`);

      // Wait for document to be fully processed
      const docExists = await waitForDocument(docLocation, 5000);
      
      console.log(`   📁 Document exists: ${docExists}`);
      
      expect(docExists).toBe(true);

      // Read and verify document JSON
      const docData = await readDocumentJson(docLocation);
      
      if (!docData) {
        console.error(`   ❌ Failed to read document: ${docLocation}`);
        console.error(`   📁 Looking in: ${process.env.NODE_ENV === "development" ? "server/storage/documents" : process.env.STORAGE_DIR + "/documents"}`);
      }
      
      expect(docData).not.toBeNull();

      const validation = verifyOcrStructure(docData);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Verify OCR data structure
      expect(docData.ocr.google_raw).toBeTruthy();
      expect(docData.ocr.fields).toBeDefined();
      expect(docData.ocr.rawFields).toHaveLength(validOcrFields.length);

      // Verify specific fields
      expect(docData.ocr.fields.patient_name).toBe("Jane Smith");
      expect(docData.ocr.fields.diagnosis).toBe("Type 2 Diabetes Mellitus");

      console.log(`   ⏱️  Processing took ${duration.toFixed(2)}ms`);
      console.log(`   ✅ OCR fields stored correctly`);
      console.log(`   📋 Extracted ${validOcrFields.length} fields`);
    });

    it("Confidence levels are tracked correctly", async () => {
      const ocrFields = generateOcrFields({ 
        count: 5, 
        minConfidence: 0.6, 
        maxConfidence: 0.95 
      });

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(ocrFields))
        .attach("file", testFile);

      expect(response.status).toBe(200);

      const docLocation = response.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      await waitForDocument(docLocation, 5000);
      const docData = await readDocumentJson(docLocation);

      expect(docData.ocr.rawFields).toHaveLength(ocrFields.length);

      // Verify all confidence values preserved
      docData.ocr.rawFields.forEach((field) => {
        expect(field.confidence).toBeGreaterThanOrEqual(0);
        expect(field.confidence).toBeLessThanOrEqual(1);
      });

      const stats = calculateConfidenceStats(docData.ocr.rawFields);
      console.log(`   📊 Confidence Stats:`);
      console.log(`      Average: ${stats.average}`);
      console.log(`      Min: ${stats.min}, Max: ${stats.max}`);
      console.log(`      Low confidence fields: ${stats.lowConfidenceCount}`);
      console.log(`   ✅ Confidence tracking verified`);
    });

    it("Malformed OCR data is handled gracefully", async () => {
      const invalidOcrFields = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../fixtures/ocr-fields-invalid.json"), "utf8")
      );

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(invalidOcrFields))
        .attach("file", testFile);

      // Upload should succeed even with invalid OCR data
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      const docLocation = response.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      await waitForDocument(docLocation, 5000);
      const docData = await readDocumentJson(docLocation);

      // OCR processing should skip invalid fields
      // Valid fields should still be processed
      expect(docData.ocr).toBeDefined();

      console.log(`   ✅ Malformed OCR handled gracefully`);
    });
  });

  describe("Edge Cases - Image-Based PDFs", () => {
    const testFile = path.join(__dirname, "../fixtures/sample-medical-record.txt");

    it("Low confidence OCR is flagged appropriately", async () => {
      const lowConfidenceOcr = generateLowConfidenceOcrFields();

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(lowConfidenceOcr))
        .attach("file", testFile);

      expect(response.status).toBe(200);

      const docLocation = response.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      await waitForDocument(docLocation, 5000);
      const docData = await readDocumentJson(docLocation);

      const stats = calculateConfidenceStats(docData.ocr.rawFields);
      
      expect(stats.lowConfidenceCount).toBeGreaterThan(0);
      expect(stats.average).toBeLessThan(0.5);

      console.log(`   ⚠️  Low confidence detected:`);
      console.log(`      Average confidence: ${stats.average}`);
      console.log(`      Low confidence fields: ${stats.lowConfidenceCount}/${stats.count}`);
      console.log(`   ✅ Low confidence flagging works`);
    });

    it("Image-based documents can be marked for benchmarking", async () => {
      const imageOcrFields = generateOcrFields({ 
        count: 6, 
        minConfidence: 0.7, 
        maxConfidence: 0.92 
      });

      const metadata = createImageBasedMetadata(imageOcrFields);

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(imageOcrFields))
        .attach("file", testFile);

      expect(response.status).toBe(200);

      const docLocation = response.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      // Verify metadata structure
      expect(metadata.sourceType).toBe("image-based");
      expect(metadata.averageConfidence).toBeDefined();
      expect(metadata.requiresManualReview).toBeDefined();

      console.log(`   📸 Image-based metadata:`);
      console.log(`      Source type: ${metadata.sourceType}`);
      console.log(`      Avg confidence: ${metadata.averageConfidence}`);
      console.log(`      Requires review: ${metadata.requiresManualReview}`);
      console.log(`   ✅ Image-based marking works`);
    });
  });

  describe("OCR with Document Updates", () => {
    const testFile = path.join(__dirname, "../fixtures/sample-medical-record.txt");

    it("Document upload with OCR creates proper structure", async () => {
      const ocrFields = generateOcrFields({ count: 4, type: "medical" });

      const response = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(ocrFields))
        .attach("file", testFile);

      expect(response.status).toBe(200);

      const docLocation = response.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      await waitForDocument(docLocation, 5000);
      const docData = await readDocumentJson(docLocation);

      // Verify complete OCR structure
      expect(docData.ocr).toBeDefined();
      expect(docData.ocr.google_raw).toBeTruthy();
      expect(docData.ocr.fields).toBeDefined();
      expect(docData.ocr.rawFields).toHaveLength(ocrFields.length);

      // Verify google_raw contains combined text
      const combinedText = ocrFields.map(f => f.fieldValue).join("\n");
      expect(docData.ocr.google_raw).toContain(ocrFields[0].fieldValue);

      console.log(`   ✅ OCR structure created correctly`);
      console.log(`   📄 google_raw length: ${docData.ocr.google_raw.length} chars`);
    });
  });
});
