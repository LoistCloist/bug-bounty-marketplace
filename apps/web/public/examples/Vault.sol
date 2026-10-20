// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// Deliberately vulnerable vault used by the analysis and sandbox tests.
/// `withdraw` sends ETH before zeroing the caller's balance, so a contract
/// that re-enters `withdraw` from its receive hook drains every deposit.
contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "nothing to withdraw");
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "transfer failed");
        balances[msg.sender] = 0;
    }

    function totalHeld() external view returns (uint256) {
        return address(this).balance;
    }
}
