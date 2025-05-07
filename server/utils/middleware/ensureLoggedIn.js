/**
 * Middleware to ensure the user is authenticated via Passport session.
 * If not authenticated, responds with 401 and JSON error.
 */
module.exports = function ensureLoggedIn(req, res, next) {
  if (req.isAuthenticated?.() && req.user?.accessToken) {
    return next();
  }

  return res.status(401).json({
    authenticated: false,
    error: "Not authenticated",
  });
};
