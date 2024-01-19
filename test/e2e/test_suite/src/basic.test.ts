import { UserOperation, createSmartAccountClient } from "permissionless"
import { privateKeyToSimpleSmartAccount } from "permissionless/accounts";
import { Address, createPublicClient, createTestClient, getContract, http, parseEther, parseGwei } from "viem";
import { foundry } from "viem/chains";
import { generatePrivateKey } from "viem/accounts";
import {
    BUNDLE_BULKER_ADDRESS,
    ENTRY_POINT_ADDRESS,
    PER_OP_INFLATOR_ADDRESS,
    SIMPLE_ACCOUNT_FACTORY_ADDRESS,
    SIMPLE_INFLATOR_ADDRESS,
    altoEndpoint,
    anvilDumpState,
    anvilEndpoint,
    anvilLoadState,
    fundAccount,
    setupSimpleSmartAccountClient,
    compressAndSendOp,
    setBundlingMode,
    clearBundlerState,
    sendBundleNow
} from "./utils";
import { setupBasicEnvironment, setupCompressedEnvironment } from "./setup";
import {
    bundleBulkerDeployedBytecode,
    entryPointDeployedBytecode,
    perOpInflatorDeployedBytecode,
    simpleAccountFactoryDeployedBytecode,
    simpleInflatorDeployedBytecode
} from "./data";
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico";

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

    // ensure that all bytecode is deployed to expected addresses.
    expect(await publicClient.getBytecode({ address: ENTRY_POINT_ADDRESS })).toEqual(entryPointDeployedBytecode)
    expect(await publicClient.getBytecode({ address: SIMPLE_ACCOUNT_FACTORY_ADDRESS })).toEqual(simpleAccountFactoryDeployedBytecode)
    expect(await publicClient.getBytecode({ address: BUNDLE_BULKER_ADDRESS })).toEqual(bundleBulkerDeployedBytecode)
    expect(await publicClient.getBytecode({ address: PER_OP_INFLATOR_ADDRESS })).toEqual(perOpInflatorDeployedBytecode)
    expect(await publicClient.getBytecode({ address: SIMPLE_INFLATOR_ADDRESS })).toEqual(simpleInflatorDeployedBytecode)
});

// This function will revert all contracts to the state before the tests were run (called once before all tests).
beforeEach(async () => {
    clearBundlerState()
    setBundlingMode("auto")

    if (!anvilCheckpoint) {
        anvilCheckpoint = await anvilDumpState()
    } else {
        await anvilLoadState(anvilCheckpoint)
    }
})

test.only("pimlico_sendCompressedUserOperation can replace mempool transaction", async () => {
    const pimlicoClient = createPimlicoBundlerClient({
        transport: http(altoEndpoint),
    })
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })
    const anvilClient = createTestClient({
        chain: foundry,
        mode: 'anvil',
        transport: http(anvilEndpoint)
    })

    const target = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    const amt = parseEther("0.1337")

    const smartAccount = await setupSimpleSmartAccountClient(publicClient, pimlicoClient)
    await anvilClient.setAutomine(false)

    await anvilClient.mine({ blocks: 1 })

    const op = await smartAccount.prepareUserOperationRequest({
        userOperation: {
            callData: await smartAccount.account.encodeCallData({
                to: target,
                value: amt,
                data: "0x",
            }),
        }
    })
    op.signature = await smartAccount.account.signUserOperation(op)

    const opHash = await compressAndSendOp(op, publicClient, pimlicoClient)

    await new Promise(resolve => setTimeout(resolve, 1000))

    await anvilClient.setNextBlockBaseFeePerGas({
        baseFeePerGas: parseGwei('150')
    })

    await anvilClient.mine({ blocks: 1 })
    await new Promise(resolve => setTimeout(resolve, 1000))

    let opReceipt = await pimlicoClient.getUserOperationReceipt({ hash: opHash })
    console.log("should fail", opReceipt)

    await anvilClient.mine({ blocks: 1 })

    opReceipt = await pimlicoClient.getUserOperationReceipt({ hash: opHash })
    console.log("should pass", opReceipt)
})

