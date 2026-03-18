import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Paths Module', async () => {
  let paths;
  const origEnv = process.env.AGENT_CHAT_XMTP_DIR;

  before(async () => {
    paths = await import('../../src/paths.mjs');
  });

  after(() => {
    if (origEnv !== undefined) process.env.AGENT_CHAT_XMTP_DIR = origEnv;
    else delete process.env.AGENT_CHAT_XMTP_DIR;
  });

  it('getXmtpDir returns env override when set', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/test-xmtp';
    assert.equal(paths.getXmtpDir(), '/tmp/test-xmtp');
  });

  it('getInboxDir is child of xmtpDir', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/test-xmtp';
    assert.equal(paths.getInboxDir(), '/tmp/test-xmtp/inbox');
  });

  it('getOutboxDir is child of xmtpDir', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/test-xmtp';
    assert.equal(paths.getOutboxDir(), '/tmp/test-xmtp/outbox');
  });

  it('getPeersFilePath is child of xmtpDir', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/test-xmtp';
    assert.equal(paths.getPeersFilePath(), '/tmp/test-xmtp/peers.json');
  });

  it('getHealthFilePath is child of xmtpDir', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/test-xmtp';
    assert.equal(paths.getHealthFilePath(), '/tmp/test-xmtp/health.json');
  });

  it('getGroupsFilePath is child of xmtpDir', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/test-xmtp';
    assert.equal(paths.getGroupsFilePath(), '/tmp/test-xmtp/groups.json');
  });

  it('defaults to ~/.everclaw/xmtp when env not set', () => {
    delete process.env.AGENT_CHAT_XMTP_DIR;
    const dir = paths.getXmtpDir();
    assert.ok(dir.endsWith('.everclaw/xmtp'), `Expected path ending with .everclaw/xmtp, got ${dir}`);
  });

  it('all paths update dynamically when env changes', () => {
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/a';
    assert.equal(paths.getXmtpDir(), '/tmp/a');
    process.env.AGENT_CHAT_XMTP_DIR = '/tmp/b';
    assert.equal(paths.getXmtpDir(), '/tmp/b');
  });
});
