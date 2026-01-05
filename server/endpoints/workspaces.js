const path = require("path");
const fs = require("fs");
const {
  reqBody,
  multiUserMode,
  userFromSession,
  safeJsonParse,
} = require("../utils/http");
const { normalizePath, isWithin } = require("../utils/files");
const { Workspace } = require("../models/workspace");
const { Document } = require("../models/documents");
const { DocumentVectors } = require("../models/vectors");
const { WorkspaceChats } = require("../models/workspaceChats");
const { getVectorDbClass } = require("../utils/helpers");
const { handleFileUpload, handlePfpUpload } = require("../utils/files/multer");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { Telemetry } = require("../models/telemetry");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { EventLogs } = require("../models/eventLogs");
const {
  WorkspaceSuggestedMessages,
} = require("../models/workspacesSuggestedMessages");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { convertToChatHistory } = require("../utils/helpers/chat/responses");
const { CollectorApi } = require("../utils/collectorApi");
const {
  determineWorkspacePfpFilepath,
  fetchPfp,
} = require("../utils/files/pfp");
const { getTTSProvider } = require("../utils/TextToSpeech");
const { WorkspaceThread } = require("../models/workspaceThread");
const truncate = require("truncate");
const { purgeDocument } = require("../utils/files/purgeDocument");
const { getModelTag } = require("./utils");
const {
  logEndpointOperation,
  logEndpointError,
} = require("../utils/helpers/endpointLogger");

