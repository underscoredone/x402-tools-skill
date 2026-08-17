# Example output

Real transcripts, captured from live endpoints. Regenerate any of them with the command
shown at the top of the file.

| File | What it shows |
|---|---|
| [inspect-output.md](inspect-output.md) | A straightforward x402 v2 endpoint: two payment options, Base and Solana, one cent each |
| [inspect-multichain-output.md](inspect-multichain-output.md) | 21 payment options across 9 chains, including USDG on X Layer and a challenge sent in both the header and the body |
| [openapi-output.md](openapi-output.md) | A spec read end to end, plus the spec-vs-live comparison table |

Worth noticing in these:

- The price appears twice — as money (`0.01 USDC`) and as the raw atomic number (`10000`)
- Testnets are labelled
- Chains the tool does not recognise are passed through untouched, with an explanation,
  rather than converted on a guess
- Nothing anywhere calls an endpoint invalid, broken, or non-conformant
