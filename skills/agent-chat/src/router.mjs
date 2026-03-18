/**
 * src/router.mjs
 * Tier-aware + relationship-aware message dispatch.
 * Writes all messages to inbox (never silent drop).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getInboxDir } from './paths.mjs';
import { getPeer, getContextProfile } from './peers.mjs';
import { messageCounter } from './health.mjs';

export async function routerMiddleware(ctx, next) {
  const tier = ctx.tier || 1;
  const sender = ctx.peerAddress || ctx.message?.senderInboxId;

  messageCounter.increment();

  // Load relationship context for this peer
  const peer = await getPeer(sender);
  const relationship = peer?.relationship || 'unknown';
  const profile = await getContextProfile(sender);

  console.log(`[Router] Tier ${tier} | ${relationship} | from ${sender}`);

  // Handle HANDSHAKE at any tier (consumed, not written to inbox)
  const msg = ctx.validatedV6 || ctx.lenientV6;
  if (msg?.messageType === 'HANDSHAKE') {
    const { handleInboundHandshake } = await import('./consent.mjs');
    await handleInboundHandshake(sender, msg.payload);
    return next();
  }

  const inboxDir = getInboxDir();
  await fs.mkdir(inboxDir, { recursive: true });

  if (tier === 3) {
    // Full V6 — all message types supported (subject to relationship)
    const v6 = ctx.validatedV6;
    console.log(`[Router] V6 ${v6.messageType} from ${sender}`);

    if (v6.messageType === 'COMMAND') {
      if (!profile.canCommand) {
        console.warn(`[Router] COMMAND blocked — relationship "${relationship}" does not allow commands`);
        const fileId = sanitizeFileId(v6.correlationId);
        await writeInbox(inboxDir, fileId, {
          ...v6,
          messageType: 'DATA',
          direction: 'inbound',
          tier: 3,
          _originalType: 'COMMAND',
          _demotedReason: `relationship-${relationship}-no-command`,
        });
        return next();
      }
      console.log(`[Router] Executing command: ${v6.payload?.command}`);
      // TODO: OpenClaw skill dispatch (Phase D)
    }

    if (v6.messageType === 'DATA' || v6.messageType === 'COMMAND' ||
        v6.messageType === 'RESPONSE' || v6.messageType === 'INTRODUCTION') {
      const fileId = sanitizeFileId(v6.correlationId);
      await writeInbox(inboxDir, fileId, { ...v6, direction: 'inbound', tier: 3 });
    }

  } else if (tier === 2) {
    // Lenient V6 — DATA only, no COMMAND execution
    const v6 = ctx.lenientV6;
    console.log(`[Router] Lenient V6 ${v6.messageType} from ${sender}`);

    if (v6.messageType === 'DATA' || v6.messageType === 'RESPONSE' || v6.messageType === 'INTRODUCTION') {
      const fileId = sanitizeFileId(v6.correlationId);
      await writeInbox(inboxDir, fileId, { ...v6, direction: 'inbound', tier: 2 });
    }

    // COMMAND at tier 2 → demote to DATA, log reason
    if (v6.messageType === 'COMMAND') {
      console.warn(`[Router] COMMAND from tier 2 peer — logged as DATA, not executed`);
      const fileId = sanitizeFileId(v6.correlationId);
      await writeInbox(inboxDir, fileId, {
        ...v6,
        messageType: 'DATA',
        direction: 'inbound',
        tier: 2,
        _originalType: 'COMMAND',
        _demotedReason: 'tier-2-no-command-exec',
      });
    }

  } else {
    // Tier 1 — plaintext, inbox log only
    const content = ctx.plaintext || ctx.message?.content;
    if (content && typeof content === 'string') {
      const fileId = crypto.randomUUID();
      await writeInbox(inboxDir, fileId, {
        messageType: 'PLAINTEXT',
        direction: 'inbound',
        tier: 1,
        senderInboxId: ctx.message?.senderInboxId,
        senderAddress: ctx.peerAddress,
        content,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return next();
}

// --- Utilities ---

function sanitizeFileId(rawId) {
  return (rawId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function writeInbox(dir, fileId, data) {
  const filePath = path.join(dir, `${fileId}.json`);
  const tmpPath = filePath + '.tmp.' + process.pid;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
    await fs.rename(tmpPath, filePath);
    console.log(`[Router] Wrote tier ${data.tier || '?'} message to ${filePath}`);
  } catch (err) {
    console.error(`[Router] Failed to write inbox file ${filePath}: ${err.message}`);
    // Clean up temp file on failure
    await fs.unlink(tmpPath).catch(() => {});
    // Don't throw — never crash the middleware chain on write failure
  }
}
