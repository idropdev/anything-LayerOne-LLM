const fs = require("fs");
const path = require("path");
const { isWithin, normalizePath } = require("../files");
const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, `../../storage/documents`)
    : path.resolve(process.env.STORAGE_DIR, `documents`);

class DocumentManager {
  constructor({ workspace = null, maxTokens = null }) {
    this.workspace = workspace;
    this.maxTokens = maxTokens || Number.POSITIVE_INFINITY;
    this.documentStoragePath = documentsPath;
  }

  log(text, ...args) {
    console.log(`\x1b[36m[DocumentManager]\x1b[0m ${text}`, ...args);
  }

  async pinnedDocuments() {
    if (!this.workspace) return [];
    const { Document } = require("../../models/documents");
    return await Document.where({
      workspaceId: Number(this.workspace.id),
      pinned: true,
    });
  }

  async pinnedDocs() {
    if (!this.workspace) return [];
    const docPaths = (await this.pinnedDocuments()).map((doc) => doc.docpath);
    if (docPaths.length === 0) return [];

    let tokens = 0;
    const pinnedDocs = [];
    for await (const docPath of docPaths) {
      try {
        const filePath = path.resolve(this.documentStoragePath, docPath);
        const data = JSON.parse(
          fs.readFileSync(filePath, { encoding: "utf-8" })
        );

        if (
          !data.hasOwnProperty("pageContent") ||
          !data.hasOwnProperty("token_count_estimate")
        ) {
          this.log(
            `Skipping document - Could not find page content or token_count_estimate in pinned source.`
          );
          continue;
        }

        if (tokens >= this.maxTokens) {
          this.log(
            `Skipping document - Token limit of ${this.maxTokens} has already been exceeded by pinned documents.`
          );
          continue;
        }

        pinnedDocs.push(data);
        tokens += data.token_count_estimate || 0;
      } catch {}
    }

    this.log(
      `Found ${pinnedDocs.length} pinned sources - prepending to content with ~${tokens} tokens of content.`
    );
    return pinnedDocs;
  }

  async docsFromPaths(docPaths) {
    if (!docPaths || !Array.isArray(docPaths) || docPaths.length === 0) {
      return [];
    }

    // Security: Type validation - ensure all paths are strings
    if (!docPaths.every((p) => typeof p === "string")) {
      this.log("Security: Invalid documentPaths - all items must be strings");
      return [];
    }

    // Security: Limit array size to prevent DoS
    const MAX_DOCUMENT_PATHS = 100;
    if (docPaths.length > MAX_DOCUMENT_PATHS) {
      this.log(
        `Security: documentPaths truncated from ${docPaths.length} to ${MAX_DOCUMENT_PATHS} items`
      );
      docPaths = docPaths.slice(0, MAX_DOCUMENT_PATHS);
    }

    // Security: Validate documents belong to this workspace (prevents cross-workspace access)
    let allowedPaths = new Set();
    if (this.workspace) {
      const { Document } = require("../../models/documents");
      const workspaceDocs = await Document.where({
        workspaceId: Number(this.workspace.id),
        docpath: { in: docPaths },
      });
      allowedPaths = new Set(workspaceDocs.map((doc) => doc.docpath));

      const blockedCount = docPaths.length - allowedPaths.size;
      if (blockedCount > 0) {
        this.log(
          `Security: Blocked ${blockedCount} documents not belonging to workspace ${this.workspace.slug}`
        );
      }
    }

    const scopedDocs = [];
    for await (const docPath of docPaths) {
      try {
        // Security: Normalize and validate path to prevent directory traversal
        const normalizedPath = normalizePath(docPath);
        const filePath = path.resolve(this.documentStoragePath, normalizedPath);

        // Security: Ensure the resolved path is within the documents directory
        if (!isWithin(this.documentStoragePath, filePath)) {
          this.log(
            `Security: Blocked path traversal attempt - ${docPath} resolves outside storage directory`
          );
          continue;
        }

        // Security: Skip documents not belonging to this workspace
        if (this.workspace && !allowedPaths.has(docPath)) {
          continue; // Already logged in batch above
        }

        if (!fs.existsSync(filePath)) {
          this.log(`Skipping document - File not found: ${docPath}`);
          continue;
        }

        const data = JSON.parse(
          fs.readFileSync(filePath, { encoding: "utf-8" })
        );

        if (
          !data.hasOwnProperty("pageContent") ||
          !data.hasOwnProperty("token_count_estimate")
        ) {
          this.log(
            `Skipping document - Could not find page content or token_count_estimate in scoped source: ${docPath}`
          );
          continue;
        }

        // Critical: Do NOT enforce maxTokens check - bypass token limit
        scopedDocs.push(data);
      } catch (error) {
        this.log(
          `Skipping document - Error loading scoped source: ${docPath}`,
          error.message
        );
      }
    }

    this.log(
      `Found ${scopedDocs.length} scoped sources from ${docPaths.length} requested paths.`
    );
    return scopedDocs;
  }
}

module.exports.DocumentManager = DocumentManager;
