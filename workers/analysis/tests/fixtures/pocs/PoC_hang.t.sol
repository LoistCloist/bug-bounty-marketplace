// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/Vault.sol";

/// Never finishes: gas metering is paused, so the loop never runs out of gas.
contract PoCTest is Test {
    function test_hangs() public {
        vm.pauseGasMetering();
        uint256 i;
        while (true) {
            i++;
        }
    }
}
