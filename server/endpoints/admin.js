const { ApiKey } = require("../models/apiKeys");
const { Document } = require("../models/documents");
const { EventLogs } = require("../models/eventLogs");
const { Invite } = require("../models/invite");
const { SystemSettings } = require("../models/systemSettings");
const { User } = require("../models/user");
const { DocumentVectors } = require("../models/vectors");
const { Workspace } = require("../models/workspace");
const { WorkspaceChats } = require("../models/workspaceChats");
const {
  getVectorDbClass,
  getEmbeddingEngineSelection,
} = require("../utils/helpers");
const {
  validRoleSelection,
  canModifyAdmin,
  validCanModify,
} = require("../utils/helpers/admin");
const { reqBody, safeJsonParse } = require("../utils/http");
const { requireAdmin } = require("../utils/middleware/requireAdmin");
const { requireAdminJWT } = require("../utils/middleware/requireAdminJWT");
const ImportedPlugin = require("../utils/agents/imported");
const {
  logEndpointOperation,
  logEndpointError,
} = require("../utils/helpers/endpointLogger");

function adminEndpoints(app) {
  if (!app) return;

  app.get("/admin/users", [requireAdmin], async (request, response) => {
    try {
      const users = await User.where();
      await logEndpointOperation({
        method: "GET",
        path: "/admin/users",
        operation: "admin_users_listed",
        metadata: { userCount: users.length },
        userId: request.user?.id,
      });
      response.status(200).json({ users });
    } catch (e) {
      logEndpointError({
        method: "GET",
        path: "/admin/users",
        operation: "admin_users_listed",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.post("/admin/users/new", [requireAdmin], async (request, response) => {
    try {
      // In single-user mode, request.user.id will be null - skip this operation
      if (!request.user.id) {
        return response.status(400).json({
          user: null,
          error: "User management not available in single-user mode",
        });
      }
      const currUser = await User.get({ id: request.user.id });
      const newUserParams = reqBody(request);
      const roleValidation = validRoleSelection(currUser, newUserParams);

      if (!roleValidation.valid) {
        response.status(200).json({ user: null, error: roleValidation.error });
        return;
      }

      const { user: newUser, error } = await User.create(newUserParams);
      if (!!newUser) {
        await EventLogs.logEvent(
          "user_created",
          {
            userName: newUser.username,
            createdBy: currUser.username,
          },
          currUser.id
        );
        await logEndpointOperation({
          method: "POST",
          path: "/admin/users/new",
          operation: "admin_user_created",
          metadata: {
            userName: newUser.username,
            userRole: newUser.role,
            createdBy: currUser.username,
          },
          userId: currUser.id,
          skipEventLog: true, // Already logged above
        });
      }

      response.status(200).json({ user: newUser, error });
    } catch (e) {
      logEndpointError({
        method: "POST",
        path: "/admin/users/new",
        operation: "admin_user_created",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.post("/admin/user/:id", [requireAdmin], async (request, response) => {
    try {
      // In single-user mode, request.user.id will be null - skip this operation
      if (!request.user.id) {
        return response.status(400).json({
          success: false,
          error: "User management not available in single-user mode",
        });
      }
      const currUser = await User.get({ id: request.user.id });
      const { id } = request.params;
      const updates = reqBody(request);
      const user = await User.get({ id: Number(id) });

      const canModify = validCanModify(currUser, user);
      if (!canModify.valid) {
        response.status(200).json({ success: false, error: canModify.error });
        return;
      }

      const roleValidation = validRoleSelection(currUser, updates);
      if (!roleValidation.valid) {
        response
          .status(200)
          .json({ success: false, error: roleValidation.error });
        return;
      }

      const validAdminRoleModification = await canModifyAdmin(user, updates);
      if (!validAdminRoleModification.valid) {
        response
          .status(200)
          .json({ success: false, error: validAdminRoleModification.error });
        return;
      }

      const { success, error } = await User.update(id, updates);
      if (success) {
        await logEndpointOperation({
          method: "POST",
          path: "/admin/user/:id",
          operation: "admin_user_updated",
          metadata: {
            targetUserId: id,
            targetUserName: user.username,
            updatedBy: currUser.username,
            updatedFields: Object.keys(updates),
          },
          userId: currUser.id,
        });
      }
      response.status(200).json({ success, error });
    } catch (e) {
      logEndpointError({
        method: "POST",
        path: "/admin/user/:id",
        operation: "admin_user_updated",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.delete("/admin/user/:id", [requireAdmin], async (request, response) => {
    try {
      // In single-user mode, request.user.id will be null - skip this operation
      if (!request.user.id) {
        return response.status(400).json({
          success: false,
          error: "User management not available in single-user mode",
        });
      }
      const currUser = await User.get({ id: request.user.id });
      const { id } = request.params;
      const user = await User.get({ id: Number(id) });

      const canModify = validCanModify(currUser, user);
      if (!canModify.valid) {
        response.status(200).json({ success: false, error: canModify.error });
        return;
      }

      await User.delete({ id: Number(id) });
      await EventLogs.logEvent(
        "user_deleted",
        {
          userName: user.username,
          deletedBy: currUser.username,
        },
        currUser.id
      );
      await logEndpointOperation({
        method: "DELETE",
        path: "/admin/user/:id",
        operation: "admin_user_deleted",
        metadata: {
          targetUserId: id,
          targetUserName: user.username,
          deletedBy: currUser.username,
        },
        userId: currUser.id,
        skipEventLog: true, // Already logged above
      });
      response.status(200).json({ success: true, error: null });
    } catch (e) {
      logEndpointError({
        method: "DELETE",
        path: "/admin/user/:id",
        operation: "admin_user_deleted",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.get("/admin/invites", [requireAdmin], async (request, response) => {
    try {
      const invites = await Invite.whereWithUsers();
      await logEndpointOperation({
        method: "GET",
        path: "/admin/invites",
        operation: "admin_invites_listed",
        metadata: { inviteCount: invites.length },
        userId: request.user?.id,
      });
      response.status(200).json({ invites });
    } catch (e) {
      logEndpointError({
        method: "GET",
        path: "/admin/invites",
        operation: "admin_invites_listed",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.post("/admin/invite/new", [requireAdmin], async (request, response) => {
    try {
      // In single-user mode, request.user.id will be null - skip this operation
      if (!request.user.id) {
        return response.status(400).json({
          invite: null,
          error: "Invite management not available in single-user mode",
        });
      }
      const user = await User.get({ id: request.user.id });
      const body = reqBody(request);
      const { invite, error } = await Invite.create({
        createdByUserId: user.id,
        workspaceIds: body?.workspaceIds || [],
      });

      await EventLogs.logEvent(
        "invite_created",
        {
          inviteCode: invite.code,
          createdBy: request.user.username,
        },
        request.user.id
      );
      await logEndpointOperation({
        method: "POST",
        path: "/admin/invite/new",
        operation: "admin_invite_created",
        metadata: {
          inviteCode: invite.code,
          workspaceIds: body?.workspaceIds || [],
          createdBy: request.user.username,
        },
        userId: request.user.id,
        skipEventLog: true, // Already logged above
      });
      response.status(200).json({ invite, error });
    } catch (e) {
      logEndpointError({
        method: "POST",
        path: "/admin/invite/new",
        operation: "admin_invite_created",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.delete("/admin/invite/:id", [requireAdmin], async (request, response) => {
    try {
      const { id } = request.params;
      const { success, error } = await Invite.deactivate(id);
      await EventLogs.logEvent(
        "invite_deleted",
        { deletedBy: request.user.username || "admin" },
        request.user.id
      );
      await logEndpointOperation({
        method: "DELETE",
        path: "/admin/invite/:id",
        operation: "admin_invite_deleted",
        metadata: {
          inviteId: id,
          deletedBy: request.user.username || "admin",
        },
        userId: request.user.id,
        skipEventLog: true, // Already logged above
      });
      response.status(200).json({ success, error });
    } catch (e) {
      logEndpointError({
        method: "DELETE",
        path: "/admin/invite/:id",
        operation: "admin_invite_deleted",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.get("/admin/workspaces", [requireAdmin], async (request, response) => {
    try {
      const workspaces = await Workspace.whereWithUsers();
      await logEndpointOperation({
        method: "GET",
        path: "/admin/workspaces",
        operation: "admin_workspaces_listed",
        metadata: { workspaceCount: workspaces.length },
        userId: request.user?.id,
      });
      response.status(200).json({ workspaces });
    } catch (e) {
      logEndpointError({
        method: "GET",
        path: "/admin/workspaces",
        operation: "admin_workspaces_listed",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.get(
    "/admin/workspaces/:workspaceId/users",
    [requireAdmin],
    async (request, response) => {
      try {
        const { workspaceId } = request.params;
        const users = await Workspace.workspaceUsers(workspaceId);
        await logEndpointOperation({
          method: "GET",
          path: "/admin/workspaces/:workspaceId/users",
          operation: "admin_workspace_users_listed",
          metadata: {
            workspaceId,
            userCount: users.length,
          },
          userId: request.user?.id,
        });
        response.status(200).json({ users });
      } catch (e) {
        logEndpointError({
          method: "GET",
          path: "/admin/workspaces/:workspaceId/users",
          operation: "admin_workspace_users_listed",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/admin/workspaces/new",
    [requireAdmin],
    async (request, response) => {
      try {
        // In single-user mode, request.user.id will be null - use a default or handle appropriately
        if (!request.user.id) {
          return response.status(400).json({
            workspace: null,
            error: "Workspace creation requires multi-user mode",
          });
        }
        const user = await User.get({ id: request.user.id });
        const { name } = reqBody(request);
        const { workspace, message: error } = await Workspace.new(
          name,
          user.id
        );
        if (workspace) {
          await logEndpointOperation({
            method: "POST",
            path: "/admin/workspaces/new",
            operation: "admin_workspace_created",
            metadata: {
              workspaceName: workspace.name,
              workspaceId: workspace.id,
              createdBy: user.username,
            },
            userId: user.id,
          });
        }
        response.status(200).json({ workspace, error });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/admin/workspaces/new",
          operation: "admin_workspace_created",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/admin/workspaces/:workspaceId/update-users",
    [requireAdmin],
    async (request, response) => {
      try {
        const { workspaceId } = request.params;
        const { userIds } = reqBody(request);
        const { success, error } = await Workspace.updateUsers(
          workspaceId,
          userIds
        );
        if (success) {
          await logEndpointOperation({
            method: "POST",
            path: "/admin/workspaces/:workspaceId/update-users",
            operation: "admin_workspace_users_updated",
            metadata: {
              workspaceId,
              userIdCount: userIds.length,
            },
            userId: request.user?.id,
          });
        }
        response.status(200).json({ success, error });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/admin/workspaces/:workspaceId/update-users",
          operation: "admin_workspace_users_updated",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/admin/workspaces/:id",
    [requireAdmin],
    async (request, response) => {
      try {
        const { id } = request.params;
        const VectorDb = getVectorDbClass();
        const workspace = await Workspace.get({ id: Number(id) });
        if (!workspace) {
          response.sendStatus(404).end();
          return;
        }

        await WorkspaceChats.delete({ workspaceId: Number(workspace.id) });
        await DocumentVectors.deleteForWorkspace(Number(workspace.id));
        await Document.delete({ workspaceId: Number(workspace.id) });
        await Workspace.delete({ id: Number(workspace.id) });
        try {
          await VectorDb["delete-namespace"]({ namespace: workspace.slug });
        } catch (e) {
          console.error(e.message);
        }

        await logEndpointOperation({
          method: "DELETE",
          path: "/admin/workspaces/:id",
          operation: "admin_workspace_deleted",
          metadata: {
            workspaceId: id,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
          },
          userId: request.user?.id,
        });
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/admin/workspaces/:id",
          operation: "admin_workspace_deleted",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  // System preferences but only by array of labels
  app.get(
    "/admin/system-preferences-for",
    [requireAdmin],
    async (request, response) => {
      try {
        const requestedSettings = {};
        const labels = request.query.labels?.split(",") || [];
        const needEmbedder = [
          "text_splitter_chunk_size",
          "max_embed_chunk_size",
        ];
        const noRecord = [
          "max_embed_chunk_size",
          "agent_sql_connections",
          "imported_agent_skills",
          "feature_flags",
          "meta_page_title",
          "meta_page_favicon",
        ];

        for (const label of labels) {
          // Skip any settings that are not explicitly defined as public
          if (!SystemSettings.publicFields.includes(label)) continue;

          // Only get the embedder if the setting actually needs it
          let embedder = needEmbedder.includes(label)
            ? getEmbeddingEngineSelection()
            : null;
          // Only get the record from db if the setting actually needs it
          let setting = noRecord.includes(label)
            ? null
            : await SystemSettings.get({ label });

          switch (label) {
            case "footer_data":
              requestedSettings[label] = setting?.value ?? JSON.stringify([]);
              break;
            case "support_email":
              requestedSettings[label] = setting?.value || null;
              break;
            case "text_splitter_chunk_size":
              requestedSettings[label] =
                setting?.value || embedder?.embeddingMaxChunkLength || null;
              break;
            case "text_splitter_chunk_overlap":
              requestedSettings[label] = setting?.value || null;
              break;
            case "max_embed_chunk_size":
              requestedSettings[label] =
                embedder?.embeddingMaxChunkLength || 1000;
              break;
            case "agent_search_provider":
              requestedSettings[label] = setting?.value || null;
              break;
            case "agent_sql_connections":
              requestedSettings[label] =
                await SystemSettings.brief.agent_sql_connections();
              break;
            case "default_agent_skills":
              requestedSettings[label] = safeJsonParse(setting?.value, []);
              break;
            case "disabled_agent_skills":
              requestedSettings[label] = safeJsonParse(setting?.value, []);
              break;
            case "imported_agent_skills":
              requestedSettings[label] = ImportedPlugin.listImportedPlugins();
              break;
            case "custom_app_name":
              requestedSettings[label] = setting?.value || null;
              break;
            case "feature_flags":
              requestedSettings[label] =
                (await SystemSettings.getFeatureFlags()) || {};
              break;
            case "meta_page_title":
              requestedSettings[label] =
                await SystemSettings.getValueOrFallback({ label }, null);
              break;
            case "meta_page_favicon":
              requestedSettings[label] =
                await SystemSettings.getValueOrFallback({ label }, null);
              break;
            default:
              break;
          }
        }

        await logEndpointOperation({
          method: "GET",
          path: "/admin/system-preferences-for",
          operation: "admin_system_preferences_retrieved",
          metadata: {
            requestedLabels: labels,
            labelCount: labels.length,
          },
          userId: request.user?.id,
        });
        response.status(200).json({ settings: requestedSettings });
      } catch (e) {
        logEndpointError({
          method: "GET",
          path: "/admin/system-preferences-for",
          operation: "admin_system_preferences_retrieved",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  // TODO: Delete this endpoint
  // DEPRECATED - use /admin/system-preferences-for instead with ?labels=... comma separated string of labels
  app.get("/admin/system-preferences", [requireAdmin], async (_, response) => {
    try {
      const embedder = getEmbeddingEngineSelection();
      const settings = {
        footer_data:
          (await SystemSettings.get({ label: "footer_data" }))?.value ||
          JSON.stringify([]),
        support_email:
          (await SystemSettings.get({ label: "support_email" }))?.value || null,
        text_splitter_chunk_size:
          (await SystemSettings.get({ label: "text_splitter_chunk_size" }))
            ?.value ||
          embedder?.embeddingMaxChunkLength ||
          null,
        text_splitter_chunk_overlap:
          (await SystemSettings.get({ label: "text_splitter_chunk_overlap" }))
            ?.value || null,
        max_embed_chunk_size: embedder?.embeddingMaxChunkLength || 1000,
        agent_search_provider:
          (await SystemSettings.get({ label: "agent_search_provider" }))
            ?.value || null,
        agent_sql_connections:
          await SystemSettings.brief.agent_sql_connections(),
        default_agent_skills:
          safeJsonParse(
            (await SystemSettings.get({ label: "default_agent_skills" }))
              ?.value,
            []
          ) || [],
        disabled_agent_skills:
          safeJsonParse(
            (await SystemSettings.get({ label: "disabled_agent_skills" }))
              ?.value,
            []
          ) || [],
        imported_agent_skills: ImportedPlugin.listImportedPlugins(),
        custom_app_name:
          (await SystemSettings.get({ label: "custom_app_name" }))?.value ||
          null,
        feature_flags: (await SystemSettings.getFeatureFlags()) || {},
        meta_page_title: await SystemSettings.getValueOrFallback(
          { label: "meta_page_title" },
          null
        ),
        meta_page_favicon: await SystemSettings.getValueOrFallback(
          { label: "meta_page_favicon" },
          null
        ),
      };
      await logEndpointOperation({
        method: "GET",
        path: "/admin/system-preferences",
        operation: "admin_system_preferences_retrieved",
        metadata: {},
        userId: request.user?.id,
      });
      response.status(200).json({ settings });
    } catch (e) {
      logEndpointError({
        method: "GET",
        path: "/admin/system-preferences",
        operation: "admin_system_preferences_retrieved",
        error: e,
        userId: request.user?.id,
      });
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/admin/system-preferences",
    [requireAdmin],
    async (request, response) => {
      try {
        const updates = reqBody(request);
        await SystemSettings.updateSettings(updates);
        await logEndpointOperation({
          method: "POST",
          path: "/admin/system-preferences",
          operation: "admin_system_preferences_updated",
          metadata: {
            updatedFields: Object.keys(updates),
          },
          userId: request.user?.id,
        });
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/admin/system-preferences",
          operation: "admin_system_preferences_updated",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.get("/admin/api-keys", [requireAdmin], async (request, response) => {
    try {
      const apiKeys = await ApiKey.whereWithUser({});
      await logEndpointOperation({
        method: "GET",
        path: "/admin/api-keys",
        operation: "admin_api_keys_listed",
        metadata: { apiKeyCount: apiKeys.length },
        userId: request.user?.id,
      });
      return response.status(200).json({
        apiKeys,
        error: null,
      });
    } catch (error) {
      logEndpointError({
        method: "GET",
        path: "/admin/api-keys",
        operation: "admin_api_keys_listed",
        error,
        userId: request.user?.id,
      });
      response.status(500).json({
        apiKey: null,
        error: "Could not find an API Keys.",
      });
    }
  });

  app.post(
    "/admin/generate-api-key",
    [requireAdminJWT],
    async (request, response) => {
      try {
        // In single-user mode, request.user.id will be null
        // ApiKey.create() requires a user ID, so this only works in multi-user mode
        if (!request.user.id) {
          return response.status(400).json({
            apiKey: null,
            error: "API key generation requires multi-user mode",
          });
        }
        const user = await User.get({ id: request.user.id });
        const { apiKey, error } = await ApiKey.create(user.id);
        await EventLogs.logEvent(
          "api_key_created",
          { createdBy: user?.username },
          user?.id
        );
        await logEndpointOperation({
          method: "POST",
          path: "/admin/generate-api-key",
          operation: "admin_api_key_created",
          metadata: {
            createdBy: user?.username,
          },
          userId: user?.id,
          skipEventLog: true, // Already logged above
        });
        return response.status(200).json({
          apiKey,
          error,
        });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/admin/generate-api-key",
          operation: "admin_api_key_created",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/admin/delete-api-key/:id",
    [requireAdmin],
    async (request, response) => {
      try {
        const { id } = request.params;
        if (!id || isNaN(Number(id))) return response.sendStatus(400).end();
        await ApiKey.delete({ id: Number(id) });

        await EventLogs.logEvent(
          "api_key_deleted",
          { deletedBy: request.user.username || "admin" },
          request.user.id
        );
        await logEndpointOperation({
          method: "DELETE",
          path: "/admin/delete-api-key/:id",
          operation: "admin_api_key_deleted",
          metadata: {
            apiKeyId: id,
            deletedBy: request.user.username || "admin",
          },
          userId: request.user.id,
          skipEventLog: true, // Already logged above
        });
        return response.status(200).end();
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/admin/delete-api-key/:id",
          operation: "admin_api_key_deleted",
          error: e,
          userId: request.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { adminEndpoints };
