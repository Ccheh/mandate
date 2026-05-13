// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Mandate} from "../src/Mandate.sol";
import {IMandate} from "../src/interfaces/IMandate.sol";

contract MandateTest is Test {
    Mandate m;

    // identities
    address issuer    = makeAddr("issuer");
    address principal = makeAddr("principal");
    address vendor    = makeAddr("vendor");
    address vendor2   = makeAddr("vendor2");
    address attacker  = makeAddr("attacker");
    address auditor   = makeAddr("auditor");

    // canonical purpose codes (ISO 20022-style)
    bytes32 constant P_GOODS    = bytes32("GDDS");
    bytes32 constant P_SERVICES = bytes32("SCVE");
    bytes32 constant TAG_OFFICIAL = bytes32("VENDOR_OFFICIAL");

    // pre-computed leaves + roots for single-leaf trees
    bytes32 leafVendorOfficial;     // leaf for (TAG_OFFICIAL, vendor)
    bytes32 leafPGoods;             // leaf for P_GOODS

    // Cached BIT_TRANSFER value — reading bitTransfer is an external call
    // that would consume vm.prank, so we cache it after setup.
    uint32 bitTransfer;

    function setUp() public {
        m = new Mandate();
        bitTransfer = m.BIT_TRANSFER();
        leafVendorOfficial = keccak256(abi.encode(TAG_OFFICIAL, vendor));
        leafPGoods         = keccak256(abi.encode(P_GOODS));
        vm.deal(issuer, 100 ether);
        vm.deal(principal, 100 ether);
        vm.deal(attacker, 100 ether);
        vm.warp(1_000_000);
    }

    /* ---------- helpers ---------- */

    function _defaultIssue() internal returns (bytes32 mandateId) {
        return _issueWithCeiling(1 ether, 0.5 ether);
    }

    function _issueWithCeiling(uint256 ceiling, uint256 funded) internal returns (bytes32 mandateId) {
        vm.prank(issuer);
        mandateId = m.issue{value: funded}(
            principal,
            bitTransfer,
            ceiling,
            leafVendorOfficial,        // single-leaf tree: root == leaf
            leafPGoods,                // single-leaf tree: root == leaf
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            auditor
        );
    }

    function _exec(bytes32 mandateId, address to, uint256 amount, bytes32 tag, bytes32 purpose) internal returns (bytes32 actionId) {
        vm.prank(principal);
        actionId = m.execute(
            mandateId,
            to,
            amount,
            purpose,
            tag,
            new bytes32[](0),           // single-leaf tree → empty proof
            new bytes32[](0),
            ""
        );
    }

    /* ============================================================ */
    /*                          issue                                */
    /* ============================================================ */

    function test_issue_happyPath_fundedUpfront() public {
        bytes32 mandateId = _defaultIssue();
        (
            address iss,
            address prin,
            uint32 caps,
            uint256 ceiling,
            uint256 spent,
            uint256 funded,
            bytes32 cpRoot,
            bytes32 ppRoot,
            uint64 vFrom,
            uint64 vUntil,
            address akh,
            IMandate.Status status
        ) = m.mandates(mandateId);
        assertEq(iss, issuer);
        assertEq(prin, principal);
        assertEq(caps, bitTransfer);
        assertEq(ceiling, 1 ether);
        assertEq(spent, 0);
        assertEq(funded, 0.5 ether);
        assertEq(cpRoot, leafVendorOfficial);
        assertEq(ppRoot, leafPGoods);
        assertEq(vFrom, uint64(block.timestamp));
        assertEq(vUntil, uint64(block.timestamp + 1 days));
        assertEq(akh, auditor);
        assertEq(uint256(status), uint256(IMandate.Status.Active));
        assertEq(address(m).balance, 0.5 ether);
    }

    function test_issue_happyPath_zeroFunding() public {
        vm.prank(issuer);
        bytes32 mandateId = m.issue{value: 0}(
            principal, bitTransfer, 1 ether,
            leafVendorOfficial, leafPGoods,
            uint64(block.timestamp), uint64(block.timestamp + 1 days), auditor
        );
        (, , , , , uint256 funded, , , , , , IMandate.Status status) = m.mandates(mandateId);
        assertEq(funded, 0);
        assertEq(uint256(status), uint256(IMandate.Status.Active));
    }

    function test_issue_emitsEvent() public {
        vm.expectEmit(false, true, true, true);  // mandateId computed dynamically
        emit IMandate.MandateIssued(
            bytes32(0),  // ignored (we set first topic indicator to false)
            issuer,
            principal,
            bitTransfer,
            1 ether,
            leafVendorOfficial,
            leafPGoods,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days)
        );
        vm.prank(issuer);
        m.issue{value: 0.1 ether}(
            principal, bitTransfer, 1 ether,
            leafVendorOfficial, leafPGoods,
            uint64(block.timestamp), uint64(block.timestamp + 1 days), auditor
        );
    }

    function test_issue_revertsOnZeroPrincipal() public {
        vm.prank(issuer);
        vm.expectRevert(IMandate.ZeroAddress.selector);
        m.issue(address(0), bitTransfer, 1 ether, bytes32(0), bytes32(0),
                uint64(block.timestamp), uint64(block.timestamp + 1 days), auditor);
    }

    function test_issue_revertsOnZeroCapability() public {
        vm.prank(issuer);
        vm.expectRevert(IMandate.InvalidCapability.selector);
        m.issue(principal, 0, 1 ether, bytes32(0), bytes32(0),
                uint64(block.timestamp), uint64(block.timestamp + 1 days), auditor);
    }

    function test_issue_revertsOnZeroCeiling() public {
        vm.prank(issuer);
        vm.expectRevert(IMandate.ZeroAmount.selector);
        m.issue(principal, bitTransfer, 0, bytes32(0), bytes32(0),
                uint64(block.timestamp), uint64(block.timestamp + 1 days), auditor);
    }

    function test_issue_revertsOnInvalidTimes_pastEnd() public {
        vm.prank(issuer);
        vm.expectRevert(IMandate.InvalidTimes.selector);
        m.issue(principal, bitTransfer, 1 ether, bytes32(0), bytes32(0),
                uint64(block.timestamp), uint64(block.timestamp - 1), auditor);
    }

    function test_issue_revertsOnInvalidTimes_endInPast() public {
        vm.warp(100_000);
        vm.prank(issuer);
        vm.expectRevert(IMandate.InvalidTimes.selector);
        m.issue(principal, bitTransfer, 1 ether, bytes32(0), bytes32(0),
                uint64(50_000), uint64(99_999), auditor);
    }

    function test_issue_revertsOnFundingOverCeiling() public {
        vm.prank(issuer);
        vm.expectRevert(IMandate.CeilingExceeded.selector);
        m.issue{value: 2 ether}(
            principal, bitTransfer, 1 ether,
            bytes32(0), bytes32(0),
            uint64(block.timestamp), uint64(block.timestamp + 1 days), auditor
        );
    }

    function test_issue_uniqueIdsAcrossManyIssues() public {
        bytes32 a = _defaultIssue();
        bytes32 b = _defaultIssue();
        bytes32 c = _defaultIssue();
        assertTrue(a != b);
        assertTrue(b != c);
        assertTrue(a != c);
    }

    /* ============================================================ */
    /*                          topUp                                */
    /* ============================================================ */

    function test_topUp_happyPath() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        m.topUp{value: 0.2 ether}(mid);
        (, , , , , uint256 funded, , , , , ,) = m.mandates(mid);
        assertEq(funded, 0.7 ether);
    }

    function test_topUp_revertsNotIssuer() public {
        bytes32 mid = _defaultIssue();
        vm.prank(attacker);
        vm.deal(attacker, 1 ether);
        vm.expectRevert(IMandate.NotIssuer.selector);
        m.topUp{value: 0.1 ether}(mid);
    }

    function test_topUp_revertsNotActive() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        m.revoke(mid);
        vm.prank(issuer);
        vm.expectRevert(IMandate.NotActive.selector);
        m.topUp{value: 0.1 ether}(mid);
    }

    function test_topUp_revertsOverCeiling() public {
        bytes32 mid = _issueWithCeiling(1 ether, 0.8 ether);
        vm.prank(issuer);
        vm.expectRevert(IMandate.CeilingExceeded.selector);
        m.topUp{value: 0.3 ether}(mid);  // 0.8 + 0.3 > 1
    }

    function test_topUp_revertsZeroAmount() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        vm.expectRevert(IMandate.ZeroAmount.selector);
        m.topUp{value: 0}(mid);
    }

    /* ============================================================ */
    /*                          execute                              */
    /* ============================================================ */

    function test_execute_happyPath() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        uint256 vendorBefore = vendor.balance;
        bytes32 actionId = _exec(mid, vendor, 0.1 ether, TAG_OFFICIAL, P_GOODS);
        assertEq(vendor.balance - vendorBefore, 0.1 ether);
        (, , , , uint256 spent, , , , , , ,) = m.mandates(mid);
        assertEq(spent, 0.1 ether);
        assertTrue(actionId != bytes32(0));
    }

    function test_execute_multipleAccumulate() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        _exec(mid, vendor, 0.1 ether, TAG_OFFICIAL, P_GOODS);
        _exec(mid, vendor, 0.2 ether, TAG_OFFICIAL, P_GOODS);
        _exec(mid, vendor, 0.3 ether, TAG_OFFICIAL, P_GOODS);
        (, , , , uint256 spent, , , , , , ,) = m.mandates(mid);
        assertEq(spent, 0.6 ether);
        assertEq(vendor.balance, 0.6 ether);
    }

    function test_execute_revertsNotPrincipal() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(attacker);
        vm.expectRevert(IMandate.NotPrincipal.selector);
        m.execute(mid, vendor, 0.1 ether, P_GOODS, TAG_OFFICIAL, new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsWrongCounterparty() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(principal);
        vm.expectRevert(IMandate.InvalidCounterpartyProof.selector);
        m.execute(mid, vendor2, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsForgedCounterpartyTag() public {
        // Attacker tries to use OFFICIAL tag against a different (vendor2) address.
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(principal);
        vm.expectRevert(IMandate.InvalidCounterpartyProof.selector);
        m.execute(mid, vendor2, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsWrongPurpose() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(principal);
        vm.expectRevert(IMandate.InvalidPurposeProof.selector);
        m.execute(mid, vendor, 0.1 ether, P_SERVICES, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsOverCeiling() public {
        bytes32 mid = _issueWithCeiling(0.1 ether, 0.1 ether);
        vm.prank(principal);
        vm.expectRevert(IMandate.CeilingExceeded.selector);
        m.execute(mid, vendor, 0.2 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsInsufficientFunds_belowCeilingButOverFunded() public {
        // ceiling = 1 ether, funded only 0.2 ether → ceiling not breached but funds short.
        bytes32 mid = _issueWithCeiling(1 ether, 0.2 ether);
        vm.prank(principal);
        vm.expectRevert(IMandate.InsufficientFunds.selector);
        m.execute(mid, vendor, 0.3 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsBelowMin() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(principal);
        vm.expectRevert(IMandate.ZeroAmount.selector);
        m.execute(mid, vendor, 0.00001 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsAfterRevoke() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(issuer);
        m.revoke(mid);
        vm.prank(principal);
        vm.expectRevert(IMandate.NotActive.selector);
        m.execute(mid, vendor, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsBeforeValidFrom() public {
        vm.prank(issuer);
        bytes32 mid = m.issue{value: 1 ether}(
            principal, bitTransfer, 1 ether,
            leafVendorOfficial, leafPGoods,
            uint64(block.timestamp + 100), uint64(block.timestamp + 200), auditor
        );
        vm.prank(principal);
        vm.expectRevert(IMandate.NotActive.selector);
        m.execute(mid, vendor, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_revertsAfterValidUntil() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(principal);
        vm.expectRevert(IMandate.NotActive.selector);
        m.execute(mid, vendor, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    function test_execute_emitsStructuredEvent() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.expectEmit(true, true, true, true);
        emit IMandate.MandateAction(
            mid,
            principal,
            vendor,
            0.1 ether,
            P_GOODS,
            TAG_OFFICIAL,
            0.1 ether,
            hex"deadbeef"
        );
        vm.prank(principal);
        m.execute(mid, vendor, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), hex"deadbeef");
    }

    /* ============================================================ */
    /*                          revoke                               */
    /* ============================================================ */

    function test_revoke_happyPath() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        m.revoke(mid);
        (, , , , , , , , , , , IMandate.Status status) = m.mandates(mid);
        assertEq(uint256(status), uint256(IMandate.Status.Revoked));
    }

    function test_revoke_revertsNotIssuer() public {
        bytes32 mid = _defaultIssue();
        vm.prank(attacker);
        vm.expectRevert(IMandate.NotIssuer.selector);
        m.revoke(mid);
    }

    function test_revoke_revertsAlreadyRevoked() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        m.revoke(mid);
        vm.prank(issuer);
        vm.expectRevert(IMandate.NotActive.selector);
        m.revoke(mid);
    }

    function test_revoke_principalImmediatelyBlocked() public {
        bytes32 mid = _issueWithCeiling(1 ether, 1 ether);
        vm.prank(issuer);
        m.revoke(mid);
        vm.prank(principal);
        vm.expectRevert(IMandate.NotActive.selector);
        m.execute(mid, vendor, 0.1 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");
    }

    /* ============================================================ */
    /*                          withdraw                             */
    /* ============================================================ */

    function test_withdraw_happyPathAfterRevoke() public {
        bytes32 mid = _issueWithCeiling(1 ether, 0.6 ether);
        _exec(mid, vendor, 0.2 ether, TAG_OFFICIAL, P_GOODS);
        vm.prank(issuer);
        m.revoke(mid);
        uint256 before_ = issuer.balance;
        vm.prank(issuer);
        m.withdraw(mid, 0.4 ether);
        assertEq(issuer.balance - before_, 0.4 ether);
    }

    function test_withdraw_happyPathAfterExpire() public {
        bytes32 mid = _issueWithCeiling(1 ether, 0.5 ether);
        vm.warp(block.timestamp + 2 days);
        uint256 before_ = issuer.balance;
        vm.prank(issuer);
        m.withdraw(mid, 0.5 ether);
        assertEq(issuer.balance - before_, 0.5 ether);
    }

    function test_withdraw_revertsNotIssuer() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        m.revoke(mid);
        vm.prank(attacker);
        vm.expectRevert(IMandate.NotIssuer.selector);
        m.withdraw(mid, 0.1 ether);
    }

    function test_withdraw_revertsActiveAndUnexpired() public {
        bytes32 mid = _defaultIssue();
        vm.prank(issuer);
        vm.expectRevert(IMandate.NotExpiredOrRevoked.selector);
        m.withdraw(mid, 0.1 ether);
    }

    function test_withdraw_revertsOverAvailable() public {
        bytes32 mid = _issueWithCeiling(1 ether, 0.5 ether);
        vm.prank(issuer);
        m.revoke(mid);
        vm.prank(issuer);
        vm.expectRevert(IMandate.InsufficientFunds.selector);
        m.withdraw(mid, 0.6 ether);
    }

    /* ============================================================ */
    /*                      multi-mandate isolation                  */
    /* ============================================================ */

    function test_multiMandate_independentSpendCounters() public {
        bytes32 a = _issueWithCeiling(0.5 ether, 0.5 ether);
        bytes32 b = _issueWithCeiling(0.5 ether, 0.5 ether);
        _exec(a, vendor, 0.3 ether, TAG_OFFICIAL, P_GOODS);
        _exec(b, vendor, 0.1 ether, TAG_OFFICIAL, P_GOODS);
        (, , , , uint256 spentA, , , , , , ,) = m.mandates(a);
        (, , , , uint256 spentB, , , , , , ,) = m.mandates(b);
        assertEq(spentA, 0.3 ether);
        assertEq(spentB, 0.1 ether);
        assertEq(vendor.balance, 0.4 ether);
    }

    function test_multiMandate_oneRevokeDoesntAffectOther() public {
        bytes32 a = _issueWithCeiling(0.5 ether, 0.5 ether);
        bytes32 b = _issueWithCeiling(0.5 ether, 0.5 ether);
        vm.prank(issuer);
        m.revoke(a);
        // b still active
        _exec(b, vendor, 0.1 ether, TAG_OFFICIAL, P_GOODS);
        assertEq(vendor.balance, 0.1 ether);
    }

    /* ============================================================ */
    /*                          views                                */
    /* ============================================================ */

    function test_view_remaining() public {
        bytes32 mid = _issueWithCeiling(1 ether, 0.7 ether);
        _exec(mid, vendor, 0.2 ether, TAG_OFFICIAL, P_GOODS);
        (uint256 ceilingRem, uint256 fundsAvail, IMandate.Status status) = m.remaining(mid);
        assertEq(ceilingRem, 0.8 ether);
        assertEq(fundsAvail, 0.5 ether);
        assertEq(uint256(status), uint256(IMandate.Status.Active));
    }

    function test_view_previewNextMandateId() public {
        bytes32 preview = m.previewNextMandateId(issuer);
        bytes32 actual = _defaultIssue();
        assertEq(preview, actual);
    }

    function test_view_leafEncoders() public view {
        assertEq(m.counterpartyLeaf(TAG_OFFICIAL, vendor), keccak256(abi.encode(TAG_OFFICIAL, vendor)));
        assertEq(m.purposeLeaf(P_GOODS), keccak256(abi.encode(P_GOODS)));
    }

    /* ============================================================ */
    /*                  end-to-end lifecycle                         */
    /* ============================================================ */

    function test_endToEnd_lifecycle() public {
        // 1. issue with $1 ceiling, $0.5 funded
        bytes32 mid = _issueWithCeiling(1 ether, 0.5 ether);

        // 2. principal spends $0.3
        _exec(mid, vendor, 0.3 ether, TAG_OFFICIAL, P_GOODS);
        assertEq(vendor.balance, 0.3 ether);

        // 3. issuer tops up another $0.4 (within ceiling)
        vm.prank(issuer);
        m.topUp{value: 0.4 ether}(mid);

        // 4. principal spends another $0.5
        _exec(mid, vendor, 0.5 ether, TAG_OFFICIAL, P_GOODS);
        assertEq(vendor.balance, 0.8 ether);

        // 5. issuer revokes
        vm.prank(issuer);
        m.revoke(mid);

        // 6. principal cannot spend more
        vm.prank(principal);
        vm.expectRevert(IMandate.NotActive.selector);
        m.execute(mid, vendor, 0.05 ether, P_GOODS, TAG_OFFICIAL,
                  new bytes32[](0), new bytes32[](0), "");

        // 7. issuer pulls back remaining 0.1 (0.5 + 0.4 - 0.8 = 0.1)
        uint256 before_ = issuer.balance;
        vm.prank(issuer);
        m.withdraw(mid, 0.1 ether);
        assertEq(issuer.balance - before_, 0.1 ether);

        // 8. remaining is now drained
        (uint256 ceilingRem, uint256 fundsAvail, IMandate.Status status) = m.remaining(mid);
        assertEq(ceilingRem, 0.1 ether); // (1.0 - 0.9 spent)
        assertEq(fundsAvail, 0);          // (0.9 funded - 0.9 spent)
        assertEq(uint256(status), uint256(IMandate.Status.Revoked));
    }
}
