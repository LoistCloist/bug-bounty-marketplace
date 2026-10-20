// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/Vault.sol";

/// Claims an ordinary withdraw drains the vault. It doesn't, so this fails.
contract PoCTest is Test {
    function test_plainWithdrawDrainsVault() public {
        Vault vault = new Vault();
        address victim = makeAddr("victim");
        vm.deal(victim, 5 ether);
        vm.prank(victim);
        vault.deposit{value: 5 ether}();

        address user = makeAddr("user");
        vm.deal(user, 1 ether);
        vm.startPrank(user);
        vault.deposit{value: 1 ether}();
        vault.withdraw();
        vm.stopPrank();

        assertEq(address(vault).balance, 0, "vault should be drained");
    }
}
