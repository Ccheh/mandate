# Mandate

> **The institutional × agent authorization layer for Arc.** Banks, funds, and
> corporate treasuries issue on-chain mandates to AI agents (or humans). The
> mandate caps spend, restricts counterparties + purposes, emits a structured
> audit trail per action, and can be revoked instantly. The missing IAM
> primitive for the institutional half of Arc's regulated-stablecoin thesis.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-43%2F43%20passing-success)](#)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-blue)](contracts/foundry.toml)

> **Read this first.** Mandate is v0. The Solidity is complete and tested; no
> on-chain deployment yet. The pitch is: Circle's Arc thesis (regulated
> stablecoin native gas, compliance hooks, controllable finality) creates the
> base-layer conditions for institutions to use crypto — but the application
> layer where institutions actually deploy AI agents to spend money does not
> exist. Mandate is that layer.

---

## The thesis in one paragraph

Arc is engineered for institutions: USDC as native gas (so CFOs can budget
operating costs), L1 finality (so banks know when settlement is final),
compliance hooks at the protocol level (so AML/disclosure can be enforced
not bolted on), and configurable privacy (so commercial information stays
private to the parties that need it). What's missing on top of those rails
is a **capability framework** that lets an institution safely deploy AI
agents to act on its behalf: spend with limits, only to known counterparties,
only for known purposes, with every action attributable from the institution
all the way down to the leaf transaction. Today institutions either give
agents a corporate credit card (no programmability) or build bespoke
authorization stacks per project (no portability). Mandate is the missing
on-chain abstraction.

---

## How it works

A **Mandate** is an on-chain capability grant with four constraints:

| Constraint | Semantics |
|---|---|
| **Capability bitmap** | Which actions the principal is allowed to take (v0: `BIT_TRANSFER`). Future bits gate Cadence claims, Crucible market opens, Helm votes, etc. |
| **Spend ceiling** | Hard cap (in USDC wei) the principal can ever spend through this mandate. Monotonic; never decreases. |
| **Counterparty whitelist** | Merkle root over allowed `(tag, address)` pairs. Tag-to-address binding is part of the leaf — an attacker can't reuse a known-good tag for a different address. |
| **Purpose whitelist** | Merkle root over allowed ISO-20022-style purpose codes (e.g., `GDDS` for goods, `SCVE` for services). |

Plus: validity window (`validFrom` / `validUntil`), an auditor view-key
holder (off-chain encrypted metadata recipient), and an `Active → Revoked`
lifecycle controlled by the issuer.

### Lifecycle

```
None → Active → (Revoked | Expired)
            ↓
          Drained (spent == ceiling)
```

### Core flows

1. **Issue.** Institutional issuer calls `issue(...)` with the constraints + optional initial funding (sent as `msg.value`). Mandate becomes `Active`. `mandateId` is a deterministic `keccak256(issuer, count, chainId)`.

2. **Top up.** Issuer can call `topUp(mandateId)` to add funds while the mandate is active. Total funding can never exceed `spendCeiling`.

3. **Execute.** Principal calls `execute(mandateId, to, amount, purposeCode, counterpartyTag, counterpartyProof, purposeProof, encryptedMetadata)`. Contract verifies:
   - mandate is Active and within validity window
   - `msg.sender == principal`
   - Merkle proof for `(counterpartyTag, to)` against `counterpartyMerkleRoot`
   - Merkle proof for `purposeCode` against `purposeMerkleRoot`
   - `spent + amount <= spendCeiling` AND `spent + amount <= funded`
   
   Then increments `spent`, emits a structured `MandateAction` event, and transfers `amount` USDC to `to`.

4. **Revoke.** Issuer can call `revoke(mandateId)` any time. State becomes `Revoked`; no further `execute` allowed.

5. **Withdraw.** After revocation OR expiry, issuer can call `withdraw(mandateId, amount)` to reclaim unspent funds. The mandate's `spent` counter is incremented to keep accounting invariant (`spent <= funded` always).

### The audit-trail event

```solidity
event MandateAction(
    bytes32 indexed mandateId,
    address indexed principal,
    address indexed to,
    uint256 amount,
    bytes32 purposeCode,
    bytes32 counterpartyTag,
    uint256 newSpent,
    bytes   encryptedMetadata
);
```

This is the on-chain row in the institution's general ledger. An ERP ingest
pipeline subscribes to this event and produces journal entries automatically.
An AML system filters by `purposeCode` to flag suspicious patterns. An
auditor with the encryption key for `encryptedMetadata` can reconstruct the
full off-chain context (invoice ID, sub-account, vendor metadata).

---

## How it composes with the rest of the stack

```
Institution (KYC'd, typically multi-sig)
   │
   │  issues Mandate (USDC pool + capability + whitelists)
   ▼
Principal (AI agent / human)
   │
   ├─→ Cadence (github.com/Ccheh/arc402)
   │     Per-call streaming USDC payments. Each Cadence claim signed by
   │     the principal includes the mandate ID; service-side middleware
   │     can verify the mandate is active before honoring the claim.
   │
   ├─→ Crucible (github.com/Ccheh/crucible)
   │     Per-call quality attestation. ServiceReputation events index
   │     by mandate ID, so the institution's reputation accumulates
   │     across all agents acting under any of its mandates.
   │
   ├─→ Helm (github.com/Ccheh/helm)
   │     Group decisions. Institutions co-managing a treasury can use
   │     futarchy to decide whether to grant or extend a mandate.
   │
   └─→ Mandate (this repo)
         The root permission layer. All execute() calls produce a
         structured audit trail directly traceable to the issuing
         institution.
```

