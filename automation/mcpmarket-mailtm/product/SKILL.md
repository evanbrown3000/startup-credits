---
name: provider-reality-check
description: Verify whether an online marketplace or API provider is actually usable for a specific commercial action right now. Cross-check current first-party marketing, docs, live app/API behavior, seller economics, payout constraints, authentication, public discoverability, and historical failure evidence; return an evidence-backed execute/hold/retire decision plus the next materially different test.
user-invocable: true
argument-hint: "<provider> <intended commercial action>"
effort: high
compatibility: "Designed for research-capable coding agents with web access; useful before seller signup, listing publication, API monetization, or payout onboarding."
---

# Provider Reality Check

Use this skill when an agent is about to spend meaningful time on a marketplace, seller platform, paid API directory, bounty venue, creator store, or similar provider and needs to know whether the intended commercial path is **actually executable now**.

The objective is not a generic provider review. The objective is to reduce wasted execution by proving or falsifying the exact commercial path with current evidence, while preserving a materially different next experiment when the path is not yet proven.

## Inputs

Extract or request only what materially changes the decision:

- provider/domain;
- intended commercial action, such as create seller, publish paid listing, expose paid API, claim bounty, or receive payout;
- product/service being sold;
- spend ceiling, if any;
- required payout destination or currency, if constrained;
- any already-known account, listing, failure, or historical provider evidence.

Do not ask for information that can be recovered from current first-party surfaces or from evidence already supplied.

## Continuous verification loop

Run the following loop until the path is executable, falsified under the current hypothesis, or blocked by a genuinely external requirement.

### 1. Define the exact claim

Rewrite the intended path as a falsifiable sentence, for example:

`A new seller can create an account at $0 upfront, publish a publicly discoverable $9 digital listing today, and receive proceeds through an accessible payout rail without a minimum that makes the first sale economically unusable.`

Do not test the vague claim that the provider "exists" or "supports sellers." Test the whole commercial chain.

### 2. Check current first-party evidence first

Prefer evidence in this order when available:

1. live authenticated or unauthenticated provider UI/API behavior;
2. current first-party pricing, seller, payout, API, and account documentation;
3. current first-party marketing/product pages;
4. provider-controlled status/changelog/help pages;
5. reputable secondary reporting only when first-party evidence cannot answer the question.

Record page/update time when visible. Treat search snippets and cached pages as discovery hints, not decisive live evidence.

### 3. Reconcile contradictions instead of averaging them

When first-party sources disagree, preserve both facts and identify which commercial layer each describes. Common patterns:

- marketing says "sell publicly" while product docs describe organization-private assets;
- pricing says "free" while publication requires a paid plan;
- signup exists while payout onboarding is region- or KYC-gated;
- an API contract is documented while the current endpoint is gone, 4xx, 5xx, or DNS-dead;
- listing creation succeeds while public discovery does not expose the item;
- buyer checkout exists while seller withdrawal thresholds make the first transaction non-fungible.

Use the live provider path as the tie-breaker when it can be tested without violating the operator's constraints.

### 4. Prove the seller economics

Capture, at minimum:

- upfront cost to create the account;
- listing/publication fee;
- platform commission or transaction fee;
- payout processor fee when material;
- minimum payout/withdrawal threshold;
- payout currency/rail;
- payout delay or hold;
- region, identity, tax, KYC, age, or business-entity requirements that materially constrain access;
- whether a buyer can purchase without bespoke/manual seller intervention.

Separate **revenue**, **profit**, **provider-held proceeds**, and **withdrawable/fungible proceeds**. Never count a listing, invoice, face-value bounty, or hypothetical sale as income.

### 5. Prove the public buyer path

For marketplace-style products, require evidence for all applicable stages:

`seller identity -> product/listing created -> published/live state -> unauthenticated public discovery/detail -> buyer purchase or payment path -> seller proceeds/payout path`

A private draft, organization-only skill, unpublished object ID, or authenticated seller preview is not a public listing.

For paid APIs/resources, require the analogous chain:

`resource live -> unauthenticated request proves paywall/payment contract -> discovery/index registration when promised -> buyer payment protocol usable -> settlement destination controlled`

### 6. Use bounded execution, not endless probing

Each experiment should answer one material uncertainty. Put strict bounds on requests, retries, recursive searches, and browser loops.

After a failure, classify the layer:

- `discovery_stale`
- `provider_unreachable`
- `auth_contract`
- `account_verification`
- `seller_onboarding`
- `listing_contract`
- `public_discovery`
- `payment_contract`
- `payout_economics`
- `carrier_or_execution_environment`
- `transient_provider_state`

Do not repeat the same failed experiment unless a state change makes it a new hypothesis.

### 7. Search historical evidence for the same failure class

Before declaring a fix, look for earlier attempts involving the same provider or the same mechanism. Ask:

- Has this exact provider already been tried?
- Has a similar auth/payout/publication assumption failed before?
- Did a prior "success" stop at account creation, listing creation, or another pre-income proxy?
- Was a prior failure actually caused by the execution carrier rather than the provider?

Use negative evidence to shrink the search space. Preserve the causal distinction between provider failure and carrier failure.

### 8. Choose the next action from evidence

Return one of these decisions:

- `EXECUTE_NOW` — the commercial chain is sufficiently proven to perform the next external step now.
- `EXECUTE_BOUNDED_TEST` — one material uncertainty remains and a low-cost test can resolve it.
- `HOLD_FOR_STATE_CHANGE` — the path is legitimate but depends on a specific external change; name the observable trigger.
- `RETIRE_CURRENT_HYPOTHESIS` — live evidence falsifies the current path; name what must materially change before retry.
- `SWITCH_PROVIDER` — the commercial objective remains good but this provider no longer deserves execution time.

Never use `unknown` as a terminal conclusion. Replace it with the smallest experiment or state trigger that would resolve the uncertainty.

## Required output

Return a compact decision record containing:

```text
Provider:
Commercial claim:
Decision:
Confidence: <0-1>
Current first-party evidence:
Contradictions resolved:
Seller economics:
Public buyer path:
Historical negative/positive evidence:
Next external action:
Retry only if:
Income actually observed:
```

When automation will consume the result, append JSON with these keys:

```json
{
  "provider": "",
  "commercial_claim": "",
  "decision": "EXECUTE_NOW|EXECUTE_BOUNDED_TEST|HOLD_FOR_STATE_CHANGE|RETIRE_CURRENT_HYPOTHESIS|SWITCH_PROVIDER",
  "confidence": 0.0,
  "upfront_cost": 0.0,
  "listing_cost": 0.0,
  "commission_known": false,
  "payout_rail": "",
  "withdrawal_threshold": null,
  "account_state": "",
  "publication_state": "",
  "public_discovery_proven": false,
  "buyer_payment_path_proven": false,
  "payout_path_proven": false,
  "income_observed": 0.0,
  "failure_layer": null,
  "next_action": "",
  "retry_trigger": ""
}
```

## Decision discipline

Optimize for external commercial effect and time saved, not for report completeness. A 90-second bounded test that definitively falsifies a provider path is more valuable than a long speculative report. A successful seller signup is useful only if it advances toward publication and buyer payment. A public paid listing is useful only if it is actually discoverable and transactable. Income is counted only when proceeds exist on an accessible rail under the operator's stated accounting rule.
