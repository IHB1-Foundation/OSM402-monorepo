// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Counter - Example contract for toolchain verification
/// @notice This is a placeholder contract that will be replaced by actual GitPay contracts
contract Counter {
    uint256 public number;

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number++;
    }
}
