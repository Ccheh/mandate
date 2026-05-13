export type Hex = `0x${string}`;

export interface MandateConstraints {
  principal: Hex;
  capabilityBitmap: number;
  spendCeiling: bigint;
  counterpartyMerkleRoot: Hex;
  purposeMerkleRoot: Hex;
  validFrom: bigint;
  validUntil: bigint;
  auditViewKeyHolder: Hex;
}

export interface MandateState {
  issuer: Hex;
  principal: Hex;
  capabilityBitmap: number;
  spendCeiling: bigint;
  spent: bigint;
  funded: bigint;
  counterpartyMerkleRoot: Hex;
  purposeMerkleRoot: Hex;
  validFrom: bigint;
  validUntil: bigint;
  auditViewKeyHolder: Hex;
  status: number;  // 0 None, 1 Active, 2 Revoked, 3 Expired
}

/** Single allowed counterparty in the whitelist. Tag binds to address. */
export interface CounterpartyEntry {
  tag: Hex;       // bytes32, e.g. keccak256("VENDOR_OFFICIAL") or short ASCII bytes32
  address: Hex;
}

/** Helper bundling a (tag, address, proof) for an execute call. */
export interface CounterpartyWitness {
  tag: Hex;
  address: Hex;
  proof: Hex[];
}

/** Helper bundling a (purposeCode, proof) for an execute call. */
export interface PurposeWitness {
  purposeCode: Hex;
  proof: Hex[];
}

/** Result of `execute` — actionId + tx hash for chain attribution. */
export interface ExecuteResult {
  txHash: Hex;
  actionId: Hex;
  newSpent: bigint;
}
