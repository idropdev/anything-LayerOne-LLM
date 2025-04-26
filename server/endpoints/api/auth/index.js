const { validApiKey } = require("../../../utils/middleware/validApiKey");
const ensureLoggedIn = require("../../../utils/middleware/ensureLoggedIn");

function apiAuthEndpoints(app) {
  if (!app) return;

  app.get("/v1/auth", [validApiKey, ensureLoggedIn], (req, res) => {
    /*
      #swagger.tags = ['Authentication']
      #swagger.description = 'Verify the attached Authentication header contains a valid API token and user session.'
      #swagger.responses[200] = {
        description: 'Valid API key and active session.',
        content: {
          "application/json": {
            schema: {
              type: 'object',
              example: {
                authenticated: true,
                user: { id: 1, username: 'john_doe', role: 'default' }
              }
            }
          }
        }
      }
      #swagger.responses[401] = {
        description: 'No active session. Permission denied.',
        content: {
          "application/json": {
            schema: {
              type: 'object',
              example: { authenticated: false, error: 'Not authenticated' }
            }
          }
        }
      }
      #swagger.responses[403] = {
        schema: { "$ref": "#/definitions/InvalidAPIKey" }
      }
      */

    // If we reach here, validApiKey passed and user has an active session
    const { id, username, role, pfpFilename, bio } = req.user;
    res.status(200).json({
      authenticated: true,
      user: { id, username, role, pfpFilename, bio },
    });
  });
}

module.exports = { apiAuthEndpoints };
