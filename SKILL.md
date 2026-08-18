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

### Run both, by default

When someone points at an endpoint — "what does X cost?", "inspect X", "/x402-tools for
X" — run **`inspect` and then `openapi`**, and report both. The 402 challenge and the
spec answer different questions: the challenge is what the endpoint charges right now,
the spec is what it documents about itself — its full parameter list, response schema,
error codes, and agent-readable `x-*` metadata. Someone deciding whether to call an API
needs both, and `openapi` also produces the spec-vs-live comparison, which exists only if
you run it.

```bash
node scripts/x402.mjs inspect https://api.syraa.fun/bitcoin --method POST --body '{}'
node scripts/x402.mjs openapi https://api.syraa.fun/bitcoin
```

`openapi` takes the same URL as `inspect` — it walks up to the origin itself to search.

Skip the `openapi` run only when the question is narrowly about payment ("is it Solana?",
"just the price") or when the user asked for `inspect` alone. If no spec is found, say so
in one line and move on — a missing spec is a fact worth reporting, not a failure to hide.

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

**Unknown tokens.** If the tool does not recognise a token, it first looks for a
`decimals` the endpoint declared in that option's `extra` block. If it finds one it
converts the price and says the figure is the endpoint's own claim rather than one checked
against the token contract — pass that caveat along. A `decimals` in `extra` is ignored for
tokens the tool does know, so a challenge cannot talk it into a wrong price.

With no table entry and no declared decimals, it shows the raw number and says why. Do not
guess on its behalf — a wrong price is worse than no price. It never queries a blockchain.

**Notes.** The `Notes` section is observations, not faults. Pass them along in the same
neutral register.

## How much to report

**Default to everything the tool returned.** Report every field, not a summary of the
interesting ones. The person running this is usually inspecting an endpoint precisely
because they don't yet know which field matters — dropping one to be concise forces another
round trip. So unless asked otherwise, pass along:

- price as both the human figure and the raw atomic number, with the token's decimals
- every accepted network and token, not just the first or the cheapest
- the pay-to address in full, never truncated
- the x402 version found and where it was found (header vs body)
- the settlement timeout, resource, scheme, and MIME type
- any example request and response the endpoint publishes
- every decoded header, the full `Notes` section, and the HTTP status

And from `openapi`, in the same detail:

- the API title, version, OpenAPI version, and which URL the spec was found at — including
  which candidate paths were tried before one resolved
- the full description and the contact block
- every server URL
- **every operation**: method, path, summary, `operationId`, the request body schema with
  each field's type, whether it is required, and its description, plus every documented
  response code with its meaning
- any example request and response bodies the spec carries
- **every `x-*` metadata key in full** — `x-402`, `x-pricing`, `x-ai-instructions`,
  `x-guidance`, `x-keywords`, `x-category`, `x-provider`, `x-openapi-url`,
  `x-payment-accepts` and any others. These are written for agents specifically;
  `x-ai-instructions` in particular often carries the calling rules that nothing else
  states. Do not summarise them away.
- **every row of the spec-vs-live comparison table**, including the rows that agree, and
  the line saying what was probed and what it returned

If no spec is found, report which paths were tried and that none resolved.

**When a spec covers many operations.** Some specs are gateway-wide — `api.syraa.fun`
documents 35 operations for one endpoint you asked about. There, give the operation the
user actually pointed at in full detail as above, then list every other operation compactly
as method, path and summary — one line each. List all of them; a compact line is not the
same as omitting it, and the reader needs to know what else the API offers. The `x-*`
metadata and the comparison table stay in full either way.

Narrow the output only when the prompt actually narrows it — "just the price", "which
networks?", "is it Solana?", "one line". Then answer that and stop. A specific question is a
request for a specific answer, not a cue to dump the rest alongside it.

Two things that are not reasons to trim: length, and your own sense that a field is
uninteresting. If the full output is long, give it structure — group it under headings or a
table — rather than cutting it.

When the tool errors or returns nothing, report the failure verbatim, including the exact
message and status. Sandbox egress blocks, 404s on GET-only endpoints, and unrecognised
tokens are all more useful quoted than paraphrased.

## Safety

The tool refuses private, loopback, link-local, and internal addresses, and re-checks
where a hostname actually resolves — including after every redirect. If a URL is
refused, that is deliberate; do not try to work around it.

---

x402 Tools by _done — https://underscoredone.com/x402-tools
