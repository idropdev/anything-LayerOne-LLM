/**
 * Simple OCR Upload Test
 * 
 * Simplified test to verify OCR field processing works
 */

require("dotenv").config({ path: ".env.test" });
const request = require("supertest");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.TEST_SERVER_URL || "http://localhost:3001";
const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;

describe("OCR Upload - Simple Test", () => {
  let adminJWT;

  beforeAll(async () => {
    // Login
    const loginResponse = await request(BASE_URL)
      .post("/api/request-token")
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

    adminJWT = loginResponse.body.token;
    console.log("✅ Logged in successfully");
  });

  it("Should upload a file with OCR fields", async () => {
    const testFile = path.join(__dirname, "../fixtures/sample-medical-record.txt");
    const documentFields = {
      text: "Patient Name: John Doe",
      entities: [
        { 
          type: "patient_name", 
          mentionText: "John Doe", 
          confidence: 0.95,
          startOffset: 14,
          endOffset: 22
        }
      ],
      outputRef: "simple-test-doc",
      pageCount: 1,
      confidence: 0.95
    };

    console.log("📁 Test file:", testFile);
    console.log("📄 File exists:", fs.existsSync(testFile));
    console.log("📊 Document fields:", JSON.stringify(documentFields));

    const response = await request(BASE_URL)
      .post("/api/v1/document/upload")
      .set("Authorization", `Bearer ${adminJWT}`)
      .field("documentFields", JSON.stringify(documentFields))
      .attach("file", testFile);

    console.log("📡 Response status:", response.status);
    console.log("📡 Response body:", JSON.stringify(response.body, null, 2));

    if (response.status !== 200) {
      console.error("❌ Upload failed!");
      console.error("Error:", response.body.error);
    }

    expect(response.status).toBe(200);
  });
});
