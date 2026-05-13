# Mandate — the missing IAM layer for institutional AI agents

> **One page. Plain English. For CFOs, treasurers, compliance officers,
> internal auditors.**
>
> If your firm is deploying AI agents to make payment decisions —
> answering vendor invoices, paying for API calls, settling cross-border
> transfers, executing trades — this is the gap you're hitting and what
> we propose for it.

---

## The problem in 3 sentences

1. AI agents are starting to spend money on your firm's behalf. (Customer
   service AIs, treasury automation, API consumers, RPA replacements.)
2. The authorization models we have for them are either too coarse — a
   shared credit card, a hot wallet, a service account password — or built
   bespoke per project, in a way no auditor can inspect.
3. **When the regulator asks "show me every dollar this agent moved, to
   whom, under whose authority, for what purpose"**, you can't produce
   that artifact in less than weeks of manual reconciliation.

This is the same gap I personally watched eat up audit hours at a fund —
on-chain numbers match, but attribution requires a story stitched
together from emails, spreadsheets, and the client's recollection.

---

## What Mandate is

A primitive that lets your firm issue an **on-chain authority** to an AI
agent (or human operator) with four enforced constraints:

| Constraint | Plain English |
|---|---|
| **Spend ceiling** | Hard cap — agent cannot ever exceed this, no matter how many calls or operators |
| **Counterparty whitelist** | Agent can only pay addresses your team has approved (set once, immutable per mandate) |
| **Purpose whitelist** | Agent can only spend for approved purposes (ISO 20022 codes — services, goods, intercompany, etc.) |
| **Validity window** | Agent cannot operate before `validFrom` or after `validUntil` |

And four guarantees:

- **Single-tap revocation.** Your team can kill an agent's authority in
  one on-chain transaction. All downstream activity stops instantly.
- **Structured audit trail per action.** Every payment emits an event
  containing the issuing institution, mandate ID, agent, counterparty,
  purpose code, amount, accumulated spent, and an encrypted metadata blob
  the auditor can decrypt. The event is on-chain forever.
- **Funds isolated in mandate pool.** USDC is held by the mandate contract
  itself, per-mandate. You can over-fund and revoke; we never give the
  agent access to your operating account.
- **Auditor-decryptable metadata.** Sensitive context (invoice ID, supplier
  name, internal cost code) can be encrypted to a specific auditor's view
  key — public sees structure, auditor sees content, no one else.

---

## What it looks like in a typical month

| Day | Action |
|---|---|
| 1 | Treasurer issues a $10,000 mandate to "Vendor-Payment-Agent v3" with whitelist of approved vendors + purposes `GDDS` (goods), `SCVE` (services), `CHAR` (charity), `INVS` (intercompany), and validity 30 days |
| 1–30 | Agent receives invoices, validates against ERP, pays through the mandate. Each payment emits a structured event the ERP picks up via subscription — journal entries are created automatically |
| 15 | Compliance officer requests "all spend under this mandate for purpose SCVE" — answer in 1 SQL query against the event log, not 3 weeks of reconciliation |
| 28 | Agent's behavior model drifts — flagged by anomaly detection. Treasurer revokes the mandate. All in-flight activity stops |
| 30 | Mandate expires. Unspent USDC ($1,247.32) auto-reclaimable via `withdraw`. Auditor signs off the month using the on-chain event log as primary evidence |

Every step in that flow is **a single on-chain transaction** the auditor
can verify independently. No reliance on the agent operator's logs.

---

## Why this is uniquely possible on Arc

Arc — Circle's institutional-stablecoin L1 — provides the substrate that
makes Mandate work:

- **USDC as native gas** means agent transactions cost predictable USDC,
  not a volatile gas token. CFOs can forecast operating costs.
- **Sub-cent per-tx fees** make per-call attribution economically viable.
  On Ethereum mainnet, a single mandate-execute call would cost $3-5 in
  gas; on Arc it's a fraction of a cent.
- **Configurable privacy at the L1 level** means sensitive metadata can
  be hidden from the public chain but revealed to specific auditors.
- **Compliance interfaces at the L1 level** mean AML / disclosure systems
  can stream events directly, without going through 3 layers of
  custodian-API.
- **L1 finality** means a settled transaction is settled — no chain
  reorg risk on the agent's spend.

Without any one of those, Mandate would be either too expensive, too
opaque, or too uncertain for institutional adoption.

---

## What you would have to do to try this

Today (v0):
1. Designate an EOA or multi-sig as your issuer address (in production:
   Gnosis Safe with your treasury policy).
2. Deploy a Mandate contract on Arc Testnet (we already did at
   `0xfbbdaec0...e6e4`).
3. Pick 1 use case: "the agent that pays for our LLM API consumption" or
   "the agent that pays our top 10 SaaS subscriptions monthly."
4. Issue the mandate via the SDK, fund it with a small amount of testnet
   USDC, and run the agent for one week.
5. At end of week, pull the audit log via the AuditorClient SDK — verify
   it gives you exactly the audit artifact you need.

We estimate **half a day** of integration work for a sandbox test, and
~$50 USDC of actual on-chain spend (refundable after revoke). Zero cost
to evaluate.

---

## What this is **not**

- **Not** a replacement for your bank or your accounting system. Mandate
  sits next to them and gives a single piece of attribution that's
  currently missing.
- **Not** a custody product. Funds stay in Arc-native USDC; if your firm
  doesn't yet have on-chain USDC operations, this requires that step
  first.
- **Not** production-audited yet. v0 has 43 forge tests + Slither static
  analysis (no high/medium findings); production deployment should wait
  for a formal audit (~$15K, ~3 weeks turnaround) and a real validator
  network for the auditor view-key escrow.
- **Not** a smart-contract wallet. It's a *capability* on top of whatever
  wallet your agent uses.

---

## What we'd like from you

If this sounds like a problem you have:

1. **30 minutes of your time** for a walkthrough of the demo, with your
   compliance officer or treasury operations lead.
2. **Sharp criticism.** Tell us what wouldn't survive your audit committee
   review — every objection moves the spec forward.
3. **One use case** you'd be willing to pilot, given a v1 audit.

What we offer in exchange:

- A protocol where your needs as a design partner are visible in the
  contract code.
- Open source (MIT). No vendor lock-in. Self-hostable.
- Integration help. We're shipping the SDK; we can sit alongside your
  team for the pilot.

---

## Author

[Zen Chen](https://github.com/Ccheh) — MSc Data Science (Sheffield).
Previously: crypto-asset audit work at a fund. Currently building Mandate,
[Cadence](https://github.com/Ccheh/arc402),
[Crucible](https://github.com/Ccheh/crucible),
[Helm](https://github.com/Ccheh/helm) on Arc Testnet. Reach out: ccheh4@gmail.com.

## Repo

- Mandate v0: github.com/Ccheh/mandate (deployed `0xfbbdaec0...e6e4` on Arc Testnet)
- Live lifecycle proof: `mandate/sdk-ts/examples/full-lifecycle.ts`
- Cross-protocol demo: `hackathon-submission/mandate-cadence-demo/`
