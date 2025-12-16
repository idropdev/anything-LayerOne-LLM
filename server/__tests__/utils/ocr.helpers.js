/**
 * OCR Test Helper Utilities
 * 
 * Provides helper functions for testing OCR functionality in document uploads
 */

const fs = require("fs");
const path = require("path");

/**
 * Generate test OCR fields with varying confidence levels
 * 
 * @param {Object} options - Configuration options
 * @param {number} options.count - Number of fields to generate
 * @param {number} options.minConfidence - Minimum confidence (0-1)
 * @param {number} options.maxConfidence - Maximum confidence (0-1)
 * @param {string} options.type - Field type (medical, general, mixed)
 * @returns {Array} Array of OCR field objects
 */
function generateOcrFields(options = {}) {
  const {
    count = 5,
    minConfidence = 0.7,
    maxConfidence = 0.95,
    type = "medical",
  } = options;

  const medicalFields = [
    { key: "patient_name", value: "John Doe" },
    { key: "date_of_birth", value: "1980-01-15" },
    { key: "diagnosis", value: "Hypertension" },
    { key: "medication", value: "Lisinopril 10mg" },
    { key: "physician", value: "Dr. Jane Smith" },
    { key: "visit_date", value: "2024-01-15" },
    { key: "blood_pressure", value: "120/80" },
    { key: "heart_rate", value: "72 bpm" },
  ];

  const generalFields = [
    { key: "title", value: "Document Title" },
    { key: "author", value: "John Smith" },
    { key: "date", value: "2024-01-15" },
    { key: "description", value: "Sample document description" },
    { key: "category", value: "General" },
  ];

  const fieldPool = type === "medical" ? medicalFields : generalFields;
  const selectedFields = fieldPool.slice(0, Math.min(count, fieldPool.length));

  return selectedFields.map((field) => ({
    fieldKey: field.key,
    fieldValue: field.value,
    fieldType: "string",
    confidence: parseFloat(
      (Math.random() * (maxConfidence - minConfidence) + minConfidence).toFixed(2)
    ),
  }));
}

/**
 * Generate low confidence OCR fields for edge case testing
 */
function generateLowConfidenceOcrFields() {
  return [
    {
      fieldKey: "unclear_text_1",
      fieldValue: "???",
      fieldType: "string",
      confidence: 0.25,
    },
    {
      fieldKey: "unclear_text_2",
      fieldValue: "Partially readable text",
      fieldType: "string",
      confidence: 0.45,
    },
    {
      fieldKey: "blurry_number",
      fieldValue: "123?",
      fieldType: "string",
      confidence: 0.35,
    },
  ];
}

/**
 * Verify OCR data structure in document JSON
 * 
 * @param {Object} documentData - Document JSON data
 * @returns {Object} Validation result with errors array
 */
function verifyOcrStructure(documentData) {
  const errors = [];

  if (!documentData) {
    errors.push("Document data is null or undefined");
    return { valid: false, errors };
  }

  if (!documentData.ocr) {
    errors.push("Missing ocr object in document");
    return { valid: false, errors };
  }

  const { ocr } = documentData;

  // Check for google_raw (should be present if OCR fields provided)
  if (!ocr.google_raw && !ocr.anything_raw) {
    errors.push("Missing google_raw or anything_raw in OCR data");
  }

  // Check for fields object
  if (!ocr.fields || typeof ocr.fields !== "object") {
    errors.push("Missing or invalid fields object in OCR data");
  }

  // Check for rawFields array
  if (!ocr.rawFields || !Array.isArray(ocr.rawFields)) {
    errors.push("Missing or invalid rawFields array in OCR data");
  }

  return {
    valid: errors.length === 0,
    errors,
    ocr,
  };
}

/**
 * Calculate confidence level statistics from OCR fields
 * 
 * @param {Array} ocrFields - Array of OCR field objects
 * @returns {Object} Statistics object
 */
function calculateConfidenceStats(ocrFields) {
  if (!Array.isArray(ocrFields) || ocrFields.length === 0) {
    return {
      count: 0,
      average: 0,
      min: 0,
      max: 0,
      lowConfidenceCount: 0,
      highConfidenceCount: 0,
    };
  }

  const confidences = ocrFields
    .map((f) => f.confidence)
    .filter((c) => typeof c === "number");

  if (confidences.length === 0) {
    return {
      count: 0,
      average: 0,
      min: 0,
      max: 0,
      lowConfidenceCount: 0,
      highConfidenceCount: 0,
    };
  }

  const sum = confidences.reduce((a, b) => a + b, 0);
  const average = sum / confidences.length;
  const min = Math.min(...confidences);
  const max = Math.max(...confidences);
  const lowConfidenceCount = confidences.filter((c) => c < 0.5).length;
  const highConfidenceCount = confidences.filter((c) => c >= 0.9).length;

  return {
    count: confidences.length,
    average: parseFloat(average.toFixed(3)),
    min: parseFloat(min.toFixed(3)),
    max: parseFloat(max.toFixed(3)),
    lowConfidenceCount,
    highConfidenceCount,
  };
}

/**
 * Create metadata for image-based documents
 * 
 * @param {Array} ocrFields - OCR fields extracted from image
 * @returns {Object} Metadata object
 */
function createImageBasedMetadata(ocrFields) {
  const stats = calculateConfidenceStats(ocrFields);

  return {
    sourceType: "image-based",
    requiresManualReview: stats.average < 0.7 || stats.lowConfidenceCount > 0,
    averageConfidence: stats.average,
    confidenceStats: stats,
    extractionMethod: "external-ocr",
    timestamp: new Date().toISOString(),
  };
}

/**
 * Wait for document to be processed and available
 * 
 * @param {string} documentLocation - Document location path
 * @param {number} maxWaitMs - Maximum wait time in milliseconds
 * @returns {Promise<boolean>} True if document exists
 */
async function waitForDocument(documentLocation, maxWaitMs = 5000) {
  const documentsPath =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? path.resolve(__dirname, "../../storage/documents")
      : path.resolve(process.env.STORAGE_DIR || "/app/server/storage", "documents");

  const docPath = path.resolve(documentsPath, documentLocation);
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(docPath)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

/**
 * Read document JSON from storage
 * 
 * @param {string} documentLocation - Document location path
 * @returns {Promise<Object|null>} Document data or null if not found
 */
async function readDocumentJson(documentLocation) {
  const documentsPath =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? path.resolve(__dirname, "../../storage/documents")
      : path.resolve(process.env.STORAGE_DIR || "/app/server/storage", "documents");

  const docPath = path.resolve(documentsPath, documentLocation);

  if (!fs.existsSync(docPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(docPath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading document JSON: ${error.message}`);
    return null;
  }
}

/**
 * Clean up test documents from storage
 * 
 * @param {Array<string>} documentLocations - Array of document location paths
 */
function cleanupTestDocuments(documentLocations) {
  const documentsPath =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? path.resolve(__dirname, "../../storage/documents")
      : path.resolve(process.env.STORAGE_DIR || "/app/server/storage", "documents");

  for (const location of documentLocations) {
    const docPath = path.resolve(documentsPath, location);
    if (fs.existsSync(docPath)) {
      try {
        fs.unlinkSync(docPath);
      } catch (error) {
        console.warn(`Failed to cleanup test document: ${error.message}`);
      }
    }
  }
}

module.exports = {
  generateOcrFields,
  generateLowConfidenceOcrFields,
  verifyOcrStructure,
  calculateConfidenceStats,
  createImageBasedMetadata,
  waitForDocument,
  readDocumentJson,
  cleanupTestDocuments,
};
