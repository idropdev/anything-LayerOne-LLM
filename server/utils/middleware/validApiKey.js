const { adminOnlyAuth } = require("./unifiedAuth");

// For backward compatibility, validApiKey now uses adminOnlyAuth
// This ensures all developer API endpoints use the unified authentication
async function validApiKey(request, response, next) {
  return adminOnlyAuth(request, response, next);
}

module.exports = {
  validApiKey,
};
