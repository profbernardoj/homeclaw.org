/**
 * src/agent.mjs
 * Agent creation + middleware wiring + 3-tier guard adapter.
 * Uses Agent.createFromEnv() — reads XMTP_WALLET_KEY, XMTP_DB_ENCRYPTION_KEY, XMTP_ENV from env.
 * XMTP_DB_DIRECTORY used for DB path (no CWD hack).
 *
 * Middleware order (locked): Consent → GuardAdapter → Router
 */

import { Agent } from '@xmtp/agent-sdk';
import { handleConsent, initConsent } from './consent.mjs';
import { routerMiddleware } from './router.mjs';

// Comms-guard singleton — created once at module level (optional peer dependency).
// All functions cached here to avoid repeated dynamic imports in hot paths.
let commsGuard = null;
let validateLenient = null;
let rateLimit = null;
let piiCheck = null;

try {
  const mod = await import('xmtp-comms-guard');
  commsGuard = {
    middleware: mod.createCommsGuardMiddleware(),
    storage: mod.storage,
  };
  validateLenient = mod.validateLenient || null;
  rateLimit = mod.rateLimit || null;
  piiCheck = mod.piiCheck || null;
  console.log('[Agent] xmtp-comms-guard loaded — full guard pipeline available');
} catch {
  console.warn('[Agent] xmtp-comms-guard not available — all messages treated as tier 1/2');
}

export let agentInstance = null;

/**
 * Guard adapter middleware — classifies messages into 3 tiers.
 *
 * Tier 3: Full V6 JSON, passes complete 8-step comms-guard pipeline
 * Tier 2: Partial V6 JSON (has messageType but missing fields), rate limit + PII only
 * Tier 1: Plain text or unparseable — logged, no dispatch
 */
async function guardAdapterMiddleware(ctx, next) {
  const raw = ctx.message?.content;
  if (!raw || typeof raw !== 'string') {
    ctx.tier = 1;
    ctx.plaintext = '';
    return next();
  }

  // Attempt JSON parse
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Plain text — tier 1
    ctx.tier = 1;
    ctx.plaintext = raw;
    return next();
  }

  // Must have messageType to be considered V6-ish
  if (!parsed.messageType) {
    ctx.tier = 1;
    ctx.plaintext = raw;
    return next();
  }

  // Attempt strict V6 validation + full guard pipeline (tier 3)
  // Note: ctx.peerAddress is resolved by consent middleware (runs before us).
  // Fallback to senderInboxId only if consent didn't set it.
  if (commsGuard && parsed.version === '6.0') {
    const peerAddress = ctx.peerAddress || ctx.message?.senderInboxId;

    const adaptedCtx = {
      message: parsed,
      direction: 'inbound',
      peerAddress,
    };

    try {
      let guardPassed = false;
      await commsGuard.middleware(adaptedCtx, () => {
        guardPassed = true;
      });

      if (guardPassed) {
        ctx.tier = 3;
        ctx.validatedV6 = parsed;
        return next();
      }
    } catch (err) {
      // Strict validation failed — log details, fall through to lenient
      console.warn(`[Guard] Tier 3 rejected (${err.code || 'UNKNOWN'}), peer: ${peerAddress}: ${err.details || err.message}`);
    }
  }

  // Attempt lenient V6 parse (tier 2)
  if (validateLenient) {
    const result = validateLenient(parsed);
    if (result.valid) {
      const peerAddress = ctx.peerAddress || ctx.message?.senderInboxId;
      try {
        // Use module-level cached refs — no dynamic import in hot path
        if (rateLimit) {
          await rateLimit(peerAddress, Buffer.byteLength(raw, 'utf8'));
        }
        if (piiCheck) {
          await piiCheck(result.parsed, 'inbound');
        }
      } catch (err) {
        if (err.code === 'RATE_LIMIT' || err.code === 'PII_DETECTED' || err.code === 'SIZE_EXCEEDED') {
          console.error(`[Guard] Message dropped at tier 2 — code: ${err.code}, peer: ${peerAddress}`);
          return; // drop
        }
        console.warn(`[Guard] Tier 2 check warning: ${err.message}`);
      }

      ctx.tier = 2;
      ctx.lenientV6 = result.parsed;
      return next();
    }
  }

  // Fallback: has messageType but failed both schemas — treat as tier 1
  ctx.tier = 1;
  ctx.plaintext = raw;
  return next();
}

/**
 * Start the XMTP agent with full middleware chain.
 * @param {object} identity - From identity.loadIdentity()
 * @param {object} config - From config/default.json
 */
export async function startAgent(identity, config) {
  try {
    // Set env vars for createFromEnv
    process.env.XMTP_WALLET_KEY = identity.secrets.XMTP_WALLET_KEY;
    process.env.XMTP_DB_ENCRYPTION_KEY = identity.secrets.XMTP_DB_ENCRYPTION_KEY;
    process.env.XMTP_ENV = identity.secrets.XMTP_ENV || 'production';

    // Use XMTP_DB_DIRECTORY instead of CWD hack
    process.env.XMTP_DB_DIRECTORY = identity.dbPath;

    // Init comms-guard storage with wallet address
    if (commsGuard?.storage?.init) {
      await commsGuard.storage.init(identity.metadata.address);
    }

    // Init consent with config + identity (needed for handshake signing)
    await initConsent(config, identity);

    // Create agent via SDK
    agentInstance = await Agent.createFromEnv();

    // Wire middleware chain: Consent → Guard → Router
    agentInstance.use(handleConsent);
    agentInstance.use(guardAdapterMiddleware);
    agentInstance.use(routerMiddleware);

    // Start listening
    await agentInstance.start();

    // Save inboxId on first run (lazy registration)
    // Agent class wraps client — inboxId is on client, not Agent directly
    const inboxId = agentInstance.client?.inboxId;
    if (!identity.metadata.inboxId && inboxId) {
      const { saveInboxId } = await import('./identity.mjs');
      await saveInboxId(inboxId);
      console.log(`[Agent] InboxId registered: ${inboxId}`);
    }

    console.log(`[Agent] Started — Address: ${identity.metadata.address}`);
    return agentInstance;
  } catch (err) {
    console.error(`[Agent] Failed to start: ${err.message}`);
    console.error(`[Agent] Check env vars (XMTP_WALLET_KEY, XMTP_DB_ENCRYPTION_KEY) and network connectivity`);
    throw err; // Re-throw for daemon.mjs to handle
  }
}

export async function stopAgent() {
  if (agentInstance) {
    await agentInstance.stop?.();
    agentInstance = null;
    console.log('[Agent] Stopped');
  }
}
