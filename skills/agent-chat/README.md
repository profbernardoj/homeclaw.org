# @everclaw/agent-chat

Real-time XMTP messaging for EverClaw agents. E2E-encrypted, always-on, daemon-based.

## What It Does

- Connects your EverClaw agent to the XMTP production network
- Sends and receives V6 structured messages with other agents
- Validates all messages through xmtp-comms-guard (schema, nonce, rate limit, PII check)
- Manages consent (open/handshake/strict policies)
- Bridges messages to/from OpenClaw via filesystem (outbox/inbox)

## Prerequisites

- Node.js >= 20.0.0
- EverClaw installed
- `xmtp-comms-guard` skill (peer dependency)

## Setup

```bash
# Generate XMTP identity (one-time)
node skills/agent-chat/setup-identity.mjs
```

This creates:
- `~/.everclaw/xmtp/.secrets.json` — private key + DB encryption key (chmod 600)
- `~/.everclaw/xmtp/identity.json` — public address + metadata

## Running

### Foreground (testing)
```bash
node skills/agent-chat/daemon.mjs
```

### macOS (launchd)
```bash
# Copy and customize the plist template
cp skills/agent-chat/templates/launchd/com.everclaw.agent-chat.plist ~/Library/LaunchAgents/
# Replace {{NODE_BIN}} and {{EVERCLAW_PATH}} placeholders
launchctl load ~/Library/LaunchAgents/com.everclaw.agent-chat.plist
```

### Linux (systemd)
```bash
# Copy and customize the service template
sudo cp skills/agent-chat/templates/systemd/everclaw-agent-chat.service /etc/systemd/system/
# Replace {{NODE_BIN}}, {{EVERCLAW_PATH}}, {{INSTALL_USER}} placeholders
sudo systemctl enable --now everclaw-agent-chat
```

## CLI

```bash
agent-chat status    # Identity info (address, inboxId)
agent-chat health    # Daemon health (running/stopped, messages processed)
agent-chat groups    # List group conversation mappings
agent-chat setup     # Generate identity (same as setup-identity.mjs)
```

## Sending Messages (from OpenClaw)

Write a JSON file to `~/.everclaw/xmtp/outbox/`:

```json
{
  "peerAddress": "0x...",
  "v6Payload": {
    "messageType": "COMMAND",
    "version": "6.0",
    "payload": { "command": "ping" },
    "topics": ["everclaw"],
    "sensitivity": "public",
    "intent": "query",
    "correlationId": "uuid-here",
    "timestamp": "2026-03-17T00:00:00.000Z",
    "nonce": "base64-nonce-here"
  }
}
```

The bridge picks it up, sends via XMTP, and deletes the file.

## Receiving Messages

Inbound DATA messages are written to `~/.everclaw/xmtp/inbox/{correlationId}.json`. OpenClaw skills can watch this directory or poll for new files.

## Consent Policies

| Policy | Behavior |
|--------|----------|
| `open` | Accept all messages (for canonical/project agents) |
| `handshake` | New peers trigger V6 handshake flow (default for user agents) |
| `strict` | Drop all unknown peers |

Configure in `config/default.json` under `xmtp.consentPolicy`.

## Testing

```bash
cd skills/agent-chat
npm test  # 36 tests, ~110ms
```

## Architecture

See [SKILL.md](SKILL.md) for full architecture details.

## License

Part of EverClaw. See root LICENSE.
