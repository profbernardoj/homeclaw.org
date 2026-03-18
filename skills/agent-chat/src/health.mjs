/**
 * src/health.mjs — status.json for OpenClaw heartbeat + message counter.
 */

import fs from 'node:fs/promises';
import { getHealthFilePath } from './paths.mjs';

let getStatusFn; // cached import

/**
 * Atomic message counter — incremented by router on every routed message (all tiers).
 */
export const messageCounter = {
  _count: 0,
  increment() { this._count++; },
  get value() { return this._count; },
};

export async function writeHealthFile(status) {
  if (!getStatusFn) {
    const mod = await import('./identity.mjs');
    getStatusFn = mod.getStatus;
  }

  const identityStatus = await getStatusFn();
  const health = {
    status,
    timestamp: new Date().toISOString(),
    inboxId: identityStatus.inboxId || 'unknown',
    messagesProcessed: messageCounter.value,
  };

  await fs.writeFile(getHealthFilePath(), JSON.stringify(health, null, 2));
}
