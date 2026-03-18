/**
 * src/peers.mjs
 * Peer registry with relationship-based trust.
 * Two backends: JSON fallback (always available) + Bagman (when installed).
 * Atomic writes + in-memory cache for concurrency safety.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getPeersFilePath } from './paths.mjs';

export const RELATIONSHIPS = ['unknown', 'stranger', 'colleague', 'friend', 'family'];

/**
 * Maps user-facing relationship to comms-guard contextProfile + capabilities.
 * Users say "colleague" — system translates to "business" profile internally.
 */
const RELATIONSHIP_MAP = {
  unknown:   { contextProfile: 'public',   maxSensitivity: 'public',    canReply: false, canCommand: false },
  stranger:  { contextProfile: 'public',   maxSensitivity: 'public',    canReply: true,  canCommand: false },
  colleague: { contextProfile: 'business', maxSensitivity: 'technical', canReply: true,  canCommand: true  },
  friend:    { contextProfile: 'personal', maxSensitivity: 'personal',  canReply: true,  canCommand: true  },
  family:    { contextProfile: 'full',     maxSensitivity: 'financial', canReply: true,  canCommand: true  },
};

// --- Backend selection ---

/**
 * Bagman API contract (xmtp-comms-guard v6.0 storage):
 *   Probe: storage.set(key, val), storage.get(key), storage.delete(key)
 *   Peers: storage.getPeer(address), storage.setPeer(peerObj), storage.getAllPeers()
 *   Optional: storage.removePeer(address) — falls back to storage.delete(address)
 *   Init: storage.init(agentAddress)
 *   Noop stub: storage.get() always returns null (detected by write+read probe)
 */
let _backend = null; // 'json' | 'bagman'
let _bagmanStorage = null;

async function detectBackend() {
  if (_backend) return _backend;

  try {
    const { storage } = await import('xmtp-comms-guard');
    // Probe: write + read a marker to confirm bagman is real (not noop stub).
    // The noop stub always returns null for get(), so this distinguishes them.
    const probeKey = '__peers_probe__';
    await storage.set(probeKey, 'ok');
    const probeResult = await storage.get(probeKey);
    if (probeResult === 'ok') {
      await storage.delete(probeKey);
      _bagmanStorage = storage;
      _backend = 'bagman';
      return _backend;
    }
  } catch {
    // comms-guard or bagman unavailable
  }

  _backend = 'json';
  return _backend;
}

// --- In-memory cache (JSON backend) ---

let _cache = null;

async function loadCache() {
  if (_cache) return _cache;
  try {
    const raw = await fs.readFile(getPeersFilePath(), 'utf8');
    _cache = JSON.parse(raw);
  } catch {
    _cache = { version: 1, peers: {} };
  }
  return _cache;
}

let _flushCounter = 0;
let _flushLock = Promise.resolve();

async function flushCache() {
  if (!_cache) return;
  // Serialize concurrent flushes — in-memory cache is shared, file writes must not race
  _flushLock = _flushLock.then(async () => {
    const peersFile = getPeersFilePath();
    await fs.mkdir(path.dirname(peersFile), { recursive: true });
    // Atomic write: temp file + rename (POSIX-atomic)
    const tmpPath = peersFile + '.tmp.' + process.pid + '.' + (++_flushCounter);
    await fs.writeFile(tmpPath, JSON.stringify(_cache, null, 2));
    await fs.rename(tmpPath, peersFile);
    try {
      await fs.chmod(peersFile, 0o600);
    } catch {
      // chmod may fail on some platforms — non-critical
    }
  });
  return _flushLock;
}

// --- Public API ---

export async function getPeer(address) {
  if (!address) return null;
  const key = address.toLowerCase();
  const backend = await detectBackend();

  if (backend === 'bagman') {
    return await _bagmanStorage.getPeer(key);
  }

  const cache = await loadCache();
  return cache.peers[key] || null;
}

/**
 * Normalize + default all peer fields to prevent incomplete records.
 * Ensures every peer always has the full shape from the spec.
 */
function normalizePeer(peer, key) {
  return {
    address: key,
    inboxId: peer.inboxId || null,
    name: peer.name || null,
    relationship: RELATIONSHIPS.includes(peer.relationship) ? peer.relationship : 'unknown',
    approved: peer.approved ?? false,
    discoveredAt: peer.discoveredAt || new Date().toISOString(),
    lastSeen: peer.lastSeen || new Date().toISOString(),
    handshakeState: peer.handshakeState || null,
    handshakeAttempts: peer.handshakeAttempts || 0,
    handshakeSentAt: peer.handshakeSentAt || null,
    source: peer.source || 'manual',
  };
}

export async function setPeer(peer) {
  if (!peer?.address) throw new Error('Peer address required');
  const key = peer.address.toLowerCase();
  // Don't mutate the caller's object — spread into normalized copy
  const normalized = normalizePeer(peer, key);

  const backend = await detectBackend();

  if (backend === 'bagman') {
    // Map relationship to contextProfile for bagman/comms-guard compatibility
    // Bagman API: storage.getPeer(address), storage.setPeer(peerObj), storage.removePeer(address)
    const profile = RELATIONSHIP_MAP[normalized.relationship] || RELATIONSHIP_MAP.unknown;
    await _bagmanStorage.setPeer({
      ...normalized,
      contextProfile: profile.contextProfile,
    });
    return;
  }

  const cache = await loadCache();
  const prev = cache.peers[key];
  cache.peers[key] = { ...normalized };

  try {
    await flushCache();
  } catch (err) {
    // Rollback on write failure
    if (prev) {
      cache.peers[key] = prev;
    } else {
      delete cache.peers[key];
    }
    throw err;
  }
}

export async function getAllPeers() {
  const backend = await detectBackend();

  if (backend === 'bagman') {
    return await _bagmanStorage.getAllPeers() || [];
  }

  const cache = await loadCache();
  return Object.values(cache.peers);
}

export async function removePeer(address) {
  if (!address) return;
  const key = address.toLowerCase();
  const backend = await detectBackend();

  if (backend === 'bagman') {
    // Use peer-level API (matches getPeer/setPeer), not generic storage.delete
    if (_bagmanStorage.removePeer) {
      await _bagmanStorage.removePeer(key);
    } else {
      // Fallback if removePeer not exposed — try generic delete with same key format
      await _bagmanStorage.delete(key);
    }
    return;
  }

  const cache = await loadCache();
  delete cache.peers[key];
  await flushCache();
}

export async function isPeerKnown(address) {
  const peer = await getPeer(address);
  return peer !== null;
}

export async function setRelationship(address, relationship) {
  if (!RELATIONSHIPS.includes(relationship)) {
    throw new Error(`Invalid relationship: "${relationship}". Must be one of: ${RELATIONSHIPS.join(', ')}`);
  }

  const peer = await getPeer(address);
  if (!peer) {
    throw new Error(`Peer not found: ${address}`);
  }

  peer.relationship = relationship;
  peer.lastSeen = new Date().toISOString();
  await setPeer(peer);
}

export async function getContextProfile(address) {
  const peer = await getPeer(address);
  const relationship = peer?.relationship || 'unknown';
  return RELATIONSHIP_MAP[relationship] || RELATIONSHIP_MAP.unknown;
}

/**
 * Reset internal state — for testing only.
 */
export function _resetForTest() {
  _cache = null;
  _backend = null;
  _bagmanStorage = null;
}

export default {
  getPeer,
  setPeer,
  getAllPeers,
  removePeer,
  isPeerKnown,
  setRelationship,
  getContextProfile,
  RELATIONSHIPS,
  RELATIONSHIP_MAP,
  _resetForTest,
};
