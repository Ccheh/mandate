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
import type {
  Hex,
  CounterpartyWitness,
  PurposeWitness,
  ExecuteResult,
  MandateState,
} from "./types.js";

export interface PrincipalClientOptions {
  privateKey: Hex;
  mandateAddress: Hex;
  chain?: ArcChain;
}

/**
 * PrincipalClient — the agent (or human) authorized by a Mandate.
 *
 * Capabilities: execute. Cannot issue / topUp / revoke / withdraw.
 */
export class PrincipalClient {
  readonly account: Account;
  readonly chain: ArcChain;
  readonly mandateAddress: Hex;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;

  constructor(opts: PrincipalClientOptions) {
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
   * Spend `amount` USDC from `mandateId` to `cp.address`, attaching purpose +
   * optional encrypted metadata. The witnesses are typically produced by
   * `buildCounterpartyTree` / `buildPurposeTree` from utils.
   */
  async execute(
    mandateId: Hex,
    cp: CounterpartyWitness,
    pp: PurposeWitness,
    amountWei: bigint,
    encryptedMetadata: Hex = "0x",
  ): Promise<ExecuteResult> {
    const txHash = await this.walletClient.writeContract({
      account: this.account,
      chain: this.walletClient.chain!,
      address: this.mandateAddress,
      abi: MANDATE_ABI,
      functionName: "execute",
      args: [
        mandateId,
        cp.address,
        amountWei,
        pp.purposeCode,
        cp.tag,
        cp.proof,
        pp.proof,
        encryptedMetadata,
      ],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    let actionId: Hex | undefined;
    let newSpent = 0n;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.mandateAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: MANDATE_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "MandateAction") {
          newSpent = decoded.args.newSpent as bigint;
          // actionId is keccak256(mandateId, newSpent) per the contract.
          // We re-compute locally rather than decoding from logs (the contract
          // does not emit actionId as an event arg — it's only the return value).
        }
      } catch {/* not our event */}
    }
    // Re-derive actionId locally (contract computes it as keccak256(abi.encode(mandateId, newSpent)))
    const { keccak256, encodeAbiParameters } = await import("viem");
    actionId = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [mandateId, newSpent]),
    );
    return { txHash, actionId, newSpent };
  }

  /** Read-only check of the mandate state. */
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
