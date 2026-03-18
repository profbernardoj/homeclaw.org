/**
 * src/groups.mjs
 * Loads and manages groups.json — maps XMTP conversation IDs to OpenClaw sessions.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getGroupsFilePath } from './paths.mjs';

export async function loadGroups() {
  try {
    const data = JSON.parse(await fs.readFile(getGroupsFilePath(), 'utf8'));
    return data.groups || {};
  } catch {
    return {};
  }
}

export async function saveGroup(conversationId, config) {
  const groups = await loadGroups();
  groups[conversationId] = {
    ...config,
    name: config.name,
    openclawSession: config.openclawSession,
    topics: config.topics || [],
    autoJoin: config.autoJoin ?? false,
    consentPolicyOverride: config.consentPolicyOverride || null
  };

  const groupsFile = getGroupsFilePath();
  await fs.mkdir(path.dirname(groupsFile), { recursive: true });
  await fs.writeFile(groupsFile, JSON.stringify({ groups }, null, 2));
}

export default { loadGroups, saveGroup };
