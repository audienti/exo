// @ts-check

/**
 * @param {unknown} rawUser
 * @returns {boolean}
 */
export function isExecutionCapableUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object" || Array.isArray(rawUser)) {
    return false;
  }

  return Array.isArray(rawUser.accounts) && rawUser.accounts.length > 0;
}

/**
 * @param {unknown[]} rawUsers
 */
export function summarizeExecutionUsers(rawUsers) {
  const eligibleUsers = rawUsers.filter((user) => isExecutionCapableUser(user));

  return {
    totalUserCount: rawUsers.length,
    eligibleUserCount: eligibleUsers.length,
    eligibleUsers
  };
}
