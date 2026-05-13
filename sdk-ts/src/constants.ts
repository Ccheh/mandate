import type { Hex } from "./types.js";

export interface ArcChain {
  chainId: number;
  rpc: string;
  explorer: string;
}

export const ARC_TESTNET: ArcChain = {
  chainId: 5042002,
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
};

/** Canonical Mandate v0 deployment on Arc Testnet. */
export const MANDATE_ARC_TESTNET = {
  mandate: "0xfbbdaec05e0061adeb955896dff183fdd412e6e4" as Hex,
  /**
   * Deploy tx for the address above. Useful for indexers anchoring
   * subscription start blocks.
   */
  deployTx: "0x10e5329de0ef0b37a36f0d9619d9c4de1e31b1aacc0a839bff650863db2f5677" as Hex,
} as const;

/** Capability bitmap bits. v0 only ships BIT_TRANSFER. */
export const Capability = {
  TRANSFER: 1 << 0,
} as const;

/** Mandate lifecycle states. Mirrors Mandate.sol's enum. */
export const Status = { None: 0, Active: 1, Revoked: 2, Expired: 3 } as const;
export type StatusName = keyof typeof Status;

export const MANDATE_ABI = [
  // ---------- write surface ----------
  {
    type: "function", name: "issue", stateMutability: "payable",
    inputs: [
      { name: "principal", type: "address" },
      { name: "capabilityBitmap", type: "uint32" },
      { name: "spendCeiling", type: "uint256" },
      { name: "counterpartyMerkleRoot", type: "bytes32" },
      { name: "purposeMerkleRoot", type: "bytes32" },
      { name: "validFrom", type: "uint64" },
      { name: "validUntil", type: "uint64" },
      { name: "auditViewKeyHolder", type: "address" },
    ],
    outputs: [{ name: "mandateId", type: "bytes32" }],
  },
  {
    type: "function", name: "topUp", stateMutability: "payable",
    inputs: [{ name: "mandateId", type: "bytes32" }], outputs: [],
  },
  {
    type: "function", name: "execute", stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "purposeCode", type: "bytes32" },
      { name: "counterpartyTag", type: "bytes32" },
      { name: "counterpartyProof", type: "bytes32[]" },
      { name: "purposeProof", type: "bytes32[]" },
      { name: "encryptedMetadata", type: "bytes" },
    ],
    outputs: [{ name: "actionId", type: "bytes32" }],
  },
  {
    type: "function", name: "revoke", stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }], outputs: [],
  },
  {
    type: "function", name: "withdraw", stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ], outputs: [],
  },

  // ---------- views ----------
  {
    type: "function", name: "mandates", stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { name: "issuer", type: "address" },
      { name: "principal", type: "address" },
      { name: "capabilityBitmap", type: "uint32" },
      { name: "spendCeiling", type: "uint256" },
      { name: "spent", type: "uint256" },
      { name: "funded", type: "uint256" },
      { name: "counterpartyMerkleRoot", type: "bytes32" },
      { name: "purposeMerkleRoot", type: "bytes32" },
      { name: "validFrom", type: "uint64" },
      { name: "validUntil", type: "uint64" },
      { name: "auditViewKeyHolder", type: "address" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "function", name: "remaining", stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { name: "ceilingRemaining", type: "uint256" },
      { name: "fundsAvailable", type: "uint256" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "function", name: "previewNextMandateId", stateMutability: "view",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "counterpartyLeaf", stateMutability: "pure",
    inputs: [{ name: "tag", type: "bytes32" }, { name: "addr", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "purposeLeaf", stateMutability: "pure",
    inputs: [{ name: "purposeCode", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function", name: "issueCount", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "BIT_TRANSFER", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "MIN_EXECUTE_AMOUNT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },

  // ---------- events ----------
  {
    type: "event", name: "MandateIssued",
    inputs: [
      { indexed: true, name: "mandateId", type: "bytes32" },
      { indexed: true, name: "issuer", type: "address" },
      { indexed: true, name: "principal", type: "address" },
      { indexed: false, name: "capabilityBitmap", type: "uint32" },
      { indexed: false, name: "spendCeiling", type: "uint256" },
      { indexed: false, name: "counterpartyMerkleRoot", type: "bytes32" },
      { indexed: false, name: "purposeMerkleRoot", type: "bytes32" },
      { indexed: false, name: "validFrom", type: "uint64" },
      { indexed: false, name: "validUntil", type: "uint64" },
    ],
  },
  {
    type: "event", name: "MandateFunded",
    inputs: [
      { indexed: true, name: "mandateId", type: "bytes32" },
      { indexed: true, name: "by", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "newFunded", type: "uint256" },
    ],
  },
  {
    type: "event", name: "MandateAction",
    inputs: [
      { indexed: true, name: "mandateId", type: "bytes32" },
      { indexed: true, name: "principal", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "purposeCode", type: "bytes32" },
      { indexed: false, name: "counterpartyTag", type: "bytes32" },
      { indexed: false, name: "newSpent", type: "uint256" },
      { indexed: false, name: "encryptedMetadata", type: "bytes" },
    ],
  },
  {
    type: "event", name: "MandateRevoked",
    inputs: [
      { indexed: true, name: "mandateId", type: "bytes32" },
      { indexed: true, name: "by", type: "address" },
      { indexed: false, name: "reclaimable", type: "uint256" },
    ],
  },
  {
    type: "event", name: "MandateWithdrawn",
    inputs: [
      { indexed: true, name: "mandateId", type: "bytes32" },
      { indexed: true, name: "by", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;
