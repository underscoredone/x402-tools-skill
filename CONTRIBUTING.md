# Contributing

Thanks for looking. The most useful contributions, in order:

1. **A token or chain we don't know** — see below
2. **An x402 endpoint this tool reads badly** — open an issue with the URL
3. **Fixes to the wording of the output** — it is read by both people and models

## Adding a token or chain

This is the one place where a mistake shows someone a wrong price, so there is a rule:

> **Read `decimals()` and `symbol()` off the contract. Never assume.**

USDC is 6 decimals on most chains and **18 on BNB Chain**. DAI is 18 everywhere. Tether's
bridged token reports `USDT0` on Polygon and `USD₮0` on Arbitrum. Avalanche uses `USDt`
and `DAI.e`. None of that is guessable.

To check an EVM token:

```bash
curl -s https://base-rpc.publicnode.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0xTOKEN","data":"0x313ce567"},"latest"]}'
```

The result is `decimals()` as hex — `0x06` is 6, `0x12` is 18. Use `0x95d89b41` for
`symbol()`.

For Solana:

```bash
curl -s https://api.mainnet-beta.solana.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getTokenSupply","params":["MINT_ADDRESS"]}'
```

Then add the entry to `core/src/tables.js` **in the
[x402-tools](https://github.com/underscoredone/x402-tools) repo** — not here. This repo
carries a built copy of that engine in `lib/`. Once the change lands there, the bundle is
rebuilt and committed here.

Include in your PR: the chain id, the token address, the values you read, and how you read
them.

## Working on this repo

```bash
npm test
```

No install needed — there are no dependencies, and that is deliberate. If a change
introduces one, the skill stops working on a bare machine, and CI will fail.

Rebuild the bundled engine after changing the core:

```bash
./scripts/sync-core.sh ../x402-tools/core
```

Commit the resulting `lib/x402-core.bundle.js`.

## Things to keep

A few constraints are load-bearing rather than stylistic:

- **No payments, signing, or wallets.** Not a feature gap — it is the reason this is safe
  to install.
- **No blockchain calls at runtime.** The table is hand-verified precisely so the tool
  needs no network beyond the endpoint being inspected.
- **No grading.** No scores, verdicts, or "invalid". Report what is there and let the
  reader decide. A spec that lags behind its endpoint is ordinary, not a fault.
- **No new dependencies.** The skill must run on bare Node.
- **The safety guard stays.** Private-address blocking and post-redirect re-checking are
  not optional; without them this tool becomes an SSRF proxy.

Changes that cross those lines are likely to be declined, however well written — but ask
first in an issue and we'll talk about it.

## Reporting a security issue

Email info@underscoredone.com rather than opening a public issue.

---

x402 Tools by _done — https://underscoredone.com/x402-tools
