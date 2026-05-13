export {
  ARC_TESTNET,
  MANDATE_ARC_TESTNET,
  MANDATE_ABI,
  Capability,
  Status,
  type ArcChain,
  type StatusName,
} from "./constants.js";

export type {
  Hex,
  MandateConstraints,
  MandateState,
  CounterpartyEntry,
  CounterpartyWitness,
  PurposeWitness,
  ExecuteResult,
} from "./types.js";

export {
  deriveMandateId,
  counterpartyLeaf,
  purposeLeaf,
  buildMerkleTree,
  buildCounterpartyTree,
  buildPurposeTree,
  labelToBytes32,
} from "./utils.js";

export { IssuerClient } from "./IssuerClient.js";
export type { IssuerClientOptions } from "./IssuerClient.js";

export { PrincipalClient } from "./PrincipalClient.js";
export type { PrincipalClientOptions } from "./PrincipalClient.js";

export { AuditorClient } from "./AuditorClient.js";
export type { AuditorClientOptions, DecodedAction } from "./AuditorClient.js";
