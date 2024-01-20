import { Hex, createPublicClient, createTestClient, http, parseEther, parseGwei } from "viem";
import { foundry } from "viem/chains";
import {
    BUNDLE_BULKER_ADDRESS,
    ENTRY_POINT_ADDRESS,
    PER_OP_INFLATOR_ADDRESS,
    SIMPLE_ACCOUNT_FACTORY_ADDRESS,
    SIMPLE_INFLATOR_ADDRESS,
    altoEndpoint,
    anvilEndpoint,
    setupSimpleSmartAccountClient,
    compressAndSendOp,
    setBundlingMode,
    clearBundlerState,
    sendBundleNow,
    newRandomAddress,
    resetAnvil
} from "./utils";
import { setupBasicEnvironment, setupCompressedEnvironment } from "./setup";
import {
    bundleBulkerDeployedBytecode,
    entryPointDeployedBytecode,
    perOpInflatorDeployedBytecode,
    simpleAccountDeployedBytecode,
    simpleAccountFactoryDeployedBytecode,
    simpleInflatorDeployedBytecode
} from "./data";
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico";

// Holds the checkpoint after all contracts have been deployed.
let anvilCheckpoint: Hex | null = null

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
    resetAnvil(anvilClient)

    if (!anvilCheckpoint) {
        anvilCheckpoint = await anvilClient.dumpState()
    } else {
        await anvilClient.loadState({ state: anvilCheckpoint })
    }
})

test("eth_sendUserOperation can submit a userOperation", async () => {
    const smartAccount = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)

    const target = newRandomAddress()
    const amt = parseEther("0.1337")

    smartAccount.prepareUserOperationRequest

    await smartAccount.sendTransaction({
        to: target,
        value: amt,
    })

    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    expect(await publicClient.getBytecode({ address: smartAccount.account.address })).toEqual(simpleAccountDeployedBytecode)
})

test("pimlico_sendCompressedUserOperation can submit a compressed userOp", async () => {
    const smartAccount = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)

    const target = newRandomAddress()
    const amt = parseEther("0.1337")

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
    await pimlicoClient.waitForUserOperationReceipt({ hash: opHash })

    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
})

test("pimlico_sendCompressedUserOperation can replace mempool transaction", async () => {
    const target = newRandomAddress()
    const amt = parseEther("0.1337")

    const smartAccount = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)
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
    await new Promise(resolve => setTimeout(resolve, 1500))

    await anvilClient.setNextBlockBaseFeePerGas({
        baseFeePerGas: parseGwei('150')
    })

    await anvilClient.mine({ blocks: 1 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    let opReceipt = await pimlicoClient.getUserOperationReceipt({ hash: opHash })
    expect(opReceipt).toBeNull() // no tx should be mined

    await anvilClient.mine({ blocks: 1 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    opReceipt = await pimlicoClient.getUserOperationReceipt({ hash: opHash })

    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    expect(await publicClient.getBytecode({ address: smartAccount.account.address })).toEqual(simpleAccountDeployedBytecode)
})

test("pimlico_sendCompressedUserOperation can bundle multiple compressed userOps", async () => {
    const sender = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)
    const relayer = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)

    const target = newRandomAddress()
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

    expect(await pimlicoClient.getUserOperationReceipt({ hash: senderHash })).toBeNull()
    expect(await pimlicoClient.getUserOperationReceipt({ hash: relayerHash })).toBeNull()

    await sendBundleNow()

    expect((await pimlicoClient.waitForUserOperationReceipt({ hash: senderHash })).success).toEqual(true)
    expect((await pimlicoClient.waitForUserOperationReceipt({ hash: relayerHash })).success).toEqual(true)

    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    expect(await publicClient.getBytecode({ address: sender.account.address })).toEqual(simpleAccountDeployedBytecode)
    expect(await publicClient.getBytecode({ address: relayer.account.address })).toEqual(simpleAccountDeployedBytecode)
})
