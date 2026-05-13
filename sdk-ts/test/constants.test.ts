import { describe, it, expect } from "vitest";
import {
  ARC_TESTNET,
  MANDATE_ARC_TESTNET,
  MANDATE_ABI,
  Capability,
  Status,
} from "../src/index.js";

describe("constants", () => {
  it("ARC_TESTNET has the canonical chainId / RPC", () => {
    expect(ARC_TESTNET.chainId).toBe(5042002);
    expect(ARC_TESTNET.rpc).toMatch(/^https:\/\/rpc\.testnet\.arc\.network/);
    expect(ARC_TESTNET.explorer).toMatch(/^https:\/\/testnet\.arcscan\.app/);
  });

  it("Mandate v0 address + deploy tx are valid hex", () => {
    expect(MANDATE_ARC_TESTNET.mandate).toMatch(/^0x[0-9a-f]{40}$/);
    expect(MANDATE_ARC_TESTNET.deployTx).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("Capability.TRANSFER is bit 0", () => {
    expect(Capability.TRANSFER).toBe(1);
  });

  it("Status enum values match Solidity (None=0, Active=1, Revoked=2, Expired=3)", () => {
    expect(Status.None).toBe(0);
    expect(Status.Active).toBe(1);
    expect(Status.Revoked).toBe(2);
    expect(Status.Expired).toBe(3);
  });

  it("MANDATE_ABI exposes the 5 lifecycle functions", () => {
    const fns = MANDATE_ABI.filter(e => e.type === "function").map(e => e.name);
    expect(fns).toContain("issue");
    expect(fns).toContain("topUp");
    expect(fns).toContain("execute");
    expect(fns).toContain("revoke");
    expect(fns).toContain("withdraw");
  });

  it("MANDATE_ABI exposes the 5 view helpers", () => {
    const fns = MANDATE_ABI.filter(e => e.type === "function").map(e => e.name);
    expect(fns).toContain("mandates");
    expect(fns).toContain("remaining");
    expect(fns).toContain("previewNextMandateId");
    expect(fns).toContain("counterpartyLeaf");
    expect(fns).toContain("purposeLeaf");
  });

  it("MANDATE_ABI exposes the 5 events", () => {
    const events = MANDATE_ABI.filter(e => e.type === "event").map(e => e.name);
    expect(events).toContain("MandateIssued");
    expect(events).toContain("MandateFunded");
    expect(events).toContain("MandateAction");
    expect(events).toContain("MandateRevoked");
    expect(events).toContain("MandateWithdrawn");
  });
});
