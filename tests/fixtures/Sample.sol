// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// Upload fixture for the system tests. Content is fixed so its sha256
/// sourceHash is stable across runs (used by the regression goldens).
contract Sample {
    uint256 public value;

    function set(uint256 v) external {
        value = v;
    }
}
