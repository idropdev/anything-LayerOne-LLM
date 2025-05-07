const { User } = require("../../../models/user");
const { TemporaryAuthToken } = require("../../../models/temporaryAuthToken");
const { multiUserMode } = require("../../../utils/http");
const {
  simpleSSOEnabled,
} = require("../../../utils/middleware/simpleSSOEnabled");
const { validApiKey } = require("../../../utils/middleware/validApiKey");
const passport = require("../../../utils/passport");
const ensureLoggedIn = require("../../../utils/middleware/ensureLoggedIn");

function apiUserManagementEndpoints(app) {
  if (!app) return;

  // List all users
  app.get("/v1/users", [validApiKey], async (request, response) => {
    /* #swagger.tags = ['User Management'] */
    try {
      if (!multiUserMode(response))
        return response
          .status(401)
          .send("Instance is not in Multi-User mode. Permission denied.");

      const users = await User.where();
      const filteredUsers = users.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
      }));
      response.status(200).json({ users: filteredUsers });
    } catch (e) {
      console.error(e.message, e);
      response.sendStatus(500).end();
    }
  });

  // Issue a temporary auth token
  app.get(
    "/v1/users/:id/issue-auth-token",
    [validApiKey, simpleSSOEnabled],
    async (request, response) => {
      /* #swagger.tags = ['User Management'] */
      try {
        const { id: userId } = request.params;
        const user = await User.get({ id: Number(userId) });
        if (!user)
          return response.status(404).json({ error: "User not found" });

        const { token, error } = await TemporaryAuthToken.issue(userId);
        if (error) return response.status(500).json({ error });

        response.status(200).json({
          token: String(token),
          loginPath: `/sso/simple?token=${token}`,
        });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  // Google OAuth login
  app.get(
    "/v1/users/google/login",
    [validApiKey],
    passport.authenticate("google", {
      scope: ["email", "https://www.googleapis.com/auth/drive.readonly"],
      prompt: "consent",
    })
  );

  // Google OAuth callback
  app.get(
    "/v1/users/google/callback",
    [validApiKey],
    // if Google didn't provide an authorization code, redirect back to login
    (req, res, next) => {
      if (!req.query.code) {
        return res.redirect("/api/v1/users/google/login");
      }
      next();
    },
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
      // At this point, Passport has set and return to normal workflow
      return res.redirect("/api/v1/gdrive/oauth");
    }
  );

  // Logout endpoint
  app.post("/v1/users/logout", [
    validApiKey, 
    ensureLoggedIn], (req, res) => {
    req.logout(function (err) {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ error: "Logout failed" });
      }

      res.clearCookie("connect.sid");
      res.sendStatus(204);
    });
  });
}

module.exports = { apiUserManagementEndpoints };