**Before Mandate**: Cadence, Crucible, Helm are three independent agent-economy
protocols. The composition is bottom-up (each protocol gets used directly).

**With Mandate**: institutions can deploy agents that use all three with a
single root of attribution. The composition becomes top-down (institution →
mandate → agent → leaf action). This is the institutional missing piece.

---

## v0 scope

What's in v0:

- `Mandate.sol` — single-contract implementation (243 LOC including comments)
- `IMandate.sol` — interface + events + errors
- `Mandate.t.sol` — 43 forge tests covering happy paths, reverts, multi-mandate isolation, capability checks, Merkle proof verification (incl. tag forgery), and a full end-to-end lifecycle test.
- OpenZeppelin `ReentrancyGuard` + `MerkleProof` (audited)
- Single-contract design — all mandates share one address. Per-mandate accounting via mappings.

What's deferred to v0.2:

- **Daily / per-tx caps.** v0 has total-ceiling only.
- **Capability bits beyond BIT_TRANSFER.** Cadence / Crucible / Helm capability bits ship when those integrations are wired.
- **Encrypted metadata SDK.** v0 emits the `encryptedMetadata` field in events; SDK helpers for encrypting to the auditor's view key (libsodium-compatible threshold scheme) come in v0.2.
- **TypeScript SDK (`@mandate/sdk`).** v0 is just the contract + tests. SDK matches the pattern from `@helm/sdk` once the contract API is stable.
- **Multi-sig issuer SDK.** Most real issuers are 2-of-3 or 3-of-5 multi-sigs. v0.2 ships helpers for proposing/signing/executing issuance through Gnosis Safe-style multi-sigs.
- **ERC-8004 reputation linkage.** Once the standard's reference is stable, the Mandate struct gains an `agentIdentityRef` field linking to the ERC-8004 record.
- **Force-revoke fallback.** Emergency revocation by a backup signer if the primary issuer keys are lost.

---

## Reproducing the tests

```sh
cd contracts
forge test
```

Expected: `43 passed; 0 failed`.

### Adversarial tests included

- `test_execute_revertsForgedCounterpartyTag` — principal cannot reuse a known-good `tag` for a different `to` address. The merkle leaf pins `(tag, address)` together.
- `test_execute_revertsAfterRevoke` — principal action immediately blocked on issuer's revoke.
- `test_revoke_revertsNotIssuer` — only issuer can revoke.
- `test_topUp_revertsOverCeiling` — funded total can never exceed declared ceiling.
- `test_withdraw_revertsActiveAndUnexpired` — issuer cannot drain a mandate that's still active and not expired.
- `test_multiMandate_oneRevokeDoesntAffectOther` — mandates are independent.

---

## Honest limits

If you are evaluating Mandate for any actual integration, read this carefully.

- **v0, pre-audit, pre-deployment.** No on-chain deployment yet. 43 forge tests pass. No external review. Treat as research code.
- **No production adopters.** Zero institutions have integrated this. The thesis is that institutions will need this primitive as they deploy AI agents on Arc; the thesis might be wrong.
- **Encrypted metadata is application-layer.** The contract emits whatever bytes the principal passes. There is no on-chain enforcement that the bytes are well-formed encrypted metadata, or that the auditor view key is correct. v0.2 SDK will provide the canonical encryption scheme; v0 is bring-your-own-crypto.
- **Merkle whitelist size assumptions.** The merkle root is set at issue time and immutable. For institutions with rotating counterparty lists (e.g., a payment processor that adds 100 new merchants/week), this is too rigid. v0.2 should add a `setMerkleRoot` flow gated by a separate `BIT_ROTATE` capability the issuer can hold themselves.
- **Single-tier issuer.** Only the original issuer can topUp / revoke / withdraw. No delegation, no role hierarchy, no "compliance officer can revoke but not topUp" patterns. v0.2 work.
- **Native USDC only.** v0 holds Arc-native USDC (18 decimals). For multi-asset mandates (e.g., USDC + EURC + tokenized treasuries), an ERC-20-aware variant is v0.3+.
- **No on-chain link to ERC-8004 yet.** The `principal` is just an address. A real institution would want to issue a mandate against a verified agent identity (ERC-8004 record). Will be added once 8004 reference implementation stabilizes.
- **Arc-specific.** Mandate uses USDC as native gas, which only Arc and similar chains provide. On other chains, the contract would need an `IERC20 token` constructor parameter and `approve`/`transferFrom` semantics. The mechanism is portable; the implementation isn't.

---

## Why this protocol, why now

The author ([Zen Chen](https://github.com/Ccheh)) previously worked on
crypto-asset audits at a traditional fund. The number-one pain in that work
was attribution: knowing that an on-chain transaction happened was easy;
explaining what it was *for*, *to whom*, *under what authority* — that
required reconstructing a story from email threads, spreadsheets, and a
client's recollection. Bridging that gap with a primitive that institutions
can deploy without rewriting their compliance stack is the kind of work
Arc's L1 thesis specifically enables and Circle's official Agent Wallets
(single-tenant, not multi-tenant authorization) do not yet provide.

This protocol is the application-layer answer to the five reasons Arc had
to be its own L1 — closed-loop attribution, deterministic settlement,
compliance interfaces, configurable privacy, and controllable gas — built
on the assumption that Arc gets those L1-level capabilities right and
institutions need somewhere to land.

---

## Repository layout

```
contracts/src/
├── Mandate.sol                      — core capability + settlement contract
└── interfaces/IMandate.sol          — interface, events, errors

contracts/test/
└── Mandate.t.sol                    — 43 forge tests
```

---

## License

[MIT](LICENSE)

## Author

[Zen Chen](https://github.com/Ccheh) — MSc Data Science (Sheffield). Built on Arc.
