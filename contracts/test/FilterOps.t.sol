// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Test.sol";
import "../src/PimlicoSimulations.sol";

import {ForceReverter} from "@test-utils/ForceReverter.sol";
import {MessageHashUtils} from "openzeppelin-contracts-v5.0.2/contracts/utils/cryptography/MessageHashUtils.sol";
import {ECDSA} from "@openzeppelin-v4.8.3/contracts/utils/cryptography/ECDSA.sol";

import {UserOperation as UserOperation06} from "account-abstraction-v6/interfaces/UserOperation.sol";
import {IEntryPoint as IEntryPoint06} from "account-abstraction-v6/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint06} from "@test-aa-utils/v06/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory06} from "@test-aa-utils/v06/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount06} from "@test-aa-utils/v06/samples/SimpleAccount.sol";

import {PackedUserOperation as PackedUserOperation07} from "account-abstraction-v7/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint07} from "account-abstraction-v7/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint07} from "@test-aa-utils/v07/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory07} from "@test-aa-utils/v07/samples/SimpleAccountFactory.sol";
import {SimpleAccount as SimpleAccount07} from "@test-aa-utils/v07/samples/SimpleAccount.sol";

import {PackedUserOperation as PackedUserOperation08} from "account-abstraction-v8/interfaces/PackedUserOperation.sol";
import {IEntryPoint as IEntryPoint08} from "account-abstraction-v8/interfaces/IEntryPoint.sol";
import {EntryPoint as EntryPoint08} from "@test-aa-utils/v08/core/EntryPoint.sol";
import {SimpleAccountFactory as SimpleAccountFactory08} from "@test-aa-utils/v08/accounts/SimpleAccountFactory.sol";
import {BaseAccount as SimpleAccount08} from "@test-aa-utils/v08/core/BaseAccount.sol";

import {ExpiredPaymasterV06, ExpiredPaymasterV07, ExpiredPaymasterV08} from "./utils/ExpiredPaymasters.sol";
import {
    PostOpRevertPaymasterV06,
    PostOpRevertPaymasterV07,
    PostOpRevertPaymasterV08
} from "./utils/PostOpRevertPaymasters.sol";

