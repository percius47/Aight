// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {AightRegistry} from "../src/AightRegistry.sol";

contract DeployAightRegistry is Script {
    function run() external returns (AightRegistry registry) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address treasury = vm.envAddress("AIGHT_TREASURY");
        uint256 minOperatorStakeWei = vm.envOr("AIGHT_MIN_OPERATOR_STAKE_WEI", uint256(0.01 ether));
        uint256 heartbeatGracePeriod = vm.envOr("AIGHT_HEARTBEAT_GRACE_PERIOD", uint256(5 minutes));

        vm.startBroadcast(deployerPrivateKey);
        registry = new AightRegistry(deployer, treasury, minOperatorStakeWei, heartbeatGracePeriod);
        vm.stopBroadcast();
    }
}
