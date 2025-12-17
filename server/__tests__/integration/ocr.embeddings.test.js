/**
 * OCR Embedding Integration Tests - Phase 2
 * 
 * Tests embedding generation and vector search with OCR fields.
 * Uses real OpenAI API sparingly (~4 API calls total).
 * 
 * Prerequisites:
 * - Test workspace created manually: test-ocr-workspace
 * - OpenAI API configured
 * - Zilliz vector database accessible
 */

require("dotenv").config({ path: ".env.test" });
const request = require("supertest");
const { performance } = require("perf_hooks");
const fs = require("fs");
const path = require("path");
const {
  getWorkspace,
  addDocumentToWorkspace,
  waitForEmbeddings,
  searchWorkspace,
  verifyOcrInSearch,
} = require("../utils/ocr.helpers");

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3001";
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const WORKSPACE_SLUG = process.env.TEST_WORKSPACE_SLUG || "test-ocr-workspace";
const EMBEDDING_WAIT_MS = parseInt(process.env.TEST_EMBEDDING_WAIT_MS || "10000");

// Track uploaded documents for cleanup
const uploadedDocuments = [];

// Performance tracking
const performanceMetrics = {
  embeddingTimes: [],
  searchTimes: [],
  apiCalls: 0,
};

describe("OCR Embedding Integration Tests - Phase 2", () => {
  let adminJWT;

  beforeAll(async () => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
      throw new Error("TEST_ADMIN_USERNAME and TEST_ADMIN_PASSWORD must be set in .env.test");
    }

    console.log("\n🔧 Phase 2 Test Configuration:");
    console.log(`   Server: ${BASE_URL}`);
    console.log(`   Workspace: ${WORKSPACE_SLUG}`);
    console.log(`   Embedding Wait: ${EMBEDDING_WAIT_MS}ms`);

    // Login and get admin JWT
    const loginResponse = await request(BASE_URL)
      .post("/api/request-token")
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    if (loginResponse.status !== 200) {
      throw new Error(`Failed to login: ${loginResponse.status}`);
    }

    adminJWT = loginResponse.body.token;
    console.log(`   ✅ Admin JWT obtained\n`);
  });

  afterAll(async () => {
    console.log("\n📊 Phase 2 Performance Summary:");
    console.log(`   Total OpenAI API Calls: ${performanceMetrics.apiCalls}`);
    console.log(`   Avg Embedding Time: ${performanceMetrics.embeddingTimes.length > 0 ? (performanceMetrics.embeddingTimes.reduce((a, b) => a + b, 0) / performanceMetrics.embeddingTimes.length).toFixed(2) : 0}ms`);
    console.log(`   Avg Search Time: ${performanceMetrics.searchTimes.length > 0 ? (performanceMetrics.searchTimes.reduce((a, b) => a + b, 0) / performanceMetrics.searchTimes.length).toFixed(2) : 0}ms`);
    console.log("");
  });

  describe("Setup Verification", () => {
    it("Should verify test workspace exists", async () => {
      const workspace = await getWorkspace(WORKSPACE_SLUG, adminJWT, BASE_URL);

      expect(workspace).not.toBeNull();
      expect(workspace.slug).toBe(WORKSPACE_SLUG);

      console.log(`   ✅ Workspace verified: ${workspace.name}`);
      console.log(`   📁 Documents in workspace: ${workspace.documents?.length || 0}`);
    });
  });

  describe("Embedding Generation with OCR", () => {
    it("Should upload document with OCR and generate embeddings", async () => {
      const testFile = path.join(__dirname, "../fixtures/ocr-medical-records/diabetes-diagnosis.txt");
      const ocrFields = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../fixtures/ocr-medical-records/diabetes-ocr.json"), "utf8")
      );

      console.log("   📄 Uploading diabetes diagnosis with OCR fields...");

      const startTime = performance.now();

      // Upload document with OCR
      const uploadResponse = await request(BASE_URL)
        .post("/api/v1/document/upload")
        .set("Authorization", `Bearer ${adminJWT}`)
        .field("externalOCRFields", JSON.stringify(ocrFields))
        .attach("file", testFile);

      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.body.success).toBe(true);
      expect(uploadResponse.body.documents).toHaveLength(1);

      const docLocation = uploadResponse.body.documents[0].location;
      uploadedDocuments.push(docLocation);

      console.log(`   ✅ Document uploaded: ${docLocation}`);

      // Add document to workspace
      const added = await addDocumentToWorkspace(docLocation, WORKSPACE_SLUG, adminJWT, BASE_URL);
      expect(added).toBe(true);

      console.log(`   ✅ Document added to workspace`);

      // Wait for embeddings to be generated
      console.log(`   ⏳ Waiting for embeddings (max ${EMBEDDING_WAIT_MS}ms)...`);
      const embeddingsReady = await waitForEmbeddings(WORKSPACE_SLUG, adminJWT, EMBEDDING_WAIT_MS, BASE_URL);
      
      const embeddingTime = performance.now() - startTime;
      performanceMetrics.embeddingTimes.push(embeddingTime);
      performanceMetrics.apiCalls++;

      expect(embeddingsReady).toBe(true);

      console.log(`   ✅ Embeddings generated in ${embeddingTime.toFixed(2)}ms`);
      console.log(`   📊 OpenAI API calls so far: ${performanceMetrics.apiCalls}`);
    });
  });

  describe("Vector Search with OCR Content", () => {
    it("Should search for documents using OCR field values", async () => {
      console.log("   🔍 Testing vector search with OCR content...");

      // Upload 3 documents with OCR
      const documents = [
        {
          file: "diabetes-diagnosis.txt",
          ocr: "diabetes-ocr.json",
          searchTerm: "diabetes",
          expectedPatient: "John Anderson"
        },
        {
          file: "hypertension-diagnosis.txt",
          ocr: "hypertension-ocr.json",
          searchTerm: "hypertension",
          expectedPatient: "Maria Rodriguez"
        },
        {
          file: "asthma-diagnosis.txt",
          ocr: "asthma-ocr.json",
          searchTerm: "asthma",
          expectedPatient: "David Kim"
        }
      ];

      // Upload all documents
      for (const doc of documents) {
        const testFile = path.join(__dirname, `../fixtures/ocr-medical-records/${doc.file}`);
        const ocrFields = JSON.parse(
          fs.readFileSync(path.join(__dirname, `../fixtures/ocr-medical-records/${doc.ocr}`), "utf8")
        );

        const uploadResponse = await request(BASE_URL)
          .post("/api/v1/document/upload")
          .set("Authorization", `Bearer ${adminJWT}`)
          .field("externalOCRFields", JSON.stringify(ocrFields))
          .attach("file", testFile);

        expect(uploadResponse.status).toBe(200);
        const docLocation = uploadResponse.body.documents[0].location;
        uploadedDocuments.push(docLocation);

        // Add to workspace
        await addDocumentToWorkspace(docLocation, WORKSPACE_SLUG, adminJWT, BASE_URL);
        performanceMetrics.apiCalls++;
      }

      console.log(`   ✅ Uploaded 3 documents with OCR`);

      // Wait for all embeddings
      console.log(`   ⏳ Waiting for embeddings...`);
      const embeddingsReady = await waitForEmbeddings(WORKSPACE_SLUG, adminJWT, EMBEDDING_WAIT_MS * 2, BASE_URL);
      expect(embeddingsReady).toBe(true);

      console.log(`   ✅ All embeddings generated`);

      // Test search for each document
      for (const doc of documents) {
        const searchStart = performance.now();
        const results = await searchWorkspace(WORKSPACE_SLUG, doc.searchTerm, adminJWT, BASE_URL);
        const searchTime = performance.now() - searchStart;
        performanceMetrics.searchTimes.push(searchTime);

        expect(results.length).toBeGreaterThan(0);
        
        // Verify OCR content in results
        const foundPatient = verifyOcrInSearch(results, doc.expectedPatient);
        expect(foundPatient).toBe(true);

        console.log(`   ✅ Search "${doc.searchTerm}" found ${doc.expectedPatient} (${searchTime.toFixed(2)}ms)`);
      }

      console.log(`   📊 Total OpenAI API calls: ${performanceMetrics.apiCalls}`);
    }, 60000); // 60 second timeout for uploading + embedding 3 documents
  });

  describe("Performance Metrics", () => {
    it("Should measure search performance", async () => {
      console.log("   ⏱️  Measuring search performance...");

      // Perform multiple searches to get average
      const searchQueries = ["diabetes", "blood pressure", "asthma", "medication"];
      const searchTimes = [];

      for (const query of searchQueries) {
        const startTime = performance.now();
        const results = await searchWorkspace(WORKSPACE_SLUG, query, adminJWT, BASE_URL);
        const searchTime = performance.now() - startTime;
        searchTimes.push(searchTime);

        console.log(`   🔍 Search "${query}": ${results.length} results in ${searchTime.toFixed(2)}ms`);
      }

      const avgSearchTime = searchTimes.reduce((a, b) => a + b, 0) / searchTimes.length;
      const minSearchTime = Math.min(...searchTimes);
      const maxSearchTime = Math.max(...searchTimes);

      console.log(`   📊 Search Performance:`);
      console.log(`      Average: ${avgSearchTime.toFixed(2)}ms`);
      console.log(`      Min: ${minSearchTime.toFixed(2)}ms`);
      console.log(`      Max: ${maxSearchTime.toFixed(2)}ms`);

      // Performance assertions
      expect(avgSearchTime).toBeLessThan(10000); // Should be under 10 seconds (OpenAI can be slow)
      expect(minSearchTime).toBeGreaterThan(0);
    });
  });
});
