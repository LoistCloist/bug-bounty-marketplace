// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/Smoke.sol";

contract SmokeTest is Test {
    function test_answer() public {
        assertEq(new Smoke().answer(), 42);
    }
}
