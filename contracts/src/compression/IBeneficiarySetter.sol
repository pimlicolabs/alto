// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.8;

interface IBeneficiarySetter {
    function getBeneficiary() external view returns (address payable);
}
