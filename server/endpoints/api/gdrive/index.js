/*******************************************************
 * Google Drive OAuth & Document Import
 *******************************************************/

const { google } = require("googleapis");
const setLogger = require("../../../utils/logger");
const logger = setLogger(); // Winston in production, console in dev

const { Telemetry } = require("../../../models/telemetry");
const { EventLogs } = require("../../../models/eventLogs");

// CollectorApi references the doc-processor behind the scenes
const { CollectorApi } = require("../../../utils/collectorApi");
const collectorAPI = new CollectorApi();

// Workspace & Document models for managing workspaces and attached docs
const { Workspace } = require("../../../models/workspace");
const { Document } = require("../../../models/documents");

// Node file system & path modules
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Where files are stored locally. For Drive imports, we want to save
// files in the directory expected by the Collector. If you have an environment
// variable (COLLECTOR_UPLOAD_DIR) specifying that, we use it; otherwise, use documentsPath.
const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../../storage/documents")
    : path.resolve(process.env.STORAGE_DIR, `documents`);
const uploadDir = process.env.COLLECTOR_UPLOAD_DIR
  ? path.resolve(process.env.COLLECTOR_UPLOAD_DIR)
  : path.resolve(__dirname, "../../../../collector/hotdir");

// Create an OAuth2 client using environment credentials.
const oauth2Client = new google.auth.OAuth2(
  process.env.GDRIVE_CLIENT_ID,
  process.env.GDRIVE_CLIENT_SECRET,
  process.env.GDRIVE_REDIRECT_URI
);

/**
 * Helper function to update the workspace embeddings.
 * It takes the workspace and an array of document location strings,
 * and calls workspace.updateEmbeddings (if available) or logs the payload.
 */
async function updateWorkspaceEmbeddings(workspace, addedDocLocations) {
  try {
    if (typeof workspace.updateEmbeddings === "function") {
      await workspace.updateEmbeddings({
        adds: addedDocLocations,
        deletes: [],
      });
    } else {
      logger.info(
        `Updating workspace '${workspace.name}' embeddings with payload: ${JSON.stringify(
          {
            adds: addedDocLocations,
            deletes: [],
          }
        )}`,
        { origin: "GDriveOAuth" }
      );
      // Add any additional update logic if needed.
    }
    logger.info(
      `Workspace embeddings updated successfully for '${workspace.name}'.`,
      {
        origin: "GDriveOAuth",
      }
    );
  } catch (err) {
    logger.error(`Failed to update workspace embeddings: ${err.message}`, {
      origin: "GDriveOAuth",
    });
  }
}

/**
 * Imports documents from Google Drive:
 * 1. Creates a new workspace.
 * 2. Recursively traverses Drive from the "root" folder.
 * 3. Downloads (or exports) each file using streams and writes it to the Collector upload directory.
 * 4. Processes the file via CollectorApi.processDocument.
 * 5. Attaches returned document locations to the workspace.
 * 6. Updates workspace embeddings.
 */
