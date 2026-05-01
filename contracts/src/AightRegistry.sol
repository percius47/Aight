// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AightRegistry is Ownable, ReentrancyGuard {
    uint16 public constant TREASURY_BPS = 1_000;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    uint256 public minOperatorStakeWei;
    uint256 public heartbeatGracePeriod;
    uint256 public nextEscrowId = 1;
    address public treasury;

    struct Operator {
        uint96 hourlyRateWei;
        uint96 stakeWei;
        uint64 lastHeartbeat;
        bytes32 endpointHash;
        bytes32 modelHash;
        bytes32 hardwareHash;
        bool active;
    }

    struct Escrow {
        address user;
        address operator;
        uint96 hourlyRateWei;
        uint64 startedAt;
        uint64 lastReleaseAt;
        uint64 durationHours;
        uint64 releasedHours;
        uint128 remainingWei;
        bool slashed;
    }

    mapping(address operator => Operator details) public operators;
    mapping(uint256 escrowId => Escrow escrow) public escrows;
    mapping(address account => uint256 amountWei) public withdrawable;

    event OperatorStaked(
        address indexed operator,
        uint256 stakeWei,
        uint256 hourlyRateWei,
        bytes32 endpointHash,
        bytes32 modelHash,
        bytes32 hardwareHash
    );
    event OperatorHeartbeat(address indexed operator, uint256 timestamp);
    event OperatorDeactivated(address indexed operator);
    event UserEscrowCreated(
        uint256 indexed escrowId,
        address indexed user,
        address indexed operator,
        uint256 amountWei,
        uint256 durationHours
    );
    event HourlyPaymentReleased(
        uint256 indexed escrowId,
        address indexed operator,
        uint256 operatorAmountWei,
        uint256 treasuryAmountWei,
        uint256 releasedHours
    );
    event EscrowSlashed(uint256 indexed escrowId, address indexed user, uint256 refundedWei);
    event Withdrawn(address indexed account, uint256 amountWei);
    event TreasuryUpdated(address indexed treasury);
    event MinOperatorStakeUpdated(uint256 minOperatorStakeWei);
    event HeartbeatGracePeriodUpdated(uint256 heartbeatGracePeriod);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDuration();
    error InvalidHourlyRate();
    error OperatorInactive();
    error OperatorStillHealthy();
    error PaymentNotDue();
    error EscrowClosed();
    error EscrowFullyReleased();
    error UnauthorizedCaller();
    error TransferFailed();

    constructor(
        address initialOwner,
        address initialTreasury,
        uint256 initialMinOperatorStakeWei,
        uint256 initialHeartbeatGracePeriod
    ) Ownable(initialOwner) {
        if (initialTreasury == address(0)) {
            revert InvalidAddress();
        }
        if (initialHeartbeatGracePeriod == 0) {
            revert InvalidDuration();
        }

        treasury = initialTreasury;
        minOperatorStakeWei = initialMinOperatorStakeWei;
        heartbeatGracePeriod = initialHeartbeatGracePeriod;
    }

    function stakeOperator(bytes32 endpointHash, bytes32 modelHash, bytes32 hardwareHash, uint96 hourlyRateWei)
        external
        payable
        nonReentrant
    {
        if (msg.value < minOperatorStakeWei) {
            revert InvalidAmount();
        }
        if (msg.value > type(uint96).max) {
            revert InvalidAmount();
        }
        if (hourlyRateWei == 0) {
            revert InvalidHourlyRate();
        }

        Operator storage operator = operators[msg.sender];
        if (uint256(operator.stakeWei) + msg.value > type(uint96).max) {
            revert InvalidAmount();
        }
        operator.stakeWei += uint96(msg.value);
        operator.hourlyRateWei = hourlyRateWei;
        operator.lastHeartbeat = uint64(block.timestamp);
        operator.endpointHash = endpointHash;
        operator.modelHash = modelHash;
        operator.hardwareHash = hardwareHash;
        operator.active = true;

        emit OperatorStaked(msg.sender, operator.stakeWei, hourlyRateWei, endpointHash, modelHash, hardwareHash);
        emit OperatorHeartbeat(msg.sender, block.timestamp);
    }

    function recordHeartbeat() external {
        Operator storage operator = operators[msg.sender];
        if (!operator.active) {
            revert OperatorInactive();
        }

        operator.lastHeartbeat = uint64(block.timestamp);
        emit OperatorHeartbeat(msg.sender, block.timestamp);
    }

    function deactivateOperator() external {
        Operator storage operator = operators[msg.sender];
        if (!operator.active) {
            revert OperatorInactive();
        }

        operator.active = false;
        emit OperatorDeactivated(msg.sender);
    }

    function stakeUserDeposit(address operatorAddress, uint64 durationHours)
        external
        payable
        nonReentrant
        returns (uint256 escrowId)
    {
        Operator storage operator = operators[operatorAddress];
        if (!operator.active) {
            revert OperatorInactive();
        }
        if (durationHours == 0) {
            revert InvalidDuration();
        }

        uint256 requiredDeposit = uint256(operator.hourlyRateWei) * durationHours;
        if (msg.value != requiredDeposit) {
            revert InvalidAmount();
        }
        if (msg.value > type(uint128).max) {
            revert InvalidAmount();
        }

        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow({
            user: msg.sender,
            operator: operatorAddress,
            hourlyRateWei: operator.hourlyRateWei,
            startedAt: uint64(block.timestamp),
            lastReleaseAt: uint64(block.timestamp),
            durationHours: durationHours,
            releasedHours: 0,
            remainingWei: uint128(msg.value),
            slashed: false
        });

        emit UserEscrowCreated(escrowId, msg.sender, operatorAddress, msg.value, durationHours);
    }

    function releaseHourlyPayment(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        if (msg.sender != escrow.operator && msg.sender != owner()) {
            revert UnauthorizedCaller();
        }
        if (escrow.slashed) {
            revert EscrowClosed();
        }
        if (escrow.releasedHours >= escrow.durationHours) {
            revert EscrowFullyReleased();
        }
        if (block.timestamp < uint256(escrow.lastReleaseAt) + 1 hours) {
            revert PaymentNotDue();
        }

        uint256 hourlyRateWei = escrow.hourlyRateWei;
        uint256 treasuryAmountWei = (hourlyRateWei * TREASURY_BPS) / BPS_DENOMINATOR;
        uint256 operatorAmountWei = hourlyRateWei - treasuryAmountWei;

        escrow.releasedHours += 1;
        escrow.lastReleaseAt = uint64(block.timestamp);
        escrow.remainingWei -= uint128(hourlyRateWei);
        withdrawable[escrow.operator] += operatorAmountWei;
        withdrawable[treasury] += treasuryAmountWei;

        emit HourlyPaymentReleased(
            escrowId, escrow.operator, operatorAmountWei, treasuryAmountWei, escrow.releasedHours
        );
    }

    function slashForMissedHeartbeat(uint256 escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        if (escrow.slashed) {
            revert EscrowClosed();
        }
        if (escrow.releasedHours >= escrow.durationHours) {
            revert EscrowFullyReleased();
        }

        Operator storage operator = operators[escrow.operator];
        if (block.timestamp <= uint256(operator.lastHeartbeat) + heartbeatGracePeriod) {
            revert OperatorStillHealthy();
        }

        uint256 refundWei = escrow.remainingWei;
        escrow.remainingWei = 0;
        escrow.slashed = true;
        withdrawable[escrow.user] += refundWei;

        emit EscrowSlashed(escrowId, escrow.user, refundWei);
    }

    function withdraw() external nonReentrant {
        uint256 amountWei = withdrawable[msg.sender];
        if (amountWei == 0) {
            revert InvalidAmount();
        }

        withdrawable[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amountWei}("");
        if (!success) {
            revert TransferFailed();
        }

        emit Withdrawn(msg.sender, amountWei);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) {
            revert InvalidAddress();
        }

        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setMinOperatorStakeWei(uint256 newMinOperatorStakeWei) external onlyOwner {
        minOperatorStakeWei = newMinOperatorStakeWei;
        emit MinOperatorStakeUpdated(newMinOperatorStakeWei);
    }

    function setHeartbeatGracePeriod(uint256 newHeartbeatGracePeriod) external onlyOwner {
        if (newHeartbeatGracePeriod == 0) {
            revert InvalidDuration();
        }

        heartbeatGracePeriod = newHeartbeatGracePeriod;
        emit HeartbeatGracePeriodUpdated(newHeartbeatGracePeriod);
    }
}
