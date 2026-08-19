import fs from 'node:fs';
import { Wallet } from 'ethers';

const outdir = process.env.OUTDIR || 'relai-out';
fs.mkdirSync(outdir, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const bootstrapUrl = 'https://api.relai.fi/mcp/management/bootstrap/agent';
const originBase = 'https://raw.githubusercontent.com/evanbrown3000/startup-credits/relai-deadline-fit-v1/relai';
const originPath = '/marketplace-deadline-fit.json';
const originUrl = originBase + originPath;
const productName = 'Cognilode Marketplace Deadline-Fit Matrix';

async function bodyJson(res) {
  try { return await res.json(); } catch { return {}; }
}
async function requireJson(res, label) {
  const body = await bodyJson(res);
  if (!res.ok) throw new Error(`${label} failed HTTP ${res.status}: ${body.error || body.message || 'no detail'}`);
  return body;
}
function writeResult(extra) {
  fs.writeFileSync(`${outdir}/result.json`, JSON.stringify({
    provider: 'RelAI', product: productName, verified_buyer_income_usd: 0,
    checked_at: new Date().toISOString(), ...extra
  }, null, 2));
}

let wallet;
let serviceKey;
let apiId = null;
let relayUrl = null;
try {
  const origin = await fetch(originUrl, { redirect: 'follow' });
  if (!origin.ok) throw new Error(`origin not public: HTTP ${origin.status}`);
  JSON.parse(await origin.text());

  wallet = Wallet.createRandom();
  const challenge = await requireJson(await fetch(bootstrapUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: wallet.address })
  }), 'RelAI challenge');
  if (!challenge.message) throw new Error('RelAI challenge missing message');

  const signature = await wallet.signMessage(challenge.message);
  const keyBody = await requireJson(await fetch(bootstrapUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: wallet.address, signature, message: challenge.message, label: 'cognilode-deadline-fit-20260819' })
  }), 'RelAI service-key bootstrap');
  if (!keyBody.key || !String(keyBody.key).startsWith('sk_live_')) throw new Error('RelAI bootstrap returned no live service key');
  serviceKey = keyBody.key;

  // Checkpoint immediately: no successful bootstrap is allowed to become an unrecoverable orphan.
  fs.writeFileSync(`${outdir}/credentials.json`, JSON.stringify({
    provider: 'RelAI', createdAt: new Date().toISOString(), walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey, serviceKey, apiId: null, relayUrl: null, originUrl
  }, null, 2), { mode: 0o600 });
  writeResult({ stage: 'bootstrapped', account_created: true, authenticated_via_service_key: true,
    wallet_address: wallet.address, publication_live: false, paid_relay_live: false });

  const createBody = {
    name: productName,
    baseUrl: originBase,
    description: 'Machine-readable business dataset screening API/digital marketplaces by listing cost, seller economics, payout/settlement latency, and deadline fit.',
    network: 'base', x402Version: 2, merchantWallet: wallet.address,
    websiteUrl: 'https://github.com/evanbrown3000/startup-credits/blob/relai-deadline-fit-v1/relai/marketplace-deadline-fit.json',
    endpoints: [{ path: originPath, method: 'get', usdPrice: 0.01, description: 'Current machine-readable marketplace deadline-fit matrix.' }]
  };

  let created = null;
  let lastStatus = null;
  let lastBody = {};
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.relai.fi/v1/apis', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Service-Key': serviceKey },
      body: JSON.stringify(createBody)
    });
    lastStatus = res.status;
    lastBody = await bodyJson(res);
    if (res.ok) { created = lastBody; break; }
    if (res.status !== 429) throw new Error(`RelAI API registration failed HTTP ${res.status}: ${lastBody.error || lastBody.message || 'no detail'}`);
    const retryHeader = Number(res.headers.get('retry-after'));
    const waitSec = Number.isFinite(retryHeader) && retryHeader > 0 ? Math.min(retryHeader, 90) : [15, 30, 60, 90][attempt - 1];
    writeResult({ stage: 'registration_rate_limited', account_created: true, wallet_address: wallet.address,
      registration_attempt: attempt, provider_http: res.status, retry_after_seconds: waitSec,
      publication_live: false, paid_relay_live: false });
    if (attempt < 4) await sleep(waitSec * 1000);
  }
  if (!created) throw new Error(`RelAI API registration remained rate-limited after bounded retries; last HTTP ${lastStatus}: ${lastBody.error || lastBody.message || 'no detail'}`);
  apiId = created.apiId;
  if (!apiId) throw new Error('RelAI registration missing apiId');

  relayUrl = `https://api.relai.fi/relay/${apiId}${originPath}`;
  const relay = await fetch(relayUrl, { method: 'GET', redirect: 'manual' });
  if (relay.status !== 402) throw new Error(`RelAI relay expected HTTP 402, got ${relay.status}`);

  let marketplaceVisible = false;
  try {
    const market = await fetch('https://relai.fi/market');
    marketplaceVisible = (await market.text()).toLowerCase().includes(productName.toLowerCase());
  } catch {}

  fs.writeFileSync(`${outdir}/credentials.json`, JSON.stringify({
    provider: 'RelAI', createdAt: new Date().toISOString(), walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey, serviceKey, apiId, relayUrl, originUrl
  }, null, 2), { mode: 0o600 });
  writeResult({ stage: 'relay_live', account_created: true, authenticated_via_service_key: true,
    wallet_address: wallet.address, api_id: apiId, provider_status: created.status ?? null,
    origin_http: origin.status, relay_url: relayUrl, relay_http_without_payment: relay.status,
    publication_live: true, paid_relay_live: true, price_usd_per_call: 0.01,
    public_marketplace_visible_in_html_check: marketplaceVisible,
    marketplace_review_expected: marketplaceVisible ? 'already_visible' : 'not_yet_verified_visible; provider docs say typically 24-48h review' });
} catch (err) {
  writeResult({ stage: apiId ? 'post_registration_failure' : (serviceKey ? 'post_bootstrap_failure' : 'pre_bootstrap_failure'),
    account_created: Boolean(serviceKey), authenticated_via_service_key: Boolean(serviceKey),
    wallet_address: wallet?.address ?? null, api_id: apiId, relay_url: relayUrl,
    publication_live: false, paid_relay_live: false, terminal_error: String(err.message || err) });
  console.error(String(err.message || err));
  process.exitCode = 1;
}
