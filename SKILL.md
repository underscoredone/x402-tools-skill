---
name: x402-tools
description: Inspect x402 pay-per-call endpoints without paying — decode the payment challenge to see the real price, accepted blockchains, pay-to address, and how to call the endpoint; and read an API's openapi.json, comparing it against the live endpoint. Use whenever an x402, HTTP 402, or "payment required" endpoint comes up; when someone asks what an agent API costs, which networks or tokens it takes, or whether they can afford to call it; when a paid API call fails and the reason is unclear; when checking whether your own x402 endpoint emits what you think it does; or when reading, finding, or validating an openapi.json for any API. TRIGGERS: x402, 402, payment required, payment-required header, X-PAYMENT, pay per call, agent payments, USDC endpoint, what does this API cost, inspect endpoint, openapi.json, check my API spec, agentic payments, Bazaar, x402scan
license: MIT
---

# x402 Tools

Read-only inspection of x402 endpoints. Two things it does:

1. **Inspect a live endpoint** — call it without paying, decode the payment challenge,
   and report the price in real money, the accepted networks and tokens, where the money
   goes, and how to call it.
2. **Read an OpenAPI spec** — find it, check it parses, lay out its contents, and show
   where it differs from the live endpoint.

**It never pays, signs, or needs a wallet.** It also never grades an endpoint: it reports
what is there and leaves the conclusions to the reader.

## When to use this

- Someone asks what an x402 or paid API costs, or which chains and tokens it takes
- A paid API call failed and the 402 response is opaque
- Someone wants to know how to call an endpoint before spending anything on it
- Someone is shipping an x402 API and wants to see what it actually emits
- Any request to read, find, or check an `openapi.json`

Do **not** use it to pay for anything — it has no wallet and cannot. If the user wants to
actually call a paid endpoint, that is a different tool.

## How to run it

```bash
node scripts/x402.mjs inspect <url> [--method POST] [--body '{}'] [--json]
node scripts/x402.mjs openapi <url> [--no-compare] [--spec-url <url>] [--json]
node scripts/x402.mjs decode <base64-value>
```

Requires only Node 18+. Nothing to install — the engine is bundled in `lib/`.

### Inspecting an endpoint

```bash
node scripts/x402.mjs inspect https://hash-hmac.underscoredone.com/hash --method POST --body '{}'
```

**Most x402 endpoints only answer POST.** A GET often returns 404 or 405 with no
challenge at all. If a GET shows no x402, retry with `--method POST --body '{}'` before
concluding the endpoint is not x402.

Output covers: the price both as real money and as the raw atomic number, each accepted
network and token, the pay-to address, the settlement timeout, an example request and
response where the endpoint publishes one, and any base64 headers decoded.

### Reading a spec

```bash
node scripts/x402.mjs openapi https://hash-hmac.underscoredone.com
```

Accepts an origin, an endpoint URL, or a direct link to a spec. Given an origin it tries
`/openapi.json`, `/.well-known/openapi.json`, `/openapi.yaml`, `/docs/openapi.json`,
`/swagger.json`, and then the `x-openapi-url` in the live challenge.

By default it also probes the live endpoint and prints a side-by-side table. Pass
`--no-compare` to skip that.

### Decoding a header by hand

```bash
node scripts/x402.mjs decode eyJ4NDAyVmVyc2lvbiI6Miw...
```

## Reading the output

**Price.** x402 quotes prices in the token's smallest unit. `10000` of a 6-decimal token
is `0.01`, not ten thousand. The tool shows both; quote the human figure to the user.

**Version.** v2 puts the challenge in the `payment-required` response header as base64,
with an empty body. v1 puts it in the 402 response body as plain JSON. The tool reads
both and says which it found.

**Differences between spec and live.** Shown as two columns with no "correct" side. A
spec being older than the endpoint it describes is ordinary. Report the difference; do
not tell the user their API is broken.

**Unknown tokens.** If the tool does not recognise a token it shows the raw number and
says so rather than guessing the decimals. Do not guess on its behalf — a wrong price is
worse than no price. It never queries a blockchain.

**Notes.** The `Notes` section is observations, not faults. Pass them along in the same
neutral register.

## Safety

The tool refuses private, loopback, link-local, and internal addresses, and re-checks
where a hostname actually resolves — including after every redirect. If a URL is
refused, that is deliberate; do not try to work around it.

## Hosted version

The same two tools are available as a hosted MCP server, if the user would rather not
run anything locally:

- MCP: `https://x402mcp.underscoredone.com/mcp`
- REST: `https://x402mcp.underscoredone.com/inspect?url=...`

Free, no account, no key, nothing logged.

---

x402 Tools by _done — https://underscoredone.com/x402-tools
