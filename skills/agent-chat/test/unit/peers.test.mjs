/**
 * test/unit/peers.test.mjs
 * Tests peer registry: CRUD, relationship mapping, JSON fallback, concurrency.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

let peers;
let testDir;

describe('Peers Module', () => {
  before(async () => {
    testDir = path.join(os.tmpdir(), `agent-chat-peers-test-${crypto.randomUUID().slice(0, 8)}`);
    await fs.mkdir(testDir, { recursive: true });
    process.env.AGENT_CHAT_XMTP_DIR = testDir;

    peers = await import('../../src/peers.mjs');
    // Reset internal cache so it reads from the test directory
    peers._resetForTest();
  });

  after(async () => {
    delete process.env.AGENT_CHAT_XMTP_DIR;
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('exports RELATIONSHIPS array', () => {
    assert.ok(Array.isArray(peers.RELATIONSHIPS));
    assert.deepStrictEqual(peers.RELATIONSHIPS, ['unknown', 'stranger', 'colleague', 'friend', 'family']);
  });

  it('returns null for unknown peer', async () => {
    const result = await peers.getPeer('0xnonexistent');
    assert.strictEqual(result, null);
  });

  it('sets and gets a peer', async () => {
    await peers.setPeer({
      address: '0xABC123',
      inboxId: 'inbox-abc',
      name: 'Test Peer',
      relationship: 'stranger',
      approved: true,
      discoveredAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      handshakeState: 'verified',
      source: 'cli-trust',
    });

    const peer = await peers.getPeer('0xabc123'); // lowercase lookup
    assert.ok(peer, 'should find peer');
    assert.strictEqual(peer.address, '0xabc123'); // stored lowercase
    assert.strictEqual(peer.name, 'Test Peer');
    assert.strictEqual(peer.relationship, 'stranger');
    assert.strictEqual(peer.approved, true);
  });

  it('normalizes address to lowercase', async () => {
    await peers.setPeer({
      address: '0xDEF456',
      relationship: 'colleague',
      approved: false,
    });

    const peer = await peers.getPeer('0xDEF456');
    assert.strictEqual(peer.address, '0xdef456');
  });

  it('getAllPeers returns all registered peers', async () => {
    const all = await peers.getAllPeers();
    assert.ok(all.length >= 2, 'should have at least 2 peers from prior tests');
  });

  it('isPeerKnown returns true for registered peer', async () => {
    assert.ok(await peers.isPeerKnown('0xabc123'));
    assert.ok(!(await peers.isPeerKnown('0xnothere')));
  });

  it('removePeer deletes a peer', async () => {
    await peers.setPeer({ address: '0xremoveme', relationship: 'unknown' });
    assert.ok(await peers.isPeerKnown('0xremoveme'));
    await peers.removePeer('0xremoveme');
    assert.ok(!(await peers.isPeerKnown('0xremoveme')));
  });

  it('setRelationship validates relationship value', async () => {
    await assert.rejects(
      () => peers.setRelationship('0xabc123', 'enemy'),
      /Invalid relationship/
    );
  });

  it('setRelationship updates existing peer', async () => {
    await peers.setRelationship('0xabc123', 'friend');
    const peer = await peers.getPeer('0xabc123');
    assert.strictEqual(peer.relationship, 'friend');
  });

  it('getContextProfile maps relationships correctly', async () => {
    // stranger
    await peers.setPeer({ address: '0xprofile1', relationship: 'stranger' });
    const p1 = await peers.getContextProfile('0xprofile1');
    assert.strictEqual(p1.contextProfile, 'public');
    assert.strictEqual(p1.canReply, true);
    assert.strictEqual(p1.canCommand, false);

    // colleague
    await peers.setPeer({ address: '0xprofile2', relationship: 'colleague' });
    const p2 = await peers.getContextProfile('0xprofile2');
    assert.strictEqual(p2.contextProfile, 'business');
    assert.strictEqual(p2.canCommand, true);

    // family
    await peers.setPeer({ address: '0xprofile3', relationship: 'family' });
    const p3 = await peers.getContextProfile('0xprofile3');
    assert.strictEqual(p3.contextProfile, 'full');
    assert.strictEqual(p3.maxSensitivity, 'financial');

    // unknown peer (not registered)
    const p4 = await peers.getContextProfile('0xunknown');
    assert.strictEqual(p4.contextProfile, 'public');
    assert.strictEqual(p4.canReply, false);
    assert.strictEqual(p4.canCommand, false);
  });

  it('writes peers.json to disk', async () => {
    const peersFile = path.join(testDir, 'peers.json');
    const raw = await fs.readFile(peersFile, 'utf8');
    const data = JSON.parse(raw);
    assert.strictEqual(data.version, 1);
    assert.ok(data.peers['0xabc123'], 'should have abc123 in persisted file');
  });

  it('throws when setting peer without address', async () => {
    await assert.rejects(
      () => peers.setPeer({ relationship: 'stranger' }),
      /address required/
    );
  });
});
