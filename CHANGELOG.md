# Changelog

All notable changes to this skill. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `SKILL.md`: a "How much to report" section — report every field the tool returned by
  default, and narrow only when the prompt narrows it.
- `README.md`: click-only claude.ai install (Download ZIP → rename → Compress → Settings →
  Skills → Add → Upload a skill), and the sandbox network-egress step that `inspect`
  requires there. Notes that wildcard hosts are rejected, so each subdomain needs its own
  exact entry.

## [1.0.0] — 2026-08-17

First release.

### Added
- `inspect` — call an x402 endpoint without paying and decode its payment challenge:
  price in real money and raw atomic units, accepted networks and tokens, pay-to address,
  settlement deadline, and the call schema where one is published.
- `openapi` — find and read an API's `openapi.json`, surface its agent-readable `x-*`
  metadata, and show a side-by-side comparison against the live endpoint.
- `decode` — base64-decode a `payment-required` or `X-PAYMENT` header by hand.
- Support for both protocol versions: v2 (challenge in the `payment-required` response
  header) and v1 (challenge in the response body).
- Token table covering 30 networks and 40 tokens — USDC, USDT and DAI across Ethereum,
  Base, Polygon, Arbitrum, Optimism, BNB Chain, Avalanche, X Layer and Solana, plus
  testnets. Every `decimals` value read from the token contract.
- SSRF guard: private, loopback, link-local and internal addresses refused; hostnames
  re-checked against what they actually resolve to, including after every redirect;
  response size and duration capped.

### Notes
- Never pays, signs, or holds a wallet, and never calls a blockchain at runtime.
- Never grades an endpoint. Where a spec and a live endpoint disagree, both values are
  shown and neither is called correct.
