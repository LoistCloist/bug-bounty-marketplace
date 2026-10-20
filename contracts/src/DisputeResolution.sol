// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {AuditorStaking} from "./AuditorStaking.sol";
import {BountyEscrow} from "./BountyEscrow.sol";

/// @title DisputeResolution
/// @notice A developer can dispute a verified finding inside the challenge
/// window (R21). Opening a dispute freezes the payout in BountyEscrow. A single
/// arbiter rules within RULING_WINDOW. If the auditor wins, the finding stays
/// verified and the escrow restarts the challenge window (M1 US7.3). If the
/// auditor loses, the finding is rejected, SLASH_PERCENT of their stake goes to
/// the developer, and their reputation drops (US4.3). Each finding can be
/// disputed once, to prevent stalling.
contract DisputeResolution {
    /// @notice Share of the auditor's stake taken when they lose, in percent.
    uint256 public constant SLASH_PERCENT = 50;

    /// @notice Time the arbiter has to rule after a dispute opens.
    uint256 public constant RULING_WINDOW = 3 days;

    /// @notice Single address allowed to rule on disputes.
    address public immutable arbiter;

    AuditorStaking public immutable staking;
    BountyEscrow public immutable escrow;

    struct Dispute {
        address developer;
        address auditor;
        uint256 ruleBy;
        bool resolved;
    }

    /// @notice Keyed by disputeKey(contractId, findingId). One per finding.
    mapping(bytes32 => Dispute) public disputes;

    error NotArbiter();
    error NotDeveloper();
    error ZeroAddress();
    error DisputeExists();
    error DisputeNotFound();
    error AlreadyResolved();
    error RulingWindowOpen(uint256 ruleBy);
    error RulingWindowClosed();

    event DisputeOpened(
        bytes32 indexed key,
        bytes32 indexed contractId,
        bytes32 indexed findingId,
        address developer,
        address auditor,
        uint256 ruleBy,
        string reason
    );
    event DisputeRuled(bytes32 indexed key, bool auditorWon, uint256 slashed);
    event DisputeLapsed(bytes32 indexed key);

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    constructor(address _arbiter, AuditorStaking _staking, BountyEscrow _escrow) {
        if (_arbiter == address(0)) revert ZeroAddress();
        if (address(_staking) == address(0)) revert ZeroAddress();
        if (address(_escrow) == address(0)) revert ZeroAddress();
        arbiter = _arbiter;
        staking = _staking;
        escrow = _escrow;
    }

    /// @notice Key for a finding's dispute record.
    function disputeKey(bytes32 contractId, bytes32 findingId) public pure returns (bytes32) {
        return keccak256(abi.encode(contractId, findingId));
    }

    /// @notice Developer disputes the verified finding. Freezes the payout.
    /// Reverts if the challenge window has closed or the finding does not match.
    function openDispute(bytes32 contractId, bytes32 findingId, string calldata reason) external {
        bytes32 key = disputeKey(contractId, findingId);
        if (disputes[key].developer != address(0)) revert DisputeExists();

        (address developer,,,,,, address auditor,,) = escrow.bounties(contractId);
        if (msg.sender != developer) revert NotDeveloper();

        uint256 ruleBy = block.timestamp + RULING_WINDOW;
        disputes[key] = Dispute({developer: developer, auditor: auditor, ruleBy: ruleBy, resolved: false});

        // Reverts if the window is closed, nothing is verified, or the finding does not match.
        escrow.freeze(contractId, findingId);

        emit DisputeOpened(key, contractId, findingId, developer, auditor, ruleBy, reason);
    }

    /// @notice Arbiter rules within the ruling window.
    function rule(bytes32 contractId, bytes32 findingId, bool auditorWon) external onlyArbiter {
        bytes32 key = disputeKey(contractId, findingId);
        Dispute storage d = disputes[key];
        if (d.developer == address(0)) revert DisputeNotFound();
        if (d.resolved) revert AlreadyResolved();
        if (block.timestamp > d.ruleBy) revert RulingWindowClosed();

        // Effects before the external calls.
        d.resolved = true;

        if (auditorWon) {
            escrow.unfreeze(contractId, findingId, true);
            staking.adjustReputation(d.auditor, 1);
            emit DisputeRuled(key, true, 0);
            return;
        }

        uint256 slashed = staking.stakeOf(d.auditor) * SLASH_PERCENT / 100;
        escrow.unfreeze(contractId, findingId, false);
        if (slashed > 0) {
            staking.slash(d.auditor, slashed, d.developer);
        }
        staking.adjustReputation(d.auditor, -1);
        emit DisputeRuled(key, false, slashed);
    }

    /// @notice If the arbiter misses the ruling window, anyone can lapse the
    /// dispute. This resolves in the auditor's favour without a reputation
    /// change. The choice of auditor-favouring default is pending confirmation.
    function lapse(bytes32 contractId, bytes32 findingId) external {
        bytes32 key = disputeKey(contractId, findingId);
        Dispute storage d = disputes[key];
        if (d.developer == address(0)) revert DisputeNotFound();
        if (d.resolved) revert AlreadyResolved();
        if (block.timestamp <= d.ruleBy) revert RulingWindowOpen(d.ruleBy);

        d.resolved = true;
        escrow.unfreeze(contractId, findingId, true);
        emit DisputeLapsed(key);
    }
}
