import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('v0.2.0 Adversarial Tests', async () => {
  let routerMiddleware, peers, tmpDir;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `adversarial-v02-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, 'inbox'), { recursive: true });
    process.env.AGENT_CHAT_XMTP_DIR = tmpDir;

    const mod = await import('../../src/router.mjs');
    routerMiddleware = mod.routerMiddleware;
    peers = await import('../../src/peers.mjs');
  });

  beforeEach(async () => {
    peers._resetForTest();
    try {
      const files = await fs.readdir(path.join(tmpDir, 'inbox'));
      for (const f of files) await fs.unlink(path.join(tmpDir, 'inbox', f));
    } catch {}
  });

  it('path traversal in correlationId is sanitized with atomic write', async () => {
    const ctx = {
      tier: 3,
      peerAddress: '0xattacker',
      message: { senderInboxId: '0xattacker' },
      validatedV6: {
        messageType: 'DATA',
        version: '6.0',
        correlationId: '../../../etc/passwd',
        payload: { text: 'pwned' },
      },
    };
    await routerMiddleware(ctx, () => {});

    // File should be in inbox, not in /etc/
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    assert.ok(files.length > 0);
    // Sanitized name should only have alphanumeric + underscore + dash
    assert.ok(!files[0].includes('..'));
    assert.ok(!files[0].includes('/'));
    // No temp files
    const tmpFiles = files.filter(f => f.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0);
  });

  it('COMMAND from unknown peer is always demoted', async () => {
    await peers.setPeer({ address: '0xattacker', relationship: 'unknown' });
    const ctx = {
      tier: 3,
      peerAddress: '0xattacker',
      message: { senderInboxId: '0xattacker' },
      validatedV6: {
        messageType: 'COMMAND',
        version: '6.0',
        correlationId: 'attack-cmd',
        payload: { command: 'rm -rf /' },
      },
    };
    await routerMiddleware(ctx, () => {});
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', files[0]), 'utf8'));
    assert.equal(content.messageType, 'DATA');
    assert.equal(content._originalType, 'COMMAND');
  });

  it('COMMAND from stranger peer is also demoted', async () => {
    await peers.setPeer({ address: '0xstranger', relationship: 'stranger' });
    const ctx = {
      tier: 3,
      peerAddress: '0xstranger',
      message: { senderInboxId: '0xstranger' },
      validatedV6: {
        messageType: 'COMMAND',
        version: '6.0',
        correlationId: 'stranger-cmd',
        payload: { command: 'exploit' },
      },
    };
    await routerMiddleware(ctx, () => {});
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', files[0]), 'utf8'));
    assert.equal(content.messageType, 'DATA');
    assert.equal(content._originalType, 'COMMAND');
  });

  it('tier 2 COMMAND from family is still demoted (protocol tier enforcement)', async () => {
    await peers.setPeer({ address: '0xfamily', relationship: 'family' });
    const ctx = {
      tier: 2,
      peerAddress: '0xfamily',
      message: { senderInboxId: '0xfamily' },
      lenientV6: {
        messageType: 'COMMAND',
        correlationId: 'family-tier2-cmd',
        payload: { command: 'safe-cmd' },
      },
    };
    await routerMiddleware(ctx, () => {});
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const cmdFile = files.find(f => f.includes('family-tier2-cmd'));
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', cmdFile), 'utf8'));
    assert.equal(content.messageType, 'DATA');
    assert.equal(content._demotedReason, 'tier-2-no-command-exec');
  });

  it('empty/null message content handled gracefully', async () => {
    for (const content of [null, undefined, '', 0, false]) {
      let nextCalled = false;
      const ctx = {
        tier: 1,
        peerAddress: '0xempty',
        message: { senderInboxId: '0xempty', content },
      };
      // Should not throw
      await routerMiddleware(ctx, () => { nextCalled = true; });
      assert.ok(nextCalled, `next() should be called for content: ${JSON.stringify(content)}`);
    }
  });

  it('very large payload (64KB) writes to inbox without crash', async () => {
    const largePayload = 'x'.repeat(64 * 1024);
    const ctx = {
      tier: 3,
      peerAddress: '0xlarge',
      message: { senderInboxId: '0xlarge' },
      validatedV6: {
        messageType: 'DATA',
        version: '6.0',
        correlationId: 'large-payload',
        payload: { text: largePayload },
      },
    };
    await routerMiddleware(ctx, () => {});
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const file = files.find(f => f.includes('large-payload'));
    assert.ok(file, 'Large payload should be written');
    const stat = await fs.stat(path.join(tmpDir, 'inbox', file));
    assert.ok(stat.size > 60000, 'File should be >60KB');
  });
});
