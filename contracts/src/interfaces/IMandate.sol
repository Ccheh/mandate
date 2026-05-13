// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title  IMandate — institutional × agent authorization layer
/// @notice A Mandate is an on-chain capability grant from an institutional
///         **issuer** (a bank, fund, corporate treasury — typically a multi-sig)
///         to a **principal** (an AI agent, a human operator, a smart contract)
///         authorizing the principal to spend up to a fixed USDC ceiling from
///         the mandate's internal pool, but **only** to whitelisted
///         counterparties and for whitelisted purpose codes.
///
///         The mandate is the root of attribution for every action taken under
///         it. Every `execute` emits a structured `MandateAction` event that
///         downstream protocols (Cadence claims, Crucible markets, Helm bets,
///         AML systems, ERP ingest pipelines) can subscribe to.
///
/// @dev    No admin keys. Issuer cannot mutate a mandate post-issue except via
///         `revoke`. Principal cannot upgrade their own capabilities. The
///         contract holds USDC in its own balance per mandate (Arc native USDC
///         used as msg.value).
interface IMandate {
    /// @notice Mandate lifecycle states.
    enum Status { None, Active, Revoked, Expired }

    /// @notice Mandate full struct.
    struct Mandate {
        address issuer;                  // institution (typically multi-sig)
        address principal;               // authorized agent / human
        uint32  capabilityBitmap;        // current v0: BIT_TRANSFER must be set
        uint256 spendCeiling;            // hard total cap in wei (18 decimals on Arc)
        uint256 spent;                   // monotonic, never decreases
        uint256 funded;                  // total USDC ever deposited into this mandate
        bytes32 counterpartyMerkleRoot;  // root over allowed `to` addresses
        bytes32 purposeMerkleRoot;       // root over allowed bytes32 purpose codes
        uint64  validFrom;
        uint64  validUntil;
        address auditViewKeyHolder;      // off-chain encrypted-metadata reader
        Status  status;
    }

    /* ---------- events ---------- */

    event MandateIssued(
        bytes32 indexed mandateId,
        address indexed issuer,
        address indexed principal,
        uint32  capabilityBitmap,
        uint256 spendCeiling,
        bytes32 counterpartyMerkleRoot,
        bytes32 purposeMerkleRoot,
        uint64  validFrom,
        uint64  validUntil
    );

    event MandateFunded(bytes32 indexed mandateId, address indexed by, uint256 amount, uint256 newFunded);

    /// @notice Emitted on every `execute`. This is the audit-trail event the
    ///         OFF-chain world subscribes to — purpose, counterparty, encrypted
    ///         metadata are all structured here.
    event MandateAction(
        bytes32 indexed mandateId,
        address indexed principal,
        address indexed to,
        uint256 amount,
        bytes32 purposeCode,
        bytes32 counterpartyTag,
        uint256 newSpent,
        bytes   encryptedMetadata
    );

    event MandateRevoked(bytes32 indexed mandateId, address indexed by, uint256 reclaimable);
    event MandateWithdrawn(bytes32 indexed mandateId, address indexed by, uint256 amount);

    /* ---------- errors ---------- */

    error NotIssuer();
    error NotPrincipal();
    error NotActive();
    error AlreadyExists();
    error ZeroAddress();
    error InvalidTimes();
    error InvalidCapability();
    error InvalidCounterpartyProof();
    error InvalidPurposeProof();
    error CeilingExceeded();
    error InsufficientFunds();
    error NotRevocableForFunds();
    error ZeroAmount();
    error TransferFailed();
    error NotExpiredOrRevoked();

    /* ---------- write surface (signatures only) ---------- */

    /// @notice Issuer creates a Mandate. `msg.value` is the initial funding
    ///         (can be 0; issuer can fund later via `topUp`).
    function issue(
        address principal,
        uint32  capabilityBitmap,
        uint256 spendCeiling,
        bytes32 counterpartyMerkleRoot,
        bytes32 purposeMerkleRoot,
        uint64  validFrom,
        uint64  validUntil,
        address auditViewKeyHolder
    ) external payable returns (bytes32 mandateId);

    /// @notice Issuer adds funds to an existing mandate's pool.
    function topUp(bytes32 mandateId) external payable;

    /// @notice Principal moves USDC from the mandate pool to `to`, subject to
    ///         capability bits, counterparty whitelist, purpose whitelist,
    ///         ceiling, and time-window checks.
    ///         `encryptedMetadata` is an opaque blob the principal may attach
    ///         (e.g., AES-GCM-encrypted invoice ID). It is emitted in the
    ///         event but not validated by the contract.
    function execute(
        bytes32 mandateId,
        address to,
        uint256 amount,
        bytes32 purposeCode,
        bytes32 counterpartyTag,
        bytes32[] calldata counterpartyProof,
        bytes32[] calldata purposeProof,
        bytes   calldata encryptedMetadata
    ) external returns (bytes32 actionId);

    /// @notice Issuer revokes the mandate. No further execute calls allowed.
    function revoke(bytes32 mandateId) external;

    /// @notice After expiry OR revocation, issuer may pull back unspent USDC.
    function withdraw(bytes32 mandateId, uint256 amount) external;
}
