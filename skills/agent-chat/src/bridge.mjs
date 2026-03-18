/**
 * src/bridge.mjs
 * Filesystem bridge: watches outbox/ for OpenClaw → XMTP sends.
 * Uses fs.watch (callback API from node:fs, not fs/promises).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getOutboxDir } from './paths.mjs';
import { getContextProfile } from './peers.mjs';
import { agentInstance } from './agent.mjs';

let watcher = null;
let pollInterval = null;
const processed = new Map(); // filename → timestamp for TTL-based eviction
const PROCESSED_TTL_MS = 60_000; // 60s TTL per entry (prevents unbounded growth)

function markProcessed(filename) {
  processed.set(filename, Date.now());
  // Evict stale entries periodically
  if (processed.size > 500) {
    const cutoff = Date.now() - PROCESSED_TTL_MS;
    for (const [k, ts] of processed) {
      if (ts < cutoff) processed.delete(k);
    }
  }
}

async function handleOutbound(filename) {
  if (!filename || !filename.endsWith('.json')) return;
  if (processed.has(filename)) return;
  markProcessed(filename);

  const outboxDir = getOutboxDir();
  const filePath = path.join(outboxDir, filename);

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const msg = JSON.parse(raw);

    if (!agentInstance) {
      console.error('[Bridge] Agent not ready — cannot send');
      return; // leave file for retry on next poll
    }

    // Reply blocking: check if peer's relationship allows outbound messages.
    // Handshake messages (messageType=HANDSHAKE) always go through regardless.
    const isHandshake = msg.v6Payload?.messageType === 'HANDSHAKE';
    if (!isHandshake && msg.peerAddress) {
      const profile = await getContextProfile(msg.peerAddress);
      if (!profile.canReply) {
        console.warn(`[Bridge] Outbound blocked — peer ${msg.peerAddress} relationship does not allow replies`);
        await fsp.unlink(filePath).catch(() => {});
        return;
      }
    }

    // Use SDK helper (not raw client.conversations.createDmWithIdentifier)
    const conv = await agentInstance.createDmWithAddress(msg.peerAddress);

    const content = typeof msg.v6Payload === 'string'
      ? msg.v6Payload
      : JSON.stringify(msg.v6Payload);

    await conv.sendText(content);
    console.log(`[Bridge] Sent to ${msg.peerAddress}`);

    // Remove processed file
    await fsp.unlink(filePath).catch(() => {});
  } catch (err) {
    console.error(`[Bridge] Failed to process ${filename}: ${err.message}`);
    // Move to failed/ on send error (prevents message loss)
    try {
      const failedDir = path.join(outboxDir, 'failed');
      await fsp.mkdir(failedDir, { recursive: true });
      await fsp.rename(filePath, path.join(failedDir, filename)).catch(() => {});
      console.warn(`[Bridge] Moved ${filename} to failed/ for retry`);
    } catch { /* best effort */ }
  }
}

/**
 * Poll-based fallback: scan outbox for any files fs.watch may have missed.
 * Runs every 5s — catches macOS fsevents gaps and startup queue.
 */
async function pollOutbox() {
  try {
    const outboxDir = getOutboxDir();
    const files = await fsp.readdir(outboxDir);
    for (const f of files) {
      if (f.endsWith('.json') && !processed.has(f)) {
        await handleOutbound(f);
      }
    }
  } catch { /* outbox may not exist yet */ }
}

export function startBridge(config) {
  const outboxDir = getOutboxDir();

  // Ensure outbox exists
  fs.mkdirSync(outboxDir, { recursive: true });

  // Primary: fs.watch for instant delivery
  watcher = fs.watch(outboxDir, (eventType, filename) => {
    if (eventType === 'rename' || eventType === 'change') {
      handleOutbound(filename);
    }
  });

  // Secondary: polling fallback for fs.watch reliability gaps (macOS fsevents, startup queue)
  const pollMs = config?.xmtp?.bridge?.pollIntervalMs || 5000;
  pollInterval = setInterval(pollOutbox, pollMs);
  // Process any files already in outbox at startup
  pollOutbox();

  console.log(`[Bridge] Watching ${outboxDir} (poll every ${pollMs}ms)`);
}

export function stopBridge() {
  if (watcher) { watcher.close(); watcher = null; }
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  console.log('[Bridge] Stopped');
}
