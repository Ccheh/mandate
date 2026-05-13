import {
  createPublicClient,
  defineChain,
  http,
  decodeEventLog,
  parseAbiItem,
  type PublicClient,
  type Log,
} from "viem";
import { ARC_TESTNET, MANDATE_ABI, type ArcChain } from "./constants.js";
import type { Hex } from "./types.js";

export interface AuditorClientOptions {
  mandateAddress: Hex;
  chain?: ArcChain;
}

export interface DecodedAction {
  mandateId: Hex;
  principal: Hex;
  to: Hex;
  amount: bigint;
  purposeCode: Hex;
  counterpartyTag: Hex;
  newSpent: bigint;
  encryptedMetadata: Hex;
  txHash: Hex;
  blockNumber: bigint;
}

/**
 * AuditorClient — read-only ingest of mandate events for auditors, ERP
 * pipelines, AML systems, regulatory reporting. No private key required.
 *
 * v0 returns the encrypted metadata bytes as-is. Decrypting them into
 * structured invoice/journal data is application-specific; v0.2 will ship
 * a canonical (libsodium-compatible) encryption scheme.
 */
export class AuditorClient {
  readonly chain: ArcChain;
  readonly mandateAddress: Hex;
  readonly publicClient: PublicClient;

  constructor(opts: AuditorClientOptions) {
    this.chain = opts.chain ?? ARC_TESTNET;
    this.mandateAddress = opts.mandateAddress;
    const viemChain = defineChain({
      id: this.chain.chainId,
      name: "Arc Testnet",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: { default: { http: [this.chain.rpc] } },
    });
    this.publicClient = createPublicClient({
      chain: viemChain,
      transport: http(this.chain.rpc, { timeout: 60_000, retryCount: 2 }),
    });
  }

  /**
   * Fetch all MandateAction events for a mandate between two block numbers.
   *
   * NOTE: Arc Testnet RPCs sometimes cap getLogs ranges. For large ranges,
   * batch this in chunks externally.
   */
  async listActions(
    mandateId: Hex,
    fromBlock: bigint = 0n,
    toBlock: bigint | "latest" = "latest",
  ): Promise<DecodedAction[]> {
    const event = parseAbiItem(
      "event MandateAction(bytes32 indexed mandateId, address indexed principal, address indexed to, uint256 amount, bytes32 purposeCode, bytes32 counterpartyTag, uint256 newSpent, bytes encryptedMetadata)",
    );
    const logs = await this.publicClient.getLogs({
      address: this.mandateAddress,
      event,
      args: { mandateId },
      fromBlock,
      toBlock,
    });
    return logs.map((l: Log) => {
      const decoded = decodeEventLog({
        abi: MANDATE_ABI, data: l.data, topics: l.topics,
        eventName: "MandateAction",
      });
      return {
        mandateId:           decoded.args.mandateId as Hex,
        principal:           decoded.args.principal as Hex,
        to:                  decoded.args.to as Hex,
        amount:              decoded.args.amount as bigint,
        purposeCode:         decoded.args.purposeCode as Hex,
        counterpartyTag:     decoded.args.counterpartyTag as Hex,
        newSpent:            decoded.args.newSpent as bigint,
        encryptedMetadata:   decoded.args.encryptedMetadata as Hex,
        txHash:              l.transactionHash ?? ("0x" as Hex),
        blockNumber:         l.blockNumber ?? 0n,
      };
    });
  }

  /** Roll up actions into a per-counterparty summary (audit-ready). */
  async summarizeByCounterparty(
    mandateId: Hex,
    fromBlock: bigint = 0n,
  ): Promise<Map<Hex, { totalAmount: bigint; actionCount: number; lastBlock: bigint }>> {
    const actions = await this.listActions(mandateId, fromBlock);
    const out = new Map<Hex, { totalAmount: bigint; actionCount: number; lastBlock: bigint }>();
    for (const a of actions) {
      const key = a.to.toLowerCase() as Hex;
      const cur = out.get(key) ?? { totalAmount: 0n, actionCount: 0, lastBlock: 0n };
      cur.totalAmount += a.amount;
      cur.actionCount += 1;
      if (a.blockNumber > cur.lastBlock) cur.lastBlock = a.blockNumber;
      out.set(key, cur);
    }
    return out;
  }

  /** Roll up actions into a per-purpose-code summary (for AML / tax reporting). */
  async summarizeByPurpose(
    mandateId: Hex,
    fromBlock: bigint = 0n,
  ): Promise<Map<Hex, { totalAmount: bigint; actionCount: number }>> {
    const actions = await this.listActions(mandateId, fromBlock);
    const out = new Map<Hex, { totalAmount: bigint; actionCount: number }>();
    for (const a of actions) {
      const cur = out.get(a.purposeCode) ?? { totalAmount: 0n, actionCount: 0 };
      cur.totalAmount += a.amount;
      cur.actionCount += 1;
      out.set(a.purposeCode, cur);
    }
    return out;
  }
}
