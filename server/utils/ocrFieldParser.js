/**
 * OCR Field Parser Utility
 *
 * Parses external OCR field arrays (from Google OCR or other providers)
 * and extracts structured OCR data for document enrichment.
 * 
 * Supports three OCR sources:
 * - documentFields: Google Document AI output (document_output structure)
 * - visionFields: Google Vision API output (vision_output structure)
 * - userEditField: User-edited OCR data (same structure, highest priority)
 */

const { mergeOcrSources } = require('./documentEnrichment');

/**
 * Parse external OCR fields array and extract OCR text
 * 
 * @deprecated This function is deprecated. Use parseDocumentOutput, parseVisionOutput, 
 * or parseUserEditOutput instead for the new OCR field format.
 *
 * @param {Array} ocrFields - Array of OCR field objects with structure:
 *   {
 *     fieldKey: string,
 *     fieldValue: string,
 *     fieldType: string,
 *     confidence: number
 *   }
 * @returns {Object} - Structured OCR data:
 *   {
 *     google_raw: string,  // Combined text from all fields
 *     fields: Object,       // Structured fields by fieldKey
 *     rawFields: Array     // Original field array
 *   }
 */
function parseExternalOcrFields(ocrFields) {
  if (!Array.isArray(ocrFields) || ocrFields.length === 0) {
    return {
      google_raw: null,
      fields: {},
      rawFields: [],
    };
  }

  // Extract all field values and combine into raw text
  const fieldTexts = [];
  const fields = {};
  const fieldGroups = {};

  for (const field of ocrFields) {
    // Validate field structure
    if (
      !field ||
      typeof field !== "object" ||
      !field.fieldKey ||
      field.fieldValue === undefined
    ) {
      continue;
    }

    const { fieldKey, fieldValue, fieldType, confidence } = field;

    // Add to combined raw text
    if (fieldValue && typeof fieldValue === "string" && fieldValue.trim()) {
      fieldTexts.push(fieldValue.trim());
    }

    // Group fields by fieldKey (some keys may repeat)
    if (!fieldGroups[fieldKey]) {
      fieldGroups[fieldKey] = [];
    }
    fieldGroups[fieldKey].push({
      value: fieldValue,
      type: fieldType || "string",
      confidence: confidence || 0,
    });

    // Store in structured format (if multiple values, store as array)
    if (!fields[fieldKey]) {
      fields[fieldKey] = fieldGroups[fieldKey].length === 1
        ? fieldValue
        : fieldGroups[fieldKey].map((f) => f.value);
    } else if (Array.isArray(fields[fieldKey])) {
      fields[fieldKey].push(fieldValue);
    } else {
      // Convert to array if we have multiple values
      fields[fieldKey] = [fields[fieldKey], fieldValue];
    }
  }

  // Combine all field values into raw OCR text
  // Join with newlines to preserve structure
  const google_raw = fieldTexts.length > 0 ? fieldTexts.join("\n") : null;

  return {
    google_raw,
    fields,
    rawFields: ocrFields,
  };
}

/**
 * Build OCR object for document JSON from external OCR fields
 * 
 * @deprecated This function is deprecated. Use buildOcrFromMultipleSources with 
 * documentFields, visionFields, and userEditField parameters instead.
 *
 * @param {Array|string} externalOcrFields - JSON array string or array of OCR fields
 * @param {Object} existingOcr - Existing OCR data to merge with (optional)
 * @returns {Object} - OCR object for document:
 *   {
 *     google_raw: string,
 *     anything_raw: string (if exists),
 *     user_corrected: string (if exists),
 *     fields: Object,
 *     rawFields: Array
 *   }
 */
function buildOcrFromExternalFields(externalOcrFields, existingOcr = {}) {
  // Parse if string
  let ocrFieldsArray = externalOcrFields;
  if (typeof externalOcrFields === "string") {
    try {
      ocrFieldsArray = JSON.parse(externalOcrFields);
    } catch (e) {
      console.warn(
        "[OCR Parser] Failed to parse externalOCRFields as JSON:",
        e.message
      );
      return existingOcr;
    }
  }

  // Parse the fields
  const parsed = parseExternalOcrFields(ocrFieldsArray);

  // Merge with existing OCR data
  return {
    ...existingOcr,
    google_raw: parsed.google_raw || existingOcr.google_raw || null,
    // Preserve existing fields
    anything_raw: existingOcr.anything_raw || null,
    user_corrected: existingOcr.user_corrected || null,
    // Add structured fields
    fields: parsed.fields,
    rawFields: parsed.rawFields,
  };
}

