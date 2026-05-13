import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import type { CounterpartyEntry } from "./types.js";

/**
 * On-chain mandateId derivation:
 *   keccak256(abi.encode(issuer, postIncrementedCount, chainId))
 * Useful for pre-computing the id before the issue tx returns.
 */
export function deriveMandateId(issuer: Hex, issueCount: bigint, chainId: number | bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
      [issuer, issueCount, BigInt(chainId)],
    ),
  );
}

/**
 * Encode a counterparty whitelist leaf.
 * MUST match `Mandate.sol::counterpartyLeaf(tag, addr)` byte-for-byte:
 *   keccak256(abi.encode(tag, addr))
 */
export function counterpartyLeaf(tag: Hex, addr: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [tag, addr]),
  );
}

/**
 * Encode a purpose whitelist leaf.
 * MUST match `Mandate.sol::purposeLeaf(purposeCode)` byte-for-byte:
 *   keccak256(abi.encode(purposeCode))
 */
export function purposeLeaf(purposeCode: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }], [purposeCode]));
}

/**
 * Build a sorted-pair Merkle tree compatible with OpenZeppelin's
 * `MerkleProof.verify` (which the on-chain contract uses). The hash of a
 * parent is `keccak256(sortedConcat(left, right))`.
 *
 * Returns `{ root, proof(leafIndex) }`. The proof function returns the
 * sibling hashes needed for verification.
 *
 * Handles the single-leaf edge case by returning the leaf as the root and
 * an empty proof.
 */
export function buildMerkleTree(leaves: Hex[]): {
  root: Hex;
  proof: (leafIndex: number) => Hex[];
} {
  if (leaves.length === 0) {
    return { root: ("0x" + "00".repeat(32)) as Hex, proof: () => [] };
  }
  if (leaves.length === 1) {
    const root = leaves[0]!;
    return {
      root,
      proof: (i: number) => {
        if (i !== 0) throw new Error(`leafIndex out of range: ${i}`);
        return [];
      },
    };
  }

  // Build layered tree, padding odd layers by reusing the last element.
  const layers: Hex[][] = [leaves.slice()];
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const a = prev[i]!;
      const b = i + 1 < prev.length ? prev[i + 1]! : a;
      next.push(sortedPairHash(a, b));
    }
    layers.push(next);
  }

  const root = layers[layers.length - 1]![0]!;

  return {
    root,
    proof: (leafIndex: number): Hex[] => {
      if (leafIndex < 0 || leafIndex >= leaves.length) {
        throw new Error(`leafIndex out of range: ${leafIndex}`);
      }
      const out: Hex[] = [];
      let idx = leafIndex;
      for (let layer = 0; layer < layers.length - 1; layer++) {
        const cur = layers[layer]!;
        const siblingIdx = idx ^ 1;
        if (siblingIdx < cur.length) out.push(cur[siblingIdx]!);
        idx = idx >> 1;
      }
      return out;
    },
  };
}

function sortedPairHash(a: Hex, b: Hex): Hex {
  // OpenZeppelin sorts numerically before concatenation.
  const aFirst = BigInt(a) < BigInt(b);
  return keccak256(("0x" + (aFirst ? a.slice(2) + b.slice(2) : b.slice(2) + a.slice(2))) as Hex);
}

/**
 * Convenience: build the counterparty Merkle tree from a list of entries.
 * Returns `{ root, witnesses }` where each witness has the `(tag, address, proof)`
 * the principal needs to call execute().
 */
export function buildCounterpartyTree(entries: CounterpartyEntry[]) {
  const leaves = entries.map(e => counterpartyLeaf(e.tag, e.address));
  const { root, proof } = buildMerkleTree(leaves);
  const witnesses = entries.map((e, i) => ({ tag: e.tag, address: e.address, proof: proof(i) }));
  return { root, witnesses };
}

/**
 * Convenience: build the purpose Merkle tree from a list of purpose codes.
 */
export function buildPurposeTree(purposeCodes: Hex[]) {
  const leaves = purposeCodes.map(p => purposeLeaf(p));
  const { root, proof } = buildMerkleTree(leaves);
  const witnesses = purposeCodes.map((p, i) => ({ purposeCode: p, proof: proof(i) }));
  return { root, witnesses };
}

/**
 * Convert a short ASCII label (e.g. "VENDOR_OFFICIAL") into bytes32. Same
 * as Solidity's `bytes32("VENDOR_OFFICIAL")` — left-pads to 32 bytes.
 */
export function labelToBytes32(label: string): Hex {
  if (label.length > 32) throw new Error(`label too long: ${label.length} > 32`);
  const hex = stringToHex(label);  // right-padded short hex
  return (hex + "00".repeat(32 - (hex.length - 2) / 2)) as Hex;
}
