// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {AuditorStaking} from "../src/AuditorStaking.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

/// @dev Auditor that tries to re-enter withdrawPayout() from its receive hook.
/// The re-entry must revert, which makes the outer withdrawal fail.
contract ReentrantPayoutReceiver {
    BountyEscrow public immutable escrow;

    constructor(BountyEscrow _escrow) {
        escrow = _escrow;
    }

    function withdraw() external {
        escrow.withdrawPayout();
    }

    receive() external payable {
        escrow.withdrawPayout();
    }
}

contract BountyEscrowTest is Test {
    AuditorStaking internal staking;
    BountyEscrow internal escrow;

    // This test contract is the operator (backend) and deployer.
    address internal dispute = makeAddr("dispute");
    address internal developer = makeAddr("developer");
    address internal auditor = makeAddr("auditor");
    address internal auditor2 = makeAddr("auditor2");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant CONTRACT_ID = keccak256("contract-1");
    bytes32 internal constant FINDING_1 = keccak256("finding-1");
    bytes32 internal constant FINDING_2 = keccak256("finding-2");

    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant REFUND_DELAY = 3 hours;
    uint256 internal constant BOUNTY = 2 ether;

    uint256 internal deadline;

    function setUp() public {
        staking = new AuditorStaking(address(this));
        escrow = new BountyEscrow(address(this), staking, WINDOW, REFUND_DELAY);
        escrow.bindDisputeResolution(dispute);

        vm.deal(developer, 10 ether);
        vm.deal(stranger, 10 ether);

        // Both auditors meet REQUIRED_STAKE (R9).
        vm.deal(auditor, 1 ether);
        vm.deal(auditor2, 1 ether);
        vm.prank(auditor);
        staking.stake{value: 0.1 ether}();
        vm.prank(auditor2);
        staking.stake{value: 0.1 ether}();

        deadline = block.timestamp + 7 days;
    }

    function _fund() internal {
        vm.prank(developer);
        escrow.fund{value: BOUNTY}(CONTRACT_ID, deadline);
    }

    /// @dev Funds, records one submission and verifies FINDING_1 for `auditor`.
    function _verifiedBounty() internal {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);
        escrow.recordVerification(CONTRACT_ID, FINDING_1, auditor);
    }

    // --- construction and binding ---

    function test_constructor_rejectsZeroOperator() public {
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        new BountyEscrow(address(0), staking, WINDOW, REFUND_DELAY);
    }

    function test_constructor_rejectsZeroStaking() public {
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        new BountyEscrow(address(this), AuditorStaking(address(0)), WINDOW, REFUND_DELAY);
    }

    function test_bind_onlyOperator() public {
        BountyEscrow fresh = new BountyEscrow(address(this), staking, WINDOW, REFUND_DELAY);
        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotOperator.selector);
        fresh.bindDisputeResolution(dispute);
    }

    function test_bind_onlyOnce() public {
        vm.expectRevert(BountyEscrow.AlreadyBound.selector);
        escrow.bindDisputeResolution(makeAddr("other"));
    }

    function test_bind_rejectsZeroAddress() public {
        BountyEscrow fresh = new BountyEscrow(address(this), staking, WINDOW, REFUND_DELAY);
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        fresh.bindDisputeResolution(address(0));
    }

    // --- funding ---

    function test_fund_recordsBounty() public {
        _fund();

        (address dev, uint256 amount, uint256 dl, BountyEscrow.BountyState state,,,,,) = escrow.bounties(CONTRACT_ID);
        assertEq(dev, developer);
        assertEq(amount, BOUNTY);
        assertEq(dl, deadline);
        assertEq(uint8(state), uint8(BountyEscrow.BountyState.Open));
        assertEq(address(escrow).balance, BOUNTY);
    }

    function test_fund_rejectsZeroId() public {
        vm.prank(developer);
        vm.expectRevert(BountyEscrow.ZeroId.selector);
        escrow.fund{value: BOUNTY}(bytes32(0), deadline);
    }

    function test_fund_rejectsZeroValue() public {
        vm.prank(developer);
        vm.expectRevert(BountyEscrow.ZeroAmount.selector);
        escrow.fund{value: 0}(CONTRACT_ID, deadline);
    }

    function test_fund_rejectsSecondBountyForSameContract() public {
        _fund();

        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.BountyExists.selector);
        escrow.fund{value: BOUNTY}(CONTRACT_ID, deadline);
    }

    function test_fund_rejectsPastDeadline() public {
        vm.prank(developer);
        vm.expectRevert(BountyEscrow.PastDeadline.selector);
        escrow.fund{value: BOUNTY}(CONTRACT_ID, block.timestamp);
    }

    // --- submissions and deletion (R13) ---

    function test_recordSubmission_onlyOperator() public {
        _fund();
        vm.prank(developer);
        vm.expectRevert(BountyEscrow.NotOperator.selector);
        escrow.recordSubmission(CONTRACT_ID);
    }

    function test_recordSubmission_countsSubmissions() public {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);
        escrow.recordSubmission(CONTRACT_ID);

        (,,,, uint256 count,,,,) = escrow.bounties(CONTRACT_ID);
        assertEq(count, 2);
    }

    function test_recordSubmission_rejectsUnknownBounty() public {
        vm.expectRevert(BountyEscrow.BountyNotOpen.selector);
        escrow.recordSubmission(CONTRACT_ID);
    }

    function test_deleteBounty_refundsDeveloper() public {
        _fund();

        vm.prank(developer);
        escrow.deleteBounty(CONTRACT_ID);

        assertEq(developer.balance, 10 ether);
        assertEq(address(escrow).balance, 0);
    }

    function test_deleteBounty_onlyDeveloper() public {
        _fund();
        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotDeveloper.selector);
        escrow.deleteBounty(CONTRACT_ID);
    }

    function test_deleteBounty_blockedAfterSubmission() public {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);

        vm.prank(developer);
        vm.expectRevert(BountyEscrow.HasSubmissions.selector);
        escrow.deleteBounty(CONTRACT_ID);
    }

    // --- verification (R9, R10) ---

    function test_recordVerification_onlyOperator() public {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);

        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotOperator.selector);
        escrow.recordVerification(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_recordVerification_requiresSubmission() public {
        _fund();
        vm.expectRevert(BountyEscrow.NoSubmissions.selector);
        escrow.recordVerification(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_recordVerification_rejectsIneligibleAuditor() public {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);

        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AuditorNotEligible.selector, stranger));
        escrow.recordVerification(CONTRACT_ID, FINDING_1, stranger);
    }

    function test_recordVerification_rejectsZeroIdsAndAddress() public {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);

        vm.expectRevert(BountyEscrow.ZeroId.selector);
        escrow.recordVerification(CONTRACT_ID, bytes32(0), auditor);

        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        escrow.recordVerification(CONTRACT_ID, FINDING_1, address(0));
    }

    function test_recordVerification_onlyFirstVerifiedCounts() public {
        _fund();
        escrow.recordSubmission(CONTRACT_ID);
        escrow.recordVerification(CONTRACT_ID, FINDING_1, auditor);

        vm.expectRevert(BountyEscrow.AlreadyVerified.selector);
        escrow.recordVerification(CONTRACT_ID, FINDING_2, auditor2);
    }

    function test_deleteBounty_blockedOnceVerified() public {
        _verifiedBounty();

        vm.prank(developer);
        vm.expectRevert(BountyEscrow.HasSubmissions.selector);
        escrow.deleteBounty(CONTRACT_ID);
    }

    // --- payout after the challenge window (R8, R10) ---

    function test_payout_revertsInsideChallengeWindow() public {
        _verifiedBounty();
        uint256 payableAt = vm.getBlockTimestamp() + WINDOW;

        vm.warp(payableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ChallengeWindowOpen.selector, payableAt));
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_payout_creditsAfterWindow_thenWithdraws() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);

        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
        assertEq(escrow.pendingPayouts(auditor), BOUNTY);

        vm.prank(auditor);
        escrow.withdrawPayout();
        // Started with 1 ETH, staked 0.1 ETH, then received the bounty.
        assertEq(auditor.balance, 0.9 ether + BOUNTY);
        assertEq(escrow.pendingPayouts(auditor), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_payout_onlyOperator() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);

        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotOperator.selector);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_payout_rejectsWrongFinding() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);

        vm.expectRevert(BountyEscrow.FindingMismatch.selector);
        escrow.payout(CONTRACT_ID, FINDING_2, auditor);
    }

    function test_payout_rejectsWrongAuditor() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);

        vm.expectRevert(BountyEscrow.AuditorMismatch.selector);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor2);
    }

    function test_payout_rejectsWithoutVerifiedFinding() public {
        _fund();
        vm.expectRevert(BountyEscrow.NoVerifiedFinding.selector);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_payout_onlyOnce() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);

        vm.expectRevert(BountyEscrow.BountyNotOpen.selector);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_withdrawPayout_rejectsWhenNothingCredited() public {
        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NothingToWithdraw.selector);
        escrow.withdrawPayout();
    }

    function test_withdrawPayout_reentrancyFails() public {
        ReentrantPayoutReceiver attacker = new ReentrantPayoutReceiver(escrow);
        vm.prank(developer);
        escrow.fund{value: BOUNTY}(CONTRACT_ID, deadline);
        escrow.recordSubmission(CONTRACT_ID);

        // The attacker must be eligible to be verified and paid.
        vm.deal(address(attacker), 1 ether);
        vm.prank(address(attacker));
        staking.stake{value: 0.1 ether}();
        escrow.recordVerification(CONTRACT_ID, FINDING_1, address(attacker));
        vm.warp(block.timestamp + WINDOW);
        escrow.payout(CONTRACT_ID, FINDING_1, address(attacker));

        // The re-entry sees a zeroed balance and reverts. The outer send fails.
        vm.expectRevert(BountyEscrow.TransferFailed.selector);
        attacker.withdraw();

        assertEq(escrow.pendingPayouts(address(attacker)), BOUNTY);
    }

    // --- dispute freeze and unfreeze (R21) ---

    function test_freeze_onlyDisputeResolution() public {
        _verifiedBounty();

        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotDisputeResolution.selector);
        escrow.freeze(CONTRACT_ID, FINDING_1);
    }

    function test_freeze_blocksPayout() public {
        _verifiedBounty();

        vm.prank(dispute);
        escrow.freeze(CONTRACT_ID, FINDING_1);

        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(BountyEscrow.FrozenBounty.selector);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
    }

    function test_freeze_blocksRefund() public {
        _verifiedBounty();
        vm.prank(dispute);
        escrow.freeze(CONTRACT_ID, FINDING_1);

        vm.warp(deadline + REFUND_DELAY);
        vm.prank(developer);
        vm.expectRevert(BountyEscrow.FrozenBounty.selector);
        escrow.refund(CONTRACT_ID);
    }

    function test_freeze_rejectsWrongFinding() public {
        _verifiedBounty();

        vm.prank(dispute);
        vm.expectRevert(BountyEscrow.FindingMismatch.selector);
        escrow.freeze(CONTRACT_ID, FINDING_2);
    }

    function test_freeze_rejectsWithoutVerifiedFinding() public {
        _fund();
        vm.prank(dispute);
        vm.expectRevert(BountyEscrow.NoVerifiedFinding.selector);
        escrow.freeze(CONTRACT_ID, FINDING_1);
    }

    function test_freeze_rejectsAfterChallengeWindow() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);

        vm.prank(dispute);
        vm.expectRevert(BountyEscrow.ChallengeWindowClosed.selector);
        escrow.freeze(CONTRACT_ID, FINDING_1);
    }

    function test_freeze_rejectsDoubleFreeze() public {
        _verifiedBounty();
        vm.startPrank(dispute);
        escrow.freeze(CONTRACT_ID, FINDING_1);

        vm.expectRevert(BountyEscrow.AlreadyFrozen.selector);
        escrow.freeze(CONTRACT_ID, FINDING_1);
        vm.stopPrank();
    }

    function test_unfreeze_onlyDisputeResolution() public {
        _verifiedBounty();
        vm.prank(dispute);
        escrow.freeze(CONTRACT_ID, FINDING_1);

        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotDisputeResolution.selector);
        escrow.unfreeze(CONTRACT_ID, FINDING_1, true);
    }

    function test_unfreeze_rejectsWhenNotFrozen() public {
        _verifiedBounty();
        vm.prank(dispute);
        vm.expectRevert(BountyEscrow.NotFrozen.selector);
        escrow.unfreeze(CONTRACT_ID, FINDING_1, true);
    }

    function test_unfreeze_auditorWon_restartsWindow() public {
        _verifiedBounty();
        vm.prank(dispute);
        escrow.freeze(CONTRACT_ID, FINDING_1);

        // Time passes past the original window while the dispute is open.
        vm.warp(vm.getBlockTimestamp() + WINDOW + 1 hours);
        uint256 restartedAt = vm.getBlockTimestamp();
        vm.prank(dispute);
        escrow.unfreeze(CONTRACT_ID, FINDING_1, true);

        // The old window has already passed, but a fresh window now applies (M1 US7.3).
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ChallengeWindowOpen.selector, restartedAt + WINDOW));
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);

        vm.warp(restartedAt + WINDOW);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);
        assertEq(escrow.pendingPayouts(auditor), BOUNTY);
    }

    function test_unfreeze_auditorLost_clearsVerification() public {
        _verifiedBounty();
        vm.prank(dispute);
        escrow.freeze(CONTRACT_ID, FINDING_1);

        vm.prank(dispute);
        escrow.unfreeze(CONTRACT_ID, FINDING_1, false);

        (,,,,, bytes32 finding, address verifiedAuditor,,) = escrow.bounties(CONTRACT_ID);
        assertEq(finding, bytes32(0));
        assertEq(verifiedAuditor, address(0));

        // The bounty is open again, so a different submission can be verified (R10).
        escrow.recordVerification(CONTRACT_ID, FINDING_2, auditor2);
        vm.warp(block.timestamp + WINDOW);
        escrow.payout(CONTRACT_ID, FINDING_2, auditor2);
        assertEq(escrow.pendingPayouts(auditor2), BOUNTY);
    }

    // --- refund after the deadline (R11) ---

    function test_refund_onlyDeveloper() public {
        _fund();
        vm.warp(deadline + REFUND_DELAY);

        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotDeveloper.selector);
        escrow.refund(CONTRACT_ID);
    }

    function test_refund_revertsBeforeDeadlinePlusDelay() public {
        _fund();
        uint256 dueAt = deadline + REFUND_DELAY;

        vm.warp(dueAt - 1);
        vm.prank(developer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.RefundNotDue.selector, dueAt));
        escrow.refund(CONTRACT_ID);
    }

    function test_refund_returnsFundsAfterDelay() public {
        _fund();
        vm.warp(deadline + REFUND_DELAY);

        vm.prank(developer);
        escrow.refund(CONTRACT_ID);

        assertEq(developer.balance, 10 ether);
        assertEq(address(escrow).balance, 0);
    }

    function test_refund_blockedWhileVerificationPending() public {
        _verifiedBounty();
        vm.warp(deadline + REFUND_DELAY);

        vm.prank(developer);
        vm.expectRevert(BountyEscrow.AlreadyVerified.selector);
        escrow.refund(CONTRACT_ID);
    }

    function test_refund_blockedAfterPayout() public {
        _verifiedBounty();
        vm.warp(block.timestamp + WINDOW);
        escrow.payout(CONTRACT_ID, FINDING_1, auditor);

        vm.warp(deadline + REFUND_DELAY);
        vm.prank(developer);
        vm.expectRevert(BountyEscrow.BountyNotOpen.selector);
        escrow.refund(CONTRACT_ID);
    }
}