contract FilterOpsTest is Test {
    PimlicoSimulations pimlicoSim;
    SimpleAccountFactory06 accountFactory06;
    SimpleAccountFactory07 accountFactory07;
    SimpleAccountFactory08 accountFactory08;
    EntryPoint06 entryPoint06;
    EntryPoint07 entryPoint07;
    EntryPoint08 entryPoint08;

    address payable beneficiary = payable(address(0x1234));
    address owner;
    uint256 ownerKey;

    address forceReverter;
    ExpiredPaymasterV06 expiredPaymaster06;
    ExpiredPaymasterV07 expiredPaymaster07;
    ExpiredPaymasterV08 expiredPaymaster08;
    PostOpRevertPaymasterV06 postOpRevertPaymaster06;
    PostOpRevertPaymasterV07 postOpRevertPaymaster07;
    PostOpRevertPaymasterV08 postOpRevertPaymaster08;

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("alice");
        pimlicoSim = new PimlicoSimulations();
        entryPoint06 = new EntryPoint06();
        entryPoint07 = new EntryPoint07();
        entryPoint08 = new EntryPoint08();
        accountFactory06 = new SimpleAccountFactory06(entryPoint06);
        accountFactory07 = new SimpleAccountFactory07(entryPoint07);
        accountFactory08 = new SimpleAccountFactory08(entryPoint08);

        forceReverter = address(new ForceReverter());

        // Deploy and fund expired paymasters
        expiredPaymaster06 = new ExpiredPaymasterV06(entryPoint06);
        expiredPaymaster07 = new ExpiredPaymasterV07(entryPoint07);
        expiredPaymaster08 = new ExpiredPaymasterV08(entryPoint08);

        expiredPaymaster06.deposit{value: 10 ether}();
        expiredPaymaster07.deposit{value: 10 ether}();
        expiredPaymaster08.deposit{value: 10 ether}();

        // Deploy and fund postOp revert paymasters
        postOpRevertPaymaster06 = new PostOpRevertPaymasterV06(entryPoint06);
        postOpRevertPaymaster07 = new PostOpRevertPaymasterV07(entryPoint07);
        postOpRevertPaymaster08 = new PostOpRevertPaymasterV08(entryPoint08);

        postOpRevertPaymaster06.deposit{value: 10 ether}();
        postOpRevertPaymaster07.deposit{value: 10 ether}();
        postOpRevertPaymaster08.deposit{value: 10 ether}();
    }

    // ============================================
    // =========== ENTRYPOINT 06 TESTS ============
    // ============================================

    // Test filterOps06 with all valid operations
    function testFilterOps06_AllValid() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps06 with one failing operation
    function testFilterOps06_OneFailingOp() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        }); // No funds
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA21 didn't pay prefund")
        );
    }

    // Test filterOps06 with invalid signature
    function testFilterOps06_InvalidSignature() public {
        TestAccount[] memory accounts = new TestAccount[](1);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        // Replace with invalid signature
        ops[0].signature = hex"deadbeef";

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Operation should be rejected
        _assertAllFailedResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA23 reverted: ECDSA: invalid signature length")
        );
    }

    // Test filterOps06 with all failing operations
    function testFilterOps06_AllFailingOps() public {
        TestAccount[] memory accounts = new TestAccount[](2);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps06 with empty array
    function testFilterOps06_EmptyArray() public {
        UserOperation06[] memory ops = new UserOperation06[](0);
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);
        _assertEmptyResult(result);
    }

    // Test filterOps06 with reverting userOp.callData (all ops should be valid)
    function testFilterOps06_OneCallPhaseRevert() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: true,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        }); // callphase reverting
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);
        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps06 with expired paymaster (AA32 error)
    function testFilterOps06_ExpiredPaymaster() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: true,
            usePostOpRevertPaymaster: false
        }); // use expired paymaster
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        // Advance block timestamp to ensure the paymaster validation fails
        vm.warp(block.timestamp + 2);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Second operation should be rejected with AA32 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA32 paymaster expired or not due")
        );
    }

    // Test filterOps06 with postOp reverting paymaster (AA50 error)
    function testFilterOps06_PostOpRevertPaymaster() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: true
        }); // use postOp revert paymaster
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        UserOperation06[] memory ops = _createAndSignOps06(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps06(ops, beneficiary, entryPoint06);

        // Second operation should be rejected with AA50 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint06.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint06.FailedOp.selector, 0, "AA50 postOp reverted: AA50 postOp reverted")
        );
    }

    // ============================================
    // =========== ENTRYPOINT 07 TESTS ============
    // ============================================

    // Test filterOps07 with all valid operations
    function testFilterOps07_AllValid() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps07 with one failing operation
    function testFilterOps07_OneFailingOp() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        }); // No funds
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint07.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint07.FailedOp.selector, 0, "AA21 didn't pay prefund")
        );
    }

    // Test filterOps07 with invalid signature
    function testFilterOps07_InvalidSignature() public {
        TestAccount[] memory accounts = new TestAccount[](1);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        // Replace with invalid signature
        ops[0].signature = hex"deadbeef";

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // Operation should be rejected
        _assertAllFailedResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(
                IEntryPoint07.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(
                    bytes4(keccak256("ECDSAInvalidSignatureLength(uint256)")), uint256(ops[0].signature.length)
                )
            )
        );
    }

    // Test filterOps07 with all failing operations
    function testFilterOps07_AllFailingOps() public {
        TestAccount[] memory accounts = new TestAccount[](2);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps07 with empty array
    function testFilterOps07_EmptyArray() public {
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](0);
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);
        _assertEmptyResult(result);
    }

    // Test filterOps07 with reverting userOp.callData (all ops should be valid)
    function testFilterOps07_OneCallPhaseRevert() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: true,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        }); // callphase reverting
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);
        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps07 with expired paymaster (AA32 error)
    function testFilterOps07_ExpiredPaymaster() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: true,
            usePostOpRevertPaymaster: false
        }); // use expired paymaster
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        // Advance block timestamp to ensure the paymaster validation fails
        vm.warp(block.timestamp + 2);

        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // Second operation should be rejected with AA32 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint07.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint07.FailedOp.selector, 0, "AA32 paymaster expired or not due")
        );
    }

    // Test filterOps07 with postOp reverting paymaster (should still succeed in v0.7+)
    function testFilterOps07_PostOpRevertPaymaster() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: true
        }); // use postOp revert paymaster
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation07[] memory ops = _createAndSignOps07(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result = pimlicoSim.filterOps07(ops, beneficiary, entryPoint07);

        // In v0.7+, postOp reverts don't cause operation failure - all ops should succeed
        _assertValidOpsResult(result, balanceBefore);
    }

    // ============================================
    // =========== ENTRYPOINT 08 TESTS ============
    // ============================================

    // Test filterOps08 with all valid operations
    function testFilterOps08_AllValid() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps08 with one failing operation
    function testFilterOps08_OneFailingOp() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        }); // No funds
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint08.getUserOpHash(ops[1]), "Second op should be rejected"
        );
    }

    // Test filterOps08 with invalid signature
    function testFilterOps08_InvalidSignature() public {
        TestAccount[] memory accounts = new TestAccount[](1);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        // Replace with invalid signature
        ops[0].signature = hex"deadbeef";

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        // Operation should be rejected
        _assertAllFailedResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(
                IEntryPoint08.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(
                    bytes4(keccak256("ECDSAInvalidSignatureLength(uint256)")), uint256(ops[0].signature.length)
                )
            )
        );
    }

    // Test filterOps08 with all failing operations
    function testFilterOps08_AllFailingOps() public {
        TestAccount[] memory accounts = new TestAccount[](2);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: false,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        _assertAllFailedResult(result, 2);
    }

    // Test filterOps08 with empty array
    function testFilterOps08_EmptyArray() public {
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](0);
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);
        _assertEmptyResult(result);
    }

    // Test filterOps08 with reverting userOp.callData (all ops should be valid)
    function testFilterOps08_OneCallPhaseRevert() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: true,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        }); // callphase reverting
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);
        _assertValidOpsResult(result, balanceBefore);
    }

    // Test filterOps08 with expired paymaster (AA32 error)
    function testFilterOps08_ExpiredPaymaster() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: true,
            usePostOpRevertPaymaster: false
        }); // use expired paymaster
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        // Advance block timestamp to ensure the paymaster validation fails
        vm.warp(block.timestamp + 2);

        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        // Second operation should be rejected with AA32 error
        _assertPartialFailureResult(result, 1);
        assertEq(
            result.rejectedUserOps[0].userOpHash, entryPoint08.getUserOpHash(ops[1]), "Second op should be rejected"
        );
        assertEq(
            result.rejectedUserOps[0].revertReason,
            abi.encodeWithSelector(IEntryPoint08.FailedOp.selector, 0, "AA32 paymaster expired or not due")
        );
    }

    // Test filterOps08 with postOp reverting paymaster (should still succeed in v0.8)
    function testFilterOps08_PostOpRevertPaymaster() public {
        TestAccount[] memory accounts = new TestAccount[](3);
        accounts[0] = TestAccount({
            salt: 0,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });
        accounts[1] = TestAccount({
            salt: 1,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: true
        }); // use postOp revert paymaster
        accounts[2] = TestAccount({
            salt: 2,
            shouldRevert: false,
            shouldFund: true,
            useExpiredPaymaster: false,
            usePostOpRevertPaymaster: false
        });

        PackedUserOperation08[] memory ops = _createAndSignOps08(accounts);

        uint256 balanceBefore = beneficiary.balance;
        PimlicoSimulations.FilterOpsResult memory result =
            pimlicoSim.filterOps08(castToVersion07(ops), beneficiary, entryPoint08);

        // In v0.8, postOp reverts don't cause operation failure - all ops should succeed
        _assertValidOpsResult(result, balanceBefore);
    }

    // ============================================
    // ================= HELPERS ==================
    // ============================================

    struct TestAccount {
        uint256 salt;
        bool shouldRevert;
        bool shouldFund;
        bool useExpiredPaymaster;
        bool usePostOpRevertPaymaster;
    }

    function _setupAccounts06(TestAccount[] memory accounts) private {
        for (uint256 i = 0; i < accounts.length; i++) {
            accountFactory06.createAccount(owner, accounts[i].salt);
            if (accounts[i].shouldFund) {
                address addr = accountFactory06.getAddress(owner, accounts[i].salt);
                vm.deal(addr, 1 ether);
            }
        }
    }

    function _setupAccounts07(TestAccount[] memory accounts) private {
        for (uint256 i = 0; i < accounts.length; i++) {
            accountFactory07.createAccount(owner, accounts[i].salt);
            if (accounts[i].shouldFund) {
                address addr = accountFactory07.getAddress(owner, accounts[i].salt);
                vm.deal(addr, 1 ether);
            }
        }
    }

    function _setupAccounts08(TestAccount[] memory accounts) private {
        vm.startPrank(address(entryPoint08.senderCreator()));
        for (uint256 i = 0; i < accounts.length; i++) {
            accountFactory08.createAccount(owner, accounts[i].salt);
            if (accounts[i].shouldFund) {
                address addr = accountFactory08.getAddress(owner, accounts[i].salt);
                vm.deal(addr, 1 ether);
            }
        }
        vm.stopPrank();
    }

    function _createAndSignOps06(TestAccount[] memory accounts) private returns (UserOperation06[] memory) {
        _setupAccounts06(accounts);
        UserOperation06[] memory ops = new UserOperation06[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            address addr = accountFactory06.getAddress(owner, accounts[i].salt);

            // Build v0.6 UserOperation
            bytes memory initCode = "";
            if (addr.code.length == 0) {
                initCode = abi.encodePacked(
                    address(accountFactory06), abi.encodeCall(accountFactory06.createAccount, (owner, accounts[i].salt))
                );
            }

            bytes memory callData = "";
            if (accounts[i].shouldRevert) {
                bytes memory revertData =
                    abi.encodeWithSelector(ForceReverter.forceRevertWithMessage.selector, "foobar");
                callData = abi.encodeWithSelector(SimpleAccount06.execute.selector, forceReverter, 0, revertData);
            } else {
                callData = abi.encodeWithSelector(SimpleAccount06.execute.selector, address(0), 0, "");
            }

            bytes memory paymasterAndData = "";
            if (accounts[i].useExpiredPaymaster) {
                paymasterAndData = abi.encodePacked(address(expiredPaymaster06));
            } else if (accounts[i].usePostOpRevertPaymaster) {
                paymasterAndData = abi.encodePacked(address(postOpRevertPaymaster06));
            }

            ops[i] = UserOperation06({
                sender: addr,
                nonce: 0,
                initCode: initCode,
                callData: callData,
                callGasLimit: 100000,
                verificationGasLimit: 150000,
                preVerificationGas: 21000,
                maxFeePerGas: 1 gwei,
                maxPriorityFeePerGas: 1 gwei,
                paymasterAndData: paymasterAndData,
                signature: ""
            });

            // Sign the UserOperation
            bytes32 hash = entryPoint06.getUserOpHash(ops[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ECDSA.toEthSignedMessageHash(hash));
            ops[i].signature = abi.encodePacked(r, s, v);
        }
        return ops;
    }

    function _createAndSignOps07(TestAccount[] memory accounts) private returns (PackedUserOperation07[] memory) {
        _setupAccounts07(accounts);
        PackedUserOperation07[] memory ops = new PackedUserOperation07[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            address addr = accountFactory07.getAddress(owner, accounts[i].salt);

            // Build v0.7 PackedUserOperation
            bytes memory initCode = "";
            if (addr.code.length == 0) {
                initCode = abi.encodePacked(
                    address(accountFactory07), abi.encodeCall(accountFactory07.createAccount, (owner, accounts[i].salt))
                );
            }

            bytes memory callData = "";
            if (accounts[i].shouldRevert) {
                bytes memory revertData =
                    abi.encodeWithSelector(ForceReverter.forceRevertWithMessage.selector, "foobar");
                callData = abi.encodeWithSelector(SimpleAccount07.execute.selector, forceReverter, 0, revertData);
            } else {
                callData = abi.encodeWithSelector(SimpleAccount07.execute.selector, address(0), 0, "");
            }

            bytes memory paymasterAndData = "";
            if (accounts[i].useExpiredPaymaster) {
                paymasterAndData = abi.encodePacked(
                    address(expiredPaymaster07),
                    uint128(100000), // verificationGasLimit
                    uint128(50000) // postOpGasLimit
                );
            } else if (accounts[i].usePostOpRevertPaymaster) {
                paymasterAndData = abi.encodePacked(
                    address(postOpRevertPaymaster07),
                    uint128(100000), // verificationGasLimit
                    uint128(50000) // postOpGasLimit
                );
            }

            // Pack gas limits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
            uint256 accountGasLimits = (uint256(150000) << 128) | uint256(100000);

            ops[i] = PackedUserOperation07({
                sender: addr,
                nonce: 0,
                initCode: initCode,
                callData: callData,
                accountGasLimits: bytes32(accountGasLimits),
                preVerificationGas: 21000,
                gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)), // maxPriorityFeePerGas | maxFeePerGas
                paymasterAndData: paymasterAndData,
                signature: ""
            });

            // Sign the PackedUserOperation
            bytes32 hash = entryPoint07.getUserOpHash(ops[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, MessageHashUtils.toEthSignedMessageHash(hash));
            ops[i].signature = abi.encodePacked(r, s, v);
        }
        return ops;
    }

    function _createAndSignOps08(TestAccount[] memory accounts) private returns (PackedUserOperation08[] memory) {
        _setupAccounts08(accounts);
        PackedUserOperation08[] memory ops = new PackedUserOperation08[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            address addr = accountFactory08.getAddress(owner, accounts[i].salt);

            // Build v0.8 PackedUserOperation
            bytes memory initCode = "";
            if (addr.code.length == 0) {
                initCode = abi.encodePacked(
                    address(accountFactory08), abi.encodeCall(accountFactory08.createAccount, (owner, accounts[i].salt))
                );
            }

            bytes memory callData = "";
            if (accounts[i].shouldRevert) {
                bytes memory revertData =
                    abi.encodeWithSelector(ForceReverter.forceRevertWithMessage.selector, "foobar");
                callData = abi.encodeWithSelector(SimpleAccount08.execute.selector, forceReverter, 0, revertData);
            } else {
                callData = abi.encodeWithSelector(SimpleAccount08.execute.selector, address(0), 0, "");
            }

            bytes memory paymasterAndData = "";
            if (accounts[i].useExpiredPaymaster) {
                paymasterAndData = abi.encodePacked(
                    address(expiredPaymaster08),
                    uint128(100000), // verificationGasLimit
                    uint128(50000) // postOpGasLimit
                );
            } else if (accounts[i].usePostOpRevertPaymaster) {
                paymasterAndData = abi.encodePacked(
                    address(postOpRevertPaymaster08),
                    uint128(100000), // verificationGasLimit
                    uint128(50000) // postOpGasLimit
                );
            }

            // Pack gas limits: verificationGasLimit (16 bytes) | callGasLimit (16 bytes)
            uint256 accountGasLimits = (uint256(150000) << 128) | uint256(100000);

            ops[i] = PackedUserOperation08({
                sender: addr,
                nonce: 0,
                initCode: initCode,
                callData: callData,
                accountGasLimits: bytes32(accountGasLimits),
                preVerificationGas: 21000,
                gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)), // maxPriorityFeePerGas | maxFeePerGas
                paymasterAndData: paymasterAndData,
                signature: ""
            });

            // Sign the PackedUserOperation
            bytes32 hash = entryPoint08.getUserOpHash(ops[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, hash);
            ops[i].signature = abi.encodePacked(r, s, v);
        }
        return ops;
    }

    function castToVersion07(PackedUserOperation08 memory op) internal pure returns (PackedUserOperation07 memory) {
        return PackedUserOperation07({
            sender: op.sender,
            nonce: op.nonce,
            initCode: op.initCode,
            callData: op.callData,
            accountGasLimits: op.accountGasLimits,
            preVerificationGas: op.preVerificationGas,
            gasFees: op.gasFees,
            paymasterAndData: op.paymasterAndData,
            signature: op.signature
        });
    }

    function castToVersion07(PackedUserOperation08[] memory ops)
        internal
        pure
        returns (PackedUserOperation07[] memory)
    {
        PackedUserOperation07[] memory convertedOps = new PackedUserOperation07[](ops.length);
        for (uint256 i = 0; i < ops.length; i++) {
            convertedOps[i] = castToVersion07(ops[i]);
        }
        return convertedOps;
    }

    // ============================================
    // ============== TEST HELPERS ================
    // ============================================

    function _assertValidOpsResult(PimlicoSimulations.FilterOpsResult memory result, uint256 balanceBefore) private {
        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
        assertEq(beneficiary.balance - balanceBefore, result.balanceChange, "Balance change should match");
    }

    function _assertPartialFailureResult(PimlicoSimulations.FilterOpsResult memory result, uint256 expectedRejected)
        private
    {
        assertEq(result.rejectedUserOps.length, expectedRejected, "Expected number of operations should be rejected");
        assertGt(result.gasUsed, 0, "Gas should be used");
        assertGt(result.balanceChange, 0, "Balance should increase");
    }

    function _assertAllFailedResult(PimlicoSimulations.FilterOpsResult memory result, uint256 totalOps) private {
        assertEq(result.rejectedUserOps.length, totalOps, "All operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }

    function _assertEmptyResult(PimlicoSimulations.FilterOpsResult memory result) private {
        assertEq(result.rejectedUserOps.length, 0, "No operations should be rejected");
        assertEq(result.gasUsed, 0, "No gas should be used");
        assertEq(result.balanceChange, 0, "Balance should not change");
    }
}
