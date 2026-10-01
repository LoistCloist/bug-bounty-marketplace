// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Placeholder} from "../src/Placeholder.sol";

contract PlaceholderTest is Test {
    Placeholder internal placeholder;

    function setUp() public {
        placeholder = new Placeholder();
    }

    function test_isPlaceholder() public view {
        assertTrue(placeholder.isPlaceholder());
    }
}
