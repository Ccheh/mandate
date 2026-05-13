/**
 * End-to-end Mandate v0 lifecycle on Arc Testnet via @mandate/sdk.
 *
 *   1. Issuer (MAIN_PK) issues a mandate authorizing SERVICE_PK to spend up
 *      to 0.01 USDC, only to one whitelisted vendor, only for `SCVE` (services).
 *      Initial funding: 0.005 USDC.
 *   2. Issuer tops up another 0.003 USDC.
 *   3. Principal executes a 0.001 USDC transfer to vendor with purpose=SCVE.
 *   4. Issuer revokes.
 *   5. Issuer withdraws remaining funds (0.007 USDC: 0.005 + 0.003 - 0.001).
 *
 * All actions emit structured events the AuditorClient can ingest.
 * Roughly 5 on-chain txs, total cost a fraction of 1 USDC of gas.
 */

import { parseEther, formatEther, type Hex } from "viem";
import {
  IssuerClient,
  PrincipalClient,
  AuditorClient,
  MANDATE_ARC_TESTNET,
  ARC_TESTNET,
  Capability,
  buildCounterpartyTree,
  buildPurposeTree,
  labelToBytes32,
} from "../src/index.js";

// ---------- env ----------
process.loadEnvFile("D:\\桌面\\arc\\.env");

const ISSUER_PK = process.env.PRIVATE_KEY as Hex;
const PRINCIPAL_PK = process.env.SERVICE_PRIVATE_KEY as Hex;
if (!ISSUER_PK || !PRINCIPAL_PK) {
  throw new Error("Missing PRIVATE_KEY / SERVICE_PRIVATE_KEY in .env");
}

const MANDATE = MANDATE_ARC_TESTNET.mandate;
const EXPLORER = ARC_TESTNET.explorer;

// Vendor address that will receive the mandate spend (doesn't need to be funded;
// just needs to exist as an address). Using a deterministic address here.
const VENDOR: Hex = "0xc0ffee00c0ffee00c0ffee00c0ffee00c0ffee00";

// ---------- clients ----------
const issuer    = new IssuerClient({    privateKey: ISSUER_PK,    mandateAddress: MANDATE });
const principal = new PrincipalClient({ privateKey: PRINCIPAL_PK, mandateAddress: MANDATE });
const auditor   = new AuditorClient({                              mandateAddress: MANDATE });

console.log(`ISSUER    : ${issuer.address}`);
console.log(`PRINCIPAL : ${principal.address}`);
console.log(`VENDOR    : ${VENDOR}\n`);

// ---------- build whitelists ----------
const TAG_OFFICIAL = labelToBytes32("VENDOR_OFFICIAL");
const P_SERVICES = labelToBytes32("SCVE");
const P_GOODS = labelToBytes32("GDDS");  // included to demonstrate a multi-purpose tree

const cpTree = buildCounterpartyTree([
  { tag: TAG_OFFICIAL, address: VENDOR },
]);
const purposeTree = buildPurposeTree([P_SERVICES, P_GOODS]);

console.log(`Counterparty Merkle root: ${cpTree.root}`);
console.log(`Purpose Merkle root:      ${purposeTree.root}\n`);

// ---------- step 1: issue ----------
const now = BigInt(Math.floor(Date.now() / 1000));
console.log(`Step 1: ISSUER issues mandate (ceiling=0.01 USDC, funded=0.005, 1h validity)`);
const { txHash: issueTx, mandateId } = await issuer.issue(
  {
    principal: principal.address,
    capabilityBitmap: Capability.TRANSFER,
    spendCeiling: parseEther("0.01"),
    counterpartyMerkleRoot: cpTree.root,
    purposeMerkleRoot: purposeTree.root,
    validFrom: now,
    validUntil: now + 3600n,
    auditViewKeyHolder: issuer.address,  // for this demo issuer holds its own view key
  },
  parseEther("0.005"),  // initial funding
);
console.log(`  issue tx:  ${EXPLORER}/tx/${issueTx}`);
console.log(`  mandateId: ${mandateId}\n`);

// ---------- step 2: top up ----------
console.log(`Step 2: ISSUER tops up another 0.003 USDC`);
const topUpTx = await issuer.topUp(mandateId, parseEther("0.003"));
console.log(`  topUp tx: ${EXPLORER}/tx/${topUpTx}\n`);

// ---------- step 3: execute ----------
console.log(`Step 3: PRINCIPAL spends 0.001 USDC to VENDOR (purpose=SCVE)`);
const cpWitness = cpTree.witnesses[0]!;        // (TAG_OFFICIAL, VENDOR)
const ppWitness = purposeTree.witnesses[0]!;   // SCVE
const exec = await principal.execute(
  mandateId,
  cpWitness,
  ppWitness,
  parseEther("0.001"),
  "0x",  // no encrypted metadata in this demo
);
console.log(`  execute tx: ${EXPLORER}/tx/${exec.txHash}`);
console.log(`  actionId:   ${exec.actionId}`);
console.log(`  newSpent:   ${formatEther(exec.newSpent)} USDC\n`);

// ---------- step 4: revoke ----------
console.log(`Step 4: ISSUER revokes mandate`);
const revokeTx = await issuer.revoke(mandateId);
console.log(`  revoke tx: ${EXPLORER}/tx/${revokeTx}\n`);

// ---------- step 5: withdraw remaining ----------
console.log(`Step 5: ISSUER withdraws remaining funds`);
const m = await issuer.getMandate(mandateId);
const reclaimable = m.funded - m.spent;
console.log(`  reclaimable: ${formatEther(reclaimable)} USDC`);
const withdrawTx = await issuer.withdraw(mandateId, reclaimable);
console.log(`  withdraw tx: ${EXPLORER}/tx/${withdrawTx}\n`);

// ---------- step 6: auditor view ----------
console.log(`Step 6: AUDITOR reads the structured audit trail`);
// Use the issue tx's block as a starting filter; getLogs gets all MandateAction
// events for this mandateId since then.
const issueRcpt = await issuer.publicClient.getTransactionReceipt({ hash: issueTx });
const actions = await auditor.listActions(mandateId, issueRcpt.blockNumber);
console.log(`  ${actions.length} MandateAction event(s) for this mandate:`);
for (const a of actions) {
  console.log(`    to=${a.to.slice(0, 10)}... amount=${formatEther(a.amount)} USDC purpose=${a.purposeCode.slice(0, 10)}... block=${a.blockNumber}`);
}

const byCp = await auditor.summarizeByCounterparty(mandateId, issueRcpt.blockNumber);
console.log(`  per-counterparty summary:`);
for (const [addr, sum] of byCp) {
  console.log(`    ${addr}: ${formatEther(sum.totalAmount)} USDC across ${sum.actionCount} action(s)`);
}

console.log(`\n================== SUMMARY ==================`);
console.log(`Full Mandate v0 lifecycle executed on Arc Testnet via @mandate/sdk:`);
console.log(`  - issue:    ${issueTx}`);
console.log(`  - topUp:    ${topUpTx}`);
console.log(`  - execute:  ${exec.txHash}  (vendor received ${formatEther(parseEther("0.001"))} USDC)`);
console.log(`  - revoke:   ${revokeTx}`);
console.log(`  - withdraw: ${withdrawTx}  (issuer reclaimed ${formatEther(reclaimable)} USDC)`);
console.log(`\nNet flow: 0.008 USDC funded → 0.001 to vendor + 0.007 returned to issuer.`);
console.log(`Audit trail: 1 MandateAction event tying issuer → mandate → principal → vendor → purpose.`);
console.log(`Verifiable: ${EXPLORER}/address/${MANDATE}#events`);
