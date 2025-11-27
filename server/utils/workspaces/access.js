const { Workspace } = require("../../models/workspace");

function isAdminRequest(response) {
  return response?.locals?.principal?.type === "admin";
}

function scopeWorkspaceQuery(response, prismaQuery = {}) {
  if (isAdminRequest(response)) return prismaQuery;

  const user = response?.locals?.user;
  if (!user) return null;

  const where = prismaQuery.where ? { ...prismaQuery.where } : {};
  const workspaceUsersClause = where.workspace_users
    ? { ...where.workspace_users }
    : {};
  const someClause = workspaceUsersClause.some
    ? { ...workspaceUsersClause.some }
    : {};

  return {
    ...prismaQuery,
    where: {
      ...where,
      workspace_users: {
        ...workspaceUsersClause,
        some: {
          ...someClause,
          user_id: user.id,
        },
      },
    },
  };
}

async function getWorkspaceForRequest(response, clause = {}, options = {}) {
  const scopedQuery = scopeWorkspaceQuery(response, {
    where: clause,
    ...options,
  });

  if (!scopedQuery) return null;

  if (!scopedQuery.include) {
    scopedQuery.include = { documents: true };
  }

  return await Workspace._findFirst(scopedQuery);
}

async function getAccessibleWorkspaceIds(response) {
  const scopedQuery = scopeWorkspaceQuery(response, {
    where: {},
    select: { id: true },
  });

  if (!scopedQuery) return [];

  const results = await Workspace._findMany(scopedQuery);
  if (!Array.isArray(results)) return [];
  return results.map((workspace) => workspace.id);
}

module.exports = {
  isAdminRequest,
  scopeWorkspaceQuery,
  getWorkspaceForRequest,
  getAccessibleWorkspaceIds,
};

