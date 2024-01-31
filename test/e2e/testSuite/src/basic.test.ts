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
    resetAnvil,
    MULTICALL3_ADDRESS
} from "./utils";
import {
    bundleBulkerDeployedBytecode,
    entryPointDeployedBytecode,
    multicall3DeployedBytecode,
    perOpInflatorDeployedBytecode,
    simpleAccountDeployedBytecode,
    simpleAccountFactoryDeployedBytecode,
    simpleInflatorDeployedBytecode
} from "./data";
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico";

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
    // ensure that all bytecode is deployed to expected addresses.
    expect(await publicClient.getBytecode({ address: ENTRY_POINT_ADDRESS })).toEqual(entryPointDeployedBytecode)
    expect(await publicClient.getBytecode({ address: SIMPLE_ACCOUNT_FACTORY_ADDRESS })).toEqual(simpleAccountFactoryDeployedBytecode)
    expect(await publicClient.getBytecode({ address: BUNDLE_BULKER_ADDRESS })).toEqual(bundleBulkerDeployedBytecode)
    expect(await publicClient.getBytecode({ address: PER_OP_INFLATOR_ADDRESS })).toEqual(perOpInflatorDeployedBytecode)
    expect(await publicClient.getBytecode({ address: SIMPLE_INFLATOR_ADDRESS })).toEqual(simpleInflatorDeployedBytecode)
    expect(await publicClient.getBytecode({ address: MULTICALL3_ADDRESS })).toEqual(multicall3DeployedBytecode)
});

// This function will revert all contracts to the state before the tests were run (called once before all tests).
beforeEach(async () => {
    clearBundlerState()
    setBundlingMode("auto")
    resetAnvil(anvilClient)
})

test("eth_sendUserOperation can submit a userOperation", async () => {
    const smartAccount = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)

    const target = newRandomAddress()
    const amt = parseEther("0.1337")

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

    const opHash = await compressAndSendOp(op, publicClient)
    await pimlicoClient.waitForUserOperationReceipt({ hash: opHash })

    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
})

test("pimlico_sendCompressedUserOperation can replace a mempool transaction", async () => {
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

    const opHash = await compressAndSendOp(op, publicClient)
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

test("pimlico_getUserOperationStatus returns correct values", async () => {
    const smartAccount = await setupSimpleSmartAccountClient(pimlicoClient, publicClient)

    // send a random tx to force a contract deployment
    await smartAccount.sendTransaction({to: newRandomAddress() })

    const nonce = await smartAccount.account.getNonce()

    // add a op to the nonce queue
    let op = await smartAccount.prepareUserOperationRequest({
        userOperation: {
            nonce: nonce + 1n,
            callData: await smartAccount.account.encodeCallData({
                to: newRandomAddress(),
                value: parseEther("0.1337"),
                data: "0x",
            }),
        }
    })
    op.signature = await smartAccount.account.signUserOperation(op)

    // check queued op
    const hashHigherNonce = await pimlicoClient.sendUserOperation({userOperation: op, entryPoint: ENTRY_POINT_ADDRESS})
    const queued = await pimlicoClient.getUserOperationStatus({hash: hashHigherNonce})
    expect(queued.status).toEqual("queued")

    // check submitted op
    op = await smartAccount.prepareUserOperationRequest({
        userOperation: {
            nonce,
            callData: await smartAccount.account.encodeCallData({
                to: newRandomAddress(),
                value: parseEther("0.1337"),
                data: "0x",
            }),
        }
    })
    op.signature = await smartAccount.account.signUserOperation(op)

    anvilClient.setAutomine(false)

    const hashLowerNonce = await pimlicoClient.sendUserOperation({userOperation: op, entryPoint: ENTRY_POINT_ADDRESS})
    await new Promise(resolve => setTimeout(resolve, 1500))

    // lower nonce should get mined here
    await anvilClient.mine({ blocks: 1 })
    await new Promise(resolve => setTimeout(resolve, 1500))

    // lower nonce op should be included
    const included = await pimlicoClient.getUserOperationStatus({ hash: hashLowerNonce })
    expect(included.status).toEqual("included")

    // higher nonce op should be submitted
    await new Promise(resolve => setTimeout(resolve, 1500))
    const submitted = await pimlicoClient.getUserOperationStatus({ hash: hashHigherNonce })
    expect(submitted.status).toEqual("submitted")

    // higher nonce op should now be included
    await anvilClient.mine({ blocks: 1 })
    await new Promise(resolve => setTimeout(resolve, 1500))
    const queuedIncluded = await pimlicoClient.getUserOperationStatus({ hash: hashHigherNonce })
    expect(queuedIncluded.status).toEqual("included")

    // non-existant op shouldn't be found
    const nonExistant = await pimlicoClient.getUserOperationStatus({hash: "0x0000000000000000000000000000000000000000000000000000000000000000"})
    expect(nonExistant.status).toEqual("not_found")
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

    const senderHash = await compressAndSendOp(senderOp, publicClient)
    const relayerHash = await compressAndSendOp(relayerOp, publicClient)

    expect(await pimlicoClient.getUserOperationReceipt({ hash: senderHash })).toBeNull()
    expect(await pimlicoClient.getUserOperationReceipt({ hash: relayerHash })).toBeNull()

    await sendBundleNow()

    expect((await pimlicoClient.waitForUserOperationReceipt({ hash: senderHash })).success).toEqual(true)
    expect((await pimlicoClient.waitForUserOperationReceipt({ hash: relayerHash })).success).toEqual(true)

    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    expect(await publicClient.getBytecode({ address: sender.account.address })).toEqual(simpleAccountDeployedBytecode)
    expect(await publicClient.getBytecode({ address: relayer.account.address })).toEqual(simpleAccountDeployedBytecode)
})
