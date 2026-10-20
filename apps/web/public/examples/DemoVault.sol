// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Demonstration input only. Not audited or intended for deployment.
contract DemoVault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
        balances[msg.sender] = 0;
    }
}
