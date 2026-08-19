'use strict';

const { chromium } = require('playwright-core');
const crypto = require('crypto');
const fs = require('fs');

const PRODUCT_PATH = '/tmp/product/SKILL.md';
const compact = (value, limit = 4200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);

function redactUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      if (/token|code|access|refresh|secret/i.test(key)) url.searchParams.set(key, '[redacted]');
    }
    if (url.hash) url.hash = '#[redacted]';
    return url.toString();
  } catch (_) {
    return compact(value, 600);
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = { raw: raw.slice(0, 1800) };
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}: ${raw.slice(0, 500)}`);
  return data;
}

async function snapshot(page, label) {
  const buttons = (await page.getByRole('button').allTextContents().catch(() => [])).slice(0, 100);
  const rawLinks = await page.locator('a').evaluateAll((elements) => elements.slice(0, 130).map((element) => ({
    text: (element.innerText || '').trim().slice(0, 120),
    href: element.href,
  }))).catch(() => []);
  const inputs = await page.locator('input,textarea,select').evaluateAll((elements) => elements.slice(0, 100).map((element) => ({
    tag: element.tagName,
    type: element.type || '',
    name: element.name || '',
    placeholder: element.placeholder || '',
    accept: element.accept || '',
  }))).catch(() => []);
  return {
    label,
    url: redactUrl(page.url()),
    title: await page.title().catch(() => ''),
    body: compact(await page.locator('body').innerText().catch(() => '')),
    buttons,
    links: rawLinks.map((link) => ({ text: link.text, href: redactUrl(link.href) })),
    inputs,
  };
}

async function click(page, patterns) {
  for (const pattern of patterns) {
    for (const locator of [page.getByRole('button', { name: pattern }), page.getByRole('link', { name: pattern })]) {
      try {
        if (await locator.count()) {
          await locator.last().click({ timeout: 7000 });
          return true;
        }
      } catch (_) {}
    }
  }
  return false;
}

async function fill(page, patterns, value) {
  for (const pattern of patterns) {
    for (const locator of [page.getByLabel(pattern), page.getByPlaceholder(pattern)]) {
      try {
        if (await locator.count()) {
          await locator.first().fill(String(value));
          return true;
        }
      } catch (_) {}
    }
  }
  return false;
}

async function fillMeta(page, pattern, value) {
  const nodes = page.locator('input,textarea');
  const count = await nodes.count();
  for (let index = 0; index < count; index += 1) {
    const node = nodes.nth(index);
    const metadata = `${(await node.getAttribute('name')) || ''} ${(await node.getAttribute('placeholder')) || ''} ${(await node.getAttribute('aria-label')) || ''}`;
    if (pattern.test(metadata)) {
      try {
        await node.fill(String(value));
        return true;
      } catch (_) {}
    }
  }
  return false;
}

function linksFrom(material) {
  const decoded = String(material || '').replace(/&amp;/g, '&').replace(/&#x3D;/gi, '=').replace(/&#61;/g, '=');
  return [...new Set((decoded.match(/https?:\/\/[^\s"'<>]+/g) || []).map((value) => value.replace(/[),.;]+$/, '')))];
}

async function finishOnboarding(page, output) {
  for (let index = 0; index < 14; index += 1) {
    if (!page.url().includes('/signup/onboarding')) return true;
    output.snapshots.push(await snapshot(page, `onboarding-${index}`));
    let acted = false;
    if (await click(page, [/^engineering$/i])) acted = true;
    else if (await click(page, [/^skip$/i])) acted = true;
    else if (await click(page, [/^continue$|^next$|^finish$|^done$/i])) acted = true;
    else {
      const texts = (await page.getByRole('button').allTextContents().catch(() => [])).map((value) => value.trim()).filter(Boolean);
      const candidate = texts.find((text) => !/back|close|menu|sign out|log out/i.test(text));
      if (candidate) {
        try {
          await page.getByRole('button', { name: candidate, exact: true }).last().click({ timeout: 6000 });
          acted = true;
        } catch (_) {}
      }
    }
    if (!acted) break;
    await page.waitForTimeout(1300);
  }
  return !page.url().includes('/signup/onboarding');
}

async function main() {
  const payload = JSON.parse(fs.readFileSync('/tmp/input.json', 'utf8'));
  const output = {
    provider: 'mcpmarket.com',
    product: payload.title,
    price_usd: Number(payload.price),
    mailbox_provider: 'mail.tm',
    mailbox_created: false,
    account_created: false,
    confirmation_received: false,
    email_confirmed: false,
    onboarding_completed: false,
    authenticated: false,
    seller_onboarding: false,
    skill_uploaded: false,
    listing_published: false,
    public_url: null,
    public_readback: false,
    income: 0,
    status: 'started',
    snapshots: [],
  };

  let address = '';
  let mailboxId = '';
  let mailToken = '';
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    const domains = await api('https://api.mail.tm/domains?page=1');
    const domain = (domains['hydra:member'] || []).find((candidate) => candidate.isActive !== false && candidate.isPrivate !== true);
    if (!domain?.domain) throw new Error('mail.tm returned no active public domain');

    address = `cognilode-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@${domain.domain}`;
    const account = await api('https://api.mail.tm/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password: payload.mailbox_password }),
    });
    mailboxId = account.id || '';
    const token = await api('https://api.mail.tm/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password: payload.mailbox_password }),
    });
    mailToken = token.token || '';
    if (!mailToken) throw new Error('mail.tm token missing');
    output.mailbox_created = true;
    output.account_email = address;

    await page.goto('https://app.mcpmarket.com/signup', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.getByRole('button', { name: /^sign up with email$/i }).click({ timeout: 12000 });
    const nameInput = page.getByLabel(/^name$/i);
    if (await nameInput.count()) await nameInput.fill('Evan Brown');
    else await page.getByPlaceholder(/your name/i).fill('Evan Brown');
    await page.locator('input[type=email]').fill(address);
    await page.locator('input[type=password]').fill(payload.provider_password);
    const createButton = page.getByRole('button', { name: /^create account$/i });
    if (await createButton.count()) await createButton.last().click({ timeout: 12000 });
    else await page.locator('form button[type=submit]').last().click({ timeout: 12000 });
    await page.waitForTimeout(2200);
    let body = compact(await page.locator('body').innerText());
    output.snapshots.push(await snapshot(page, 'signup-result'));
    if (!/check your email|confirmation link|verify your email/i.test(body)) throw new Error(`signup did not reach confirmation: ${body.slice(0, 700)}`);
    output.account_created = true;

    let confirmationUrl = null;
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline && !confirmationUrl) {
      const list = await api('https://api.mail.tm/messages?page=1', { headers: { Authorization: `Bearer ${mailToken}` } });
      for (const message of list['hydra:member'] || []) {
        const full = await api(`https://api.mail.tm/messages/${message.id}`, { headers: { Authorization: `Bearer ${mailToken}` } });
        const material = [full.subject, full.intro, full.text, Array.isArray(full.html) ? full.html.join('\n') : full.html].filter(Boolean).join('\n');
        confirmationUrl = linksFrom(material).find((url) => /supabase\.co\/auth\/v1\/verify|token_hash=|type=signup|app\.mcpmarket\.com\/auth\/callback/i.test(url)) || null;
        if (confirmationUrl) break;
      }
      if (!confirmationUrl) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (!confirmationUrl) throw new Error('confirmation mail did not arrive within 150 seconds');
    output.confirmation_received = true;

    await page.goto(confirmationUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1600);
    body = compact(await page.locator('body').innerText());
    output.email_confirmed = !/invalid|expired|unable to verify|error/i.test(body);
    output.snapshots.push(await snapshot(page, 'confirmation-result'));
    if (!output.email_confirmed) throw new Error(`confirmation rejected: ${body.slice(0, 700)}`);

    output.onboarding_completed = await finishOnboarding(page, output);
    if (!output.onboarding_completed) {
      await page.goto('https://app.mcpmarket.com/dashboard', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(1300);
      if (page.url().includes('/signup/onboarding')) output.onboarding_completed = await finishOnboarding(page, output);
    }
    output.authenticated = !page.url().includes('/login');
    output.snapshots.push(await snapshot(page, 'post-onboarding'));
    if (!output.authenticated) throw new Error('confirmation session did not remain authenticated');

    await page.goto('https://app.mcpmarket.com/sell?source=sell-page', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1600);
    output.snapshots.push(await snapshot(page, 'seller-entry'));

    for (let step = 0; step < 22; step += 1) {
      body = compact(await page.locator('body').innerText());
      const lower = body.toLowerCase();
      if (/published|listing is live|view public page|live paid/i.test(lower)) {
        output.listing_published = true;
        break;
      }
      if (page.url().includes('/login')) throw new Error('seller route redirected to login');
      if (page.url().includes('/signup/onboarding')) {
        output.onboarding_completed = await finishOnboarding(page, output);
        continue;
      }

      if (/organization|workspace/.test(lower)) {
        await fill(page, [/organization name|workspace name/i], payload.organization || 'Cognilode');
        await fill(page, [/slug|handle/i], payload.organization_slug || 'cognilode');
        await fillMeta(page, /organization|workspace|name/i, payload.organization || 'Cognilode');
        await fillMeta(page, /slug|handle/i, payload.organization_slug || 'cognilode');
        if (await click(page, [/^create organization$|^create workspace$|^continue$|^next$/i])) {
          output.seller_onboarding = true;
          await page.waitForTimeout(1400);
          output.snapshots.push(await snapshot(page, `organization-${step}`));
          continue;
        }
      }

      if (/storefront|seller profile|start selling|set up.*store/.test(lower)) {
        await fill(page, [/display name|seller name/i], payload.seller_name || 'Cognilode');
        await fill(page, [/handle|username|slug/i], payload.handle || 'cognilode');
        await fill(page, [/bio|about|description/i], payload.seller_bio || 'Evidence-driven agent skills for commercial execution and provider validation.');
        if (await click(page, [/^start selling$|^set up.*store$|^create.*seller$|^save$|^continue$|^next$/i])) {
          output.seller_onboarding = true;
          await page.waitForTimeout(1400);
          output.snapshots.push(await snapshot(page, `seller-${step}`));
          continue;
        }
      }

      if (/connect stripe|payout|payments setup/i.test(lower)) {
        if (await click(page, [/^skip for now$|^do this later$|^continue without payouts$/i])) {
          await page.waitForTimeout(1200);
          output.snapshots.push(await snapshot(page, `payout-skip-${step}`));
          continue;
        }
      }

      const fileInput = page.locator('input[type=file]');
      if (await fileInput.count()) {
        await fileInput.first().setInputFiles(PRODUCT_PATH);
        output.skill_uploaded = true;
        await page.waitForTimeout(1400);
        output.snapshots.push(await snapshot(page, `skill-uploaded-${step}`));
      } else if (await click(page, [/^upload.*skill$|^new skill$|^create skill$|^add skill$|^import skill$|^connect skill$/i])) {
        await page.waitForTimeout(1400);
        output.snapshots.push(await snapshot(page, `open-upload-${step}`));
        continue;
      }

      const sourceUrl = payload.source_url || '';
      if (sourceUrl) {
        await fill(page, [/github url|repository url|source url|skill url/i], sourceUrl);
        await fillMeta(page, /github|repository|source.*url|skill.*url/i, sourceUrl);
      }
      await fill(page, [/skill name|listing title|title/i], payload.title);
      await fill(page, [/description|summary/i], payload.description);
      await fill(page, [/price|amount/i], payload.price);
      await fillMeta(page, /title|skill.*name|listing.*name/i, payload.title);
      await fillMeta(page, /description|summary/i, payload.description);
      await fillMeta(page, /price|amount/i, payload.price);

      if (await click(page, [/^publish$|^go live$|^create listing$|^save and publish$|^list skill$|^continue$|^next$|^save$|^import$/i])) {
        await page.waitForTimeout(2100);
        output.snapshots.push(await snapshot(page, `advance-${step}`));
        continue;
      }
      break;
    }

    body = compact(await page.locator('body').innerText());
    output.listing_published = output.listing_published || (/published|listing is live|view public page|live paid/i.test(body) && !/not published|error/i.test(body));
    const links = await page.locator('a').evaluateAll((elements) => elements.map((element) => ({ text: (element.innerText || '').trim(), href: element.href })));
    const candidate = links.find((link) => /view public page|public listing|storefront/i.test(link.text)) || links.find((link) => /mcpmarket\.com\/@|\/tools\/skills\//.test(link.href));
    output.public_url = candidate ? candidate.href : null;
    output.snapshots.push(await snapshot(page, 'seller-terminal'));

    if (output.public_url) {
      const publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const publicPage = await publicContext.newPage();
      const response = await publicPage.goto(output.public_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await publicPage.waitForTimeout(900);
      output.public_readback = Boolean(response && response.status() < 400 && /provider reality check/i.test(compact(await publicPage.locator('body').innerText())));
      output.snapshots.push(await snapshot(publicPage, 'public-readback'));
      await publicContext.close();
    }
    output.status = output.listing_published ? (output.public_readback ? 'published_publicly_verified' : 'published_public_readback_unverified') : 'publish_incomplete';
  } catch (error) {
    output.status = 'error';
    output.error = String(error.message || error).slice(0, 1200);
    try {
      output.snapshots.push(await snapshot(page, 'error-terminal'));
    } catch (_) {}
  }

  output.finished_at = new Date().toISOString();
  fs.writeFileSync('/tmp/result.json', `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync('/tmp/custody.json', `${JSON.stringify({
    mailbox_provider: 'mail.tm',
    mailbox_address: address,
    mailbox_password: payload.mailbox_password,
    mailbox_account_id: mailboxId,
    provider: 'mcpmarket.com',
    provider_email: address,
    provider_password: payload.provider_password,
    public_url: output.public_url,
    created_at: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
