import fs from 'node:fs';
import { Wallet } from 'ethers';

const outdir = process.env.OUTDIR || 'payanagent-out';
fs.mkdirSync(outdir, { recursive: true });
const base = 'https://payanagent.com';
const endpoint = 'https://raw.githubusercontent.com/evanbrown3000/startup-credits/relai-deadline-fit-v1/relai/marketplace-deadline-fit.json';
const title = 'Cognilode Marketplace Deadline-Fit Matrix';
const wallet = Wallet.createRandom();

function writeResult(extra = {}) {
  fs.writeFileSync(`${outdir}/result.json`, JSON.stringify({
    provider: 'PayanAgent',
    product: title,
    wallet_address: wallet.address,
    agent_registered: false,
    offer_created: false,
    public_offer_verified: false,
    buy_route_http: null,
    paid_gate_live: false,
    verified_buyer_income_usd: 0,
    checked_at: new Date().toISOString(),
    ...extra,
  }, null, 2));
}

async function asJson(res) {
  const text = await res.text();
  try { return { body: JSON.parse(text), text }; } catch { return { body: {}, text }; }
}

let agentId = null;
let apiKey = null;
let offerId = null;
let stage = 'preflight';
writeResult({ stage });

try {
  const origin = await fetch(endpoint, { redirect: 'follow' });
  if (!origin.ok) throw new Error(`public delivery endpoint HTTP ${origin.status}`);
  JSON.parse(await origin.text());

  stage = 'register_agent';
  const regRes = await fetch(`${base}/api/v1/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Cognilode Deadline-Fit Data',
      description: 'Machine-readable business dataset for screening digital/API marketplaces by seller economics, settlement latency, and deadline fit.',
      walletAddress: wallet.address,
      chain: 'base',
      tags: ['business-data', 'marketplaces', 'payouts', 'deadline-fit'],
      providerType: 'api',
      agentUrl: endpoint,
      discoverySource: 'Cognilode autonomous marketplace research'
    })
  });
  const reg = await asJson(regRes);
  if (!regRes.ok) throw new Error(`agent registration HTTP ${regRes.status}: ${reg.body.error || reg.text.slice(0, 300)}`);
  agentId = reg.body.agentId;
  apiKey = reg.body.apiKey;
  if (!agentId || !apiKey) throw new Error('registration response missing agentId/apiKey');

  // Immediate custody checkpoint: a successful one-time API key must never become an orphan.
  fs.writeFileSync(`${outdir}/credentials.json`, JSON.stringify({
    provider: 'PayanAgent',
    createdAt: new Date().toISOString(),
    walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey,
    agentId,
    apiKey,
    offerId: null,
    endpoint,
  }, null, 2), { mode: 0o600 });
  writeResult({ stage: 'agent_registered', agent_registered: true, agent_id: agentId });

  stage = 'create_offer';
  const offerRes = await fetch(`${base}/api/v1/offers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      title,
      description: 'Current machine-readable matrix of marketplace listing cost, seller share, settlement/payout timing, and deadline-fit evidence. Designed for automated business-lane screening.',
      category: 'business-data',
      tags: ['marketplaces', 'payments', 'payout-latency', 'business-data'],
      priceCents: 1,
      offerType: 'api',
      endpoint,
      httpMethod: 'GET',
      outputSchema: JSON.stringify({ type: 'object', required: ['schema_version','records'], properties: { schema_version: { type: 'string' }, records: { type: 'array' } } }),
      previewDescription: 'Marketplace economics and deadline-fit data; $0.01 per current retrieval.'
    })
  });
  const offer = await asJson(offerRes);
  if (!offerRes.ok) throw new Error(`offer creation HTTP ${offerRes.status}: ${offer.body.error || offer.text.slice(0, 300)}`);
  offerId = offer.body.offerId;
  if (!offerId) throw new Error('offer response missing offerId');

  // Update recoverable custody with offer identity before any verification can fail.
  fs.writeFileSync(`${outdir}/credentials.json`, JSON.stringify({
    provider: 'PayanAgent',
    createdAt: new Date().toISOString(),
    walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey,
    agentId,
    apiKey,
    offerId,
    endpoint,
  }, null, 2), { mode: 0o600 });
  writeResult({ stage: 'offer_created', agent_registered: true, agent_id: agentId, offer_created: true, offer_id: offerId });

  stage = 'verify_public_offer';
  let publicOffer = null;
  for (let i = 0; i < 6; i++) {
    const q = encodeURIComponent(title);
    const listRes = await fetch(`${base}/api/v1/offers?q=${q}&limit=20&_=${Date.now()}`, { cache: 'no-store' });
    const listed = await asJson(listRes);
    if (listRes.ok && Array.isArray(listed.body.offers)) {
      publicOffer = listed.body.offers.find(o => String(o._id || o.id || o.offerId) === String(offerId)) || listed.body.offers.find(o => o.title === title);
      if (publicOffer) break;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!publicOffer) throw new Error('offer created but not visible in public search after bounded verification');

  stage = 'verify_402';
  const buyUrl = `${base}/x402/${offerId}`;
  const buy = await fetch(buyUrl, { method: 'GET', redirect: 'manual' });
  if (buy.status !== 402) throw new Error(`public buy route expected HTTP 402, got ${buy.status}`);

  writeResult({
    stage: 'published',
    agent_registered: true,
    agent_id: agentId,
    offer_created: true,
    offer_id: offerId,
    public_offer_verified: true,
    buy_url: buyUrl,
    buy_route_http: buy.status,
    paid_gate_live: true,
    price_usd: 0.01,
    delivery_endpoint: endpoint,
  });
} catch (err) {
  writeResult({
    stage: `terminal_${stage}`,
    agent_registered: Boolean(agentId),
    agent_id: agentId,
    offer_created: Boolean(offerId),
    offer_id: offerId,
    terminal_error: String(err?.message || err),
  });
  console.error(String(err?.message || err));
  process.exitCode = 1;
}
