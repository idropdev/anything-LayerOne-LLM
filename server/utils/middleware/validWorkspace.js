const { Workspace } = require("../../models/workspace");
const { WorkspaceThread } = require("../../models/workspaceThread");
const { userFromSession, multiUserMode } = require("../http");

// Will pre-validate and set the workspace for a request if the slug is provided in the URL path.
async function validWorkspaceSlug(request, response, next) {
  const { slug } = request.params;
  const user = await userFromSession(request, response);

  console.log(`\x1b[36m[validWorkspaceSlug]\x1b[0m - Looking up workspace | slug: ${slug} | user_id: ${user?.id} | user_role: ${user?.role} | multiUserMode: ${multiUserMode(response)}`);

  const workspace = multiUserMode(response)
    ? await Workspace.getWithUser(user, { slug })
    : await Workspace.get({ slug });

  if (!workspace) {
    console.log(`\x1b[33m[validWorkspaceSlug]\x1b[0m - Workspace not found | slug: ${slug} | user_id: ${user?.id}`);
    response.status(404).send("Workspace does not exist.");
    return;
  }

  console.log(`\x1b[32m[validWorkspaceSlug]\x1b[0m - Workspace found | slug: ${slug} | workspace_id: ${workspace.id} | user_id: ${user?.id}`);
  response.locals.workspace = workspace;
  next();
}

// Will pre-validate and set the workspace AND a thread for a request if the slugs are provided in the URL path.
async function validWorkspaceAndThreadSlug(request, response, next) {
  const { slug, threadSlug } = request.params;
  const user = await userFromSession(request, response);
  const workspace = multiUserMode(response)
    ? await Workspace.getWithUser(user, { slug })
    : await Workspace.get({ slug });

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
    return;
  }

  const thread = await WorkspaceThread.get({
    slug: threadSlug,
    user_id: user?.id || null,
  });
  if (!thread) {
    response.status(404).send("Workspace thread does not exist.");
    return;
  }

  response.locals.workspace = workspace;
  response.locals.thread = thread;
  next();
}

module.exports = {
  validWorkspaceSlug,
  validWorkspaceAndThreadSlug,
};
