import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Router v0.2.0 Features', async () => {
  let routerMiddleware, peers, tmpDir;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `router-v02-test-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, 'inbox'), { recursive: true });
    process.env.AGENT_CHAT_XMTP_DIR = tmpDir;

    const mod = await import('../../src/router.mjs');
    routerMiddleware = mod.routerMiddleware;
    peers = await import('../../src/peers.mjs');
  });

  beforeEach(async () => {
    peers._resetForTest();
    // Clean inbox
    try {
      const files = await fs.readdir(path.join(tmpDir, 'inbox'));
      for (const f of files) await fs.unlink(path.join(tmpDir, 'inbox', f));
    } catch {}
  });

  it('COMMAND blocked for stranger relationship at tier 3', async () => {
    await peers.setPeer({ address: '0xstranger', relationship: 'stranger' });
    let nextCalled = false;
    const ctx = {
      tier: 3,
      peerAddress: '0xstranger',
      message: { senderInboxId: '0xstranger' },
      validatedV6: {
        messageType: 'COMMAND',
        version: '6.0',
        correlationId: 'cmd-test-stranger',
        payload: { command: 'test' },
      },
    };
    await routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled, 'next should be called (never drop)');

    // Check inbox — should be demoted to DATA
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    assert.ok(files.length > 0, 'Should write to inbox');
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', files[0]), 'utf8'));
    assert.equal(content.messageType, 'DATA', 'COMMAND should be demoted to DATA');
    assert.equal(content._originalType, 'COMMAND');
    assert.ok(content._demotedReason.includes('stranger'));
  });

  it('COMMAND allowed for colleague relationship at tier 3', async () => {
    await peers.setPeer({ address: '0xcolleague', relationship: 'colleague' });
    let nextCalled = false;
    const ctx = {
      tier: 3,
      peerAddress: '0xcolleague',
      message: { senderInboxId: '0xcolleague' },
      validatedV6: {
        messageType: 'COMMAND',
        version: '6.0',
        correlationId: 'cmd-test-colleague',
        payload: { command: 'test' },
      },
    };
    await routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled);

    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', files[0]), 'utf8'));
    assert.equal(content.messageType, 'COMMAND', 'COMMAND should stay as COMMAND for colleague');
  });

  it('COMMAND always demoted at tier 2 regardless of relationship', async () => {
    await peers.setPeer({ address: '0xfamily', relationship: 'family' });
    let nextCalled = false;
    const ctx = {
      tier: 2,
      peerAddress: '0xfamily',
      message: { senderInboxId: '0xfamily' },
      lenientV6: {
        messageType: 'COMMAND',
        version: '6.0',
        correlationId: 'cmd-tier2-family',
        payload: { command: 'test' },
      },
    };
    await routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled);

    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const cmdFile = files.find(f => f.includes('cmd-tier2-family'));
    assert.ok(cmdFile, 'Should write demoted COMMAND');
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', cmdFile), 'utf8'));
    assert.equal(content.messageType, 'DATA');
    assert.equal(content._demotedReason, 'tier-2-no-command-exec');
  });

  it('tier 1 plaintext writes full sender metadata', async () => {
    let nextCalled = false;
    const ctx = {
      tier: 1,
      peerAddress: '0xplaintexter',
      plaintext: 'hello from ember',
      message: { senderInboxId: 'inbox-123', content: 'hello from ember' },
    };
    await routerMiddleware(ctx, () => { nextCalled = true; });
    assert.ok(nextCalled);

    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    assert.ok(files.length > 0);
    const content = JSON.parse(await fs.readFile(path.join(tmpDir, 'inbox', files[0]), 'utf8'));
    assert.equal(content.messageType, 'PLAINTEXT');
    assert.equal(content.tier, 1);
    assert.equal(content.senderInboxId, 'inbox-123');
    assert.equal(content.senderAddress, '0xplaintexter');
    assert.equal(content.content, 'hello from ember');
    assert.ok(content.timestamp);
  });

  it('atomic writeInbox creates file via rename (no partial writes)', async () => {
    const ctx = {
      tier: 3,
      peerAddress: '0xatomic',
      message: { senderInboxId: '0xatomic' },
      validatedV6: {
        messageType: 'DATA',
        version: '6.0',
        correlationId: 'atomic-test-123',
        payload: { text: 'test' },
      },
    };
    await peers.setPeer({ address: '0xatomic', relationship: 'stranger' });
    await routerMiddleware(ctx, () => {});

    // Check no .tmp files left behind
    const files = await fs.readdir(path.join(tmpDir, 'inbox'));
    const tmpFiles = files.filter(f => f.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0, 'No temp files should remain');

    // Check real file exists
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    assert.ok(jsonFiles.length > 0, 'Inbox file should exist');
  });
});
