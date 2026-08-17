// ../x402-tools/core/src/guard.js
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data"
]);
var BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];
var BlockedError = class extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "BlockedError";
    this.code = "BLOCKED";
    this.detail = detail ?? null;
  }
};
function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}
function isPrivateIPv4(host) {
  const p = parseIPv4(host);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}
function isPrivateIPv6(host) {
  let h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4 && isPrivateIPv4(v4[1])) return true;
  if (h.startsWith("fe80")) return true;
  if (/^f[cd]/.test(h)) return true;
  if (h.startsWith("ff")) return true;
  if (h.startsWith("64:ff9b")) return true;
  if (h.startsWith("2002:")) {
    return true;
  }
  return false;
}
function isBlockedHostname(hostname) {
  const h = String(hostname).toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (isPrivateIPv4(h)) return true;
  if (isPrivateIPv6(h)) return true;
  return false;
}
function assertUrlAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedError(`"${rawUrl}" is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedError(`Only http and https URLs can be inspected. Got "${url.protocol}".`);
  }
  if (url.username || url.password) {
    throw new BlockedError("URLs containing credentials are not accepted.");
  }
  if (isBlockedHostname(url.hostname)) {
    throw new BlockedError(
      `"${url.hostname}" is a private, local, or reserved address. This service only inspects endpoints reachable on the public internet.`
    );
  }
  return url;
}
async function assertResolvesPublicly(hostname, resolver) {
  if (!resolver) return { checked: false, addresses: [] };
  let addresses = [];
  try {
    addresses = await resolver(hostname);
  } catch (err) {
    throw new BlockedError(`Could not resolve "${hostname}": ${err.message}`);
  }
  if (!addresses.length) {
    throw new BlockedError(`"${hostname}" did not resolve to any address.`);
  }
  for (const addr of addresses) {
    if (isPrivateIPv4(addr) || isPrivateIPv6(addr)) {
      throw new BlockedError(
        `"${hostname}" resolves to ${addr}, which is a private or reserved address. Refusing to connect.`,
        { hostname, address: addr }
      );
    }
  }
  return { checked: true, addresses };
}
var DEFAULTS = {
  maxRedirects: 5,
  maxBytes: 2 * 1024 * 1024,
  // 2 MB
  timeoutMs: 2e4,
  userAgent: "x402-tools/1.0 (+https://underscoredone.com/x402-tools)"
};
async function safeFetch(rawUrl, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    followRedirects = false,
    resolver,
    maxRedirects = DEFAULTS.maxRedirects,
    maxBytes = DEFAULTS.maxBytes,
    timeoutMs = DEFAULTS.timeoutMs,
    fetchImpl = globalThis.fetch
  } = options;
  const chain = [];
  let current = rawUrl;
  let hops = 0;
  while (true) {
    const url = assertUrlAllowed(current);
    const dns = await assertResolvesPublicly(url.hostname, resolver);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        headers: { "user-agent": DEFAULTS.userAgent, accept: "*/*", ...headers },
        body,
        redirect: "manual",
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new BlockedError(`Request to ${url.hostname} timed out after ${timeoutMs}ms.`);
      }
      throw err;
    }
    clearTimeout(timer);
    const elapsedMs = Date.now() - started;
    const location = res.headers.get("location");
    const isRedirect = res.status >= 300 && res.status < 400 && location;
    chain.push({
      url: url.toString(),
      status: res.status,
      elapsedMs,
      resolvedAddresses: dns.addresses,
      dnsChecked: dns.checked,
      redirectedTo: isRedirect ? new URL(location, url).toString() : null
    });
    if (isRedirect && followRedirects) {
      if (++hops > maxRedirects) {
        throw new BlockedError(`Stopped after ${maxRedirects} redirects.`);
      }
      current = new URL(location, url).toString();
      continue;
    }
    const text = await readCapped(res, maxBytes);
    return {
      url: url.toString(),
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      body: text.body,
      truncated: text.truncated,
      elapsedMs,
      chain
    };
  }
}
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const body = await res.text();
    return body.length > maxBytes ? { body: body.slice(0, maxBytes), truncated: true } : { body, truncated: false };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      truncated = true;
      try {
        await reader.cancel();
      } catch {
      }
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return { body: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}

// ../x402-tools/core/src/tables.js
var NETWORKS = {
  // EVM mainnets
  "eip155:1": { name: "Ethereum Mainnet", family: "evm" },
  "eip155:10": { name: "OP Mainnet", family: "evm" },
  "eip155:56": { name: "BNB Smart Chain", family: "evm" },
  "eip155:137": { name: "Polygon Mainnet", family: "evm" },
  "eip155:146": { name: "Sonic", family: "evm" },
  "eip155:196": { name: "X Layer Mainnet", family: "evm" },
  "eip155:480": { name: "World Chain", family: "evm" },
  "eip155:1135": { name: "Lisk", family: "evm" },
  "eip155:5000": { name: "Mantle", family: "evm" },
  "eip155:8453": { name: "Base Mainnet", family: "evm" },
  "eip155:34443": { name: "Mode", family: "evm" },
  "eip155:42161": { name: "Arbitrum One", family: "evm" },
  "eip155:42220": { name: "Celo", family: "evm" },
  "eip155:43114": { name: "Avalanche C-Chain", family: "evm" },
  "eip155:59144": { name: "Linea", family: "evm" },
  "eip155:534352": { name: "Scroll", family: "evm" },
  "eip155:7777777": { name: "Zora", family: "evm" },
  // EVM testnets
  "eip155:11155111": { name: "Ethereum Sepolia", family: "evm", testnet: true },
  "eip155:11155420": { name: "OP Sepolia", family: "evm", testnet: true },
  "eip155:84532": { name: "Base Sepolia", family: "evm", testnet: true },
  "eip155:80002": { name: "Polygon Amoy", family: "evm", testnet: true },
  "eip155:421614": { name: "Arbitrum Sepolia", family: "evm", testnet: true },
  "eip155:43113": { name: "Avalanche Fuji", family: "evm", testnet: true },
  "eip155:97": { name: "BNB Smart Chain Testnet", family: "evm", testnet: true },
  "eip155:1952": { name: "X Layer Testnet", family: "evm", testnet: true },
  "eip155:4202": { name: "Lisk Sepolia", family: "evm", testnet: true },
  "eip155:5042002": { name: "Arc Network Testnet", family: "evm", testnet: true },
  // Solana
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": { name: "Solana Mainnet", family: "solana" },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": { name: "Solana Devnet", family: "solana", testnet: true },
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": { name: "Solana Testnet", family: "solana", testnet: true }
};
var LEGACY_NETWORKS = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  ethereum: "eip155:1",
  mainnet: "eip155:1",
  polygon: "eip155:137",
  avalanche: "eip155:43114",
  arbitrum: "eip155:42161",
  optimism: "eip155:10",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
};
var ASSETS = {
  // USDC — EVM mainnets
  "eip155:1|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:10|0x0b2c639c533813f4aa9d7837caf62653d097ff85": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:137|0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:8453|0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:42161|0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:43114|0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:59144|0x176211869ca2b568f2a7d4ee941e073a821ee1ff": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:534352|0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:480|0x79a02482a880bce3f13e09da970dc34db4cd24d1": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  // USDC — EVM testnets
  "eip155:84532|0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:11155111|0x1c7d4b196cb0c7b01d743fbc6116a902379c7238": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:421614|0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "eip155:43113|0x5425890298aed601595a70ab815c96711a31bc65": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  // Verified on-chain 2026-08-17 via polygon-amoy-bor-rpc.publicnode.com
  "eip155:80002|0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  // Verified on-chain 2026-08-17 via rpc.testnet.arc.network
  "eip155:5042002|0x3600000000000000000000000000000000000000": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  // USDG (Global Dollar) — verified on-chain 2026-08-17 via rpc.xlayer.tech / testrpc.xlayer.tech
  "eip155:196|0x4ae46a509f6b1d9056937ba4500cb143933d2dc8": { symbol: "USDG", decimals: 6, name: "Global Dollar" },
  "eip155:1952|0xf0863d7a29a55d0c4263c11bfac754312ff078df": { symbol: "USDG", decimals: 6, name: "Global Dollar" },
  // USDC on BNB Smart Chain uses 18 decimals, not 6. Reading this as 6 would report a
  // price a trillion times too small. Verified on-chain 2026-08-17.
  "eip155:56|0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": { symbol: "USDC", decimals: 18, name: "USD Coin" },
  "eip155:97|0x64544969ed7ebf5f083679233325356ebe738930": { symbol: "USDC", decimals: 18, name: "USD Coin" },
  // USDT — EVM. Symbols are what the contracts actually return today, which is not
  // always plain "USDT": Tether's bridged token reports USDT0 on Polygon and USD₮0 on
  // Arbitrum (that is a ₮ glyph), and Avalanche reports lowercase-t USDt. Decimals vary
  // by chain — 18 on BNB, 6 everywhere else. All verified on-chain 2026-08-17.
  "eip155:1|0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6, name: "Tether USD" },
  "eip155:10|0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": { symbol: "USDT", decimals: 6, name: "Tether USD" },
  "eip155:56|0x55d398326f99059ff775485246999027b3197955": { symbol: "USDT", decimals: 18, name: "Tether USD" },
  "eip155:137|0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { symbol: "USDT0", decimals: 6, name: "Tether USD" },
  "eip155:8453|0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT", decimals: 6, name: "Tether USD" },
  "eip155:42161|0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USD\u20AE0", decimals: 6, name: "Tether USD" },
  "eip155:43114|0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7": { symbol: "USDt", decimals: 6, name: "TetherToken" },
  // USDT — EVM testnets
  "eip155:11155111|0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0": { symbol: "USDT", decimals: 6, name: "Tether USD" },
  "eip155:80002|0x1616d425cd540b256475cbfb604586c8598ec0fb": { symbol: "USDT", decimals: 6, name: "Tether USD" },
  "eip155:97|0x337610d27c682e347c9cd60bd4b3b107c9d34ddd": { symbol: "USDT", decimals: 18, name: "Tether USD" },
  // DAI — 18 decimals everywhere, unlike the 6-decimal stablecoins above. Avalanche
  // carries the bridged DAI.e. All verified on-chain 2026-08-17.
  "eip155:1|0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  "eip155:10|0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  "eip155:56|0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  "eip155:137|0x8f3cf7ad23cd3cadbd9735aff958023239c6a063": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  "eip155:8453|0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  "eip155:42161|0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  "eip155:43114|0xd586e7f844cea2f87f50152665bcbc2c279d8d70": { symbol: "DAI.e", decimals: 18, name: "Dai Stablecoin (bridged)" },
  "eip155:11155111|0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357": { symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
  // Solana
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp|EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": { symbol: "USDC", decimals: 6, name: "USD Coin" },
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp|Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": { symbol: "USDT", decimals: 6, name: "Tether USD" },
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1|4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": { symbol: "USDC", decimals: 6, name: "USD Coin (devnet)" }
};
var SPEC_PATHS = [
  "/openapi.json",
  "/.well-known/openapi.json",
  "/openapi.yaml",
  "/docs/openapi.json",
  "/swagger.json"
];
var AGENT_EXTENSIONS = [
  "x-402",
  "x-pricing",
  "x-payment-accepts",
  "x-ai-instructions",
  "x-guidance",
  "x-keywords",
  "x-category",
  "x-provider",
  "x-openapi-url"
];

// ../x402-tools/core/src/amounts.js
function describeNetwork(network) {
  if (!network || typeof network !== "string") {
    return { raw: network, caip2: null, name: null, family: null, known: false };
  }
  const caip2 = NETWORKS[network] ? network : LEGACY_NETWORKS[network.toLowerCase()] || null;
  const info = caip2 ? NETWORKS[caip2] : null;
  return {
    raw: network,
    caip2,
    name: info?.name ?? null,
    family: info?.family ?? null,
    testnet: info?.testnet ?? false,
    known: Boolean(info),
    // Flagged, not judged: v2 challenges normally use CAIP-2.
    usesLegacyName: Boolean(caip2 && caip2 !== network)
  };
}
function describeAsset(network, asset) {
  if (!asset) return { raw: asset, known: false, symbol: null, decimals: null, name: null };
  const net = describeNetwork(network);
  const family = net.family;
  const keyAsset = family === "evm" ? String(asset).toLowerCase() : String(asset);
  const found = net.caip2 ? ASSETS[`${net.caip2}|${keyAsset}`] : null;
  return {
    raw: asset,
    known: Boolean(found),
    symbol: found?.symbol ?? null,
    decimals: found?.decimals ?? null,
    name: found?.name ?? null
  };
}
function shiftDecimal(intString, decimals) {
  const negative = intString.startsWith("-");
  const digits = (negative ? intString.slice(1) : intString).replace(/^0+(?=\d)/, "");
  if (decimals === 0) return (negative ? "-" : "") + digits;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return (negative ? "-" : "") + (frac ? `${whole}.${frac}` : whole);
}
function formatAmount(amount, network, asset) {
  const assetInfo = describeAsset(network, asset);
  const raw = amount == null ? null : String(amount);
  if (raw == null) {
    return {
      raw: null,
      display: null,
      value: null,
      symbol: assetInfo.symbol,
      asset: assetInfo,
      note: "No amount was present in the payment challenge."
    };
  }
  if (!/^-?\d+$/.test(raw)) {
    return {
      raw,
      display: raw,
      value: null,
      symbol: assetInfo.symbol,
      asset: assetInfo,
      note: "Amount is not a whole number, so it was left exactly as the endpoint sent it. x402 amounts are normally integer strings in the token's smallest unit."
    };
  }
  if (!assetInfo.known) {
    return {
      raw,
      display: raw,
      value: null,
      symbol: null,
      asset: assetInfo,
      note: `Shown unconverted. This tool does not know the token ${asset || "(none given)"} on ${network || "(no network given)"}, so it cannot know how many decimal places to shift. The real price is this number divided by 10^decimals for that token.`
    };
  }
  const value = shiftDecimal(raw, assetInfo.decimals);
  return {
    raw,
    value,
    symbol: assetInfo.symbol,
    display: `${value} ${assetInfo.symbol}`,
    asset: assetInfo,
    note: null
  };
}

// ../x402-tools/core/src/challenge.js
var CHALLENGE_HEADERS = ["payment-required", "x-payment-required", "x-402"];
var DECODABLE_HEADERS = ["x-payment", "x-payment-response", "www-authenticate"];
function normalizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function" && typeof headers.get === "function") {
    headers.forEach((v, k) => {
      out[String(k).toLowerCase()] = v;
    });
    return out;
  }
  if (headers instanceof Map) {
    for (const [k, v] of headers) out[String(k).toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}
function decodeBase64(value) {
  if (typeof value !== "string" || value.length < 8) return null;
  try {
    let s = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    if (s.length % 4) s += "=".repeat(4 - s.length % 4);
    const binary = atob(s);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}
function decodeBase64Json(value) {
  const text = decodeBase64(value);
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { text, json: null };
  try {
    return { text, json: JSON.parse(trimmed) };
  } catch {
    return { text, json: null };
  }
}
function safeJsonParse(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function normalizeAccept(entry, version, topResource) {
  if (!entry || typeof entry !== "object") {
    return { unreadable: true, raw: entry };
  }
  const amountRaw = version === 1 ? entry.maxAmountRequired ?? entry.amount : entry.amount ?? entry.maxAmountRequired;
  const network = describeNetwork(entry.network);
  const amount = formatAmount(amountRaw, entry.network, entry.asset);
  return {
    scheme: entry.scheme ?? null,
    network,
    asset: amount.asset,
    amount,
    payTo: entry.payTo ?? entry.pay_to ?? null,
    maxTimeoutSeconds: entry.maxTimeoutSeconds ?? null,
    // v1 carries these per entry; v2 has them on the shared resource object.
    description: entry.description ?? topResource?.description ?? null,
    mimeType: entry.mimeType ?? topResource?.mimeType ?? null,
    resourceUrl: typeof entry.resource === "string" ? entry.resource : topResource?.url ?? null,
    outputSchema: entry.outputSchema ?? null,
    extra: entry.extra ?? null,
    raw: entry
  };
}
function parseChallenge({ status, headers, body } = {}) {
  const h = normalizeHeaders(headers);
  const notes = [];
  let payload = null;
  let source = null;
  let sourceHeader = null;
  for (const name of CHALLENGE_HEADERS) {
    if (!h[name]) continue;
    const decoded = decodeBase64Json(h[name]);
    if (decoded?.json) {
      payload = decoded.json;
      source = "header";
      sourceHeader = name;
      break;
    }
    if (decoded && !decoded.json) {
      notes.push(`The \`${name}\` header decoded from base64 but the result was not JSON.`);
    } else {
      notes.push(`The \`${name}\` header was present but could not be decoded as base64.`);
    }
  }
  const bodyJson = safeJsonParse(body);
  const bodyLooksLikeChallenge = Boolean(bodyJson && (bodyJson.accepts || bodyJson.x402Version));
  if (!payload && bodyLooksLikeChallenge) {
    payload = bodyJson;
    source = "body";
  }
  if (source === "header" && bodyLooksLikeChallenge) {
    notes.push("A challenge was found in both the response header and the response body. The header was used.");
  }
  if (!payload) {
    return {
      found: false,
      status: status ?? null,
      version: null,
      source: null,
      resource: null,
      accepts: [],
      extensions: null,
      error: null,
      decodedHeaders: decodeOtherHeaders(h),
      siwx: detectSiwx(h),
      notes: notes.concat(
        status === 402 ? ["The endpoint returned 402 but no x402 challenge could be found in the headers or the body."] : [`The endpoint returned ${status ?? "no status"} rather than 402, and no x402 challenge was present.`]
      ),
      raw: null
    };
  }
  const declared = payload.x402Version;
  let version = typeof declared === "number" ? declared : null;
  if (version == null) {
    version = source === "header" || payload.resource?.url ? 2 : 1;
    notes.push(`No \`x402Version\` field was present. Read as version ${version}, based on where the challenge was found and which fields it uses.`);
  }
  const topResource = payload.resource && typeof payload.resource === "object" ? payload.resource : null;
  const acceptsRaw = Array.isArray(payload.accepts) ? payload.accepts : [];
  if (!Array.isArray(payload.accepts)) {
    notes.push(payload.accepts == null ? "The challenge contains no `accepts` list, so no payment options could be read." : "The `accepts` field is present but is not a list, so no payment options could be read.");
  } else if (acceptsRaw.length === 0) {
    notes.push("The `accepts` list is empty, so the challenge offers no payment options.");
  }
  const accepts = acceptsRaw.map((e) => normalizeAccept(e, version, topResource));
  if (version === 1 && source === "header") {
    notes.push("The challenge declares version 1 but arrived in a response header, which is where version 2 puts it.");
  }
  if (version === 2 && source === "body") {
    notes.push("The challenge declares version 2 but arrived in the response body, which is where version 1 puts it.");
  }
  for (const a of accepts) {
    if (a.network?.usesLegacyName) {
      notes.push(`Network "${a.network.raw}" is written as a bare name rather than in CAIP-2 form (${a.network.caip2}).`);
    }
    if (!a.network?.known) {
      notes.push(`Network "${a.network?.raw ?? "(none)"}" is not one this tool has in its table, so it is shown exactly as sent.`);
    }
  }
  return {
    found: true,
    status: status ?? null,
    version,
    declaredVersion: declared ?? null,
    source,
    sourceHeader,
    error: typeof payload.error === "string" ? payload.error : null,
    resource: topResource ? {
      url: topResource.url ?? null,
      description: topResource.description ?? null,
      mimeType: topResource.mimeType ?? null,
      serviceName: topResource.serviceName ?? null,
      tags: Array.isArray(topResource.tags) ? topResource.tags : []
    } : {
      // v1 has no resource object; synthesize one from the first accepts entry.
      url: accepts[0]?.resourceUrl ?? null,
      description: accepts[0]?.description ?? null,
      mimeType: accepts[0]?.mimeType ?? null,
      serviceName: null,
      tags: []
    },
    accepts,
    extensions: payload.extensions ?? null,
    callSchema: extractCallSchema(payload, accepts),
    decodedHeaders: decodeOtherHeaders(h),
    siwx: detectSiwx(h),
    notes,
    raw: payload
  };
}
function extractCallSchema(payload, accepts) {
  const bazaar = payload?.extensions?.bazaar;
  if (bazaar && (bazaar.info || bazaar.schema)) {
    return {
      source: "extensions.bazaar",
      method: bazaar.info?.input?.method ?? null,
      bodyType: bazaar.info?.input?.bodyType ?? null,
      exampleRequest: bazaar.info?.input?.body ?? null,
      exampleResponse: bazaar.info?.output?.example ?? null,
      schema: bazaar.schema ?? null
    };
  }
  const withSchema = accepts.find((a) => a.outputSchema);
  if (withSchema) {
    return {
      source: "accepts[].outputSchema",
      method: null,
      bodyType: null,
      exampleRequest: null,
      exampleResponse: null,
      schema: withSchema.outputSchema
    };
  }
  return null;
}
function decodeOtherHeaders(h) {
  const out = {};
  for (const name of DECODABLE_HEADERS) {
    if (!h[name]) continue;
    const decoded = decodeBase64Json(h[name]);
    out[name] = decoded ? { raw: h[name], decoded: decoded.json ?? decoded.text, isJson: Boolean(decoded.json) } : { raw: h[name], decoded: null, isJson: false };
  }
  return out;
}
function detectSiwx(h) {
  const keys = Object.keys(h).filter((k) => k.includes("sign-in-with-x") || k === "siwx" || k.includes("caip-122"));
  if (!keys.length) return { present: false, headers: [] };
  return { present: true, headers: keys.map((k) => ({ name: k, value: h[k] })) };
}

