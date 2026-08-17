#!/usr/bin/env node
/**
 * x402 Tools — command line entry point for the skill.
 *
 * Runs on bare Node with nothing installed: the engine is bundled into
 * ../lib/x402-core.bundle.js, and the only other import is node:dns.
 *
 * Usage:
 *   node scripts/x402.mjs inspect <url> [--method POST] [--body '{}'] [--json]
 *   node scripts/x402.mjs openapi <url> [--no-compare] [--spec-url <url>] [--json]
 *   node scripts/x402.mjs decode <base64-header-value>
 *
 * x402 Tools by _done — https://underscoredone.com/x402-tools
 */

import { lookup } from 'node:dns/promises';
import { inspect, readOpenApi, formatInspect, formatOpenApi, decodeBase64Json } from '../lib/x402-core.bundle.js';

/**
 * Unlike the hosted Worker, this runs on someone's own machine — inside their LAN,
 * where a hostname resolving to a private address is a real risk. So the resolver is
 * always supplied here and every hostname is checked against what it actually resolves to.
 */
async function resolver(hostname) {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const USAGE = `x402 Tools — inspect x402 endpoints without paying.

  inspect <url>     Show what an endpoint charges and how to call it
    --method <M>    HTTP method (many x402 endpoints need POST)
    --body <json>   Request body, e.g. '{}'
    --header k:v    Extra request header (repeatable)
    --follow        Follow redirects, re-checking safety at each hop
    --json          Full structured output instead of readable text

  openapi <url>     Read an API's openapi.json and compare it to the live endpoint
    --spec-url <u>  Use this exact spec URL instead of searching
    --no-compare    Skip probing the live endpoint
    --json          Full structured output

  decode <value>    Base64-decode a payment-required or X-PAYMENT header

Never pays, never signs, never needs a wallet.
x402 Tools by _done — https://underscoredone.com/x402-tools`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, target] = positional;

  if (!command || flags.help || command === 'help') {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  if (command === 'decode') {
    if (!target) { console.error('Give me a base64 value to decode.'); process.exit(1); }
    const decoded = decodeBase64Json(target);
    if (!decoded) { console.error('That value could not be decoded as base64.'); process.exit(1); }
    console.log(typeof decoded.json === 'object' && decoded.json !== null
      ? JSON.stringify(decoded.json, null, 2)
      : decoded.text);
    return;
  }

  if (!target) { console.error(`"${command}" needs a URL.\n\n${USAGE}`); process.exit(1); }

  if (command === 'inspect') {
    const headers = {};
    for (const h of [].concat(flags.header || [])) {
      if (typeof h !== 'string') continue;
      const idx = h.indexOf(':');
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    }
    if (flags.body && !headers['content-type']) headers['content-type'] = 'application/json';

    const result = await inspect(target, {
      method: flags.method || (flags.body ? 'POST' : 'GET'),
      headers,
      body: typeof flags.body === 'string' ? flags.body : undefined,
      followRedirects: Boolean(flags.follow),
      resolver,
    });
    console.log(flags.json ? JSON.stringify(result, null, 2) : formatInspect(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'openapi') {
    const result = await readOpenApi(target, {
      specUrl: typeof flags['spec-url'] === 'string' ? flags['spec-url'] : undefined,
      compareLive: !flags['no-compare'],
      resolver,
    });
    console.log(flags.json ? JSON.stringify(result, null, 2) : formatOpenApi(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  console.error(`Unknown command "${command}".\n\n${USAGE}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`Something went wrong: ${err.message}`);
  process.exit(1);
});
