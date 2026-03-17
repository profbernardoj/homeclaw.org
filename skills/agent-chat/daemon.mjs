#!/usr/bin/env node
/**
 * daemon.mjs
 * Always-on XMTP daemon entry point. Managed by launchd (macOS) or systemd (Linux).
 * Handles graceful shutdown (SIGTERM/SIGINT) and health file updates.
 */

import { loadIdentity } from './src/identity.mjs';
import { startAgent, stopAgent } from './src/agent.mjs';
import { startBridge, stopBridge } from './src/bridge.mjs';
import { writeHealthFile } from './src/health.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

// Shallow merge config — acceptable for v1
async function loadConfig() {
  const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'config', 'default.json');
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch {
    console.warn('[Daemon] No config found, using defaults');
    return { xmtp: {} };
  }
}

let healthInterval;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Daemon] ${signal} received — shutting down`);

  clearInterval(healthInterval);
  stopBridge();
  await stopAgent();
  await writeHealthFile('stopped');

  console.log('[Daemon] Clean shutdown complete');
  process.exit(0);
}

async function main() {
  console.log('[Daemon] Starting XMTP agent-chat daemon...');

  const config = await loadConfig();
  const identity = await loadIdentity();

  console.log(`[Daemon] Identity loaded: ${identity.metadata.address}`);
  console.log(`[Daemon] Flavor: ${identity.metadata.flavor}`);

  // Start agent with full middleware chain
  await startAgent(identity, config);

  // Start filesystem bridge
  startBridge(config);

  // Health file loop
  await writeHealthFile('running');
  const healthMs = config.xmtp?.health?.updateIntervalMs || 5000;
  healthInterval = setInterval(() => writeHealthFile('running'), healthMs);

  console.log('[Daemon] Ready — listening for messages');
}

// Graceful shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled errors — write health and exit
process.on('uncaughtException', async (err) => {
  console.error('[Daemon] Uncaught exception:', err);
  await writeHealthFile('error').catch(() => {});
  process.exit(1);
});

main().catch(async (err) => {
  console.error('[Daemon] Fatal startup error:', err);
  await writeHealthFile('error').catch(() => {});
  process.exit(3); // Exit code 3 = identity/key error (per error handling table)
});
