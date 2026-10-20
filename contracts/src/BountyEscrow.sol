// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {AuditorStaking} from "./AuditorStaking.sol";

/// @title BountyEscrow
/// @notice Holds a developer's ETH bounty for one contract. The backend records
/// submissions and the first verified finding. After the challenge window, that
/// finding can be paid (R8, R10). Payouts are pull-based. Unused funds return to
/// the developer after the deadline and refund delay (R11). Deleting a bounty
/// is blocked once any submission exists (R13, US2.2).
contract BountyEscrow {
    enum BountyState {
        None,
        Open,
        Paid,
        Closed
    }

    struct Bounty {
        address developer;
        uint256 amount;
        uint256 deadline;
        BountyState state;
        uint256 submissionCount;
        // First verified finding. Zero when none is pending.
        bytes32 verifiedFinding;
        address verifiedAuditor;
        uint256 verifiedAt;
        // Set by DisputeResolution while a dispute is open.
        bool frozen;
    }

    /// @notice Backend role that records submissions, verifications and payouts.
    /// Also the only address allowed to bind DisputeResolution.
    address public immutable operator;

    /// @notice Source of auditor eligibility (R9).
    AuditorStaking public immutable staking;

    /// @notice Seconds after a finding is verified before it can be paid.
    uint256 public immutable challengeWindow;

    /// @notice Seconds after the deadline before the developer can refund.
    uint256 public immutable refundDelay;

    /// @notice The DisputeResolution contract allowed to freeze and unfreeze.
    /// Zero until bound.
    address public disputeResolution;

    mapping(bytes32 => Bounty) public bounties;

    /// @notice Credited payouts waiting to be withdrawn by each auditor.
    mapping(address => uint256) public pendingPayouts;

    error NotOperator();
    error NotDisputeResolution();
    error NotDeveloper();
    error AlreadyBound();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroId();
    error BountyExists();
    error BountyNotOpen();
    error PastDeadline();
    error HasSubmissions();
    error NoSubmissions();
    error AlreadyVerified();
    error NoVerifiedFinding();
    error FindingMismatch();
    error AuditorNotEligible(address auditor);
    error AuditorMismatch();
    error ChallengeWindowOpen(uint256 payableAt);
    error ChallengeWindowClosed();
    error AlreadyFrozen();
    error NotFrozen();
    error FrozenBounty();
    error RefundNotDue(uint256 dueAt);
    error NothingToWithdraw();
    error TransferFailed();

    event DisputeResolutionBound(address indexed disputeResolution);
    event Funded(bytes32 indexed contractId, address indexed developer, uint256 amount, uint256 deadline);
    event SubmissionRecorded(bytes32 indexed contractId, uint256 submissionCount);
    event FindingVerified(
        bytes32 indexed contractId, bytes32 indexed findingId, address indexed auditor, uint256 verifiedAt
    );
    event Frozen(bytes32 indexed contractId, bytes32 indexed findingId);
    event Unfrozen(bytes32 indexed contractId, bytes32 indexed findingId, bool auditorWon, uint256 verifiedAt);
    event VerificationCleared(bytes32 indexed contractId, bytes32 indexed findingId);
    event PayoutCredited(
        bytes32 indexed contractId, bytes32 indexed findingId, address indexed auditor, uint256 amount
    );
    event PayoutWithdrawn(address indexed auditor, uint256 amount);
    event BountyDeleted(bytes32 indexed contractId, address indexed developer, uint256 refunded);
    event Refunded(bytes32 indexed contractId, address indexed developer, uint256 amount);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier onlyDisputeResolution() {
        if (msg.sender != disputeResolution) revert NotDisputeResolution();
        _;
    }

    modifier onlyDeveloper(bytes32 contractId) {
        if (msg.sender != bounties[contractId].developer) revert NotDeveloper();
        _;
    }

    modifier whenOpen(bytes32 contractId) {
        if (bounties[contractId].state != BountyState.Open) revert BountyNotOpen();
        _;
    }

    constructor(address _operator, AuditorStaking _staking, uint256 _challengeWindow, uint256 _refundDelay) {
        if (_operator == address(0)) revert ZeroAddress();
        if (address(_staking) == address(0)) revert ZeroAddress();
        operator = _operator;
        staking = _staking;
        challengeWindow = _challengeWindow;
        refundDelay = _refundDelay;
    }

    /// @notice Binds the DisputeResolution contract. Can only happen once.
    function bindDisputeResolution(address _disputeResolution) external onlyOperator {
        if (disputeResolution != address(0)) revert AlreadyBound();
        if (_disputeResolution == address(0)) revert ZeroAddress();
        disputeResolution = _disputeResolution;
        emit DisputeResolutionBound(_disputeResolution);
    }

    /// @notice Locks the caller's ETH as the bounty for `contractId`. One bounty
    /// per contract.
    function fund(bytes32 contractId, uint256 deadline) external payable {
        if (contractId == bytes32(0)) revert ZeroId();
        if (msg.value == 0) revert ZeroAmount();
        if (bounties[contractId].state != BountyState.None) revert BountyExists();
        if (deadline <= block.timestamp) revert PastDeadline();

        bounties[contractId] = Bounty({
            developer: msg.sender,
            amount: msg.value,
            deadline: deadline,
            state: BountyState.Open,
            submissionCount: 0,
            verifiedFinding: bytes32(0),
            verifiedAuditor: address(0),
            verifiedAt: 0,
            frozen: false
        });
        emit Funded(contractId, msg.sender, msg.value, deadline);
    }

    /// @notice Records that a submission exists. Blocks deletion of the bounty.
    function recordSubmission(bytes32 contractId) external onlyOperator whenOpen(contractId) {
        Bounty storage b = bounties[contractId];
        b.submissionCount += 1;
        emit SubmissionRecorded(contractId, b.submissionCount);
    }

    /// @notice Marks a finding as the verified one for this bounty. Only the
    /// first verified finding counts (R10). The auditor must be eligible (R9).
    function recordVerification(bytes32 contractId, bytes32 findingId, address auditor)
        external
        onlyOperator
        whenOpen(contractId)
    {
        if (findingId == bytes32(0)) revert ZeroId();
        if (auditor == address(0)) revert ZeroAddress();

        Bounty storage b = bounties[contractId];
        if (b.submissionCount == 0) revert NoSubmissions();
        if (b.verifiedFinding != bytes32(0)) revert AlreadyVerified();
        if (!staking.isEligible(auditor)) revert AuditorNotEligible(auditor);

        b.verifiedFinding = findingId;
        b.verifiedAuditor = auditor;
        b.verifiedAt = block.timestamp;
        emit FindingVerified(contractId, findingId, auditor, b.verifiedAt);
    }

    /// @notice Freezes the verified finding while a dispute is open. Only works
    /// inside the challenge window.
    function freeze(bytes32 contractId, bytes32 findingId) external onlyDisputeResolution whenOpen(contractId) {
        Bounty storage b = bounties[contractId];
        if (b.verifiedFinding == bytes32(0)) revert NoVerifiedFinding();
        if (b.verifiedFinding != findingId) revert FindingMismatch();
        if (b.frozen) revert AlreadyFrozen();
        if (block.timestamp >= b.verifiedAt + challengeWindow) revert ChallengeWindowClosed();

        b.frozen = true;
        emit Frozen(contractId, findingId);
    }

    /// @notice Ends a dispute. If the auditor won, the finding stays verified and
    /// the challenge window restarts (M1 US7.3). If the auditor lost, the
    /// verification is cleared so another submission can be verified.
    function unfreeze(bytes32 contractId, bytes32 findingId, bool auditorWon)
        external
        onlyDisputeResolution
        whenOpen(contractId)
    {
        Bounty storage b = bounties[contractId];
        if (!b.frozen) revert NotFrozen();
        if (b.verifiedFinding != findingId) revert FindingMismatch();

        b.frozen = false;
        if (auditorWon) {
            b.verifiedAt = block.timestamp;
            emit Unfrozen(contractId, findingId, true, b.verifiedAt);
        } else {
            b.verifiedFinding = bytes32(0);
            b.verifiedAuditor = address(0);
            b.verifiedAt = 0;
            emit Unfrozen(contractId, findingId, false, 0);
            emit VerificationCleared(contractId, findingId);
        }
    }

    /// @notice Credits the bounty to the verified auditor once the challenge
    /// window has passed and no dispute is open. The auditor withdraws with
    /// `withdrawPayout`.
    function payout(bytes32 contractId, bytes32 findingId, address auditor) external onlyOperator whenOpen(contractId) {
        Bounty storage b = bounties[contractId];
        if (b.frozen) revert FrozenBounty();
        if (b.verifiedFinding == bytes32(0)) revert NoVerifiedFinding();
        if (b.verifiedFinding != findingId) revert FindingMismatch();
        if (b.verifiedAuditor != auditor) revert AuditorMismatch();

        uint256 payableAt = b.verifiedAt + challengeWindow;
        if (block.timestamp < payableAt) revert ChallengeWindowOpen(payableAt);
        if (!staking.isEligible(auditor)) revert AuditorNotEligible(auditor);

        uint256 amount = b.amount;
        // Effects before anything else. The payout is a credit, so no external
        // call happens here.
        b.amount = 0;
        b.state = BountyState.Paid;
        pendingPayouts[auditor] += amount;
        emit PayoutCredited(contractId, findingId, auditor, amount);
    }

    /// @notice Withdraws the caller's credited payout.
    function withdrawPayout() external {
        uint256 amount = pendingPayouts[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // Effects before the external call.
        pendingPayouts[msg.sender] = 0;
        emit PayoutWithdrawn(msg.sender, amount);

        _send(msg.sender, amount);
    }

    /// @notice Developer cancels the bounty and takes the funds back. Blocked
    /// once any submission exists (R13, US2.2).
    function deleteBounty(bytes32 contractId) external onlyDeveloper(contractId) whenOpen(contractId) {
        Bounty storage b = bounties[contractId];
        if (b.submissionCount != 0) revert HasSubmissions();

        uint256 amount = _close(contractId);
        emit BountyDeleted(contractId, msg.sender, amount);

        _send(msg.sender, amount);
    }

    /// @notice Developer reclaims unused funds after the deadline and refund
    /// delay (R11). Blocked while a finding is pending or disputed, so no
    /// verified auditor loses their payout.
    function refund(bytes32 contractId) external onlyDeveloper(contractId) whenOpen(contractId) {
        Bounty storage b = bounties[contractId];
        if (b.frozen) revert FrozenBounty();
        if (b.verifiedFinding != bytes32(0)) revert AlreadyVerified();

        uint256 dueAt = b.deadline + refundDelay;
        if (block.timestamp < dueAt) revert RefundNotDue(dueAt);

        uint256 amount = _close(contractId);
        emit Refunded(contractId, msg.sender, amount);

        _send(msg.sender, amount);
    }

    /// @dev Moves the bounty to Closed and returns its remaining balance. The
    /// caller sends the ETH after this returns.
    function _close(bytes32 contractId) private returns (uint256 amount) {
        Bounty storage b = bounties[contractId];
        amount = b.amount;
        b.amount = 0;
        b.state = BountyState.Closed;
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