test("pimlico_sendCompressedUserOperation can bundle multiple compressed userOps", async () => {
    const pimlicoClient = createPimlicoBundlerClient({
        transport: http(altoEndpoint),
    })
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })

    // sender -> relay -> target
    const sender = await setupSimpleSmartAccountClient(publicClient, pimlicoClient)
    const relayer = await setupSimpleSmartAccountClient(publicClient, pimlicoClient)

    const target = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    const amt = parseEther("0.1337")

    // create sender op
    const senderOp = await sender.prepareUserOperationRequest({
        userOperation: {
            callData: await sender.account.encodeCallData({
                to: relayer.account.address,
                value: amt,
                data: "0x",
            }),
        }
    })

    senderOp.signature = await sender.account.signUserOperation(senderOp)

    // create relayer op
    const relayerOp = await relayer.prepareUserOperationRequest({
        userOperation: {
            callData: await relayer.account.encodeCallData({
                to: target,
                value: amt,
                data: "0x",
            }),
        }
    })

    relayerOp.signature = await relayer.account.signUserOperation(relayerOp)

    setBundlingMode("manual")

    const senderHash = await compressAndSendOp(senderOp, publicClient, pimlicoClient)
    const relayerHash = await compressAndSendOp(relayerOp, publicClient, pimlicoClient)

    await sendBundleNow()

    console.log("senderHash", senderHash)
    console.log("relayerHash", relayerHash)
})

test("pimlico_sendCompressedUserOperation can submit a compressed userOp", async () => {
    const pimlicoClient = createPimlicoBundlerClient({
        transport: http(altoEndpoint),
    })
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })

    const smartAccountClient = await setupSimpleSmartAccountClient(publicClient, pimlicoClient)

    const targetAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    const targetAmt = parseEther("0.1337")

    const userOperation = await smartAccountClient.prepareUserOperationRequest({
        userOperation: {
            callData: await smartAccountClient.account.encodeCallData({
                to: targetAddress,
                value: targetAmt,
                data: "0x",
            }),
        }
    })

    userOperation.signature = await smartAccountClient.account.signUserOperation(userOperation)

    const opHash = await compressAndSendOp(userOperation, publicClient, pimlicoClient)
    pimlicoClient.waitForUserOperationReceipt({ hash: opHash })

    expect(await publicClient.getBalance({ address: targetAddress })).toEqual(targetAmt)
})

test("eth_sendUserOperation can submit a userOperation", async () => {
    const bundlerClient = createPimlicoBundlerClient({
        transport: http(altoEndpoint),
    });
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })

    const simpleAccount = await privateKeyToSimpleSmartAccount(publicClient, {
        privateKey: generatePrivateKey(),
        factoryAddress: SIMPLE_ACCOUNT_FACTORY_ADDRESS,
        entryPoint: ENTRY_POINT_ADDRESS,
    });

    await fundAccount(simpleAccount.address, parseEther("1337"))

    const smartAccountClient = createSmartAccountClient({
        account: simpleAccount,
        chain: foundry,
        transport: http(altoEndpoint),
        sponsorUserOperation: async (args: {
            userOperation: UserOperation;
            entryPoint: Address;
        }) => {
            const gasInfo = await bundlerClient.estimateUserOperationGas(args)
            return Promise.resolve({
                ...args.userOperation,
                preVerificationGas: gasInfo.preVerificationGas,
                verificationGasLimit: gasInfo.verificationGasLimit,
                callGasLimit: gasInfo.callGasLimit * 5n,
            });
        },
    });

    const targetAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    const targetAmt = parseEther("0.1337")

    smartAccountClient.prepareUserOperationRequest

    await smartAccountClient.sendTransaction({
        to: targetAddress,
        value: targetAmt,
    })

    expect(await publicClient.getBalance({ address: targetAddress })).toEqual(targetAmt)
})