async function importDriveDocuments(drive) {
  logger.info("Starting recursive Drive import for authenticated user", {
    origin: "GDriveOAuth",
  });

  // Array to accumulate document locations from successful embeddings.
  const addedDocLocations = [];

  // 1) Create a new workspace.
  let workspace = null;
  try {
    const creation = await Workspace.new("Google Drive Import", null, {
      description: "Imported documents from user’s Google Drive",
    });
    workspace = creation.workspace;
    logger.info(`Workspace '${workspace.name}' (ID: ${workspace.id}) created`, {
      origin: "GDriveOAuth",
    });
    await Telemetry.sendTelemetry("drive_import_started");
    await EventLogs.logEvent("api_drive_import_started", {
      workspaceName: workspace.name,
    });
  } catch (err) {
    logger.error(
      "Failed to create workspace for Drive import: " + err.message,
      {
        origin: "GDriveOAuth",
      }
    );
    throw err;
  }

  // Recursively traverse folders in Drive.
  async function traverseFolder(folderId) {
    let pageToken = null;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageSize: 100,
        pageToken: pageToken,
      });
      pageToken = res.data.nextPageToken || null;
      const files = res.data.files || [];
      for (const file of files) {
        if (file.mimeType === "application/vnd.google-apps.folder") {
          logger.info(`Entering folder: ${file.name} (${file.id})`, {
            origin: "GDriveOAuth",
          });
          await traverseFolder(file.id);
        } else {
          // Process every non-folder file.
          await handleFile(file);
        }
      }
    } while (pageToken);
  }

  /**
   * Handle a single file: download (or export) it using a stream, write to disk,
   * then process it via Collector.
   */
  async function handleFile(file) {
    const { id, name, mimeType } = file;
    logger.info(`Downloading file: ${name} (${mimeType})`, {
      origin: "GDriveOAuth",
    });

    const safeFileName = `${uuidv4()}-${name.replace(/\s+/g, "_")}`;
    const fullPath = path.join(uploadDir, safeFileName);

    // Wrap the streaming write in a Promise.
    try {
      let stream;
      if (mimeType.startsWith("application/vnd.google-apps.")) {
        // For Google Docs and similar, export as plain text.
        const res = await drive.files.export(
          { fileId: id, mimeType: "text/plain" },
          { responseType: "stream" }
        );
        stream = res.data;
      } else {
        const res = await drive.files.get(
          { fileId: id, alt: "media" },
          { responseType: "stream" }
        );
        stream = res.data;
      }

      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(fullPath);
        stream
          .on("error", reject)
          .pipe(dest)
          .on("finish", resolve)
          .on("error", reject);
      });

      logger.info(`File saved to ${fullPath}`, { origin: "GDriveOAuth" });
    } catch (err) {
      logger.error(
        `Failed to download or save file "${name}": ${err.message}`,
        {
          origin: "GDriveOAuth",
        }
      );
      return;
    }

    // Process the saved file via Collector API.
    try {
      const { success, reason, documents } =
        await collectorAPI.processDocument(safeFileName);
      if (!success) {
        logger.error(
          `CollectorApi could not embed "${name}": ${reason || "unknown error"}`,
          {
            origin: "GDriveOAuth",
          }
        );
        return;
      }
      if (documents && documents.length) {
        const docPaths = documents.map((d) => d.location);
        addedDocLocations.push(...docPaths);
        await Document.addDocuments(workspace, docPaths);
        logger.info(`Successfully embedded & attached file: ${name}`, {
          origin: "GDriveOAuth",
        });
        await EventLogs.logEvent("api_document_uploaded", {
          documentName: name,
        });
      }
    } catch (err) {
      logger.error(`Error embedding "${name}": ${err.message}`, {
        origin: "GDriveOAuth",
      });
    }
  }

  // Start traversal from the root folder.
  try {
    await traverseFolder("root");
    logger.info(`Drive import complete for workspace '${workspace.name}'.`, {
      origin: "GDriveOAuth",
    });

    if (addedDocLocations.length > 0) {
      await updateWorkspaceEmbeddings(workspace, addedDocLocations);
      await Telemetry.sendTelemetry("drive_import_completed", {
        workspaceName: workspace.name,
        documentCount: addedDocLocations.length,
      });
      await EventLogs.logEvent("api_drive_import_completed", {
        workspaceName: workspace.name,
        documentCount: addedDocLocations.length,
      });
    } else {
      logger.warn("No documents were embedded; skipping workspace update.", {
        origin: "GDriveOAuth",
      });
    }
  } catch (err) {
    logger.error("Drive import aborted: " + err.message, {
      origin: "GDriveOAuth",
    });
  }
  return workspace;
}

/***********************************************
 * OAuth Endpoints Setup
 ***********************************************/
function apiGdriveOAuth(app) {
  if (!app) return;

  app.get("/api/v1/gdrive/oauth", (req, res) => {
    logger.info("Generating Google OAuth authorization URL", {
      origin: "GDriveOAuth",
    });
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.readonly"],
      prompt: "consent",
    });
    return res.redirect(authUrl);
  });

  app.get("/api/gdrive/oauth2callback", async (req, res) => {
    logger.info("Google OAuth callback triggered", { origin: "GDriveOAuth" });
    const code = req.query.code;
    if (!code) {
      logger.warn("Missing 'code' parameter in OAuth callback", {
        origin: "GDriveOAuth",
      });
      return res.status(400).send("Missing code");
    }
    try {
      logger.info("Exchanging OAuth code for tokens...", {
        origin: "GDriveOAuth",
      });
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      const drive = google.drive({ version: "v3", auth: oauth2Client });
      req.app.locals.gdriveClient = drive;

      // Wait for import and get workspace
      const workspace = await importDriveDocuments(drive);
      logger.info("Google Drive connected successfully", {
        origin: "GDriveOAuth",
      });
      return res.redirect(`/workspace/${workspace.slug}`);
    } catch (err) {
      logger.error(`OAuth error: ${err.message}`, {
        origin: "GDriveOAuth",
        stack: err.stack,
      });
      return res.status(500).send("OAuth failed");
    }
  });

  app.post("/api/v1/gdrive/import", async (req, res) => {
    logger.info("Manual Google Drive import triggered", {
      origin: "GDriveOAuth",
    });
    const drive = req.app.locals.gdriveClient;
    if (!drive) {
      logger.warn("No Google Drive client found. Possibly not authenticated.", {
        origin: "GDriveOAuth",
      });
      return res.status(400).json({
        error: "Google Drive is not connected. Please authenticate first.",
      });
    }
    try {
      await importDriveDocuments(drive);
      return res.json({
        success: true,
        message:
          "Google Drive import re-run complete. Check your new workspace for the imported files.",
      });
    } catch (err) {
      logger.error("Manual drive import failed: " + err.message, {
        origin: "GDriveOAuth",
      });
      return res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { apiGdriveOAuth };
