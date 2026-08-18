# x402 Tools

**Inspect any x402 endpoint before you pay it.**

A Claude skill that calls a paid API *without paying*, decodes its payment challenge, and tells you in plain terms what it costs, which chains and tokens it takes, and how to call it. Plus reads any API's `openapi.json`.

It **never pays, never signs, and never needs a wallet.**

[![test](https://github.com/underscoredone/x402-tools-skill/actions/workflows/test.yml/badge.svg)](https://github.com/underscoredone/x402-tools-skill/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#requirements)
[![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](package.json)

## Why

An x402 endpoint answers an unpaid request with `402` and a base64 blob. Decode it and the price reads `"amount": "10000"` — that's **one cent**, not ten thousand dollars. x402 quotes prices in the token's smallest unit, and USDC has six decimals. Except on BNB Chain, where it has eighteen. And DAI has eighteen everywhere. This skill does that arithmetic for you, from a table where every value was read off the token contract itself.

## Install

No `npm install` in any of these.

**Claude Desktop / Claude Code** — both read the same folder:

```bash
git clone https://github.com/underscoredone/x402-tools-skill.git ~/.claude/skills/x402-tools
```

Restart Claude. To scope it to one project, clone into that project's `.claude/skills/` instead. Update later with `git pull`.

**Claude on the web (claude.ai)** — upload a zip:

1. On [the repo](https://github.com/underscoredone/x402-tools-skill): **Code** → **Download ZIP**, unzip.
2. Rename the folder from `x402-tools-skill-main` to `x402-tools` — the folder name becomes the skill name.
3. Right-click → **Compress**. Zip the whole folder, not just `SKILL.md`; the tools live in `lib/` and `scripts/`.
4. In Claude: **Settings → Skills → Add ▾ → Upload a skill**.

⚠️ On the web the skill runs in a sandbox with **no outbound network by default**, so `inspect` fails with `Host not in allowlist: ...`. Fix it in **Settings → Capabilities**: turn on network egress and add each exact host (e.g. `cpi-report-us.underscoredone.com`). Wildcards like `*.underscoredone.com` are rejected, and on a managed account this may be admin-controlled. The web sandbox also has no wallet and skips the DNS-resolution safety check — the desktop install behaves exactly as documented here.

**Command line only** — no Claude required; see below.

## Use it

Once installed, just ask in plain language — you don't need to name the skill:

> what does https://hash-hmac.underscoredone.com/hash cost?
>
> can I pay for that API with Solana?
>
> read the openapi for dns-whois.underscoredone.com

Or directly:

```bash
node scripts/x402.mjs inspect https://hash-hmac.underscoredone.com/hash --method POST --body '{}'
node scripts/x402.mjs openapi https://hash-hmac.underscoredone.com
node scripts/x402.mjs decode eyJ4NDAyVmVyc2lvbiI6Miw...
```

<details>
<summary><b>Example output</b> (click to expand)</summary>

```
# https://hash-hmac.underscoredone.com/hash
POST -> 402 Payment Required (573ms)

## x402
- version: 2
- challenge found in: payment-required response header (base64)

## What this endpoint is
**Hashing, HMAC & Checksum Suite**
Returns: application/json
Tags: sha256 hash, hash, hmac, hmac signature, verify hmac signature

## Payment options
1. **0.01 USDC** on Base Mainnet
   - scheme: exact
   - token: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - raw amount: 10000 (6 decimals)
   - pay to: `0xE9740820225B3918b4ddd1292C7cA4Ca0e2C2F08`
   - must settle within: 300s
2. **0.01 USDC** on Solana Mainnet
   - token: USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
   - pay to: `8ugAWAXDB8V18kiUrGZTq1oMvU3C6Fxs8hfC6rvzQT3b`
   - extra: {"feePayer":"BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP"}

## How to call it
(from extensions.bazaar)
- method: POST
- body type: json
```

Full transcripts, including a 21-option challenge across nine chains: [examples/](examples/)

</details>

### Flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--method <M>` | inspect | HTTP method. **Most x402 endpoints only answer POST** |
| `--body <json>` | inspect | Request body, e.g. `'{}'` |
| `--header k:v` | inspect | Extra header, repeatable |
| `--follow` | inspect | Follow redirects, re-checking safety at each hop |
| `--spec-url <u>` | openapi | Use this exact spec instead of searching |
| `--no-compare` | openapi | Skip probing the live endpoint |
| `--json` | both | Full structured output |

> **Getting "no x402 challenge found"?** Retry with `--method POST --body '{}'`. Most x402 endpoints ignore GET entirely.

## What it does

**`inspect`** calls an endpoint without paying and reports the price in real money *and* the raw atomic number, every accepted network and token with human names, where the payment goes, the settlement deadline, how to call the endpoint when it publishes a schema, and any base64 headers decoded. Reads both **v2** (challenge in the `payment-required` header, body empty) and **v1** (challenge in the body).

**`openapi`** finds an API's spec (trying `/openapi.json`, `/.well-known/openapi.json`, `/swagger.json` and others), lays out its endpoints and agent-readable `x-*` metadata, then shows a side-by-side table of where the spec and the live endpoint differ.

## What it will not do

- **Pay, sign, or hold a wallet.** By design, permanently.
- **Call a blockchain.** Token decimals come from a built-in table, verified by hand. For a token that isn't in it, the tool uses a `decimals` the challenge declares in its `extra` block — labelling that price as the endpoint's own claim — and otherwise shows the raw number and says why rather than guessing. A declared `decimals` never overrides the table, so a challenge cannot talk it into a wrong price.
- **Reach private networks.** Refuses `192.168.x.x`, `localhost`, `169.254.169.254`, `*.internal` and friends; checks what a hostname actually resolves to, and checks again after every redirect.
- **Grade your endpoint.** No scores, no verdicts. Where a spec and an endpoint disagree it shows both and names no winner — a spec lagging behind its endpoint is ordinary.

## Supported chains

USDC, USDT and DAI across Ethereum, Base, Polygon, Arbitrum, Optimism, BNB Chain, Avalanche, X Layer and Solana, plus testnets — **30 networks, 40 tokens**, every `decimals` read off the token contract. Anything not in the table still works; the amount is shown unconverted with an explanation. [Open an issue](https://github.com/underscoredone/x402-tools-skill/issues) with the chain and token address and it'll get added.

## Requirements

Node 18 or newer. Nothing else — no dependencies, no build step, no API keys. `npm test` runs 13 tests, all offline.

## Contributing

Adding a token or chain is the most useful contribution — see [CONTRIBUTING.md](CONTRIBUTING.md). The rule: read `decimals()` off the contract, never assume.

## Licence

MIT. Copyright (c) 2026 One Scales Inc. Fork it, self-host it, sell it. A visible "powered by x402 Tools by _done" credit is appreciated but not required — see [NOTICE](NOTICE).

---

Built by [_done](https://underscoredone.com) — pay-per-call APIs for AI agents.
