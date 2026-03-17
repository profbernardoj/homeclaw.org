/**
 * src/bridge.mjs
 * Filesystem bridge: watches outbox/ for OpenClaw → XMTP sends.
 * Uses fs.watch (callback API from node:fs, not fs/promises).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { agentInstance } from './agent.mjs';

const XMTP_DIR = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');

let watcher = null;
const processed = new Set(); // Duplicate event protection

async function handleOutbound(filename) {
  if (!filename || !filename.endsWith('.json')) return;
  if (processed.has(filename)) return;
  processed.add(filename);

  // Clean up stale entries periodically
  if (processed.size > 1000) processed.clear();

  const filePath = path.join(XMTP_DIR, 'outbox', filename);

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const msg = JSON.parse(raw);

    if (!agentInstance?.client) {
      console.error('[Bridge] Agent not ready — cannot send');
      return;
    }

    // Create DM conversation and send
    const conv = await agentInstance.client.conversations.createDmWithIdentifier({
      identifier: msg.peerAddress,
      identifierKind: 0 // Ethereum
    });

    const content = typeof msg.v6Payload === 'string'
      ? msg.v6Payload
      : JSON.stringify(msg.v6Payload);

    await conv.sendText(content);
    console.log(`[Bridge] Sent to ${msg.peerAddress}`);

    // Remove processed file
    await fsp.unlink(filePath).catch(() => {});
  } catch (err) {
    console.error(`[Bridge] Failed to process ${filename}: ${err.message}`);
  }
}

export function startBridge(config) {
  const outboxDir = path.join(XMTP_DIR, 'outbox');

  // Ensure outbox exists
  fs.mkdirSync(outboxDir, { recursive: true });

  watcher = fs.watch(outboxDir, (eventType, filename) => {
    if (eventType === 'rename' || eventType === 'change') {
      handleOutbound(filename);
    }
  });

  console.log(`[Bridge] Watching ${outboxDir}`);
}

export function stopBridge() {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[Bridge] Stopped');
  }
}
