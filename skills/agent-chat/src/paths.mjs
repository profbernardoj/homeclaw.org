/**
 * src/paths.mjs
 * Shared path helpers — single source of truth for XMTP directory structure.
 * All path functions are runtime (not module-level const) for testability.
 */

import path from 'node:path';
import os from 'node:os';

export function getXmtpDir() {
  return process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');
}

export function getInboxDir() {
  return path.join(getXmtpDir(), 'inbox');
}

export function getOutboxDir() {
  return path.join(getXmtpDir(), 'outbox');
}

export function getPeersFilePath() {
  return path.join(getXmtpDir(), 'peers.json');
}

export function getHealthFilePath() {
  return path.join(getXmtpDir(), 'health.json');
}

export function getGroupsFilePath() {
  return path.join(getXmtpDir(), 'groups.json');
}
