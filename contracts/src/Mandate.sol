// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";
import {IMandate} from "./interfaces/IMandate.sol";

/// @title  Mandate — institutional × agent authorization layer (v0)
/// @notice See IMandate.sol for the full interface specification.
///
/// @dev    Single-contract design. The Mandate contract holds USDC for ALL
///         active mandates (per-mandate accounting via mappings) so issuers
///         do not pay a per-mandate deployment cost. Each mandate has its own
///         independent funded / spent counters and capability flags.
///
///         Two write surfaces:
///           - Issuer surface: issue / topUp / revoke / withdraw
///           - Principal surface: execute
///
///         No admin keys, no upgrade proxy, no protocol fees in v0.
///         MerkleProof is OpenZeppelin's audited library.
contract Mandate is IMandate, ReentrancyGuard {
    /* ------------------------------------------------------------------- */
    /*                              constants                              */
    /* ------------------------------------------------------------------- */

    /// @notice Capability bitmap bit 0 — allows `execute(transfer)` calls.
    ///         v0 requires this bit to be set on every mandate. Bits 1-31 are
    ///         reserved for v0.2+ capabilities (Cadence, Crucible, Helm bits).
    uint32 public constant BIT_TRANSFER = 1 << 0;

    /// @notice Minimum executable transfer amount. Filters dust and protects
    ///         per-action gas accounting. 0.0001 USDC (18 decimals on Arc).
    uint256 public constant MIN_EXECUTE_AMOUNT = 0.0001 ether;

    /* ------------------------------------------------------------------- */
    /*                              storage                                */
    /* ------------------------------------------------------------------- */

    /// @notice mandateId => Mandate
    mapping(bytes32 => Mandate) public mandates;

    /// @notice Monotonic counter for deterministic id derivation.
    uint256 public issueCount;

    /* ------------------------------------------------------------------- */
    /*                              issue                                  */
    /* ------------------------------------------------------------------- */

    /// @inheritdoc IMandate
    function issue(
        address principal,
        uint32  capabilityBitmap,
        uint256 spendCeiling,
        bytes32 counterpartyMerkleRoot,
        bytes32 purposeMerkleRoot,
        uint64  validFrom,
        uint64  validUntil,
        address auditViewKeyHolder
    ) external payable nonReentrant returns (bytes32 mandateId) {
        if (principal == address(0)) revert ZeroAddress();
        if (capabilityBitmap & BIT_TRANSFER == 0) revert InvalidCapability();
        if (validUntil <= validFrom) revert InvalidTimes();
        if (validUntil <= block.timestamp) revert InvalidTimes();
        if (spendCeiling == 0) revert ZeroAmount();
        if (msg.value > spendCeiling) revert CeilingExceeded();

        unchecked { issueCount++; }
        mandateId = keccak256(abi.encode(msg.sender, issueCount, block.chainid));

        if (mandates[mandateId].status != Status.None) revert AlreadyExists();

        mandates[mandateId] = Mandate({
            issuer:                  msg.sender,
            principal:               principal,
            capabilityBitmap:        capabilityBitmap,
            spendCeiling:            spendCeiling,
            spent:                   0,
            funded:                  msg.value,
            counterpartyMerkleRoot:  counterpartyMerkleRoot,
            purposeMerkleRoot:       purposeMerkleRoot,
            validFrom:               validFrom,
            validUntil:              validUntil,
            auditViewKeyHolder:      auditViewKeyHolder,
            status:                  Status.Active
        });

        emit MandateIssued(
            mandateId,
            msg.sender,
            principal,
            capabilityBitmap,
            spendCeiling,
            counterpartyMerkleRoot,
            purposeMerkleRoot,
            validFrom,
            validUntil
        );
        if (msg.value > 0) emit MandateFunded(mandateId, msg.sender, msg.value, msg.value);
    }

    /* ------------------------------------------------------------------- */
    /*                              topUp                                  */
    /* ------------------------------------------------------------------- */

    /// @inheritdoc IMandate
    function topUp(bytes32 mandateId) external payable nonReentrant {
        Mandate storage m = mandates[mandateId];
        if (m.status != Status.Active) revert NotActive();
        if (msg.sender != m.issuer) revert NotIssuer();
        if (msg.value == 0) revert ZeroAmount();
        if (m.funded + msg.value > m.spendCeiling) revert CeilingExceeded();

        m.funded += msg.value;
        emit MandateFunded(mandateId, msg.sender, msg.value, m.funded);
    }

    /* ------------------------------------------------------------------- */
    /*                              execute                                */
    /* ------------------------------------------------------------------- */

    /// @inheritdoc IMandate
    function execute(
        bytes32 mandateId,
        address to,
        uint256 amount,
        bytes32 purposeCode,
        bytes32 counterpartyTag,
        bytes32[] calldata counterpartyProof,
        bytes32[] calldata purposeProof,
        bytes   calldata encryptedMetadata
    ) external nonReentrant returns (bytes32 actionId) {
        Mandate storage m = mandates[mandateId];
        if (m.status != Status.Active) revert NotActive();
        if (msg.sender != m.principal) revert NotPrincipal();
        if (block.timestamp < m.validFrom) revert NotActive();
        if (block.timestamp > m.validUntil) revert NotActive();
        if (m.capabilityBitmap & BIT_TRANSFER == 0) revert InvalidCapability();
        if (amount < MIN_EXECUTE_AMOUNT) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        // Whitelist proofs. The leaf encoding uses keccak256(abi.encode(tag, addr))
        // so a single Merkle root can pin tag <-> address binding (prevents an
        // attacker from claiming a known-good tag for a different address).
        bytes32 counterpartyLeaf = keccak256(abi.encode(counterpartyTag, to));
        if (!MerkleProof.verify(counterpartyProof, m.counterpartyMerkleRoot, counterpartyLeaf)) {
            revert InvalidCounterpartyProof();
        }
        bytes32 purposeLeaf = keccak256(abi.encode(purposeCode));
        if (!MerkleProof.verify(purposeProof, m.purposeMerkleRoot, purposeLeaf)) {
            revert InvalidPurposeProof();
        }

        // Ceiling check.
        uint256 newSpent = m.spent + amount;
        if (newSpent > m.spendCeiling) revert CeilingExceeded();
        if (newSpent > m.funded) revert InsufficientFunds();

        m.spent = newSpent;

        // actionId is deterministic from mandateId + new spent counter.
        actionId = keccak256(abi.encode(mandateId, newSpent));

        emit MandateAction(
            mandateId,
            msg.sender,
            to,
            amount,
            purposeCode,
            counterpartyTag,
            newSpent,
            encryptedMetadata
        );

        // Transfer last (CEI). USDC is native gas on Arc.
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /* ------------------------------------------------------------------- */
    /*                              revoke                                 */
    /* ------------------------------------------------------------------- */

    /// @inheritdoc IMandate
    function revoke(bytes32 mandateId) external nonReentrant {
        Mandate storage m = mandates[mandateId];
        if (m.status != Status.Active) revert NotActive();
        if (msg.sender != m.issuer) revert NotIssuer();

        m.status = Status.Revoked;
        uint256 reclaimable = m.funded - m.spent;
        emit MandateRevoked(mandateId, msg.sender, reclaimable);
    }

    /* ------------------------------------------------------------------- */
    /*                              withdraw                               */
    /* ------------------------------------------------------------------- */

    /// @inheritdoc IMandate
    function withdraw(bytes32 mandateId, uint256 amount) external nonReentrant {
        Mandate storage m = mandates[mandateId];
        if (msg.sender != m.issuer) revert NotIssuer();
        if (amount == 0) revert ZeroAmount();

        // Withdrawal allowed only after revocation OR expiry. Until then funds
        // are locked behind the principal's capability.
        bool revoked = m.status == Status.Revoked;
        bool expired = block.timestamp > m.validUntil;
        if (!revoked && !expired) revert NotExpiredOrRevoked();

        uint256 available = m.funded - m.spent;
        if (amount > available) revert InsufficientFunds();

        // Mirror the spent counter — we never want spent to exceed funded.
        // Treating issuer-withdrawn-after-expiry as "spent toward issuer"
        // keeps accounting invariant clean. (Net effect: principal can never
        // execute against withdrawn funds.)
        m.spent += amount;

        if (expired && m.status == Status.Active) {
            m.status = Status.Expired;
        }

        emit MandateWithdrawn(mandateId, msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /* ------------------------------------------------------------------- */
    /*                              views                                  */
    /* ------------------------------------------------------------------- */

    /// @notice Snapshot the remaining authority on a mandate.
    function remaining(bytes32 mandateId) external view returns (
        uint256 ceilingRemaining,
        uint256 fundsAvailable,
        Status  status
    ) {
        Mandate storage m = mandates[mandateId];
        ceilingRemaining = m.spendCeiling - m.spent;
        fundsAvailable   = m.funded - m.spent;
        status           = m.status;
    }

    /// @notice Helper: pre-compute the mandateId an `issue` call would produce.
    function previewNextMandateId(address issuer) external view returns (bytes32) {
        return keccak256(abi.encode(issuer, issueCount + 1, block.chainid));
    }

    /// @notice Encode a leaf for the counterparty Merkle tree.
    ///         Off-chain tools use this to build proofs.
    function counterpartyLeaf(bytes32 tag, address addr) external pure returns (bytes32) {
        return keccak256(abi.encode(tag, addr));
    }

    /// @notice Encode a leaf for the purpose Merkle tree.
    function purposeLeaf(bytes32 purposeCode) external pure returns (bytes32) {
        return keccak256(abi.encode(purposeCode));
    }
}