/**
 * Parse Google Document AI document_output structure
 * 
 * @param {Object} documentOutput - document_output object from Google Document AI
 * @returns {Object} - Extracted OCR data structure
 */
function parseDocumentOutput(documentOutput) {
  if (!documentOutput || typeof documentOutput !== 'object') {
    return null;
  }

  return {
    text: documentOutput.text || null,
    entities: Array.isArray(documentOutput.entities) ? documentOutput.entities : [],
    pageCount: documentOutput.pageCount || 0,
    confidence: documentOutput.confidence || 0,
    outputRef: documentOutput.outputRef || null,
    fullResponse: documentOutput.fullResponse || null,
    source: 'document'
  };
}

/**
 * Parse Google Vision API vision_output structure
 * 
 * @param {Object} visionOutput - vision_output object from Google Vision API
 * @returns {Object} - Extracted OCR data structure
 */
function parseVisionOutput(visionOutput) {
  if (!visionOutput || typeof visionOutput !== 'object') {
    return null;
  }

  return {
    text: visionOutput.text || null,
    entities: Array.isArray(visionOutput.entities) ? visionOutput.entities : [],
    pageCount: visionOutput.pageCount || 0,
    confidence: visionOutput.confidence || 0,
    outputRef: visionOutput.outputRef || null,
    fullResponse: visionOutput.fullResponse || null,
    source: 'vision'
  };
}

/**
 * Parse user-edited OCR data (same structure as document/vision)
 * 
 * @param {Object} userEditOutput - user_edit object with user corrections
 * @returns {Object} - Extracted OCR data structure
 */
function parseUserEditOutput(userEditOutput) {
  if (!userEditOutput || typeof userEditOutput !== 'object') {
    return null;
  }

  return {
    text: userEditOutput.text || null,
    entities: Array.isArray(userEditOutput.entities) ? userEditOutput.entities : [],
    pageCount: userEditOutput.pageCount || 0,
    confidence: userEditOutput.confidence || 0,
    outputRef: userEditOutput.outputRef || null,
    source: 'userEdit'
  };
}

/**
 * Extract text from document_output structure
 * 
 * @param {Object} documentOutput - document_output object
 * @returns {string|null} - Extracted text
 */
function extractTextFromDocumentOutput(documentOutput) {
  if (!documentOutput) return null;
  return documentOutput.text || documentOutput.fullResponse?.text || null;
}

/**
 * Extract text from vision_output structure
 * 
 * @param {Object} visionOutput - vision_output object
 * @returns {string|null} - Extracted text
 */
function extractTextFromVisionOutput(visionOutput) {
  if (!visionOutput) return null;
  return visionOutput.text || visionOutput.fullResponse?.fullTextAnnotation?.text || null;
}

/**
 * Merge entities from multiple sources with priority
 * Priority: userEdit > document > vision
 * Higher confidence = better soundness/quality
 * 
 * @param {Array} documentEntities - Entities from document_output
 * @param {Array} visionEntities - Entities from vision_output
 * @param {Array} userEditEntities - Entities from user_edit (highest priority)
 * @returns {Array} - Merged and deduplicated entities
 */
