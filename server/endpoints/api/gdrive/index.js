const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  process.env.GDRIVE_CLIENT_ID,
  process.env.GDRIVE_CLIENT_SECRET,
  process.env.GDRIVE_REDIRECT_URI
);

function apiGdriveOAuth(app) {
  if (!app) return;

  app.get("/api/v1/gdrive/oauth", (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/drive.readonly"],
      prompt: "consent",
    });

    res.redirect(authUrl);
  });

  app.get("/api/gdrive/oauth2callback", async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code");

    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Store for later g-drive API use
      req.app.locals.gdriveClient = google.drive({
        version: "v3",
        auth: oauth2Client,
      });

      res.send("Google Drive connected! You can close this tab.");
    } catch (err) {
      console.error("OAuth error", err);
      res.status(500).send("OAuth failed");
    }
  });
}

module.exports = { apiGdriveOAuth };