// ../x402-tools/core/src/inspect.js
var CONTEXT_HEADERS = [
  "content-type",
  "content-length",
  "server",
  "cache-control",
  "age",
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "retry-after",
  "www-authenticate",
  "link"
];
async function inspect(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    followRedirects = false,
    decodePaymentHeader,
    resolver,
    fetchImpl
  } = options;
  if (decodePaymentHeader && !url) {
    return { mode: "decode-only", decodedPaymentHeader: decodeSuppliedHeader(decodePaymentHeader) };
  }
  let res;
  try {
    res = await safeFetch(url, { method, headers, body, followRedirects, resolver, fetchImpl });
  } catch (err) {
    if (err instanceof BlockedError) {
      return { ok: false, url, error: { type: "blocked", message: err.message, detail: err.detail } };
    }
    return { ok: false, url, error: { type: "request-failed", message: err.message } };
  }
  const headerMap = normalizeHeaders(res.headers);
  const challenge = parseChallenge({ status: res.status, headers: res.headers, body: res.body });
  return {
    ok: true,
    mode: "inspect",
    request: {
      url: res.url,
      requestedUrl: url,
      method,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: res.elapsedMs,
      redirectChain: res.chain,
      redirectsFollowed: followRedirects,
      bodyTruncated: res.truncated,
      tls: res.url.startsWith("https:")
    },
    x402: {
      present: challenge.found,
      version: challenge.version,
      declaredVersion: challenge.declaredVersion ?? null,
      challengeLocation: challenge.source ? challenge.source === "header" ? `${challenge.sourceHeader} response header (base64)` : "402 response body (JSON)" : null,
      error: challenge.error
    },
    resource: challenge.resource,
    paymentOptions: challenge.accepts.map(presentAccept),
    callSchema: challenge.callSchema,
    access: {
      siwx: challenge.siwx,
      facilitator: findFacilitator(challenge, headerMap)
    },
    decodedHeaders: {
      ...challenge.decodedHeaders,
      ...decodePaymentHeader ? { "x-payment (supplied)": decodeSuppliedHeader(decodePaymentHeader) } : {}
    },
    responseHeaders: pick(headerMap, CONTEXT_HEADERS),
    allResponseHeaders: headerMap,
    notes: challenge.notes,
    raw: { challenge: challenge.raw, body: challenge.found && challenge.source === "body" ? void 0 : res.body },
    attribution: "x402 Tools by _done - underscoredone.com"
  };
}
function presentAccept(a) {
  if (a.unreadable) {
    return { readable: false, note: "This entry in the accepts list was not an object, so it could not be read.", raw: a.raw };
  }
  return {
    readable: true,
    scheme: a.scheme,
    network: {
      id: a.network.raw,
      name: a.network.name,
      caip2: a.network.caip2,
      testnet: a.network.testnet,
      known: a.network.known
    },
    price: {
      display: a.amount.display,
      // "0.01 USDC"
      atomic: a.amount.raw,
      // "10000"
      value: a.amount.value,
      // "0.01"
      token: a.amount.symbol,
      note: a.amount.note
    },
    asset: { address: a.asset.raw, symbol: a.asset.symbol, decimals: a.asset.decimals, known: a.asset.known },
    payTo: a.payTo,
    maxTimeoutSeconds: a.maxTimeoutSeconds,
    extra: a.extra
  };
}
function decodeSuppliedHeader(value) {
  const decoded = decodeBase64Json(value);
  if (!decoded) return { raw: value, decoded: null, isJson: false, note: "Could not be decoded as base64." };
  return { raw: value, decoded: decoded.json ?? decoded.text, isJson: Boolean(decoded.json), note: null };
}
function findFacilitator(challenge, headerMap) {
  const raw = challenge.raw ?? {};
  const candidates = [
    raw.facilitator,
    raw.extensions?.facilitator,
    headerMap["x-facilitator"],
    ...Array.isArray(raw.accepts) ? raw.accepts.map((a) => a?.extra?.facilitator) : []
  ].filter(Boolean);
  return candidates.length ? candidates[0] : null;
}
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== void 0) out[k] = obj[k];
  return out;
}

