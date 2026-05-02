// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AightRegistry} from "../src/AightRegistry.sol";

contract AightRegistryTest is Test {
    AightRegistry private registry;

    address private owner = address(0xA11CE);
    address private treasury = address(0x7EA5);
    address private operator = address(0x0A1A);
    address private user = address(0xB0B);
    address private keeper = address(0xC0FFEE);

    uint256 private constant MIN_OPERATOR_STAKE = 1 ether;
    uint256 private constant HEARTBEAT_GRACE_PERIOD = 30 minutes;
    uint96 private constant HOURLY_RATE = 0.01 ether;

    bytes32 private constant ENDPOINT_HASH = keccak256("https://operator.example.com");
    bytes32 private constant MODEL_HASH = keccak256("llama3");
    bytes32 private constant HARDWARE_HASH = keccak256("rtx-4090-24gb");

    function setUp() public {
        registry = new AightRegistry(owner, treasury, MIN_OPERATOR_STAKE, HEARTBEAT_GRACE_PERIOD);
        vm.deal(operator, 10 ether);
        vm.deal(user, 10 ether);
        vm.deal(keeper, 10 ether);
    }

    function testStakeOperatorRegistersActiveNode() public {
        vm.prank(operator);
        registry.stakeOperator{value: MIN_OPERATOR_STAKE}(ENDPOINT_HASH, MODEL_HASH, HARDWARE_HASH, HOURLY_RATE);

        (
            uint96 hourlyRateWei,
            uint96 stakeWei,
            uint64 lastHeartbeat,
            bytes32 endpointHash,
            bytes32 modelHash,
            bytes32 hardwareHash,
            bool active
        ) = registry.operators(operator);

        assertEq(hourlyRateWei, HOURLY_RATE);
        assertEq(stakeWei, MIN_OPERATOR_STAKE);
        assertEq(lastHeartbeat, block.timestamp);
        assertEq(endpointHash, ENDPOINT_HASH);
        assertEq(modelHash, MODEL_HASH);
        assertEq(hardwareHash, HARDWARE_HASH);
        assertTrue(active);
    }

    function testStakeUserDepositCreatesEscrow() public {
        _stakeOperator();

        vm.prank(user);
        uint256 escrowId = registry.stakeUserDeposit{value: HOURLY_RATE * 3}(operator, 3);

        (
            address escrowUser,
            address escrowOperator,
            uint96 hourlyRateWei,
            uint64 startedAt,
            uint64 lastReleaseAt,
            uint64 durationHours,
            uint64 releasedHours,
            uint128 remainingWei,
            bool slashed
        ) = registry.escrows(escrowId);

        assertEq(escrowUser, user);
        assertEq(escrowOperator, operator);
        assertEq(hourlyRateWei, HOURLY_RATE);
        assertEq(startedAt, block.timestamp);
        assertEq(lastReleaseAt, block.timestamp);
        assertEq(durationHours, 3);
        assertEq(releasedHours, 0);
        assertEq(remainingWei, HOURLY_RATE * 3);
        assertFalse(slashed);
    }

    function testReleaseHourlyPaymentSplitsFunds() public {
        uint256 escrowId = _createEscrow(3);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        registry.releaseHourlyPayment(escrowId);

        uint256 treasuryAmount = (HOURLY_RATE * registry.TREASURY_BPS()) / registry.BPS_DENOMINATOR();
        uint256 operatorAmount = HOURLY_RATE - treasuryAmount;

        assertEq(registry.withdrawable(operator), operatorAmount);
        assertEq(registry.withdrawable(treasury), treasuryAmount);
        assertEq(registry.withdrawable(keeper), 0);

        (,,,,,, uint64 releasedHours, uint128 remainingWei,) = registry.escrows(escrowId);
        assertEq(releasedHours, 1);
        assertEq(remainingWei, HOURLY_RATE * 2);
    }

    function testPermissionlessReleaseCannotCaptureFunds() public {
        uint256 escrowId = _createEscrow(1);
        uint256 keeperBalanceBefore = keeper.balance;

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        registry.releaseHourlyPayment(escrowId);

        uint256 treasuryAmount = (HOURLY_RATE * registry.TREASURY_BPS()) / registry.BPS_DENOMINATOR();
        uint256 operatorAmount = HOURLY_RATE - treasuryAmount;

        assertEq(registry.withdrawable(operator), operatorAmount);
        assertEq(registry.withdrawable(treasury), treasuryAmount);
        assertEq(registry.withdrawable(keeper), 0);
        assertEq(keeper.balance, keeperBalanceBefore);
    }

    function testSlashForMissedHeartbeatRefundsRemainingDeposit() public {
        uint256 escrowId = _createEscrow(3);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        registry.releaseHourlyPayment(escrowId);

        vm.warp(block.timestamp + HEARTBEAT_GRACE_PERIOD + 1);
        vm.prank(user);
        registry.slashForMissedHeartbeat(escrowId);

        assertEq(registry.withdrawable(user), HOURLY_RATE * 2);

        (,,,,,,, uint128 remainingWei, bool slashed) = registry.escrows(escrowId);
        assertEq(remainingWei, 0);
        assertTrue(slashed);
    }

    function testCannotReleaseBeforeHourPasses() public {
        uint256 escrowId = _createEscrow(1);

        vm.expectRevert(AightRegistry.PaymentNotDue.selector);
        vm.prank(operator);
        registry.releaseHourlyPayment(escrowId);
    }

    function testCannotSlashHealthyOperator() public {
        uint256 escrowId = _createEscrow(1);

        vm.expectRevert(AightRegistry.OperatorStillHealthy.selector);
        vm.prank(user);
        registry.slashForMissedHeartbeat(escrowId);
    }

    function testWithdrawPaysAccruedBalance() public {
        uint256 escrowId = _createEscrow(1);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        registry.releaseHourlyPayment(escrowId);

        uint256 accruedAmount = registry.withdrawable(operator);
        uint256 balanceBefore = operator.balance;

        vm.prank(operator);
        registry.withdraw();

        assertEq(operator.balance, balanceBefore + accruedAmount);
        assertEq(registry.withdrawable(operator), 0);
    }

    function _stakeOperator() private {
        vm.prank(operator);
        registry.stakeOperator{value: MIN_OPERATOR_STAKE}(ENDPOINT_HASH, MODEL_HASH, HARDWARE_HASH, HOURLY_RATE);
    }

    function _createEscrow(uint64 durationHours) private returns (uint256 escrowId) {
        _stakeOperator();

        vm.prank(user);
        escrowId = registry.stakeUserDeposit{value: uint256(HOURLY_RATE) * durationHours}(operator, durationHours);
    }
}
