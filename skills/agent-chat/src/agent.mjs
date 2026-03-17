/**
 * src/agent.mjs
 * Agent creation + middleware wiring.
 * Uses Agent.createFromEnv() — reads XMTP_WALLET_KEY, XMTP_DB_ENCRYPTION_KEY, XMTP_ENV from env.
 * CWD is saved/restored because createFromEnv uses CWD for DB path.
 * 
 * Middleware order (locked): Consent → GuardAdapter → Router
 */

import { Agent } from '@xmtp/agent-sdk';
import { handleConsent, initConsent } from './consent.mjs';
import { routerMiddleware } from './router.mjs';

// Comms-guard singleton — created once at module level
let commsGuard;
try {
  const { createCommsGuardMiddleware, storage } = await import('xmtp-comms-guard');
  // storage.init must be called before comms-guard can run
  // walletAddress is set later in startAgent after identity is known
  commsGuard = { middleware: createCommsGuardMiddleware(), storage };
} catch {
  console.warn('[Agent] xmtp-comms-guard not available — guard middleware disabled');
  commsGuard = null;
}

export let agentInstance = null;

/**
 * Guard adapter middleware (~20 lines of glue).
 * Parses V6 JSON from message content, adapts ctx for comms-guard, attaches validated payload.
 */
async function guardAdapterMiddleware(ctx, next) {
  if (!commsGuard) return next();

  const raw = ctx.message?.content;
  if (!raw || typeof raw !== 'string') return next();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Plain text message — skip comms-guard, pass through
    return next();
  }

  // Only V6 structured messages go through comms-guard
  if (!parsed.messageType || parsed.version !== '6.0') return next();

  const adaptedCtx = {
    message: parsed,
    direction: 'inbound',
    peerAddress: ctx.message?.senderInboxId || ctx.message?.senderAddress
  };

  try {
    await commsGuard.middleware(adaptedCtx, () => {
      // Guard passed — attach validated V6 payload to original ctx
      ctx.validatedV6 = parsed;
      return next();
    });
  } catch (err) {
    console.error(`[Guard] Message rejected: ${err.message}`);
    // Drop message — do not call next()
  }
}

/**
 * Start the XMTP agent with full middleware chain.
 * @param {object} identity - From identity.loadIdentity()
 * @param {object} config - From config/default.json
 */
export async function startAgent(identity, config) {
  // Set env vars for createFromEnv
  process.env.XMTP_WALLET_KEY = identity.secrets.XMTP_WALLET_KEY;
  process.env.XMTP_DB_ENCRYPTION_KEY = identity.secrets.XMTP_DB_ENCRYPTION_KEY;
  process.env.XMTP_ENV = identity.secrets.XMTP_ENV || 'production';

  // Init comms-guard storage with wallet address
  if (commsGuard?.storage?.init) {
    await commsGuard.storage.init(identity.metadata.address);
  }

  // Init consent with config
  await initConsent(config);

  // CWD save/restore — createFromEnv uses CWD for DB directory
  const savedCwd = process.cwd();
  try {
    process.chdir(identity.dbPath);
    agentInstance = await Agent.createFromEnv();
  } finally {
    process.chdir(savedCwd);
  }

  // Wire middleware chain: Consent → Guard → Router
  agentInstance.use(handleConsent);
  agentInstance.use(guardAdapterMiddleware);
  agentInstance.use(routerMiddleware);

  // Start listening
  await agentInstance.start();

  // Save inboxId on first run (lazy registration)
  if (!identity.metadata.inboxId && agentInstance.inboxId) {
    const { saveInboxId } = await import('./identity.mjs');
    await saveInboxId(agentInstance.inboxId);
    console.log(`[Agent] InboxId registered: ${agentInstance.inboxId}`);
  }

  console.log(`[Agent] Started — Address: ${identity.metadata.address}`);
  return agentInstance;
}

export async function stopAgent() {
  if (agentInstance) {
    await agentInstance.stop?.();
    agentInstance = null;
    console.log('[Agent] Stopped');
  }
}
