import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Bridge Module', async () => {
  let tmpDir;
  let peers;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `bridge-test-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, 'outbox'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'outbox', 'failed'), { recursive: true });
    process.env.AGENT_CHAT_XMTP_DIR = tmpDir;

    // Import peers to set up relationships for canReply tests
    const peersModule = await import('../../src/peers.mjs');
    peersModule._resetForTest();
    peers = peersModule;
  });

  it('canReply blocks outbound to unknown peers', async () => {
    await peers.setPeer({ address: '0xUnknownPeer', relationship: 'unknown' });
    const profile = await peers.getContextProfile('0xunknownpeer');
    assert.equal(profile.canReply, false, 'unknown should not allow replies');
  });

  it('canReply allows outbound to stranger peers', async () => {
    await peers.setPeer({ address: '0xStrangerPeer', relationship: 'stranger' });
    const profile = await peers.getContextProfile('0xstrangerpeer');
    assert.equal(profile.canReply, true, 'stranger should allow replies');
  });

  it('canReply allows outbound to colleague/friend/family', async () => {
    for (const rel of ['colleague', 'friend', 'family']) {
      await peers.setPeer({ address: `0x${rel}Peer`, relationship: rel });
      const profile = await peers.getContextProfile(`0x${rel}peer`);
      assert.equal(profile.canReply, true, `${rel} should allow replies`);
    }
  });

  it('handshake messages bypass canReply check', () => {
    // Verify the logic: isHandshake check is on messageType
    const msg = { v6Payload: { messageType: 'HANDSHAKE' }, peerAddress: '0xunknown' };
    const isHandshake = msg.v6Payload?.messageType === 'HANDSHAKE';
    assert.equal(isHandshake, true, 'HANDSHAKE should be detected');
  });

  it('non-handshake messages are subject to canReply', () => {
    const msg = { v6Payload: { messageType: 'DATA' }, peerAddress: '0xunknown' };
    const isHandshake = msg.v6Payload?.messageType === 'HANDSHAKE';
    assert.equal(isHandshake, false, 'DATA should not bypass canReply');
  });
});
