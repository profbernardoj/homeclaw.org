/**
 * test-export-v2.mjs — Automated tests for Download Agent v2 pull-path routes.
 * Covers: /internal/diag, /internal/export/start, /internal/export/bundle.
 *
 * Black-box HTTP tests against a spawned auth-proxy (agentic export replaced
 * with a hermetic fake exporter via AGENT_EXPORT_SCRIPT).
 *
 * Spec coverage (SOP-001 Stage 5, Download Agent v2):
 *   - Auth: 401 without binding secret (all 3 routes)
 *   - start: 200 with { bundleToken, sizeBytes, passphrase, expiresAt }
 *   - start: 409 export_in_progress on concurrent request
 *   - bundle: 200 streams exact bytes (Content-Length matches)
 *   - bundle: 404 on replay (single-use token)
 *   - bundle: 404 on bogus token
 *   - bundle: 400 missing token
 *   - passphrase round-trip: decrypt returns known plaintext
 *   - no temp files left in fake HOME after transfer
 *   - secret never appears in proxy stderr
 *   - diag: 200 with probes + exportSizeProbe; auth required
 *
 * Runs with fake $HOME (no real ~/.openclaw touched) and isolated ports.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, 'server.mjs');
const FAKE_EXPORTER = join(__dirname, 'fixtures', 'fake-exporter.mjs');
const PROXY_PORT = 19890;   // distinct from test-proxy (19789)
const BINDING_SECRET = 'test-binding-secret-0123456789abcdef';
const PASSPHRASE = 'correct-horse-battery-staple-2026';

// ─── Spawn auth-proxy with hermetic env ─────────────────────────────────────
let proxyChild = null;
let proxyStderr = '';
const fakeHome = mkdtempSync(join(tmpdir(), 'export-v2-home-'));

const startProxy = async () => {
  const { generateKeyPairSync, createPrivateKey } = await import('node:crypto');
  const { exportJWK } = await import('jose');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  // exportJWK is used only to satisfy the verifySession path; not needed for
  // /internal routes, but the server requires a valid Privy verification key
  // to boot. Generate a throwaway EC key pair.

  const env = {
    ...process.env,
    AUTH_PROXY_PORT: String(PROXY_PORT),
    OPENCLAW_INTERNAL_PORT: String(19891),
    PRIVY_APP_ID: 'test-privy-app',
    PRIVY_VERIFICATION_KEY: publicKeyPem,
    OPENCLAW_OWNER_PRIVY_ID: 'did:privy:test-owner',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef-0123456789',
    CIG_BINDING_SECRET: BINDING_SECRET,
    CIG_MINT_URL: 'http://127.0.0.1:19900/mint',   // never called by /internal routes
    CIG_INFERENCE_URL: 'http://127.0.0.1:19900/v1', // never called by /internal routes
    AGENT_EXPORT_SCRIPT: FAKE_EXPORTER,
    AGENT_EXPORT_TIMEOUT_MS: '10000',
    FAKE_EXPORT_PASSPHRASE: PASSPHRASE,
    HOME: fakeHome,
    USER: 'testuser', // hermetic keychain account
  };

  proxyChild = spawn('node', [SERVER], {
    cwd: __dirname,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proxyChild.stderr.on('data', (d) => { proxyStderr += d.toString(); });
  proxyChild.stdout.on('data', () => {});

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('auth-proxy failed to start: ' + proxyStderr.slice(-2000));
};

const base = () => `http://127.0.0.1:${PROXY_PORT}`;
const startOpts = {
  method: 'POST',
  headers: { 'x-binding-secret': BINDING_SECRET, 'Content-Type': 'application/json' },
  body: '{}',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Download Agent v2 pull-path routes', () => {
  before(async () => { await startProxy(); });
  after(() => {
    if (proxyChild) proxyChild.kill('SIGKILL');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('diag: 401 without binding secret', async () => {
    const res = await fetch(`${base()}/internal/diag`);
    assert.equal(res.status, 401);
  });

  it('start: 401 without binding secret', async () => {
    const res = await fetch(`${base()}/internal/export/start`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('bundle: 401 without binding secret', async () => {
    const res = await fetch(`${base()}/internal/export/bundle?token=abc`);
    assert.equal(res.status, 401);
  });

  it('bundle: 400 missing token (with secret)', async () => {
    const res = await fetch(`${base()}/internal/export/bundle`, {
      headers: { 'x-binding-secret': BINDING_SECRET },
    });
    assert.equal(res.status, 400);
  });

  it('start: 200 returns token+size+passphrase', async () => {
    const res = await fetch(`${base()}/internal/export/start`, startOpts);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.bundleToken, 'has bundleToken');
    assert.equal(typeof body.sizeBytes, 'number');
    assert.ok(body.sizeBytes > 0);
    assert.ok(body.passphrase);
    assert.ok(body.expiresAt);
  });

  it('start then bundle: exact bytes round-trip', async () => {
    const start = await fetch(`${base()}/internal/export/start`, startOpts);
    const { bundleToken, sizeBytes, passphrase } = await start.json();

    const res = await fetch(`${base()}/internal/export/bundle?token=${bundleToken}`, {
      headers: { 'x-binding-secret': BINDING_SECRET },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.length, sizeBytes, 'Content-Length matches start.sizeBytes');
    assert.equal(buf.length, 64 * 1024 + 44, 'fake exporter size');

    // Decrypt round-trip (AES-256-GCM, scrypt — same format as real streaming encryption)
    const salt = buf.subarray(0, 16), iv = buf.subarray(16, 28),
          tag = buf.subarray(buf.length - 16), ciphertext = buf.subarray(28, buf.length - 16);
    const { scryptSync, createDecipheriv } = await import('node:crypto');
    const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(ciphertext), d.final()]);
    assert.ok(plain.toString('utf8').startsWith('FAKE-EXPORT-PAYLOAD-v2'), 'decrypts to known payload');

    // No temp file left behind in fakeHome after transfer
    const leftovers = readdirSync(fakeHome);
    assert.deepEqual(leftovers, [], 'no temp export files remain in fake HOME');
  });

  it('bundle: 404 on replay (single-use token)', async () => {
    const start = await fetch(`${base()}/internal/export/start`, startOpts);
    const { bundleToken } = await start.json();
    const first = await fetch(`${base()}/internal/export/bundle?token=${bundleToken}`, {
      headers: { 'x-binding-secret': BINDING_SECRET },
    });
    assert.equal(first.status, 200);
    await first.arrayBuffer();
    const second = await fetch(`${base()}/internal/export/bundle?token=${bundleToken}`, {
      headers: { 'x-binding-secret': BINDING_SECRET },
    });
    assert.equal(second.status, 404, 'replay of consumed token is 404');
  });

  it('bundle: 404 on bogus token', async () => {
    const res = await fetch(`${base()}/internal/export/bundle?token=not-a-real-token`, {
      headers: { 'x-binding-secret': BINDING_SECRET },
    });
    assert.equal(res.status, 404);
  });

  it('start: 409 on concurrent export (in-flight guard)', async () => {
    const [r1, r2] = await Promise.all([
      fetch(`${base()}/internal/export/start`, startOpts),
      fetch(`${base()}/internal/export/start`, startOpts),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409], `one 200, one 409 (got ${statuses})`);
    if (r1.status === 200) await r1.json(); else await r2.json();
  });

  it('diag: 200 with probes + size probe; auth required', async () => {
    const res = await fetch(`${base()}/internal/diag`, {
      headers: { 'x-binding-secret': BINDING_SECRET },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.probes), 'has probes array');
    assert.ok(body.probes.length >= 5, `has ${body.probes.length} probes`);
    for (const p of body.probes) {
      assert.ok(p.name, 'probe has name');
      assert.equal(typeof p.ok, 'boolean', 'probe has ok boolean');
    }
    assert.ok(body.exportSizeProbe, 'has exportSizeProbe');
  });

  it('proxy stderr never contains the binding secret or passphrase', () => {
    assert.ok(!proxyStderr.includes(BINDING_SECRET), 'binding secret not in stderr');
    assert.ok(!proxyStderr.includes(PASSPHRASE), 'passphrase not in stderr');
  });
});