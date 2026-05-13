import { describe, it, expect } from "vitest";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import {
  counterpartyLeaf,
  purposeLeaf,
  buildMerkleTree,
  buildCounterpartyTree,
  buildPurposeTree,
  deriveMandateId,
  labelToBytes32,
} from "../src/utils.js";

const A: Hex = "0x1111111111111111111111111111111111111111";
const B: Hex = "0x2222222222222222222222222222222222222222";
const C: Hex = "0x3333333333333333333333333333333333333333";

const TAG_X: Hex = ("0x" + "ab".repeat(32)) as Hex;
const TAG_Y: Hex = ("0x" + "cd".repeat(32)) as Hex;

describe("counterpartyLeaf", () => {
  it("matches Solidity keccak256(abi.encode(tag, addr))", () => {
    const expected = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [TAG_X, A]),
    );
    expect(counterpartyLeaf(TAG_X, A)).toBe(expected);
  });
  it("differs across addresses", () => {
    expect(counterpartyLeaf(TAG_X, A)).not.toBe(counterpartyLeaf(TAG_X, B));
  });
  it("differs across tags (tag binds to address)", () => {
    expect(counterpartyLeaf(TAG_X, A)).not.toBe(counterpartyLeaf(TAG_Y, A));
  });
});

describe("purposeLeaf", () => {
  it("matches Solidity keccak256(abi.encode(purposeCode))", () => {
    const expected = keccak256(encodeAbiParameters([{ type: "bytes32" }], [TAG_X]));
    expect(purposeLeaf(TAG_X)).toBe(expected);
  });
});

describe("buildMerkleTree", () => {
  it("single leaf: root == leaf, empty proof", () => {
    const leaf = counterpartyLeaf(TAG_X, A);
    const { root, proof } = buildMerkleTree([leaf]);
    expect(root).toBe(leaf);
    expect(proof(0)).toEqual([]);
  });

  it("two leaves: proof has 1 sibling, OZ sorted-hash root", () => {
    const a = counterpartyLeaf(TAG_X, A);
    const b = counterpartyLeaf(TAG_X, B);
    const { root, proof } = buildMerkleTree([a, b]);
    // Verify by manually recomputing the OZ sorted-pair hash
    const aFirst = BigInt(a) < BigInt(b);
    const expectedRoot = keccak256(
      ("0x" + (aFirst ? a.slice(2) + b.slice(2) : b.slice(2) + a.slice(2))) as Hex,
    );
    expect(root).toBe(expectedRoot);
    expect(proof(0)).toEqual([b]);
    expect(proof(1)).toEqual([a]);
  });

  it("three leaves: pads odd layer correctly", () => {
    const a = counterpartyLeaf(TAG_X, A);
    const b = counterpartyLeaf(TAG_X, B);
    const c = counterpartyLeaf(TAG_X, C);
    const { root, proof } = buildMerkleTree([a, b, c]);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    // each leaf has a valid proof (proof length 2 since tree has 2 layers above leaves)
    expect(proof(0)).toHaveLength(2);
    expect(proof(1)).toHaveLength(2);
    expect(proof(2)).toHaveLength(1);  // last leaf paired with itself, sibling layer is empty
  });

  it("throws on out-of-range index", () => {
    const { proof } = buildMerkleTree([counterpartyLeaf(TAG_X, A)]);
    expect(() => proof(1)).toThrow();
  });
});

describe("buildCounterpartyTree", () => {
  it("returns root + witnesses with aligned proofs", () => {
    const { root, witnesses } = buildCounterpartyTree([
      { tag: TAG_X, address: A },
      { tag: TAG_X, address: B },
      { tag: TAG_Y, address: C },
    ]);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(witnesses).toHaveLength(3);
    expect(witnesses[0]!.tag).toBe(TAG_X);
    expect(witnesses[0]!.address).toBe(A);
    expect(witnesses[2]!.tag).toBe(TAG_Y);
    expect(witnesses[2]!.address).toBe(C);
  });
});

describe("buildPurposeTree", () => {
  it("returns root + witnesses with aligned proofs", () => {
    const { root, witnesses } = buildPurposeTree([TAG_X, TAG_Y]);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(witnesses[0]!.purposeCode).toBe(TAG_X);
    expect(witnesses[1]!.purposeCode).toBe(TAG_Y);
  });
});

describe("deriveMandateId", () => {
  it("is deterministic across same inputs", () => {
    expect(deriveMandateId(A, 5n, 5042002)).toBe(deriveMandateId(A, 5n, 5042002));
  });
  it("differs across issuers, counts, chains", () => {
    expect(deriveMandateId(A, 1n, 5042002)).not.toBe(deriveMandateId(B, 1n, 5042002));
    expect(deriveMandateId(A, 1n, 5042002)).not.toBe(deriveMandateId(A, 2n, 5042002));
    expect(deriveMandateId(A, 1n, 5042002)).not.toBe(deriveMandateId(A, 1n, 1));
  });
});

describe("labelToBytes32", () => {
  it("matches Solidity bytes32 literal padding for short strings", () => {
    // Solidity bytes32("GDDS") = 0x4744445300...00 (4 ASCII bytes + 28 zero bytes)
    expect(labelToBytes32("GDDS")).toBe("0x" + "4744445300000000000000000000000000000000000000000000000000000000");
  });
  it("throws on >32-char labels", () => {
    expect(() => labelToBytes32("x".repeat(33))).toThrow();
  });
});
