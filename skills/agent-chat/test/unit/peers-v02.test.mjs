import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Peers v0.2.0 Features', async () => {
  let peers;
  let tmpDir;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `peers-v02-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    process.env.AGENT_CHAT_XMTP_DIR = tmpDir;
    peers = await import('../../src/peers.mjs');
  });

  beforeEach(async () => {
    peers._resetForTest();
    try { await fs.unlink(path.join(tmpDir, 'peers.json')); } catch {}
  });

  it('normalizePeer fills all default fields', async () => {
    await peers.setPeer({ address: '0xMinimal' });
    const peer = await peers.getPeer('0xminimal');
    assert.ok(peer);
    assert.equal(peer.address, '0xminimal');
    assert.equal(peer.relationship, 'unknown');
    assert.equal(peer.approved, false);
    assert.equal(peer.source, 'manual');
    assert.equal(peer.handshakeAttempts, 0);
    assert.equal(peer.handshakeState, null);
    assert.ok(peer.discoveredAt);
    assert.ok(peer.lastSeen);
  });

  it('normalizePeer preserves explicit fields', async () => {
    await peers.setPeer({
      address: '0xExplicit',
      relationship: 'friend',
      approved: true,
      source: 'auto-discover',
      name: 'Alice',
      handshakeState: 'verified',
      handshakeAttempts: 2,
    });
    const peer = await peers.getPeer('0xexplicit');
    assert.equal(peer.relationship, 'friend');
    assert.equal(peer.approved, true);
    assert.equal(peer.source, 'auto-discover');
    assert.equal(peer.name, 'Alice');
    assert.equal(peer.handshakeState, 'verified');
    assert.equal(peer.handshakeAttempts, 2);
  });

  it('normalizePeer rejects invalid relationship', async () => {
    await peers.setPeer({ address: '0xBadRel', relationship: 'enemy' });
    const peer = await peers.getPeer('0xbadrel');
    assert.equal(peer.relationship, 'unknown', 'Invalid relationship should default to unknown');
  });

  it('setPeer does not mutate caller object', async () => {
    const original = { address: '0xCaller', relationship: 'friend' };
    await peers.setPeer(original);
    assert.equal(original.address, '0xCaller', 'Original address should not be lowercased');
    assert.equal(original.approved, undefined, 'Original should not get approved field');
  });

  it('removePeer works on JSON backend', async () => {
    await peers.setPeer({ address: '0xToRemove', relationship: 'stranger' });
    assert.ok(await peers.isPeerKnown('0xtoremove'));
    await peers.removePeer('0xToRemove');
    assert.ok(!(await peers.isPeerKnown('0xtoremove')));
  });

  it('getContextProfile maps all relationships correctly', async () => {
    const expected = {
      unknown:   { contextProfile: 'public',   canReply: false, canCommand: false },
      stranger:  { contextProfile: 'public',   canReply: true,  canCommand: false },
      colleague: { contextProfile: 'business', canReply: true,  canCommand: true },
      friend:    { contextProfile: 'personal', canReply: true,  canCommand: true },
      family:    { contextProfile: 'full',     canReply: true,  canCommand: true },
    };

    for (const [rel, exp] of Object.entries(expected)) {
      await peers.setPeer({ address: `0x${rel}`, relationship: rel });
      const profile = await peers.getContextProfile(`0x${rel}`);
      assert.equal(profile.contextProfile, exp.contextProfile, `${rel} → ${exp.contextProfile}`);
      assert.equal(profile.canReply, exp.canReply, `${rel} canReply`);
      assert.equal(profile.canCommand, exp.canCommand, `${rel} canCommand`);
    }
  });

  it('concurrent setPeer calls do not corrupt peers.json', async () => {
    // Rapid sequential writes (realistic: handshakes from different peers in quick succession)
    for (let i = 0; i < 10; i++) {
      await peers.setPeer({ address: `0xConcurrent${i}`, relationship: 'stranger' });
    }
    const all = await peers.getAllPeers();
    assert.equal(all.length, 10);

    // Verify file is valid JSON (not corrupted by interleaved writes)
    const raw = await fs.readFile(path.join(tmpDir, 'peers.json'), 'utf8');
    const parsed = JSON.parse(raw); // Throws if corrupted
    assert.equal(Object.keys(parsed.peers).length, 10);
  });

  it('peers.json has correct file permissions', async () => {
    await peers.setPeer({ address: '0xPermTest', relationship: 'stranger' });
    const stat = await fs.stat(path.join(tmpDir, 'peers.json'));
    // 0o600 = 384 decimal (owner read+write)
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `Expected 0600, got ${mode.toString(8)}`);
  });
});