function mergeEntities(documentEntities = [], visionEntities = [], userEditEntities = []) {
  const entityMap = new Map();

  // Helper to create entity key for deduplication
  const makeKey = (entity) => {
    const type = (entity.type || '').toLowerCase().trim();
    const mention = (entity.mentionText || '').toLowerCase().trim();
    return `${type}:${mention}`;
  };

  // Helper to determine source priority
  const getSourcePriority = (source) => {
    if (source === 'userEdit') return 3; // Highest
    if (source === 'document') return 2;
    if (source === 'vision') return 1; // Lowest
    return 0;
  };

  // Process entities from all sources
  const allEntities = [
    ...visionEntities.map(e => ({ ...e, _source: 'vision' })),
    ...documentEntities.map(e => ({ ...e, _source: 'document' })),
    ...userEditEntities.map(e => ({ ...e, _source: 'userEdit' }))
  ];

  for (const entity of allEntities) {
    if (!entity.type || !entity.mentionText) continue;

    const key = makeKey(entity);
    const existing = entityMap.get(key);

    if (!existing) {
      // New entity - add it
      entityMap.set(key, entity);
    } else {
      // Duplicate - apply priority rules
      const existingPriority = getSourcePriority(existing._source);
      const newPriority = getSourcePriority(entity._source);

      if (newPriority > existingPriority) {
        // Higher priority source - replace
        entityMap.set(key, entity);
      } else if (newPriority === existingPriority) {
        // Same priority - use confidence to decide
        const existingConfidence = existing.confidence || 0;
        const newConfidence = entity.confidence || 0;
        if (newConfidence > existingConfidence) {
          entityMap.set(key, entity);
        }
      }
      // Lower priority - keep existing
    }
  }

  // Convert map to array and sort
  const mergedEntities = Array.from(entityMap.values()).map(e => {
    const cleaned = { ...e };
    delete cleaned._source; // Remove internal tracking field
    return cleaned;
  });

  // Sort by startOffset if available, else by type
  mergedEntities.sort((a, b) => {
    if (a.startOffset !== undefined && b.startOffset !== undefined) {
      return a.startOffset - b.startOffset;
    }
    return (a.type || '').localeCompare(b.type || '');
  });

  return mergedEntities;
}

/**
 * Extract fields from entities for backward compatibility
 * Uses entity type as key and mentionText as value
 * Confidence levels determine soundness/quality
 * 
 * @param {Array} entities - Merged entity array
 * @returns {Object} - Fields object { [entityType]: mentionText }
 */
function extractFieldsFromEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return {};
  }

  const fields = {};
  
  for (const entity of entities) {
    if (!entity.type || !entity.mentionText) continue;

    const type = entity.type;
    const mention = entity.mentionText;
    const confidence = entity.confidence || 0;

    // If field doesn't exist, add it
    if (!fields[type]) {
      fields[type] = mention;
    } else {
      // Field exists - only replace if new entity has higher confidence
      // Note: We're relying on mergeEntities to have already selected highest confidence
      // for each unique entity, so this is mainly for multiple different entities of same type
      fields[type] = mention;
    }
  }

  return fields;
}

/**
 * Build OCR object from documentFields (Google Document AI output)
 * 
 * @param {string|Object} documentFields - JSON string or object
 * @param {Object} existingOcr - Existing OCR data to merge with
 * @returns {Object} - Merged OCR object
 */
function buildOcrFromDocumentFields(documentFields, existingOcr = {}) {
  // Parse if string
  let documentOutput = documentFields;
  if (typeof documentFields === 'string') {
    try {
      documentOutput = JSON.parse(documentFields);
    } catch (e) {
      console.warn('[OCR Parser] Failed to parse documentFields as JSON:', e.message);
      return existingOcr;
    }
  }

  const parsed = parseDocumentOutput(documentOutput);
  if (!parsed) {
    console.warn('[OCR Parser] Invalid documentOutput structure');
    return existingOcr;
  }

  return {
    ...existingOcr,
    document_output: documentOutput
  };
}

/**
 * Build OCR object from visionFields (Google Vision API output)
 * 
 * @param {string|Object} visionFields - JSON string or object
 * @param {Object} existingOcr - Existing OCR data to merge with
 * @returns {Object} - Merged OCR object
 */
function buildOcrFromVisionFields(visionFields, existingOcr = {}) {
  // Parse if string
  let visionOutput = visionFields;
  if (typeof visionFields === 'string') {
    try {
      visionOutput = JSON.parse(visionFields);
    } catch (e) {
      console.warn('[OCR Parser] Failed to parse visionFields as JSON:', e.message);
      return existingOcr;
    }
  }

  const parsed = parseVisionOutput(visionOutput);
  if (!parsed) {
    console.warn('[OCR Parser] Invalid visionOutput structure');
    return existingOcr;
  }

  return {
    ...existingOcr,
    vision_output: visionOutput
  };
}

