/**
 * Tests for the skill as shipped.
 *
 * These run against the committed bundle in `lib/`, not against the core source, because
 * the bundle is what users actually get. If a sync is forgotten, these are what catch it.
 *
 * Everything here is offline — no network, so CI is fast and never flaky.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseChallenge, formatAmount, formatInspect, VERSION } from '../lib/x402-core.bundle.js';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(root, 'scripts', 'x402.mjs');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

const V2 = {
  x402Version: 2,
  error: 'Payment required',
  resource: { url: 'https://api.test/hash', description: 'Hashes things.', mimeType: 'application/json', serviceName: 'Hash Suite', tags: ['hash'] },
  accepts: [{
    scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount: '10000', payTo: '0xE9740820225B3918b4ddd1292C7cA4Ca0e2C2F08', maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' },
  }],
};

// --- the package itself ----------------------------------------------------

test('the files a skill needs are all present', () => {
  for (const f of ['SKILL.md', 'README.md', 'LICENSE', 'NOTICE', 'lib/x402-core.bundle.js', 'scripts/x402.mjs']) {
    assert.ok(existsSync(join(root, f)), `${f} should exist`);
  }
});

test('SKILL.md has the frontmatter a loader reads', () => {
  const text = readFileSync(join(root, 'SKILL.md'), 'utf8');
  assert.ok(text.startsWith('---\n'), 'must open with YAML frontmatter');
  const fm = text.slice(4, text.indexOf('\n---', 4));
  assert.match(fm, /^name:\s*x402-tools$/m);
  assert.match(fm, /^description:\s*\S/m);
  // The description is the only thing a model matches against, so it must be substantial
  // and must name the words people actually type.
  const description = /description:\s*([\s\S]*?)(?:\nlicense:|\n---)/.exec(fm)[1];
  assert.ok(description.length > 200, 'description should be detailed enough to trigger reliably');
  for (const word of ['x402', '402', 'openapi']) {
    assert.ok(description.toLowerCase().includes(word), `description should mention "${word}"`);
  }
});

test('the skill has no dependencies to install', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'must run on bare Node');
  assert.equal(pkg.devDependencies, undefined, 'CI should need no install either');
});

test('the bundle is present, self-contained, and current', () => {
  const bundle = readFileSync(join(root, 'lib/x402-core.bundle.js'), 'utf8');
  assert.ok(bundle.length > 10_000, 'bundle looks truncated');
  // A bundle that still imports something would not run on a bare machine.
  assert.ok(!/from\s+["']node:/.test(bundle), 'bundle must not import node builtins');
  assert.ok(!/require\(/.test(bundle), 'bundle should be ESM only');
  assert.equal(VERSION, '1.0.0');
});

// --- the engine, through the bundle ----------------------------------------

test('decodes a v2 challenge from the payment-required header', () => {
  const r = parseChallenge({ status: 402, headers: { 'payment-required': b64(V2) }, body: '{}' });
  assert.equal(r.found, true);
  assert.equal(r.version, 2);
  assert.equal(r.accepts[0].amount.display, '0.01 USDC');
});

test('decodes a v1 challenge from the response body', () => {
  const v1 = {
    x402Version: 1,
    accepts: [{ scheme: 'exact', network: 'base', maxAmountRequired: '1000',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', payTo: '0x1', resource: 'https://api.test/x' }],
  };
  const r = parseChallenge({ status: 402, headers: {}, body: JSON.stringify(v1) });
  assert.equal(r.version, 1);
  assert.equal(r.accepts[0].amount.display, '0.001 USDC');
});

test('per-chain decimals survive bundling', () => {
  // The bug this guards against would report a price a trillion times off.
  assert.equal(formatAmount('1000000000000000000', 'eip155:56', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d').display, '1 USDC');
  assert.equal(formatAmount('10000', 'eip155:8453', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913').display, '0.01 USDC');
  assert.equal(formatAmount('1000000000000000000', 'eip155:1', '0x6B175474E89094C44Da98b954EedeAC495271d0F').display, '1 DAI');
});

test('rendered output shows both the human and the raw amount', () => {
  const r = parseChallenge({ status: 402, headers: { 'payment-required': b64(V2) }, body: '{}' });
  const text = formatInspect({
    ok: true,
    request: { url: 'https://api.test/hash', method: 'POST', status: 402, elapsedMs: 1, redirectChain: [] },
    x402: { present: true, version: 2, challengeLocation: 'payment-required response header (base64)' },
    resource: r.resource,
    paymentOptions: r.accepts.map((a) => ({
      readable: true, scheme: a.scheme,
      network: { id: a.network.raw, name: a.network.name, testnet: a.network.testnet, known: a.network.known },
      price: { display: a.amount.display, atomic: a.amount.raw, note: a.amount.note },
      asset: { address: a.asset.raw, symbol: a.asset.symbol, decimals: a.asset.decimals }, payTo: a.payTo,
    })),
    notes: r.notes, attribution: 'x402 Tools by _done - underscoredone.com',
  });
  assert.ok(text.includes('0.01 USDC'));
  assert.ok(text.includes('10000'));
  assert.ok(text.includes('underscoredone.com'));
  for (const word of ['invalid', 'non-conformant', 'violation']) {
    assert.ok(!text.toLowerCase().includes(word), `output should not say "${word}"`);
  }
});

// --- the command line ------------------------------------------------------

test('runs with no arguments and prints usage', async () => {
  await assert.rejects(() => run('node', [cli]), (err) => {
    assert.equal(err.code, 1);
    assert.ok(err.stdout.includes('inspect'));
    assert.ok(err.stdout.includes('openapi'));
    return true;
  });
});

test('decode works offline', async () => {
  const { stdout } = await run('node', [cli, 'decode', b64({ x402Version: 2, hello: 'world' })]);
  assert.ok(stdout.includes('"x402Version": 2'));
  assert.ok(stdout.includes('world'));
});

test('refuses private addresses without making a request', async () => {
  const { stdout } = await run('node', [cli, 'inspect', 'http://192.168.1.1']).catch((e) => e);
  assert.ok(stdout.includes('private'), 'should explain why it refused');
});

test('refuses non-http schemes', async () => {
  const { stdout } = await run('node', [cli, 'inspect', 'file:///etc/passwd']).catch((e) => e);
  assert.ok(stdout.toLowerCase().includes('http'));
});

test('an unknown command explains itself', async () => {
  await assert.rejects(() => run('node', [cli, 'frobnicate', 'https://example.com']), (err) => {
    assert.ok(err.stderr.includes('Unknown command'));
    return true;
  });
});
