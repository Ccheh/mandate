// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Mandate} from "../src/Mandate.sol";

/// @notice Deploys Mandate v0 to Arc Testnet.
///         Single-contract design — all mandates live behind one address.
contract DeployV0Script is Script {
    function run() external {
        vm.startBroadcast();
        Mandate m = new Mandate();
        vm.stopBroadcast();

        console.log("=== Mandate v0 deployment ===");
        console.log("Chain ID:     ", block.chainid);
        console.log("Mandate:      ", address(m));
        console.log("BIT_TRANSFER: ", m.BIT_TRANSFER());
        console.log("MIN_EXECUTE:  ", m.MIN_EXECUTE_AMOUNT());
    }
}
