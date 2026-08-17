# x402 Tools

**Inspect any x402 endpoint before you pay it.**

A Claude skill that calls a paid API *without paying*, decodes its payment challenge, and
tells you in plain terms what it costs, which chains and tokens it takes, and how to call
it. Plus reads any API's `openapi.json`.

[![test](https://github.com/underscoredone/x402-tools-skill/actions/workflows/test.yml/badge.svg)](https://github.com/underscoredone/x402-tools-skill/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](#requirements)
[![dependencies](https://img.shields.io/badge/dependencies-none-brightgreen.svg)](package.json)

It **never pays, never signs, and never needs a wallet.**

---

## The problem

An x402 endpoint answers an unpaid request with `402` and a base64 blob:

```
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2Ui...
```

Decode it and the price reads `"amount": "10000"`. That is **one cent**, not ten thousand
dollars — x402 quotes prices in the token's smallest unit, and USDC has six decimal
places. Except on BNB Chain, where USDC has eighteen. And DAI has eighteen everywhere.

This skill does that arithmetic for you, from a table where every value was read off the
token contract itself.

## Install

Pick the one that matches where you use Claude. There is no `npm install` in any of them.

### Claude Desktop, or Claude Code

Both read the same folder on your machine, so one clone covers both:

```bash
git clone https://github.com/underscoredone/x402-tools-skill.git ~/.claude/skills/x402-tools
```

Restart Claude and the skill is available. To scope it to a single project instead, clone
into that project's `.claude/skills/` folder.

Updating later:

```bash
cd ~/.claude/skills/x402-tools && git pull
```

### Claude on the web (claude.ai)

The web app can't read your disk, so upload the skill as a zip. No command line needed:

1. On [the GitHub repo](https://github.com/underscoredone/x402-tools-skill), click the green
   **Code** button → **Download ZIP**.
2. Unzip it (double-click). You get a folder named `x402-tools-skill-main`.
3. Rename that folder to `x402-tools` — the folder name becomes the skill name, so drop the
   `-main`.
4. Right-click it → **Compress "x402-tools"** to get `x402-tools.zip`. Zip the whole folder,
   not just `SKILL.md`; the tools live in `lib/` and `scripts/`.
5. In Claude: **Settings → Skills → Add ▾ → Upload a skill**, and choose `x402-tools.zip`.

If you'd rather use a terminal, steps 1–4 are:

```bash
git clone https://github.com/underscoredone/x402-tools-skill.git x402-tools
zip -r x402-tools.zip x402-tools -x '*.git*'
```

#### Then allow network access, or `inspect` will fail

On the web the skill runs in Anthropic's sandbox, which has **no outbound network by
default**. Until you open it up, `inspect` fails with a message like:

> Host not in allowlist: cpi-report-us.underscoredone.com. Add this host to your network
> egress settings to allow access.

That's the sandbox refusing to make the request — not the endpoint rejecting you, and not a
sign the skill is broken. To fix it, go to **Settings → Capabilities**, turn on network
egress, and add the host you're testing, for example:

```
cpi-report-us.underscoredone.com
```

Then re-run. Two gotchas:

- **Wildcards don't work.** `*.underscoredone.com` is rejected; every subdomain you test
  needs its own exact entry.
- On a managed/organization account this setting may be admin-controlled, in which case you
  can't change it yourself.

⚠️ Even with egress open, the web sandbox has no wallet, so it can only read the 402
challenge (price, networks, tokens) — it can't pay. Paid calls need a payments MCP
connector, which means Claude Desktop or Claude Code. The DNS-resolution safety check is
also skipped on the web, since there is no private network to protect. The desktop install
is the one that behaves exactly as documented here.

### Command line only

No Claude required — the tools work as a plain CLI. See
[Use it directly](#use-it-directly).

---

Once installed, just ask in plain language:

> what does https://hash-hmac.underscoredone.com/hash cost?

> can I pay for that API with Solana?

> read the openapi for dns-whois.underscoredone.com

You don't need to name the skill — Claude picks it up from the question.

## Use it directly

```bash
node scripts/x402.mjs inspect https://hash-hmac.underscoredone.com/hash --method POST --body '{}'
```

```bash
node scripts/x402.mjs openapi https://hash-hmac.underscoredone.com
```

```bash
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

> **Getting "no x402 challenge found"?** Retry with `--method POST --body '{}'`. Most
> x402 endpoints ignore GET entirely.

## What it does

**`inspect`** — calls an endpoint without paying and reports:

- The price in real money **and** the raw atomic number
- Every accepted network and token, with human names
- Where the payment goes, and the settlement deadline
- How to call the endpoint, when it publishes a schema
- Any base64 headers, decoded

Reads both protocol versions: **v2** (challenge in the `payment-required` header, body
empty) and **v1** (challenge in the response body).

**`openapi`** — finds an API's spec (trying `/openapi.json`, `/.well-known/openapi.json`,
`/swagger.json` and others), lays out its endpoints and agent-readable `x-*` metadata,
then shows a side-by-side table of where the spec and the live endpoint differ.

## What it will not do

- **Pay, sign, or hold a wallet.** By design, permanently.
- **Call a blockchain.** Token decimals come from a built-in table, verified by hand. An
  unknown token shows the raw number and says so rather than guessing — a wrong price is
  worse than no price.
- **Reach private networks.** Refuses `192.168.x.x`, `localhost`, `169.254.169.254`,
  `*.internal` and friends; checks what a hostname actually resolves to, and checks again
  after every redirect.
- **Grade your endpoint.** No scores, no verdicts, no "invalid". It reports what is there.
  Where a spec and an endpoint disagree it shows both and names no winner — a spec
  lagging behind its endpoint is ordinary.

## Supported chains

USDC, USDT and DAI across Ethereum, Base, Polygon, Arbitrum, Optimism, BNB Chain,
Avalanche, X Layer and Solana, plus testnets — **30 networks, 40 tokens**. Every
`decimals` value was read from the token contract before being written down.

Anything not in the table still works; the amount is shown unconverted with an
explanation. [Open an issue](https://github.com/underscoredone/x402-tools-skill/issues)
with the chain and token address and it'll get added.

## Requirements

Node 18 or newer. Nothing else — no dependencies, no build step, no API keys.

```bash
npm test
```

13 tests, all offline.

## Prefer not to run anything?

The same two tools are hosted, free, no account:

```bash
claude mcp add --transport http x402-tools https://x402mcp.underscoredone.com/mcp
```

The local skill does one thing the hosted one can't: it checks what a hostname actually
resolves to before connecting. Your machine sits inside a private network, so that
matters more here.

## Contributing

Adding a token or chain is the most useful contribution — see
[CONTRIBUTING.md](CONTRIBUTING.md). The rule: read `decimals()` off the contract, never
assume.

## Licence

MIT. Copyright (c) 2026 One Scales Inc. (made by _done - underscoredone.com)

Fork it, self-host it, sell it. A visible "powered by x402 Tools by _done" credit is
appreciated but not required — see [NOTICE](NOTICE).

---

Built by [_done](https://underscoredone.com) — pay-per-call APIs for AI agents.
