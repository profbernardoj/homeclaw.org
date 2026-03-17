#!/usr/bin/env node
/**
 * cli.mjs
 * Agent-chat CLI — uses lazy imports to avoid loading middleware on simple commands.
 */

const cmd = process.argv[2];

switch (cmd) {
  case 'status': {
    // Lazy import — no middleware/agent-sdk init needed
    const { getStatus } = await import('./src/identity.mjs');
    const status = await getStatus();
    console.log(JSON.stringify(status, null, 2));
    break;
  }

  case 'health': {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const xmtpDir = process.env.AGENT_CHAT_XMTP_DIR || path.join(os.homedir(), '.everclaw', 'xmtp');
    try {
      const health = JSON.parse(await fs.readFile(path.join(xmtpDir, 'health.json'), 'utf8'));
      console.log(JSON.stringify(health, null, 2));
    } catch {
      console.log('{ "status": "no-health-file" }');
    }
    break;
  }

  case 'groups': {
    const { loadGroups } = await import('./src/groups.mjs');
    const groups = await loadGroups();
    console.log(JSON.stringify(groups, null, 2));
    break;
  }

  case 'setup': {
    const { setupIdentity } = await import('./setup-identity.mjs');
    await setupIdentity();
    break;
  }

  case 'send': {
    // TODO: Send message via outbox (Phase D)
    console.log('TODO: send message — write to outbox/ for bridge pickup');
    break;
  }

  default:
    console.log(`agent-chat — XMTP transport for EverClaw

Usage:
  agent-chat status     Show identity status
  agent-chat health     Show daemon health
  agent-chat groups     List group mappings
  agent-chat setup      Generate XMTP identity
  agent-chat send       Send a message (coming soon)
`);
}
