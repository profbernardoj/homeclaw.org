/**
 * src/consent.mjs
 * XMTP consent gate with handshake protocol wiring.
 * Runs BEFORE comms-guard (per architecture).
 *
 * Handshake flow:
 * 1. Unknown peer → register as "unknown" → send challenge → allow as tier 1
 * 2. Peer responds with signed challenge → validate EIP-191 → promote to "stranger"
 * 3. User upgrades relationship via CLI (trust-peer --as colleague)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getOutboxDir } from './paths.mjs';
import { getPeer, setPeer } from './peers.mjs';
import { loadGroups } from './groups.mjs';

let globalPolicy = 'handshake';
let handshakeConfig = { timeoutMs: 90000, maxRetries: 3 };
let discoveryConfig = { defaultRelationship: 'unknown', handshakePromotesTo: 'stranger' };
let _identity = null;

// EIP-191 functions — loaded lazily from comms-guard
let _createChallenge = null;
let _signChallenge = null;
let _verifyChallenge = null;

async function loadHandshakeCrypto() {
  if (_createChallenge) return;
  try {
    const mod = await import('xmtp-comms-guard');
    _createChallenge = mod.createChallenge;
    _signChallenge = mod.signChallenge;
    _verifyChallenge = mod.verifyChallenge;
  } catch {
    console.warn('[Consent] Handshake crypto unavailable — handshakes disabled');
  }
}

export async function initConsent(config, identity) {
  globalPolicy = config?.xmtp?.consentPolicy || 'handshake';
  handshakeConfig = {
    timeoutMs: config?.xmtp?.handshake?.timeoutMs ?? 90000,
    maxRetries: config?.xmtp?.handshake?.maxRetries ?? 3,
  };
  discoveryConfig = {
    defaultRelationship: config?.xmtp?.discovery?.defaultRelationship || 'unknown',
    handshakePromotesTo: config?.xmtp?.discovery?.handshakePromotesTo || 'stranger',
  };
  _identity = identity;
  await loadHandshakeCrypto();
  console.log(`[Consent] Policy: ${globalPolicy}`);
}

/**
 * Resolve sender's Ethereum address from XMTP context.
 * Falls back to inboxId if address resolution fails.
 */
async function resolveSenderAddress(ctx) {
  const sender = ctx.message?.senderInboxId;
  try {
    if (ctx.getSenderAddress) {
      const addr = await ctx.getSenderAddress();
      if (addr) return addr.toLowerCase();
    }
  } catch {
    // Resolution failed — use inboxId as fallback
  }
  console.warn(`[Consent] Could not resolve address for ${sender} — using inboxId as key`);
  return sender;
}

/**
 * Write handshake challenge to outbox for bridge to send.
 */
async function sendHandshakeChallenge(ctx, senderAddress) {
  if (!_createChallenge || !_signChallenge || !_identity) {
    console.warn('[Consent] Cannot send handshake — crypto or identity unavailable');
    return;
  }

  const conversationId = ctx.conversation?.id || 'unknown';
  const challenge = _createChallenge(conversationId);
  const signature = await _signChallenge(challenge, _identity.secrets.XMTP_WALLET_KEY);

  const handshakeMsg = {
    messageType: 'HANDSHAKE',
    version: '6.0',
    payload: {
      challenge,
      signature,
      capabilities: ['v6', 'plaintext'],
    },
    topics: ['general'],
    sensitivity: 'public',
    intent: 'introduce',
    correlationId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    nonce: crypto.randomBytes(32).toString('base64'),
  };

  // Write to outbox for bridge pickup
  const outboxDir = getOutboxDir();
  await fs.mkdir(outboxDir, { recursive: true });
  const filename = `handshake-${crypto.randomUUID()}.json`;
  await fs.writeFile(
    path.join(outboxDir, filename),
    JSON.stringify({
      peerAddress: senderAddress,
      v6Payload: handshakeMsg,
    }, null, 2)
  );

  console.log(`[Consent] Handshake challenge sent to ${senderAddress}`);
}

/**
 * Middleware: consent check + handshake flow
 */