function workspaceEndpoints(app) {
  if (!app) return;

  const responseCache = new Map();

  app.post(
    "/workspace/new",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { name = null, onboardingComplete = false } = reqBody(request);
        const { workspace, message } = await Workspace.new(name, user?.id);
        await Telemetry.sendTelemetry(
          "workspace_created",
          {
            multiUserMode: multiUserMode(response),
            LLMSelection: process.env.LLM_PROVIDER || "openai",
            Embedder: process.env.EMBEDDING_ENGINE || "inherit",
            VectorDbSelection: process.env.VECTOR_DB || "lancedb",
            TTSSelection: process.env.TTS_PROVIDER || "native",
            LLMModel: getModelTag(),
          },
          user?.id
        );

        await EventLogs.logEvent(
          "workspace_created",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          user?.id
        );
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/new",
          operation: "workspace_created",
          metadata: {
            workspaceName: workspace?.name || "Unknown Workspace",
            workspaceId: workspace?.id,
          },
          userId: user?.id,
          skipEventLog: true, // Already logged above
        });
        if (onboardingComplete === true)
          await Telemetry.sendTelemetry("onboarding_complete");

        response.status(200).json({ workspace, message });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/new",
          operation: "workspace_created",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { slug = null } = request.params;
        const data = reqBody(request);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        await Workspace.trackChange(currWorkspace, data, user);
        const { workspace, message } = await Workspace.update(
          currWorkspace.id,
          data
        );
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/update",
          operation: "workspace_updated",
          metadata: {
            workspaceSlug: slug,
            workspaceName: workspace?.name,
            updatedFields: Object.keys(data),
          },
          userId: user?.id,
        });
        response.status(200).json({ workspace, message });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/update",
          operation: "workspace_updated",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/upload",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (request, response) {
      try {
        const Collector = new CollectorApi();
        const { originalname } = request.file;
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Document ${originalname} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason } =
          await Collector.processDocument(originalname);
        if (!success) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Document ${originalname} uploaded processed and successfully. It is now available in documents.`
        );
        await Telemetry.sendTelemetry("document_uploaded");
        await EventLogs.logEvent(
          "document_uploaded",
          {
            documentName: originalname,
          },
          response.locals?.user?.id
        );
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/upload",
          operation: "workspace_document_uploaded",
          metadata: {
            documentName: originalname,
            workspaceSlug: request.params.slug,
          },
          userId: response.locals?.user?.id,
          skipEventLog: true, // Already logged above
        });
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/upload",
          operation: "workspace_document_uploaded",
          error: e,
          userId: response.locals?.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-link",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const Collector = new CollectorApi();
        const { link = "" } = reqBody(request);
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Link ${link} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason } = await Collector.processLink(link);
        if (!success) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Link ${link} uploaded processed and successfully. It is now available in documents.`
        );
        await Telemetry.sendTelemetry("link_uploaded");
        await EventLogs.logEvent(
          "link_uploaded",
          { link },
          response.locals?.user?.id
        );
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/upload-link",
          operation: "workspace_link_uploaded",
          metadata: {
            link,
            workspaceSlug: request.params.slug,
          },
          userId: response.locals?.user?.id,
          skipEventLog: true, // Already logged above
        });
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/upload-link",
          operation: "workspace_link_uploaded",
          error: e,
          userId: response.locals?.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update-embeddings",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { slug = null } = request.params;
        const { adds = [], deletes = [] } = reqBody(request);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        await Document.removeDocuments(
          currWorkspace,
          deletes,
          response.locals?.user?.id
        );
        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          currWorkspace,
          adds,
          response.locals?.user?.id
        );
        const updatedWorkspace = await Workspace.get({ id: currWorkspace.id });
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/update-embeddings",
          operation: "workspace_embeddings_updated",
          metadata: {
            workspaceSlug: slug,
            documentsAdded: adds.length,
            documentsRemoved: deletes.length,
            failedToEmbed: failedToEmbed.length,
          },
          userId: user?.id,
        });
        response.status(200).json({
          workspace: updatedWorkspace,
          message:
            failedToEmbed.length > 0
              ? `${failedToEmbed.length} documents failed to add.\n\n${errors
                  .map((msg) => `${msg}`)
                  .join("\n\n")}`
              : null,
        });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/update-embeddings",
          operation: "workspace_embeddings_updated",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = "" } = request.params;
        const user = await userFromSession(request, response);
        const VectorDb = getVectorDbClass();
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        await WorkspaceChats.delete({ workspaceId: Number(workspace.id) });
        await DocumentVectors.deleteForWorkspace(workspace.id);
        await Document.delete({ workspaceId: Number(workspace.id) });
        await Workspace.delete({ id: Number(workspace.id) });

        await EventLogs.logEvent(
          "workspace_deleted",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          response.locals?.user?.id
        );
        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/:slug",
          operation: "workspace_deleted",
          metadata: {
            workspaceSlug: slug,
            workspaceName: workspace?.name || "Unknown Workspace",
            workspaceId: workspace.id,
          },
          userId: response.locals?.user?.id,
          skipEventLog: true, // Already logged above
        });

        try {
          await VectorDb["delete-namespace"]({ namespace: slug });
        } catch (e) {
          console.error(e.message);
        }
        response.sendStatus(200).end();
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug",
          operation: "workspace_deleted",
          error: e,
          userId: response.locals?.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/reset-vector-db",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug = "" } = request.params;
        const user = await userFromSession(request, response);
        const VectorDb = getVectorDbClass();
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        await DocumentVectors.deleteForWorkspace(workspace.id);
        await Document.delete({ workspaceId: Number(workspace.id) });

        await EventLogs.logEvent(
          "workspace_vectors_reset",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          response.locals?.user?.id
        );
        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/:slug/reset-vector-db",
          operation: "workspace_vectors_reset",
          metadata: {
            workspaceSlug: slug,
            workspaceName: workspace?.name || "Unknown Workspace",
          },
          userId: response.locals?.user?.id,
          skipEventLog: true, // Already logged above
        });

        try {
          await VectorDb["delete-namespace"]({ namespace: slug });
        } catch (e) {
          console.error(e.message);
        }
        response.sendStatus(200).end();
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug/reset-vector-db",
          operation: "workspace_vectors_reset",
          error: e,
          userId: response.locals?.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspaces",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspaces = multiUserMode(response)
          ? await Workspace.whereWithUser(user)
          : await Workspace.where();

        await logEndpointOperation({
          method: "GET",
          path: "/workspaces",
          operation: "workspaces_listed",
          metadata: {
            workspaceCount: workspaces.length,
          },
          userId: user?.id,
        });
        response.status(200).json({ workspaces });
      } catch (e) {
        logEndpointError({
          method: "GET",
          path: "/workspaces",
          operation: "workspaces_listed",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { slug } = request.params;
        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        await logEndpointOperation({
          method: "GET",
          path: "/workspace/:slug",
          operation: "workspace_retrieved",
          metadata: {
            workspaceSlug: slug,
            workspaceName: workspace?.name,
          },
          userId: user?.id,
        });
        response.status(200).json({ workspace });
      } catch (e) {
        logEndpointError({
          method: "GET",
          path: "/workspace/:slug",
          operation: "workspace_retrieved",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/chats",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { slug } = request.params;
        const user = await userFromSession(request, response);
        const workspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!workspace) {
          response.sendStatus(400).end();
          return;
        }

        const history = multiUserMode(response)
          ? await WorkspaceChats.forWorkspaceByUser(workspace.id, user.id)
          : await WorkspaceChats.forWorkspace(workspace.id);
        await logEndpointOperation({
          method: "GET",
          path: "/workspace/:slug/chats",
          operation: "workspace_chats_retrieved",
          metadata: {
            workspaceSlug: slug,
            chatCount: history.length,
          },
          userId: user?.id,
        });
        response.status(200).json({ history: convertToChatHistory(history) });
      } catch (e) {
        logEndpointError({
          method: "GET",
          path: "/workspace/:slug/chats",
          operation: "workspace_chats_retrieved",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/delete-chats",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { chatIds = [] } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;

        if (!workspace || !Array.isArray(chatIds)) {
          response.sendStatus(400).end();
          return;
        }

        // This works for both workspace and threads.
        // we simplify this by just looking at workspace<>user overlap
        // since they are all on the same table.
        await WorkspaceChats.delete({
          id: { in: chatIds.map((id) => Number(id)) },
          user_id: user?.id ?? null,
          workspaceId: workspace.id,
        });

        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/:slug/delete-chats",
          operation: "workspace_chats_deleted",
          metadata: {
            workspaceSlug: request.params.slug,
            chatCount: chatIds.length,
          },
          userId: user?.id,
        });
        response.sendStatus(200).end();
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug/delete-chats",
          operation: "workspace_chats_deleted",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/delete-edited-chats",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { startingId } = reqBody(request);
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;

        await WorkspaceChats.delete({
          workspaceId: workspace.id,
          thread_id: null,
          user_id: user?.id,
          id: { gte: Number(startingId) },
        });

        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/:slug/delete-edited-chats",
          operation: "workspace_edited_chats_deleted",
          metadata: {
            workspaceSlug: request.params.slug,
            startingId,
          },
          userId: user?.id,
        });
        response.sendStatus(200).end();
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug/delete-edited-chats",
          operation: "workspace_edited_chats_deleted",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/update-chat",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { chatId, newText = null } = reqBody(request);
        if (!newText || !String(newText).trim())
          throw new Error("Cannot save empty response");

        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const existingChat = await WorkspaceChats.get({
          workspaceId: workspace.id,
          thread_id: null,
          user_id: user?.id,
          id: Number(chatId),
        });
        if (!existingChat) throw new Error("Invalid chat.");

        const chatResponse = safeJsonParse(existingChat.response, null);
        if (!chatResponse) throw new Error("Failed to parse chat response");

        await WorkspaceChats._update(existingChat.id, {
          response: JSON.stringify({
            ...chatResponse,
            text: String(newText),
          }),
        });

        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/update-chat",
          operation: "workspace_chat_updated",
          metadata: {
            workspaceSlug: request.params.slug,
            chatId,
          },
          userId: user?.id,
        });
        response.sendStatus(200).end();
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/update-chat",
          operation: "workspace_chat_updated",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/workspace/:slug/chat-feedback/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const { chatId } = request.params;
        const { feedback = null } = reqBody(request);
        const existingChat = await WorkspaceChats.get({
          id: Number(chatId),
          workspaceId: response.locals.workspace.id,
        });

        if (!existingChat) {
          response.status(404).end();
          return;
        }

        const result = await WorkspaceChats.updateFeedbackScore(
          chatId,
          feedback
        );
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/chat-feedback/:chatId",
          operation: "workspace_chat_feedback_submitted",
          metadata: {
            workspaceSlug: request.params.slug,
            chatId,
            feedback,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(200).json({ success: result });
      } catch (error) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/chat-feedback/:chatId",
          operation: "workspace_chat_feedback_submitted",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/suggested-messages",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const suggestedMessages =
          await WorkspaceSuggestedMessages.getMessages(slug);
        await logEndpointOperation({
          method: "GET",
          path: "/workspace/:slug/suggested-messages",
          operation: "workspace_suggested_messages_retrieved",
          metadata: {
            workspaceSlug: slug,
            messageCount: suggestedMessages.length,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(200).json({ success: true, suggestedMessages });
      } catch (error) {
        logEndpointError({
          method: "GET",
          path: "/workspace/:slug/suggested-messages",
          operation: "workspace_suggested_messages_retrieved",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response
          .status(500)
          .json({ success: false, message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/suggested-messages",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { messages = [] } = reqBody(request);
        const { slug } = request.params;
        if (!Array.isArray(messages)) {
          return response.status(400).json({
            success: false,
            message: "Invalid message format. Expected an array of messages.",
          });
        }

        await WorkspaceSuggestedMessages.saveAll(messages, slug);
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/suggested-messages",
          operation: "workspace_suggested_messages_updated",
          metadata: {
            workspaceSlug: slug,
            messageCount: messages.length,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        return response.status(200).json({
          success: true,
          message: "Suggested messages saved successfully.",
        });
      } catch (error) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/suggested-messages",
          operation: "workspace_suggested_messages_updated",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({
          success: true,
          message: "Error saving the suggested messages.",
        });
      }
    }
  );

  app.post(
    "/workspace/:slug/update-pin",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const { docPath, pinStatus = false } = reqBody(request);
        const workspace = response.locals.workspace;

        const document = await Document.get({
          workspaceId: workspace.id,
          docpath: docPath,
        });
        if (!document) return response.sendStatus(404).end();

        await Document.update(document.id, { pinned: pinStatus });
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/update-pin",
          operation: "workspace_document_pin_updated",
          metadata: {
            workspaceSlug: request.params.slug,
            docPath,
            pinStatus,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        return response.status(200).end();
      } catch (error) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/update-pin",
          operation: "workspace_document_pin_updated",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        return response.status(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/tts/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async function (request, response) {
      try {
        const { chatId } = request.params;
        const workspace = response.locals.workspace;
        const cacheKey = `${workspace.slug}:${chatId}`;
        const wsChat = await WorkspaceChats.get({
          id: Number(chatId),
          workspaceId: workspace.id,
        });

        const cachedResponse = responseCache.get(cacheKey);
        if (cachedResponse) {
          response.writeHead(200, {
            "Content-Type": cachedResponse.mime || "audio/mpeg",
          });
          response.end(cachedResponse.buffer);
          return;
        }

        const text = safeJsonParse(wsChat.response, null)?.text;
        if (!text) return response.sendStatus(204).end();

        const TTSProvider = getTTSProvider();
        const buffer = await TTSProvider.ttsBuffer(text);
        if (buffer === null) return response.sendStatus(204).end();

        responseCache.set(cacheKey, { buffer, mime: "audio/mpeg" });
        response.writeHead(200, {
          "Content-Type": "audio/mpeg",
        });
        response.end(buffer);
        await logEndpointOperation({
          method: "GET",
          path: "/workspace/:slug/tts/:chatId",
          operation: "workspace_tts_generated",
          metadata: {
            workspaceSlug: request.params.slug,
            chatId: request.params.chatId,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        return;
      } catch (error) {
        logEndpointError({
          method: "GET",
          path: "/workspace/:slug/tts/:chatId",
          operation: "workspace_tts_generated",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({ message: "TTS could not be completed" });
      }
    }
  );

  app.get(
    "/workspace/:slug/pfp",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const cachedResponse = responseCache.get(slug);

        if (cachedResponse) {
          response.writeHead(200, {
            "Content-Type": cachedResponse.mime || "image/png",
          });
          response.end(cachedResponse.buffer);
          return;
        }

        const pfpPath = await determineWorkspacePfpFilepath(slug);

        if (!pfpPath) {
          response.sendStatus(204).end();
          return;
        }

        const { found, buffer, mime } = fetchPfp(pfpPath);
        if (!found) {
          response.sendStatus(204).end();
          return;
        }

        responseCache.set(slug, { buffer, mime });

        response.writeHead(200, {
          "Content-Type": mime || "image/png",
        });
        response.end(buffer);
        await logEndpointOperation({
          method: "GET",
          path: "/workspace/:slug/pfp",
          operation: "workspace_pfp_retrieved",
          metadata: {
            workspaceSlug: slug,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        return;
      } catch (error) {
        logEndpointError({
          method: "GET",
          path: "/workspace/:slug/pfp",
          operation: "workspace_pfp_retrieved",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-pfp",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handlePfpUpload,
    ],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const uploadedFileName = request.randomFileName;
        if (!uploadedFileName) {
          return response.status(400).json({ message: "File upload failed." });
        }

        const workspaceRecord = await Workspace.get({
          slug,
        });

        const oldPfpFilename = workspaceRecord.pfpFilename;
        if (oldPfpFilename) {
          const storagePath = path.join(__dirname, "../storage/assets/pfp");
          const oldPfpPath = path.join(
            storagePath,
            normalizePath(workspaceRecord.pfpFilename)
          );
          if (!isWithin(path.resolve(storagePath), path.resolve(oldPfpPath)))
            throw new Error("Invalid path name");
          if (fs.existsSync(oldPfpPath)) fs.unlinkSync(oldPfpPath);
        }

        const { workspace, message } = await Workspace._update(
          workspaceRecord.id,
          {
            pfpFilename: uploadedFileName,
          }
        );

        if (workspace) {
          await logEndpointOperation({
            method: "POST",
            path: "/workspace/:slug/upload-pfp",
            operation: "workspace_pfp_uploaded",
            metadata: {
              workspaceSlug: slug,
              fileName: uploadedFileName,
            },
            userId: (await userFromSession(request, response))?.id,
          });
        }
        return response.status(workspace ? 200 : 500).json({
          message: workspace
            ? "Profile picture uploaded successfully."
            : message,
        });
      } catch (error) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/upload-pfp",
          operation: "workspace_pfp_uploaded",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.delete(
    "/workspace/:slug/remove-pfp",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async function (request, response) {
      try {
        const { slug } = request.params;
        const workspaceRecord = await Workspace.get({
          slug,
        });
        const oldPfpFilename = workspaceRecord.pfpFilename;

        if (oldPfpFilename) {
          const storagePath = path.join(__dirname, "../storage/assets/pfp");
          const oldPfpPath = path.join(
            storagePath,
            normalizePath(oldPfpFilename)
          );
          if (!isWithin(path.resolve(storagePath), path.resolve(oldPfpPath)))
            throw new Error("Invalid path name");
          if (fs.existsSync(oldPfpPath)) fs.unlinkSync(oldPfpPath);
        }

        const { workspace, message } = await Workspace._update(
          workspaceRecord.id,
          {
            pfpFilename: null,
          }
        );

        // Clear the cache
        responseCache.delete(slug);

        if (workspace) {
          await logEndpointOperation({
            method: "DELETE",
            path: "/workspace/:slug/remove-pfp",
            operation: "workspace_pfp_removed",
            metadata: {
              workspaceSlug: slug,
            },
            userId: (await userFromSession(request, response))?.id,
          });
        }
        return response.status(workspace ? 200 : 500).json({
          message: workspace
            ? "Profile picture removed successfully."
            : message,
        });
      } catch (error) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug/remove-pfp",
          operation: "workspace_pfp_removed",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.post(
    "/workspace/:slug/thread/fork",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const workspace = response.locals.workspace;
        const { chatId, threadSlug } = reqBody(request);
        if (!chatId)
          return response.status(400).json({ message: "chatId is required" });

        // Get threadId we are branching from if that request body is sent
        // and is a valid thread slug.
        const threadId = !!threadSlug
          ? (
              await WorkspaceThread.get({
                slug: String(threadSlug),
                workspace_id: workspace.id,
              })
            )?.id ?? null
          : null;
        const chatsToFork = await WorkspaceChats.where(
          {
            workspaceId: workspace.id,
            user_id: user?.id,
            include: true, // only duplicate visible chats
            thread_id: threadId,
            api_session_id: null, // Do not include API session chats.
            id: { lte: Number(chatId) },
          },
          null,
          { id: "asc" }
        );

        const { thread: newThread, message: threadError } =
          await WorkspaceThread.new(workspace, user?.id);
        if (threadError)
          return response.status(500).json({ error: threadError });

        let lastMessageText = "";
        const chatsData = chatsToFork.map((chat) => {
          const chatResponse = safeJsonParse(chat.response, {});
          if (chatResponse?.text) lastMessageText = chatResponse.text;

          return {
            workspaceId: workspace.id,
            prompt: chat.prompt,
            response: JSON.stringify(chatResponse),
            user_id: user?.id,
            thread_id: newThread.id,
          };
        });
        await WorkspaceChats.bulkCreate(chatsData);
        await WorkspaceThread.update(newThread, {
          name: !!lastMessageText
            ? truncate(lastMessageText, 22)
            : "Forked Thread",
        });

        await EventLogs.logEvent(
          "thread_forked",
          {
            workspaceName: workspace?.name || "Unknown Workspace",
            threadName: newThread.name,
          },
          user?.id
        );
        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/thread/fork",
          operation: "thread_forked",
          metadata: {
            workspaceSlug: request.params.slug,
            threadSlug: newThread.slug,
            threadName: newThread.name,
            chatCount: chatsToFork.length,
          },
          userId: user?.id,
          skipEventLog: true, // Already logged above
        });
        response.status(200).json({ newThreadSlug: newThread.slug });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/thread/fork",
          operation: "thread_forked",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({ message: "Internal server error" });
      }
    }
  );

  app.put(
    "/workspace/workspace-chats/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { id } = request.params;
        const user = await userFromSession(request, response);
        const validChat = await WorkspaceChats.get({
          id: Number(id),
          user_id: user?.id ?? null,
        });
        if (!validChat)
          return response
            .status(404)
            .json({ success: false, error: "Chat not found." });

        await WorkspaceChats._update(validChat.id, { include: false });
        await logEndpointOperation({
          method: "PUT",
          path: "/workspace/workspace-chats/:id",
          operation: "workspace_chat_hidden",
          metadata: {
            chatId: id,
          },
          userId: user?.id,
        });
        response.json({ success: true, error: null });
      } catch (e) {
        logEndpointError({
          method: "PUT",
          path: "/workspace/workspace-chats/:id",
          operation: "workspace_chat_hidden",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(500).json({ success: false, error: "Server error" });
      }
    }
  );

  /** Handles the uploading and embedding in one-call by uploading via drag-and-drop in chat container. */
  app.post(
    "/workspace/:slug/upload-and-embed",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (request, response) {
      try {
        const { slug = null } = request.params;
        const user = await userFromSession(request, response);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace) {
          response.sendStatus(400).end();
          return;
        }

        const Collector = new CollectorApi();
        const { originalname } = request.file;
        const processingOnline = await Collector.online();

        if (!processingOnline) {
          response
            .status(500)
            .json({
              success: false,
              error: `Document processing API is not online. Document ${originalname} will not be processed automatically.`,
            })
            .end();
          return;
        }

        const { success, reason, documents } =
          await Collector.processDocument(originalname);
        if (!success || documents?.length === 0) {
          response.status(500).json({ success: false, error: reason }).end();
          return;
        }

        Collector.log(
          `Document ${originalname} uploaded processed and successfully. It is now available in documents.`
        );
        await Telemetry.sendTelemetry("document_uploaded");
        await EventLogs.logEvent(
          "document_uploaded",
          {
            documentName: originalname,
          },
          response.locals?.user?.id
        );

        const document = documents[0];
        const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
          currWorkspace,
          [document.location],
          response.locals?.user?.id
        );

        if (failedToEmbed.length > 0)
          return response
            .status(200)
            .json({ success: false, error: errors?.[0], document: null });

        await logEndpointOperation({
          method: "POST",
          path: "/workspace/:slug/upload-and-embed",
          operation: "workspace_document_uploaded_and_embedded",
          metadata: {
            workspaceSlug: slug,
            documentName: originalname,
            documentLocation: document.location,
          },
          userId: response.locals?.user?.id,
          skipEventLog: true, // Already logged above
        });
        response.status(200).json({
          success: true,
          error: null,
          document: { id: document.id, location: document.location },
        });
      } catch (e) {
        logEndpointError({
          method: "POST",
          path: "/workspace/:slug/upload-and-embed",
          operation: "workspace_document_uploaded_and_embedded",
          error: e,
          userId: response.locals?.user?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/remove-and-unembed",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      handleFileUpload,
    ],
    async function (request, response) {
      try {
        const { slug = null } = request.params;
        const body = reqBody(request);
        const user = await userFromSession(request, response);
        const currWorkspace = multiUserMode(response)
          ? await Workspace.getWithUser(user, { slug })
          : await Workspace.get({ slug });

        if (!currWorkspace || !body.documentLocation)
          return response.sendStatus(400).end();

        // Will delete the document from the entire system + wil unembed it.
        await purgeDocument(body.documentLocation);
        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/:slug/remove-and-unembed",
          operation: "workspace_document_removed_and_unembedded",
          metadata: {
            workspaceSlug: slug,
            documentLocation: body.documentLocation,
          },
          userId: user?.id,
        });
        response.status(200).end();
      } catch (e) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug/remove-and-unembed",
          operation: "workspace_document_removed_and_unembedded",
          error: e,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/workspace/:slug/prompt-history",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_, response) => {
      try {
        const history = await Workspace.promptHistory({
          workspaceId: response.locals.workspace.id,
        });
        await logEndpointOperation({
          method: "GET",
          path: "/workspace/:slug/prompt-history",
          operation: "workspace_prompt_history_retrieved",
          metadata: {
            workspaceSlug: request.params.slug,
            historyCount: history.length,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(200).json({ history });
      } catch (error) {
        logEndpointError({
          method: "GET",
          path: "/workspace/:slug/prompt-history",
          operation: "workspace_prompt_history_retrieved",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/:slug/prompt-history",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (_, response) => {
      try {
        const success = await Workspace.deleteAllPromptHistory({
          workspaceId: response.locals.workspace.id,
        });
        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/:slug/prompt-history",
          operation: "workspace_prompt_history_cleared",
          metadata: {
            workspaceSlug: request.params.slug,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(200).json({ success });
      } catch (error) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/:slug/prompt-history",
          operation: "workspace_prompt_history_cleared",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/workspace/prompt-history/:id",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const { id } = request.params;
        const success = await Workspace.deletePromptHistory({
          workspaceId: response.locals.workspace.id,
          id: Number(id),
        });
        await logEndpointOperation({
          method: "DELETE",
          path: "/workspace/prompt-history/:id",
          operation: "workspace_prompt_history_item_deleted",
          metadata: {
            promptHistoryId: id,
            workspaceSlug: response.locals.workspace.slug,
          },
          userId: (await userFromSession(request, response))?.id,
        });
        response.status(200).json({ success });
      } catch (error) {
        logEndpointError({
          method: "DELETE",
          path: "/workspace/prompt-history/:id",
          operation: "workspace_prompt_history_item_deleted",
          error,
          userId: (await userFromSession(request, response))?.id,
        });
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { workspaceEndpoints };
