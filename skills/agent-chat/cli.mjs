#!/usr/bin/env node
/**
 * cli.mjs
 * Agent-chat CLI — uses lazy imports to avoid loading middleware on simple commands.
 */

function timeSince(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const cmd = process.argv[2];

switch (cmd) {
  case 'status': {
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

  case 'trust-peer': {
    const args = process.argv.slice(3);
    const address = args[0];

    // Parse flags
    const asIdx = args.indexOf('--as');
    const nameIdx = args.indexOf('--name');
    const relationship = asIdx !== -1 ? args[asIdx + 1] : 'stranger';
    let name = null;
    if (nameIdx !== -1) {
      // Collect name tokens until next flag (--) or end of args
      const nameTokens = [];
      for (let i = nameIdx + 1; i < args.length; i++) {
        if (args[i].startsWith('--')) break;
        nameTokens.push(args[i]);
      }
      name = nameTokens.join(' ') || null;
    }

    if (!address) {
      console.log(`Usage: agent-chat trust-peer <address> --as <relationship> [--name <label>]

Relationships:
  unknown     No context, messages logged only (default for auto-discovered)
  stranger    Met once, can exchange messages, public topics only
  colleague   Work relationship, project topics + commands allowed
  friend      Personal trust, broader access including personal topics
  family      Full trust, all topics including financial

Examples:
  agent-chat trust-peer 0xAbCd... --as colleague --name "Alice's Agent"
  agent-chat trust-peer 0x1234... --as friend --name "Bob's Agent"
  agent-chat trust-peer 0xDeF0... --as family --name "Carol's Agent"
`);
      break;
    }

    const { setPeer, getPeer, RELATIONSHIPS } = await import('./src/peers.mjs');

    if (!RELATIONSHIPS.includes(relationship)) {
      console.error(`❌ Invalid relationship: "${relationship}". Must be one of: ${RELATIONSHIPS.join(', ')}`);
      break;
    }

    const existing = await getPeer(address);
    await setPeer({
      ...(existing || {}),
      address: address.toLowerCase(),
      name: name || existing?.name || null,
      relationship,
      approved: true,
      handshakeState: existing?.handshakeState === 'verified' ? 'verified' : 'cli-trusted',
      source: 'cli-trust',
      discoveredAt: existing?.discoveredAt || new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    });

    const accessDesc = {
      unknown: 'logged only',
      stranger: 'public topics, can reply',
      colleague: 'project topics + commands',
      friend: 'personal topics + commands',
      family: 'full access',
    };

    console.log(`✅ Peer trusted: ${address}`);
    console.log(`   Name:         ${name || existing?.name || '(unnamed)'}`);
    console.log(`   Relationship: ${relationship}`);
    console.log(`   Access:       ${accessDesc[relationship]}`);
    break;
  }

  case 'peers': {
    const subcmd = process.argv[3] || 'list';
    const { getAllPeers, getPeer } = await import('./src/peers.mjs');

    if (subcmd === 'list') {
      const peers = await getAllPeers();
      if (peers.length === 0) {
        console.log('No peers registered. Peers appear after first contact or trust-peer CLI.');
        break;
      }
      console.log(`Peers (${peers.length}):\n`);
      for (const p of peers) {
        const age = p.lastSeen ? timeSince(new Date(p.lastSeen)) : 'never';
        console.log(`  ${p.name || '(unnamed)'}`);
        console.log(`    Address:      ${p.address}`);
        console.log(`    Relationship: ${p.relationship || 'unknown'}`);
        console.log(`    Handshake:    ${p.handshakeState || 'none'}`);
        console.log(`    Approved:     ${p.approved ? 'yes' : 'no'}`);
        console.log(`    Last seen:    ${age}`);
        console.log(`    Source:       ${p.source || 'unknown'}\n`);
      }
    } else if (subcmd === 'show') {
      const addr = process.argv[4];
      if (!addr) {
        console.log('Usage: agent-chat peers show <address>');
        break;
      }
      const peer = await getPeer(addr);
      if (!peer) {
        console.log(`Peer not found: ${addr}`);
        break;
      }
      console.log(JSON.stringify(peer, null, 2));
    } else {
      console.log('Usage: agent-chat peers [list|show <address>]');
    }
    break;
  }

  case 'send': {
    const address = process.argv[3];
    const message = process.argv.slice(4).join(' ');
    if (!address || !message) {
      console.log('Usage: agent-chat send <address> <message>');
      break;
    }

    const fsMod = await import('node:fs/promises');
    const pathMod = await import('node:path');
    const osMod = await import('node:os');
    const cryptoMod = await import('node:crypto');

    const xmtpDir = process.env.AGENT_CHAT_XMTP_DIR || pathMod.join(osMod.homedir(), '.everclaw', 'xmtp');
    const outboxDir = pathMod.join(xmtpDir, 'outbox');
    await fsMod.mkdir(outboxDir, { recursive: true });

    const filename = `send-${cryptoMod.randomUUID()}.json`;
    await fsMod.writeFile(
      pathMod.join(outboxDir, filename),
      JSON.stringify({
        peerAddress: address.toLowerCase(),
        v6Payload: message,
      }, null, 2)
    );

    console.log(`✅ Message queued for ${address} (bridge will send when daemon is running)`);
    break;
  }

  default:
    console.log(`agent-chat — XMTP transport for EverClaw

Usage:
  agent-chat status                Show identity status
  agent-chat health                Show daemon health
  agent-chat groups                List group mappings
  agent-chat setup                 Generate XMTP identity
  agent-chat trust-peer <addr>     Trust a peer (--as <relationship> --name <label>)
  agent-chat peers [list|show]     List or inspect peers
  agent-chat send <addr> <msg>     Send a message via outbox
`);
}
