# Aight Contracts

Foundry workspace for the native ETH Aight staking and escrow prototype on Base Sepolia.

## Setup

Install Foundry, then install contract dependencies:

```powershell
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
```

Copy the environment template and fill in local secrets:

```powershell
Copy-Item .env.example .env
```

## Commands

```powershell
forge fmt
forge test
forge script script/DeployAightRegistry.s.sol:DeployAightRegistry --rpc-url base_sepolia --broadcast --verify
```

## Contract Model

`AightRegistry` uses native ETH for the hackathon MVP:

- Operators call `stakeOperator` to bond ETH and publish hashed endpoint/model/hardware metadata.
- Users call `stakeUserDeposit` to lock the exact hourly rate multiplied by duration.
- Operators or the owner call `releaseHourlyPayment` once per paid hour.
- Anyone can call `slashForMissedHeartbeat` after the operator misses the heartbeat grace period.
- Payments and refunds use pull-based withdrawals through `withdraw`.
