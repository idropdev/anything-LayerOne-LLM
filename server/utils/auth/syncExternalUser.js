/**
 * External User Synchronization
 *
 * Syncs external users from Keystone Core API to AnythingLLM database.
 * Creates or updates users based on external authentication data.
 */

const { User } = require("../../models/user");
const prisma = require("../prisma");
const { logAuthEvent } = require("./auditAuth");

/**
 * Sync external user from Keystone Core API to AnythingLLM database
 *
 * @param {Object} externalUser - User data from Keystone Core API
 * @param {string} externalUser.id - External user ID (sub claim)
 * @param {string|null} externalUser.email - User email (may be null for Apple)
 * @param {Object|string} externalUser.role - Role from Keystone Core API ({ id, name } or string)
 * @param {string|null} externalUser.provider - Auth provider ("google", "apple", "facebook", "email")
 * @param {string|null} externalUser.firstName - First name (optional)
 * @param {string|null} externalUser.lastName - Last name (optional)
 * @param {Object|null} existingUser - Existing user if already found
 * @returns {Promise<Object>} Synced user object
 */
async function syncExternalUser(externalUser, existingUser = null) {
  const {
    id: externalId,
    email,
    role,
    provider,
    firstName,
    lastName,
  } = externalUser;

  // Generate username from email if not provided
  // Fallback to user_{externalId} if no email
  const username = email
    ? email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9_\-.]/g, "")
    : `user_${externalId}`;

  // If no existing user found by externalId, check by username
  // This handles the case where user was created proactively but doesn't have externalId set yet
  if (!existingUser) {
    try {
      const validatedUsername = User.validations.username(username);
      const userByUsername = await prisma.users.findFirst({
        where: {
          username: validatedUsername,
        },
      });
      if (userByUsername) {
        existingUser = User.filterFields(userByUsername);
      }
    } catch (error) {
      // Ignore lookup errors, proceed with creation
      console.warn("Failed to lookup user by username:", error.message);
    }
  }

  if (existingUser) {
    // Update existing user with external ID if not set
    if (!existingUser.externalId) {
      // Update via Prisma directly since externalId is not in writable fields
      await prisma.users.update({
        where: { id: existingUser.id },
        data: {
          externalId: String(externalId),
          externalProvider: "keystone-core-api",
          role: mapExternalRoleToAnythingLLMRole(role),
        },
      });

      // Refresh user data
      const updatedUser = await prisma.users.findUnique({
        where: { id: existingUser.id },
      });
      existingUser = User.filterFields(updatedUser);

      // Log user sync event
      logAuthEvent(
        "external_user_synced",
        {
          userId: existingUser.id,
          externalUserId: externalId,
          action: "linked", // User existed but was linked to external auth
        },
        existingUser.id
      );
    } else {
      // Just update role if externalId already set
      await User.update(existingUser.id, {
        role: mapExternalRoleToAnythingLLMRole(role),
        // TODO: Update other fields as needed (firstName, lastName, email if allowed)
      });

      // Log user sync event
      logAuthEvent(
        "external_user_synced",
        {
          userId: existingUser.id,
          externalUserId: externalId,
          action: "updated",
        },
        existingUser.id
      );
    }

    // Return user with externalId/externalProvider
    return {
      ...existingUser,
      externalId: String(externalId),
      externalProvider: "keystone-core-api",
    };
  }

  // Create new user
  // Note: User.create requires password, but we'll bypass validation for external users
  // by allowing null password and updating via Prisma directly
  try {
    // Validate username format
    if (!User.usernameRegex.test(username)) {
      // Fallback to a safe username
      const safeUsername = `user_${externalId}`.substring(0, 100);
      if (!User.usernameRegex.test(safeUsername)) {
        throw new Error(
          "Unable to generate valid username from external user data"
        );
      }
      var finalUsername = safeUsername;
    } else {
      var finalUsername = username;
    }

    // Create user with minimal required fields
    // We'll use a placeholder password that will never be used
    const placeholderPassword = `external_auth_${externalId}_${Date.now()}`;
    const bcrypt = require("bcrypt");
    const hashedPassword = bcrypt.hashSync(placeholderPassword, 10);

    const user = await prisma.users.create({
      data: {
        username: User.validations.username(finalUsername),
        password: hashedPassword,
        role: mapExternalRoleToAnythingLLMRole(role),
        bio: "",
        dailyMessageLimit: null,
      },
    });

    // Set external ID (requires direct DB update since not in writable fields)
    await prisma.users.update({
      where: { id: user.id },
      data: {
        externalId: String(externalId),
        externalProvider: "keystone-core-api",
      },
    });

    const syncedUser = {
      ...User.filterFields(user),
      externalId: String(externalId),
      externalProvider: "keystone-core-api",
    };

    // Log user sync event
    logAuthEvent(
      "external_user_synced",
      {
        userId: user.id,
        externalUserId: externalId,
        action: "created",
      },
      user.id
    );

    return syncedUser;
  } catch (error) {
    // If username conflict, try to find existing user by username or external ID
    if (error.code === "P2002" || error.message.includes("Unique constraint")) {
      // First try by external ID
      const existingByExternal = await findByExternalId(externalId);
      if (existingByExternal) {
        return existingByExternal;
      }

      // Then try by username (user was created proactively)
      try {
        const validatedUsername = User.validations.username(finalUsername);
        const userByUsername = await prisma.users.findFirst({
          where: {
            username: validatedUsername,
          },
        });
        if (userByUsername) {
          // Update with externalId
          await prisma.users.update({
            where: { id: userByUsername.id },
            data: {
              externalId: String(externalId),
              externalProvider: "keystone-core-api",
              role: mapExternalRoleToAnythingLLMRole(role),
            },
          });

          const updatedUser = await prisma.users.findUnique({
            where: { id: userByUsername.id },
          });

          logAuthEvent(
            "external_user_synced",
            {
              userId: updatedUser.id,
              externalUserId: externalId,
              action: "linked",
            },
            updatedUser.id
          );

          return {
            ...User.filterFields(updatedUser),
            externalId: String(externalId),
            externalProvider: "keystone-core-api",
          };
        }
      } catch (lookupError) {
        // Ignore lookup errors
      }
    }
    throw new Error(`Failed to create user: ${error.message}`);
  }
}

/**
 * Map Keystone Core API roles to AnythingLLM roles
 *
 * @param {Object|string} externalRole - Role from Keystone Core API
 * @returns {string} AnythingLLM role
 */
function mapExternalRoleToAnythingLLMRole(externalRole) {
  // Keystone Core API roles: { id: 1, name: 'admin' } or { id: 2, name: 'user' }
  const roleMap = {
    admin: "admin", // Keystone admin → AnythingLLM admin
    user: "default", // Keystone user → AnythingLLM default
  };

  // Handle role object or string
  const roleName = externalRole?.name || externalRole;
  return roleMap[roleName] || "default";
}

/**
 * Find user by external ID
 *
 * @param {string} externalId - External user ID from Keystone Core API
 * @param {string} provider - Provider name (default: "keystone-core-api")
 * @returns {Promise<Object|null>} User object or null
 */
async function findByExternalId(externalId, provider = "keystone-core-api") {
  return await User.findByExternalId(externalId, provider);
}

module.exports = {
  syncExternalUser,
  findByExternalId,
  mapExternalRoleToAnythingLLMRole,
};
