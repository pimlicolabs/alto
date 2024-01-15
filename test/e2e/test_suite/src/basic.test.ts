import { bundlerActions, getSenderAddress, signUserOperationHashWithECDSA } from "permissionless"
import { pimlicoBundlerActions } from "permissionless/actions/pimlico"
import { concat, createClient, createPublicClient, encodeFunctionData, getContract, http, parseEther, toHex } from "viem";
import { foundry } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { BUNDLE_BULKER_ADDRESS, ENTRY_POINT_ADDRESS, PER_OP_INFLATOR_ADDRESS, SIMPLE_ACCOUNT_FACTORY_ADDRESS, SIMPLE_INFLATOR_ADDRESS, altoEndpoint, anvilDumpState, anvilEndpoint, anvilLoadState, fundAccount } from "./utils";
import { setupBasicEnvironment, setupCompressedEnvironment } from "./setup";
import { bundleBulkerDeployedBytecode, entryPointDeployedBytecode, perOpInflatorDeployedBytecode, simpleAccountFactoryAbi, simpleAccountFactoryDeployedBytecode, simpleInflatorAbi, simpleInflatorDeployedBytecode } from "./data";

// Holds the checkpoint after all contracts have been deployed.
let anvilCheckpoint: string | null = null

// This function will deploy all contracts (called once before all tests).
beforeAll(async () => {
    await setupBasicEnvironment()
    await setupCompressedEnvironment()

    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })

    // ensure that all addresses map to expected bytecode.
    expect(await publicClient.getBytecode({address: ENTRY_POINT_ADDRESS})).toEqual(entryPointDeployedBytecode)
    expect(await publicClient.getBytecode({address: SIMPLE_ACCOUNT_FACTORY_ADDRESS})).toEqual(simpleAccountFactoryDeployedBytecode)
    expect(await publicClient.getBytecode({address: BUNDLE_BULKER_ADDRESS})).toEqual(bundleBulkerDeployedBytecode)
    expect(await publicClient.getBytecode({address: PER_OP_INFLATOR_ADDRESS})).toEqual(perOpInflatorDeployedBytecode)
    expect(await publicClient.getBytecode({address: SIMPLE_INFLATOR_ADDRESS})).toEqual(simpleInflatorDeployedBytecode)
});

// This function will revert all contracts to the state before the tests were run (called once before all tests).
beforeEach(async () => {
    if (!anvilCheckpoint) {
        anvilCheckpoint = await anvilDumpState()
    } else {
        await anvilLoadState(anvilCheckpoint)
    }
})

afterEach(() => {

})

test.only("pimlico_sendCompressedUserOperation can submit a compressed userOp", async () => {
    // setup vars.
    const bundlerClient = createClient({
        transport: http(altoEndpoint),
        chain: foundry,
    }).extend(bundlerActions).extend(pimlicoBundlerActions)
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })
    const simpleInflator = getContract({
        address: SIMPLE_INFLATOR_ADDRESS,
        abi: simpleInflatorAbi,
        publicClient,
    })

    const owner = privateKeyToAccount(generatePrivateKey())

    // generate init code.
    const initCode = concat([
        SIMPLE_ACCOUNT_FACTORY_ADDRESS,
        encodeFunctionData({
            abi: simpleAccountFactoryAbi,
            functionName: "createAccount",
            args: [owner.address, 0n]
        })
    ]);

    const senderAddress = await getSenderAddress(publicClient, {
        initCode,
        entryPoint: ENTRY_POINT_ADDRESS
    })

    const gasPrice = await bundlerClient.getUserOperationGasPrice()

    const userOperation = {
        sender: senderAddress,
        nonce: 0n,
        initCode,
        callData: toHex(""),
        maxFeePerGas: gasPrice.fast.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        callGasLimit: 1000000n,
        verificationGasLimit: 1000000n,
        preVerificationGas: 1000000n,
        paymasterAndData: toHex(""),
        signature: toHex(""),
    }

    // sign user operation.
    userOperation.signature = await signUserOperationHashWithECDSA({
        account: owner,
        userOperation,
        chainId: foundry.id,
        entryPoint: ENTRY_POINT_ADDRESS
    })

    await fundAccount(senderAddress, parseEther("1337"))

    // compress the userOperation
    let compressed = await simpleInflator.read.compress([[userOperation]])
    console.log(compressed)

    const res = await fetch(altoEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'pimlico_sendCompressedUserOperation',
            params: [
                compressed,
                SIMPLE_INFLATOR_ADDRESS,
                ENTRY_POINT_ADDRESS,
            ],
            id: 4337
        })
    })
    .then(response => response.json())

    console.log(res)
})

test("eth_sendUserOperation can deploy a contract", async () => {
    // setup vars.
    const bundlerClient = createClient({
        transport: http(altoEndpoint),
        chain: foundry,
    }).extend(bundlerActions).extend(pimlicoBundlerActions)
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })

    const owner = privateKeyToAccount(generatePrivateKey())

    // generate init code.
    const initCode = concat([
        SIMPLE_ACCOUNT_FACTORY_ADDRESS,
        encodeFunctionData({
            abi: simpleAccountFactoryAbi,
            functionName: "createAccount",
            args: [owner.address, 0n]
        })
    ]);

    const senderAddress = await getSenderAddress(publicClient, {
        initCode,
        entryPoint: ENTRY_POINT_ADDRESS
    })

    const gasPrice = await bundlerClient.getUserOperationGasPrice()

    const userOperation = {
        sender: senderAddress,
        nonce: 0n,
        initCode,
        callData: toHex(""),
        maxFeePerGas: gasPrice.fast.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        callGasLimit: 1000000n,
        verificationGasLimit: 1000000n,
        preVerificationGas: 1000000n,
        paymasterAndData: toHex(""),
        signature: toHex(""),
    }

    // sign user operation.
    userOperation.signature = await signUserOperationHashWithECDSA({
        account: owner,
        userOperation,
        chainId: foundry.id,
        entryPoint: ENTRY_POINT_ADDRESS
    })

    await fundAccount(senderAddress, parseEther("1337"))

    await bundlerClient.sendUserOperation({
        userOperation: userOperation,
        entryPoint: ENTRY_POINT_ADDRESS
    })
})