/**
 * Build OCR object from userEditField (user corrections)
 * User-edited entities take priority over document/vision
 * 
 * @param {string|Object} userEditField - JSON string or object
 * @param {Object} existingOcr - Existing OCR data to merge with
 * @returns {Object} - Merged OCR object
 */
function buildOcrFromUserEdit(userEditField, existingOcr = {}) {
  // Parse if string
  let userEditOutput = userEditField;
  if (typeof userEditField === 'string') {
    try {
      userEditOutput = JSON.parse(userEditField);
    } catch (e) {
      console.warn('[OCR Parser] Failed to parse userEditField as JSON:', e.message);
      return existingOcr;
    }
  }

  const parsed = parseUserEditOutput(userEditOutput);
  if (!parsed) {
    console.warn('[OCR Parser] Invalid userEditOutput structure');
    return existingOcr;
  }

  return {
    ...existingOcr,
    user_edit: userEditOutput
  };
}

/**
 * Build OCR object from multiple sources (document, vision, userEdit)
 * Combines all three sources with proper priority and merging
 * 
 * @param {Object} sources - Object with documentFields, visionFields, userEditField
 * @param {Object} existingOcr - Existing OCR data to merge with
 * @returns {Object} - Final merged OCR object
 */
function buildOcrFromMultipleSources({ documentFields, visionFields, userEditField }, existingOcr = {}) {
  let ocr = { ...existingOcr };

  // Step 1: Process documentFields
  if (documentFields) {
    ocr = buildOcrFromDocumentFields(documentFields, ocr);
  }

  // Step 2: Process visionFields and merge
  if (visionFields) {
    ocr = buildOcrFromVisionFields(visionFields, ocr);
  }

  // Step 3: Process userEditField (highest priority)
  if (userEditField) {
    ocr = buildOcrFromUserEdit(userEditField, ocr);
  }

  // Combine text - user_edit.text takes priority over document/vision text
  // Use existing mergeOcrSources() function for smart merge
  if (ocr.user_edit?.text) {
    ocr.google_raw = ocr.user_edit.text;
  } else if (ocr.document_output?.text && ocr.vision_output?.text) {
    // Smart merge using existing function with similarity checking
    ocr.google_raw = mergeOcrSources(ocr.document_output.text, ocr.vision_output.text);
  } else if (ocr.document_output?.text) {
    ocr.google_raw = ocr.document_output.text;
  } else if (ocr.vision_output?.text) {
    ocr.google_raw = ocr.vision_output.text;
  }

  // Merge entities arrays (userEdit entities take priority)
  ocr.entities = mergeEntities(
    ocr.document_output?.entities || [],
    ocr.vision_output?.entities || [],
    ocr.user_edit?.entities || []
  );

  // Extract fields for backward compatibility
  ocr.fields = extractFieldsFromEntities(ocr.entities);

  // Track sources
  ocr.sources = [];
  if (ocr.document_output) ocr.sources.push('document');
  if (ocr.vision_output) ocr.sources.push('vision');
  if (ocr.user_edit) ocr.sources.push('userEdit');

  // Calculate combined confidence (weighted average from all sources)
  const confidences = [];
  if (ocr.document_output?.confidence !== undefined) confidences.push(ocr.document_output.confidence);
  if (ocr.vision_output?.confidence !== undefined) confidences.push(ocr.vision_output.confidence);
  if (ocr.user_edit?.confidence !== undefined) confidences.push(ocr.user_edit.confidence);
  if (confidences.length > 0) {
    ocr.combined_confidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  // Max pageCount from all sources
  ocr.pageCount = Math.max(
    ocr.document_output?.pageCount || 0,
    ocr.vision_output?.pageCount || 0,
    ocr.user_edit?.pageCount || 0
  );

  return ocr;
}

module.exports = {
  // Legacy functions (will be deprecated)
  parseExternalOcrFields,
  buildOcrFromExternalFields,
  
  // New functions for document/vision/userEdit fields
  parseDocumentOutput,
  parseVisionOutput,
  parseUserEditOutput,
  extractTextFromDocumentOutput,
  extractTextFromVisionOutput,
  mergeEntities,
  extractFieldsFromEntities,
  buildOcrFromDocumentFields,
  buildOcrFromVisionFields,
  buildOcrFromUserEdit,
  buildOcrFromMultipleSources,
};

