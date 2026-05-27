// @ts-check

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
export function renderUserSummary(user) {
  const accountLines = user.accounts.length
    ? user.accounts.map((account) => {
        const source = account.sourceType === "browser-profile"
          ? `profile:${account.browserProfileId}`
          : `harness:${account.harnessConnectionId}`;
        return `  - ${account.capability}:${account.handle} ${account.preferred ? "(preferred) " : ""}[${source}]`;
      })
    : ["  - none"];
  const harnessLines = user.harnessConnections.length
    ? user.harnessConnections.map((connection) => `  - ${connection.runtime}:${connection.connector} (${connection.status})`)
    : ["  - none"];

  return [
    `User: ${user.label}`,
    `ID: ${user.id}`,
    `Owner: ${user.owner ?? "unknown"}`,
    `Created: ${user.createdAt}`,
    `Updated: ${user.updatedAt}`,
    "Accounts:",
    ...accountLines,
    "Harness Connections:",
    ...harnessLines
  ].join("\n");
}

/**
 * @param {import("../schema/user.js").userSchema._type[]} users
 */
export function renderUserList(users) {
  if (!users.length) {
    return "No users found.";
  }

  return users
    .map((user) => `${user.id}  ${user.label}  owner:${user.owner ?? "unknown"}  accounts:${user.accounts.length}  harness:${user.harnessConnections.length}`)
    .join("\n");
}
