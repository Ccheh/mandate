import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  decodeEventLog,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_TESTNET, MANDATE_ABI, type ArcChain } from "./constants.js";
import type { Hex, MandateConstraints, MandateState } from "./types.js";

export interface IssuerClientOptions {
  privateKey: Hex;
  mandateAddress: Hex;
  chain?: ArcChain;
}

/**
 * IssuerClient — the institutional side of Mandate.
 *
 * Capabilities: issue / topUp / revoke / withdraw.
 * Cannot execute (that's the principal's role).
 */
export class IssuerClient {
  readonly account: Account;
  readonly chain: ArcChain;
  readonly mandateAddress: Hex;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;

  constructor(opts: IssuerClientOptions) {
    this.account = privateKeyToAccount(opts.privateKey);
    this.chain = opts.chain ?? ARC_TESTNET;
    this.mandateAddress = opts.mandateAddress;

    const viemChain = defineChain({
      id: this.chain.chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [this.chain.rpc] } },
    });
    const transport = http(this.chain.rpc, { timeout: 60_000, retryCount: 2 });
    this.publicClient = createPublicClient({ chain: viemChain, transport });
    this.walletClient = createWalletClient({ account: this.account, chain: viemChain, transport });
  }

  get address(): Hex {
    return this.account.address;
  }

  /**
   * Issue a new mandate. `fundingWei` is initial msg.value (can be 0n).
   * Returns the new mandateId + the on-chain tx hash.
   *
   * Robust against Arc Testnet's mempool-full / waitForReceipt-timeout
   * quirks: pre-computes the deterministic mandateId from issueCount before
   * sending the tx, so if waitForReceipt times out we can still return a
   * usable mandateId.
   */
  async issue(c: MandateConstraints, fundingWei: bigint = 0n): Promise<{ txHash: Hex; mandateId: Hex }> {
    // Pre-compute mandateId off-chain.
    const { deriveMandateId } = await import("./utils.js");
    const currentCount = await this.publicClient.readContract({
      address: this.mandateAddress, abi: MANDATE_ABI,
      functionName: "issueCount", args: [],
    }) as bigint;
    const expectedMandateId = deriveMandateId(this.account.address, currentCount + 1n, this.chain.chainId);

    const txHash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.walletClient.chain!,
      address: this.mandateAddress,
      abi: MANDATE_ABI,
      functionName: "issue",
      args: [
        c.principal,
        c.capabilityBitmap,
        c.spendCeiling,
        c.counterpartyMerkleRoot,
        c.purposeMerkleRoot,
        c.validFrom,
        c.validUntil,
        c.auditViewKeyHolder,
      ],
      value: fundingWei,
    });

    // Try waitForReceipt with a generous timeout. If it fails, return the
    // pre-computed mandateId — caller can poll on-chain state to confirm.
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash, timeout: 300_000, pollingInterval: 4_000,
      });
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== this.mandateAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: MANDATE_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "MandateIssued") {
            return { txHash, mandateId: decoded.args.mandateId as Hex };
          }
        } catch {/* not our event */}
      }
    } catch (e) {
      // Receipt timeout — but tx is signed + submitted. mandateId is already
      // deterministic. Return it and let the caller verify on-chain.
      console.warn(`[mandate] waitForReceipt timed out for issue tx ${txHash}; returning pre-computed mandateId. Caller should poll mandates(${expectedMandateId}) for confirmation.`);
    }
    return { txHash, mandateId: expectedMandateId };
  }

  /** Add funds to an active mandate. msg.value = `amountWei`. */
  async topUp(mandateId: Hex, amountWei: bigint): Promise<Hex> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.walletClient.chain!,
      address: this.mandateAddress,
      abi: MANDATE_ABI,
      functionName: "topUp",
      args: [mandateId],
      value: amountWei,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  async revoke(mandateId: Hex): Promise<Hex> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.walletClient.chain!,
      address: this.mandateAddress,
      abi: MANDATE_ABI,
      functionName: "revoke",
      args: [mandateId],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  async withdraw(mandateId: Hex, amountWei: bigint): Promise<Hex> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.walletClient.chain!,
      address: this.mandateAddress,
      abi: MANDATE_ABI,
      functionName: "withdraw",
      args: [mandateId, amountWei],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /* ---------- reads (shared with everyone) ---------- */

  async getMandate(mandateId: Hex): Promise<MandateState> {
    const r = await this.publicClient.readContract({
      address: this.mandateAddress, abi: MANDATE_ABI,
      functionName: "mandates", args: [mandateId],
    }) as readonly [Hex, Hex, number, bigint, bigint, bigint, Hex, Hex, bigint, bigint, Hex, number];
    return {
      issuer: r[0], principal: r[1], capabilityBitmap: r[2],
      spendCeiling: r[3], spent: r[4], funded: r[5],
      counterpartyMerkleRoot: r[6], purposeMerkleRoot: r[7],
      validFrom: r[8], validUntil: r[9], auditViewKeyHolder: r[10],
      status: r[11],
    };
  }
}