// ../x402-tools/core/src/openapi.js
async function readOpenApi(input, options = {}) {
  const { specUrl, compareLive = true, resolver, fetchImpl } = options;
  let discovery;
  try {
    discovery = specUrl ? await fetchSpecAt(specUrl, { resolver, fetchImpl }) : await discoverSpec(input, { resolver, fetchImpl });
  } catch (err) {
    if (err instanceof BlockedError) {
      return { ok: false, error: { type: "blocked", message: err.message } };
    }
    return { ok: false, error: { type: "request-failed", message: err.message } };
  }
  if (!discovery.found) {
    return {
      ok: false,
      error: {
        type: "not-found",
        message: "No OpenAPI spec was found.",
        triedUrls: discovery.tried
      },
      attribution: "x402 Tools by _done - underscoredone.com"
    };
  }
  const parsed = parseSpec(discovery.text, discovery.url);
  if (!parsed.ok) {
    return {
      ok: false,
      discovery: { url: discovery.url, via: discovery.via, contentType: discovery.contentType, bytes: discovery.text.length },
      error: { type: "parse-failed", message: parsed.message, location: parsed.location },
      attribution: "x402 Tools by _done - underscoredone.com"
    };
  }
  const spec = parsed.spec;
  const result = {
    ok: true,
    discovery: {
      url: discovery.url,
      via: discovery.via,
      contentType: discovery.contentType,
      bytes: discovery.text.length,
      triedUrls: discovery.tried
    },
    format: parsed.format,
    info: readInfo(spec),
    servers: readServers(spec),
    operations: readOperations(spec),
    agentMetadata: readAgentMetadata(spec),
    comparison: null,
    notes: parsed.notes,
    attribution: "x402 Tools by _done - underscoredone.com"
  };
  if (compareLive) {
    const target = pickLiveTarget(spec, input, discovery.url);
    if (target) {
      const live = await inspect(target.url, { method: target.method, resolver, fetchImpl, body: target.body, headers: target.headers });
      result.comparison = compare(result, live, target);
    } else {
      result.comparison = { ran: false, reason: "Could not work out which live URL to probe from this spec." };
    }
  }
  return result;
}
async function fetchSpecAt(url, { resolver, fetchImpl }) {
  assertUrlAllowed(url);
  const res = await safeFetch(url, { resolver, fetchImpl, followRedirects: true });
  const ct = res.headers.get("content-type") || "";
  const looksLikeSpec = res.status === 200 && /json|yaml|yml|text/i.test(ct) && res.body.trim();
  return {
    found: Boolean(looksLikeSpec),
    url: res.url,
    via: "given directly",
    contentType: ct,
    text: res.body,
    tried: [{ url, status: res.status, contentType: ct }]
  };
}
async function discoverSpec(input, { resolver, fetchImpl }) {
  const base = assertUrlAllowed(input);
  const tried = [];
  const candidates = [];
  for (const p of SPEC_PATHS) candidates.push(new URL(p, base.origin).toString());
  if (base.pathname && base.pathname !== "/") {
    for (const p of SPEC_PATHS) candidates.push(new URL(`.${p}`, base).toString());
  }
  for (const candidate of [...new Set(candidates)]) {
    let res;
    try {
      res = await safeFetch(candidate, { resolver, fetchImpl, followRedirects: true });
    } catch {
      tried.push({ url: candidate, status: null, contentType: null });
      continue;
    }
    const ct = res.headers.get("content-type") || "";
    tried.push({ url: candidate, status: res.status, contentType: ct });
    if (res.status === 200 && res.body.trim() && looksLikeSpecBody(res.body)) {
      return { found: true, url: res.url, via: `found at ${new URL(candidate).pathname}`, contentType: ct, text: res.body, tried };
    }
  }
  try {
    const live = await inspect(input, { method: "GET", resolver, fetchImpl });
    const fromChallenge = live?.raw?.challenge?.["x-openapi-url"] || live?.raw?.challenge?.openapi;
    if (fromChallenge) {
      const res = await safeFetch(fromChallenge, { resolver, fetchImpl, followRedirects: true });
      tried.push({ url: fromChallenge, status: res.status, contentType: res.headers.get("content-type") });
      if (res.status === 200 && looksLikeSpecBody(res.body)) {
        return {
          found: true,
          url: res.url,
          via: "x-openapi-url in the live 402 challenge",
          contentType: res.headers.get("content-type") || "",
          text: res.body,
          tried
        };
      }
    }
  } catch {
  }
  return { found: false, tried };
}
function looksLikeSpecBody(text) {
  const t = text.trim();
  if (t.startsWith("{")) return /"(openapi|swagger)"\s*:/.test(t.slice(0, 4e3));
  return /^(openapi|swagger)\s*:/m.test(t.slice(0, 4e3));
}
function parseSpec(text, url) {
  const notes = [];
  const trimmed = text.trim();
  let spec;
  if (trimmed.startsWith("{")) {
    try {
      spec = JSON.parse(trimmed);
    } catch (err) {
      return { ok: false, message: `The spec is not valid JSON: ${err.message}`, location: locateJsonError(err, trimmed) };
    }
  } else {
    return {
      ok: false,
      message: "This looks like a YAML spec. This tool reads JSON specs only; point it at a .json spec, or convert the YAML first.",
      location: url
    };
  }
  let format = "unknown";
  if (typeof spec.openapi === "string") format = `OpenAPI ${spec.openapi}`;
  else if (typeof spec.swagger === "string") format = `Swagger ${spec.swagger}`;
  else notes.push("The document parsed, but it declares neither an `openapi` nor a `swagger` version field.");
  return { ok: true, spec, format, notes };
}
function locateJsonError(err, text) {
  const m = /position (\d+)/.exec(err.message);
  if (!m) return null;
  const pos = Number(m[1]);
  const line = text.slice(0, pos).split("\n").length;
  return `line ${line}, character ${pos}`;
}
function readInfo(spec) {
  const i = spec.info || {};
  return {
    title: i.title ?? null,
    version: i.version ?? null,
    description: i.description ?? null,
    contact: i.contact ?? null,
    license: i.license ?? null,
    termsOfService: i.termsOfService ?? null
  };
}
function readServers(spec) {
  if (Array.isArray(spec.servers)) return spec.servers.map((s) => ({ url: s.url, description: s.description ?? null }));
  if (spec.host) {
    const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : "https";
    return [{ url: `${scheme}://${spec.host}${spec.basePath || ""}`, description: "derived from Swagger 2.0 host/basePath" }];
  }
  return [];
}
function readOperations(spec) {
  const out = [];
  const paths = spec.paths || {};
  const verbs = ["get", "post", "put", "patch", "delete", "head", "options"];
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const verb of verbs) {
      const op = item[verb];
      if (!op) continue;
      out.push({
        method: verb.toUpperCase(),
        path,
        operationId: op.operationId ?? null,
        summary: op.summary ?? null,
        description: op.description ?? null,
        tags: op.tags ?? [],
        parameters: (op.parameters || item.parameters || []).map((p) => ({
          name: p.name,
          in: p.in,
          required: Boolean(p.required),
          description: p.description ?? null,
          schema: p.schema ?? null
        })),
        requestBody: summarizeBody(op.requestBody),
        responses: Object.entries(op.responses || {}).map(([code, r]) => ({
          code,
          description: r?.description ?? null,
          hasExample: Boolean(findExample(r)),
          example: findExample(r)
        })),
        documents402: Boolean(op.responses && op.responses["402"]),
        agentMetadata: pickExtensions(op)
      });
    }
  }
  return out;
}
function summarizeBody(rb) {
  if (!rb) return null;
  const content = rb.content || {};
  const type = Object.keys(content)[0] || null;
  return {
    required: Boolean(rb.required),
    contentType: type,
    schema: type ? content[type]?.schema ?? null : null,
    example: type ? content[type]?.example ?? content[type]?.examples ?? null : null
  };
}
function findExample(response) {
  if (!response) return null;
  const content = response.content || {};
  for (const media of Object.values(content)) {
    if (media?.example !== void 0) return media.example;
    if (media?.examples) return media.examples;
  }
  return response.example ?? null;
}
function pickExtensions(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const key of AGENT_EXTENSIONS) if (obj[key] !== void 0) out[key] = obj[key];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("x-") && out[k] === void 0 && AGENT_EXTENSIONS.includes(k)) out[k] = v;
  }
  return out;
}
function readAgentMetadata(spec) {
  const top = pickExtensions(spec);
  const info = pickExtensions(spec.info || {});
  const merged = { ...info, ...top };
  return {
    present: Object.keys(merged).length > 0,
    fields: merged,
    // Pulled out because they are the ones worth comparing to the wire.
    declaredNetworks: extractSpecNetworks(merged),
    declaredPrice: extractSpecPrice(merged),
    declaredPayTo: extractSpecPayTo(merged),
    declaredAsset: extractSpecAsset(merged)
  };
}
function extractSpecNetworks(x) {
  const set = /* @__PURE__ */ new Set();
  const add = (n) => {
    if (typeof n === "string" && n) set.add(n);
  };
  add(x["x-402"]?.network);
  (x["x-402"]?.networks || []).forEach(add);
  add(x["x-pricing"]?.network);
  (Array.isArray(x["x-payment-accepts"]) ? x["x-payment-accepts"] : []).forEach((a) => add(a?.network));
  return [...set];
}
function extractSpecPrice(x) {
  return x["x-402"]?.amount ?? x["x-402"]?.maxAmountRequired ?? x["x-pricing"]?.amount ?? x["x-pricing"]?.price ?? (Array.isArray(x["x-payment-accepts"]) ? x["x-payment-accepts"][0]?.amount ?? x["x-payment-accepts"][0]?.maxAmountRequired : void 0) ?? null;
}
function extractSpecPayTo(x) {
  return x["x-402"]?.payTo ?? (Array.isArray(x["x-payment-accepts"]) ? x["x-payment-accepts"][0]?.payTo : void 0) ?? null;
}
function extractSpecAsset(x) {
  return x["x-402"]?.asset ?? (Array.isArray(x["x-payment-accepts"]) ? x["x-payment-accepts"][0]?.asset : void 0) ?? null;
}
function pickLiveTarget(spec, input, specUrl) {
  const servers = readServers(spec);
  const base = servers[0]?.url || new URL(specUrl).origin;
  const ops = readOperations(spec);
  const op = ops.find((o) => o.documents402) || ops.find((o) => o.method === "POST") || ops[0];
  if (!op) {
    try {
      return { url: new URL(input).toString(), method: "GET" };
    } catch {
      return null;
    }
  }
  let url;
  try {
    url = new URL(op.path.replace(/\{[^}]+\}/g, "example"), base.endsWith("/") ? base : base + "/").toString();
  } catch {
    return null;
  }
  return {
    url,
    method: op.method,
    body: op.requestBody ? "{}" : void 0,
    headers: op.requestBody ? { "content-type": "application/json" } : {}
  };
}
function compare(specResult, live, target) {
  if (!live?.ok) {
    return { ran: false, reason: `The live endpoint could not be reached: ${live?.error?.message ?? "unknown error"}`, probed: target.url };
  }
  const rows = [];
  const liveOptions = live.paymentOptions || [];
  const specNets = canonicalNetworkSet(specResult.agentMetadata.declaredNetworks);
  const liveNets = canonicalNetworkSet(liveOptions.map((o) => o.network.name || o.network.id));
  rows.push(setRow("networks accepted", specNets, liveNets));
  const specPriceRaw = specResult.agentMetadata.declaredPrice;
  const firstLive = liveOptions[0];
  const specPrice = specPriceRaw != null && firstLive && /^\d+$/.test(String(specPriceRaw)) ? formatAmount(String(specPriceRaw), firstLive.network.id, firstLive.asset.address).display ?? String(specPriceRaw) : specPriceRaw != null ? String(specPriceRaw) : null;
  rows.push(priceRow("price", specPrice, firstLive?.price.display ?? null));
  rows.push(row("pay-to address", specResult.agentMetadata.declaredPayTo, firstLive?.payTo ?? null, { caseInsensitive: true }));
  rows.push(row("token", specResult.agentMetadata.declaredAsset, firstLive?.asset.address ?? null, { caseInsensitive: true }));
  const specHost = safeHost(specResult.servers[0]?.url);
  const liveHost = safeHost(live.request.url);
  rows.push(row("host", specHost, liveHost));
  const specDesc = specResult.info.description || firstText(specResult.agentMetadata.fields["x-guidance"]);
  const liveDesc = live.resource?.description ?? null;
  rows.push(row("description", truncate(specDesc), truncate(liveDesc), { fuzzy: true }));
  const documented = specResult.operations.map((o) => o.path);
  const probedPath = safePath(live.request.url);
  rows.push(row("probed path is documented", probedPath, documented.includes(probedPath) ? probedPath : `not in spec (spec lists: ${documented.join(", ") || "none"})`));
  const differing = rows.filter((r) => r.match === false).length;
  return {
    ran: true,
    probed: { url: live.request.url, method: target.method, status: live.request.status },
    rows,
    summary: differing === 0 ? "Everything compared here matches between the spec and the live endpoint." : `${differing} of ${rows.length} compared items differ. Both values are shown above. A spec can lag behind the endpoint it describes; this tool does not judge which side is correct.`
  };
}
function row(field, specValue, liveValue, opts = {}) {
  let match = null;
  if (specValue == null || liveValue == null) {
    match = null;
  } else if (opts.caseInsensitive) {
    match = String(specValue).toLowerCase() === String(liveValue).toLowerCase();
  } else if (opts.fuzzy) {
    match = normalizeText(specValue) === normalizeText(liveValue);
  } else {
    match = String(specValue) === String(liveValue);
  }
  return {
    field,
    spec: specValue ?? null,
    live: liveValue ?? null,
    match,
    note: specValue == null ? "The spec does not state this." : liveValue == null ? "The live challenge does not state this." : null
  };
}
function canonicalNetworkSet(values) {
  const out = /* @__PURE__ */ new Set();
  for (const v of values) {
    if (!v) continue;
    for (const piece of String(v).split(/\s+or\s+|,|;|\//i)) {
      const s = piece.trim();
      if (!s) continue;
      const d = describeNetwork(s);
      if (d.name) {
        out.add(d.name);
        continue;
      }
      const matched = Object.values(NETWORKS_BY_NAME).find((n) => n.toLowerCase() === s.toLowerCase());
      out.add(matched || s);
    }
  }
  return out;
}
var NETWORKS_BY_NAME = (() => {
  const m = {};
  for (const [id, info] of Object.entries(NETWORKS)) m[id] = info.name;
  return m;
})();
function setRow(field, specSet, liveSet) {
  const spec = [...specSet];
  const live = [...liveSet];
  if (!spec.length || !live.length) {
    return row(field, spec.join(", ") || null, live.join(", ") || null);
  }
  const match = spec.length === live.length && spec.every((s) => liveSet.has(s));
  const onlySpec = spec.filter((s) => !liveSet.has(s));
  const onlyLive = live.filter((s) => !specSet.has(s));
  return {
    field,
    spec: spec.join(", "),
    live: live.join(", "),
    match,
    note: match ? null : [
      onlySpec.length ? `only in the spec: ${onlySpec.join(", ")}` : null,
      onlyLive.length ? `only on the live endpoint: ${onlyLive.join(", ")}` : null
    ].filter(Boolean).join("; ")
  };
}
function priceRow(field, specValue, liveValue) {
  if (specValue == null || liveValue == null) return row(field, specValue, liveValue);
  const num = (s) => {
    const m = /-?\d+(\.\d+)?/.exec(String(s).replace(/,/g, ""));
    return m ? Number(m[0]) : null;
  };
  const a = num(specValue);
  const b = num(liveValue);
  const match = a != null && b != null ? a === b : String(specValue) === String(liveValue);
  return {
    field,
    spec: specValue,
    live: liveValue,
    match,
    note: match && String(specValue) !== String(liveValue) ? "Same amount, written differently." : null
  };
}
function normalizeText(s) {
  return String(s).replace(/\s+/g, " ").trim().toLowerCase();
}
function truncate(s, n = 300) {
  return s == null ? null : String(s).length > n ? String(s).slice(0, n) + "\u2026" : String(s);
}
function firstText(v) {
  return typeof v === "string" ? v : Array.isArray(v) ? v.find((x) => typeof x === "string") ?? null : null;
}
function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return u ?? null;
  }
}
function safePath(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return u ?? null;
  }
}

