/*******************************************************
 * Google Drive OAuth & Document Import
 *******************************************************/

const { google } = require("googleapis");
const setLogger = require("../../../utils/logger");
const logger = setLogger(); // Winston in production, console in dev

// CollectorApi references the doc-processor behind the scenes
const { CollectorApi } = require("../../../utils/collectorApi");
const collectorAPI = new CollectorApi();

// The Workspace & Document models let us create a new workspace and attach doc files
const { Workspace } = require("../../../models/workspace");
const { Document } = require("../../../models/documents");

// We'll need to write Drive files locally to parse them
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Where to store downloaded files before passing them to CollectorApi
// Adjust if your code uses a different location or environment variable.
const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../../storage/documents")
    : path.resolve(process.env.STORAGE_DIR, `documents`);

// Create an OAuth2 client with environment credentials
const oauth2Client = new google.auth.OAuth2(
  process.env.GDRIVE_CLIENT_ID,
  process.env.GDRIVE_CLIENT_SECRET,
  process.env.GDRIVE_REDIRECT_URI
);

/**
 * This function:
 * 1. Creates a new workspace for the user's Drive docs.
 * 2. Recursively traverses the user's Drive, downloading PDF/TXT/DOCX files.
 * 3. For each downloaded file, calls the doc-processor (Collector) to embed.
 * 4. Finally, attaches the doc references to the new workspace.
 */
async function importDriveDocuments(drive) {
  logger.info("Starting recursive Drive import for authenticated user", {
    origin: "GDriveOAuth",
  });

  // 1) Create a brand-new workspace via Workspace.new(...)
  let workspace = null;
  try {
    const creation = await Workspace.new("Google Drive Import", null, {
      description: "Imported documents from user’s Google Drive",
    });
    workspace = creation.workspace;
    logger.info(`Workspace '${workspace.name}' (ID: ${workspace.id}) created`, {
      origin: "GDriveOAuth",
    });
  } catch (err) {
    logger.error(
      "Failed to create workspace for Drive import: " + err.message,
      { origin: "GDriveOAuth" }
    );
    throw err; // Stop if we can't create the workspace
  }

  // 2) We only care about PDF, TXT, DOCX (and possibly .doc if you wish)
  const parsableTypes = new Set([
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword", // older .doc
  ]);

  /**
   * Recursively list all files from Google Drive for a given folder.
   * Default entry: "root".
   */
  async function traverseFolder(folderId) {
    let pageToken = null;

    do {
      // List all children in this folder
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
          // Recurse into subfolder
          logger.info(`Entering folder: ${file.name} (${file.id})`, {
            origin: "GDriveOAuth",
          });
          await traverseFolder(file.id);
        } else if (parsableTypes.has(file.mimeType)) {
          await handleFile(file);
        } else {
          // Not a folder, not a supported type => skip
          logger.verbose(
            `Skipping non-parsable file: ${file.name} [${file.mimeType}]`,
            { origin: "GDriveOAuth" }
          );
        }
      }
    } while (pageToken);
  }

  /**
   * Download a single file, store it locally, then call the doc-processor to embed it.
   * Finally, attach the doc references to the workspace.
   */
  async function handleFile(file) {
    const { id, name, mimeType } = file;
    logger.info(`Downloading file: ${name} (${mimeType})`, {
      origin: "GDriveOAuth",
    });

    let contentBuffer;
    try {
      // 2a) Download the file data
      const fileRes = await drive.files.get(
        { fileId: id, alt: "media" },
        { responseType: "arraybuffer" }
      );
      contentBuffer = fileRes.data;
    } catch (err) {
      logger.error(`Error downloading file "${name}": ${err.message}`, {
        origin: "GDriveOAuth",
      });
      return; // skip
    }

    // 2b) Save the file locally so CollectorApi can process it by filename
    const safeFileName = `${uuidv4()}-${name.replace(/\s+/g, "_")}`;
    const fullPath = path.join(documentsPath, safeFileName);
    try {
      fs.writeFileSync(fullPath, Buffer.from(contentBuffer));
    } catch (err) {
      logger.error(`Failed to save file "${name}" locally: ${err.message}`, {
        origin: "GDriveOAuth",
      });
      return;
    }

    // 2c) Ask CollectorApi to parse & embed the doc
    try {
      const { success, reason, documents } = await collectorAPI.processDocument(
        safeFileName // must match exactly the file name we wrote to local storage
      );
      if (!success) {
        logger.error(
          `CollectorApi could not embed "${name}": ${reason || "unknown error"}`,
          { origin: "GDriveOAuth" }
        );
        return;
      }

      if (documents?.length) {
        // 2d) Add these docs to the workspace DB so we can see them in /v1/workspace
        // Each doc has a .location field that references a JSON doc file in local storage
        const docPaths = documents.map((d) => d.location); // e.g. "custom-documents/filename.json"
        await Document.addDocuments(workspace, docPaths);
        logger.info(`Successfully embedded & attached file: ${name}`, {
          origin: "GDriveOAuth",
        });
      }
    } catch (err) {
      logger.error(`Error embedding "${name}": ${err.message}`, {
        origin: "GDriveOAuth",
      });
    }
  }

  // 3) Start recursion from the user's root folder
  try {
    await traverseFolder("root");
    logger.info(`Drive import complete for workspace '${workspace.name}'.`, {
      origin: "GDriveOAuth",
    });
  } catch (err) {
    logger.error("Drive import aborted: " + err.message, {
      origin: "GDriveOAuth",
    });
  }
}

/***********************************************
 * The main module: sets up OAuth endpoints.
 ***********************************************/

function apiGdriveOAuth(app) {
  if (!app) return;

  // 1) Start OAuth flow
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

  // 2) OAuth callback
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

      // Build an authenticated Drive client for the user
      const drive = google.drive({
        version: "v3",
        auth: oauth2Client,
      });
      req.app.locals.gdriveClient = drive;

      // Automatically start the import in the background
      importDriveDocuments(drive)
        .then(() =>
          logger.info("Drive import initiated successfully", {
            origin: "GDriveOAuth",
          })
        )
        .catch((err) =>
          logger.error("Drive import initiation failed: " + err.message, {
            origin: "GDriveOAuth",
          })
        );

      logger.info("Google Drive connected successfully", {
        origin: "GDriveOAuth",
      });
      res.send(
        "Google Drive connected! A background import of your PDF, TXT, and DOCX files has started. You can close this tab."
      );
    } catch (err) {
      logger.error(`OAuth error: ${err.message}`, {
        origin: "GDriveOAuth",
        stack: err.stack,
      });
      return res.status(500).send("OAuth failed");
    }
  });

  // 3) (Optional) Manual re-import endpoint
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
