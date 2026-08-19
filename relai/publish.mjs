import fs from 'node:fs';
import { Wallet } from 'ethers';

const outdir = process.env.OUTDIR || 'relai-out';
fs.mkdirSync(outdir, { recursive: true });

const bootstrapUrl = 'https://api.relai.fi/mcp/management/bootstrap/agent';
const originBase = 'https://raw.githubusercontent.com/evanbrown3000/startup-credits/relai-deadline-fit-v1/relai';
const originPath = '/marketplace-deadline-fit.json';
const originUrl = originBase + originPath;
const productName = 'Cognilode Marketplace Deadline-Fit Matrix';

async function readJson(res, label) {
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(`${label} failed HTTP ${res.status}: ${body.error || body.message || 'no detail'}`);
  return body;
}

const existing = await fetch(originUrl, { redirect: 'follow' });
if (!existing.ok) throw new Error(`origin not public: HTTP ${existing.status}`);
JSON.parse(await existing.text());

const wallet = Wallet.createRandom();
const challenge = await readJson(await fetch(bootstrapUrl, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ publicKey: wallet.address })
}), 'RelAI challenge');
if (!challenge.message) throw new Error('RelAI challenge missing message');

const signature = await wallet.signMessage(challenge.message);
const keyBody = await readJson(await fetch(bootstrapUrl, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ publicKey: wallet.address, signature, message: challenge.message, label: 'cognilode-deadline-fit-20260819' })
}), 'RelAI service-key bootstrap');
if (!keyBody.key || !String(keyBody.key).startsWith('sk_live_')) throw new Error('RelAI bootstrap returned no live service key');

const serviceKey = keyBody.key;
const createBody = {
  name: productName,
  baseUrl: originBase,
  description: 'Machine-readable business dataset screening API/digital marketplaces by listing cost, seller economics, payout/settlement latency, and deadline fit.',
  network: 'base',
  x402Version: 2,
  merchantWallet: wallet.address,
  websiteUrl: 'https://github.com/evanbrown3000/startup-credits/blob/relai-deadline-fit-v1/relai/marketplace-deadline-fit.json',
  endpoints: [{ path: originPath, method: 'get', usdPrice: 0.01, description: 'Current machine-readable marketplace deadline-fit matrix.' }]
};

const created = await readJson(await fetch('https://api.relai.fi/v1/apis', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Service-Key': serviceKey },
  body: JSON.stringify(createBody)
}), 'RelAI API registration');
if (!created.apiId) throw new Error('RelAI registration missing apiId');

const relayUrl = `https://api.relai.fi/relay/${created.apiId}${originPath}`;
const relay = await fetch(relayUrl, { method: 'GET', redirect: 'manual' });
if (relay.status !== 402) throw new Error(`RelAI relay expected HTTP 402, got ${relay.status}`);

let marketplaceVisible = false;
try {
  const market = await fetch('https://relai.fi/market');
  marketplaceVisible = (await market.text()).toLowerCase().includes(productName.toLowerCase());
} catch {}

fs.writeFileSync(`${outdir}/credentials.json`, JSON.stringify({
  provider: 'RelAI', createdAt: new Date().toISOString(), walletAddress: wallet.address,
  walletPrivateKey: wallet.privateKey, serviceKey, apiId: created.apiId, relayUrl, originUrl
}, null, 2), { mode: 0o600 });

fs.writeFileSync(`${outdir}/result.json`, JSON.stringify({
  provider: 'RelAI', product: productName, account_created: true,
  authenticated_via_service_key: true, wallet_address: wallet.address, api_id: created.apiId,
  provider_status: created.status ?? null, origin_http: existing.status, relay_url: relayUrl,
  relay_http_without_payment: relay.status, paid_relay_live: true, price_usd_per_call: 0.01,
  public_marketplace_visible_in_html_check: marketplaceVisible,
  marketplace_review_expected: marketplaceVisible ? 'already_visible' : 'not_yet_verified_visible; provider docs say typically 24-48h review',
  verified_buyer_income_usd: 0, checked_at: new Date().toISOString()
}, null, 2));