// ../x402-tools/core/src/format.js
function formatInspect(r) {
  if (!r.ok) {
    return `Could not inspect this URL.

${r.error.message}`;
  }
  const L = [];
  L.push(`# ${r.request.url}`);
  L.push(`${r.request.method} -> ${r.request.status} ${r.request.statusText || ""} (${r.request.elapsedMs}ms)`);
  if (r.request.redirectChain.length > 1) {
    L.push("", "## Redirects");
    for (const hop of r.request.redirectChain) {
      L.push(`- ${hop.status} ${hop.url}${hop.redirectedTo ? ` -> ${hop.redirectedTo}` : ""}`);
    }
  }
  L.push("", "## x402");
  if (!r.x402.present) {
    L.push("No x402 payment challenge was found in this response.");
  } else {
    L.push(`- version: ${r.x402.version}${r.x402.declaredVersion == null ? " (not declared; read from the shape of the response)" : ""}`);
    L.push(`- challenge found in: ${r.x402.challengeLocation}`);
    if (r.x402.error) L.push(`- message from the endpoint: "${r.x402.error}"`);
  }
  if (r.resource && (r.resource.serviceName || r.resource.description)) {
    L.push("", "## What this endpoint is");
    if (r.resource.serviceName) L.push(`**${r.resource.serviceName}**`);
    if (r.resource.url) L.push(`Resource: ${r.resource.url}`);
    if (r.resource.mimeType) L.push(`Returns: ${r.resource.mimeType}`);
    if (r.resource.tags?.length) L.push(`Tags: ${r.resource.tags.join(", ")}`);
    if (r.resource.description) L.push("", r.resource.description);
  }
  if (r.paymentOptions?.length) {
    L.push("", "## Payment options");
    r.paymentOptions.forEach((o, i) => {
      if (!o.readable) {
        L.push(`${i + 1}. Could not be read: ${o.note}`);
        return;
      }
      const netName = o.network.name ?? o.network.id;
      const marker = o.network.testnet && !/testnet|sepolia|devnet|amoy|fuji/i.test(netName) ? " [testnet]" : "";
      L.push(`${i + 1}. **${o.price.display ?? o.price.atomic}** on ${netName}${marker}`);
      L.push(`   - scheme: ${o.scheme ?? "(not stated)"}`);
      L.push(`   - token: ${o.asset.symbol ?? "(unknown to this tool)"} \`${o.asset.address ?? "(none)"}\``);
      L.push(`   - raw amount: ${o.price.atomic}${o.asset.decimals != null ? ` (${o.asset.decimals} decimals)` : ""}`);
      L.push(`   - pay to: \`${o.payTo ?? "(not stated)"}\``);
      if (o.maxTimeoutSeconds != null) L.push(`   - must settle within: ${o.maxTimeoutSeconds}s`);
      if (o.extra) L.push(`   - extra: ${JSON.stringify(o.extra)}`);
      if (o.price.note) L.push(`   - note: ${o.price.note}`);
    });
  }
  if (r.callSchema) {
    L.push("", "## How to call it");
    L.push(`(from ${r.callSchema.source})`);
    if (r.callSchema.method) L.push(`- method: ${r.callSchema.method}`);
    if (r.callSchema.bodyType) L.push(`- body type: ${r.callSchema.bodyType}`);
    if (r.callSchema.exampleRequest) L.push("", "Example request body:", "```json", JSON.stringify(r.callSchema.exampleRequest, null, 2), "```");
    if (r.callSchema.exampleResponse) L.push("", "Example response:", "```json", JSON.stringify(r.callSchema.exampleResponse, null, 2), "```");
  }
  if (r.access?.siwx?.present) {
    L.push("", "## Repeat access");
    L.push("This endpoint advertises SIWX (a wallet signature for repeat access after paying):");
    for (const h of r.access.siwx.headers) L.push(`- \`${h.name}\`: ${h.value}`);
  }
  if (r.access?.facilitator) L.push("", `Facilitator: ${r.access.facilitator}`);
  const decoded = Object.entries(r.decodedHeaders || {}).filter(([k]) => k !== "payment-required");
  if (decoded.length) {
    L.push("", "## Other decoded headers");
    for (const [name, v] of decoded) {
      L.push(`- \`${name}\`:`);
      L.push("```json", typeof v.decoded === "string" ? v.decoded : JSON.stringify(v.decoded, null, 2), "```");
    }
  }
  if (r.notes?.length) {
    L.push("", "## Notes");
    for (const n of dedupe(r.notes)) L.push(`- ${n}`);
  }
  L.push("", `\u2014 ${r.attribution}`);
  return L.join("\n");
}
function formatOpenApi(r) {
  const L = [];
  if (!r.ok) {
    L.push("Could not read an OpenAPI spec.", "", r.error.message);
    if (r.error.location) L.push(`Location: ${r.error.location}`);
    if (r.error.triedUrls?.length) {
      L.push("", "Tried:");
      for (const t of r.error.triedUrls) L.push(`- ${t.url}${t.status ? ` (${t.status}${t.contentType ? `, ${t.contentType}` : ""})` : " (no response)"}`);
    }
    L.push("", `\u2014 x402 Tools by _done - underscoredone.com`);
    return L.join("\n");
  }
  L.push(`# ${r.info.title ?? "OpenAPI spec"}${r.info.version ? ` v${r.info.version}` : ""}`);
  L.push(`Spec: ${r.discovery.url} (${r.discovery.via}, ${r.format}, ${r.discovery.bytes} bytes)`);
  if (r.info.description) L.push("", r.info.description);
  if (r.info.contact) L.push("", `Contact: ${JSON.stringify(r.info.contact)}`);
  if (r.info.license) L.push(`License: ${r.info.license.name ?? JSON.stringify(r.info.license)}`);
  if (r.servers.length) {
    L.push("", "## Servers");
    for (const s of r.servers) L.push(`- ${s.url}${s.description ? ` \u2014 ${s.description}` : ""}`);
  }
  L.push("", `## Operations (${r.operations.length})`);
  for (const op of r.operations) {
    L.push("", `### ${op.method} ${op.path}`);
    if (op.summary) L.push(op.summary);
    if (op.operationId) L.push(`operationId: \`${op.operationId}\``);
    if (op.parameters.length) {
      L.push("", "Parameters:");
      for (const p of op.parameters) L.push(`- \`${p.name}\` (${p.in}${p.required ? ", required" : ""}) ${p.description ?? ""}`);
    }
    if (op.requestBody) {
      L.push("", `Request body (${op.requestBody.contentType ?? "unspecified"}${op.requestBody.required ? ", required" : ""}):`);
      if (op.requestBody.example) L.push("```json", JSON.stringify(op.requestBody.example, null, 2), "```");
      else if (op.requestBody.schema) L.push("```json", JSON.stringify(op.requestBody.schema, null, 2), "```");
    }
    if (op.responses.length) {
      L.push("", "Responses: " + op.responses.map((x) => `${x.code}${x.description ? ` (${x.description})` : ""}`).join(", "));
      const ex = op.responses.find((x) => x.example);
      if (ex) L.push("", `Example ${ex.code} response:`, "```json", JSON.stringify(ex.example, null, 2), "```");
    }
  }
  if (r.agentMetadata.present) {
    L.push("", "## Agent-readable metadata");
    for (const [k, v] of Object.entries(r.agentMetadata.fields)) {
      L.push(`- \`${k}\`: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  } else {
    L.push("", "## Agent-readable metadata", "None of the usual `x-*` agent metadata fields are present in this spec.");
  }
  if (r.comparison) {
    L.push("", "## Spec vs live endpoint");
    if (!r.comparison.ran) {
      L.push(r.comparison.reason);
    } else {
      L.push(`Probed: ${r.comparison.probed.method} ${r.comparison.probed.url} -> ${r.comparison.probed.status}`, "");
      L.push("| | spec says | live says | same? |");
      L.push("|---|---|---|---|");
      for (const row2 of r.comparison.rows) {
        const same = row2.match === null ? "\u2014" : row2.match ? "yes" : "no";
        const suffix = row2.note ? ` (${row2.note})` : "";
        L.push(`| ${row2.field} | ${cell(row2.spec)} | ${cell(row2.live)} | ${same}${cell(suffix)} |`);
      }
      L.push("", r.comparison.summary);
    }
  }
  if (r.notes?.length) {
    L.push("", "## Notes");
    for (const n of dedupe(r.notes)) L.push(`- ${n}`);
  }
  L.push("", `\u2014 ${r.attribution}`);
  return L.join("\n");
}
function cell(v) {
  if (v == null) return "_not stated_";
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function dedupe(arr) {
  return [...new Set(arr)];
}

// ../x402-tools/core/src/index.js
var VERSION = "1.0.0";
var ATTRIBUTION = "x402 Tools by _done - underscoredone.com";
export {
  AGENT_EXTENSIONS,
  ASSETS,
  ATTRIBUTION,
  BlockedError,
  DEFAULTS,
  NETWORKS,
  SPEC_PATHS,
  VERSION,
  assertResolvesPublicly,
  assertUrlAllowed,
  decodeBase64,
  decodeBase64Json,
  describeAsset,
  describeNetwork,
  formatAmount,
  formatInspect,
  formatOpenApi,
  inspect,
  isBlockedHostname,
  isPrivateIPv4,
  isPrivateIPv6,
  normalizeHeaders,
  parseChallenge,
  readOpenApi,
  safeFetch
};