export async function handleConsent(ctx, next) {
  const sender = ctx.message?.senderInboxId;
  if (!sender) return next();

  // Resolve Ethereum address for peer registry
  const senderAddress = await resolveSenderAddress(ctx);
  ctx.peerAddress = senderAddress;

  const peer = await getPeer(senderAddress);

  // Resolve policy (group override or global)
  const groups = await loadGroups();
  const groupOverride = groups[ctx.conversation?.id]?.consentPolicyOverride;
  const policy = groupOverride || globalPolicy;

  if (policy === 'strict' && !peer?.approved) {
    console.log(`[Consent] STRICT: blocked unknown peer ${sender}`);
    return; // drop
  }

  if (policy === 'open' || peer?.approved) {
    // Update lastSeen
    if (peer) {
      peer.lastSeen = new Date().toISOString();
      await setPeer(peer).catch(() => {}); // best-effort
    }
    return next();
  }

  // Handshake policy (default)
  if (!peer) {
    // First contact — register as unknown + initiate handshake
    await setPeer({
      address: senderAddress,
      inboxId: sender,
      name: null,
      relationship: discoveryConfig.defaultRelationship,
      approved: false,
      discoveredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      handshakeState: 'pending',
      handshakeAttempts: 1,
      handshakeSentAt: new Date().toISOString(),
      source: 'auto-discover',
    });
    await sendHandshakeChallenge(ctx, senderAddress);
    console.log(`[Consent] New peer ${senderAddress} — handshake sent, relationship: ${discoveryConfig.defaultRelationship}`);
  } else if (peer.handshakeState === 'failed' && (peer.handshakeAttempts || 0) < handshakeConfig.maxRetries) {
    // Retry handshake
    peer.handshakeAttempts = (peer.handshakeAttempts || 0) + 1;
    peer.handshakeState = 'pending';
    peer.handshakeSentAt = new Date().toISOString();
    peer.lastSeen = new Date().toISOString();
    await setPeer(peer);
    await sendHandshakeChallenge(ctx, senderAddress);
    console.log(`[Consent] Handshake retry ${peer.handshakeAttempts}/${handshakeConfig.maxRetries} for ${senderAddress}`);
  } else if (peer.handshakeState === 'pending') {
    // Check timeout
    const elapsed = Date.now() - new Date(peer.handshakeSentAt || 0).getTime();
    if (elapsed > handshakeConfig.timeoutMs) {
      peer.handshakeState = 'failed';
      peer.lastSeen = new Date().toISOString();
      await setPeer(peer);
      console.log(`[Consent] Handshake timeout for ${senderAddress} (${elapsed}ms)`);
    }
  }

  // Allow message through at tier 1 regardless (never silent drop)
  return next();
}

/**
 * Handle inbound handshake response from a peer.
 * Called by router.mjs when messageType === 'HANDSHAKE'.
 */
export async function handleInboundHandshake(senderAddress, payload) {
  if (!_verifyChallenge) {
    console.warn('[Consent] Cannot validate handshake — crypto unavailable');
    return;
  }

  const peer = await getPeer(senderAddress);
  if (!peer) {
    console.warn(`[Consent] Handshake response from unknown peer ${senderAddress} — ignoring`);
    return;
  }

  if (peer.handshakeState === 'verified') {
    console.log(`[Consent] Peer ${senderAddress} already verified — ignoring duplicate handshake`);
    return;
  }

  try {
    const { challenge, signature } = payload || {};
    if (!challenge || !signature) {
      throw new Error('Missing challenge or signature in handshake payload');
    }

    const valid = await _verifyChallenge(challenge, signature, senderAddress);
    if (!valid) {
      throw new Error('EIP-191 signature verification failed');
    }

    // Success — promote peer
    peer.handshakeState = 'verified';
    peer.approved = true;
    peer.relationship = discoveryConfig.handshakePromotesTo;
    peer.lastSeen = new Date().toISOString();
    await setPeer(peer);

    console.log(`[Consent] ✅ Handshake verified: ${senderAddress} → relationship: ${peer.relationship}`);
  } catch (err) {
    console.error(`[Consent] Handshake validation failed for ${senderAddress}: ${err.message}`);
    peer.handshakeState = 'failed';
    peer.lastSeen = new Date().toISOString();
    await setPeer(peer);
  }
}

export default { initConsent, handleConsent, handleInboundHandshake };
