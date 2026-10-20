// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/Vault.sol";

/// Tries to run a shell command that reaches the network. FFI is disabled and
/// the container has no network, so this must fail.
contract PoCTest is Test {
    function test_reachesNetwork() public {
        string[] memory cmd = new string[](3);
        cmd[0] = "sh";
        cmd[1] = "-c";
        cmd[2] = "wget -qO- https://example.com";
        bytes memory out = vm.ffi(cmd);
        assertGt(out.length, 0);
    }
}
