import {
    parseEther,
    Chain,
    WalletClient,
    Transport,
    Account,
    getContract,
    PublicClient,
    Hex
} from "viem"
import {
    newRandomAddress,
    getAnvilWalletClient,
    getPublicClient,
    getPimlicoBundlerClient,
    setupSimpleSmartAccountClient,
} from "./utils"
import { ENTRYPOINT_ADDRESS_V07_TYPE } from "permissionless/types/entrypoint"
import { ENTRYPOINT_ADDRESS_V06, ENTRYPOINT_ADDRESS_V07, UserOperation } from "permissionless"
import { PimlicoBundlerClient } from "permissionless/clients/pimlico"
import { SIMPLE_INFLATOR_ADDRESS } from "./constants"
import { simpleInflatorAbi } from "../abi";

const compressOp = async (
    userOperation: UserOperation<"v0.6">,
    publicClient: PublicClient,
) => {
    const simpleInflator = getContract({
        address: SIMPLE_INFLATOR_ADDRESS,
        abi: simpleInflatorAbi,
        publicClient
    })

    return await simpleInflator.read.compress([userOperation]) as Hex
}

describe("Compression", () => {
    let pilmicoBundlerClient: PimlicoBundlerClient<ENTRYPOINT_ADDRESS_V07_TYPE>
    let walletClient: WalletClient<Transport, Chain, Account>
    let publicClient: PublicClient<Transport, Chain>

    beforeAll(async () => {
        walletClient = getAnvilWalletClient(96)
        pilmicoBundlerClient = getPimlicoBundlerClient(ENTRYPOINT_ADDRESS_V07)
        publicClient = getPublicClient()
    })

    test("pimlico_sendCompressedUserOperation can submit a compressed userOp", async () => {
        const smartAccount = await setupSimpleSmartAccountClient({ entryPoint: ENTRYPOINT_ADDRESS_V06 })

        const target = newRandomAddress()
        const amt = parseEther("0.1337")

        const op = await smartAccount.prepareUserOperationRequest({
            userOperation: {
                callData: await smartAccount.account.encodeCallData({
                    to: target,
                    value: amt,
                    data: "0x"
                })
            }
        })

        op.signature = await smartAccount.account.signUserOperation(op)

        let compressedUserOperation = await compressOp(op, publicClient)

        const opHash = await pilmicoBundlerClient.sendCompressedUserOperation({
            compressedUserOperation,
            inflatorAddress: SIMPLE_INFLATOR_ADDRESS
        })

        await pilmicoBundlerClient.waitForUserOperationReceipt({ hash: opHash })

        expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    })

    //test("pimlico_sendCompressedUserOperation can replace mempool transaction", async () => {
    //    const target = newRandomAddress()
    //    const amt = parseEther("0.1337")

    //    const smartAccount = await setupSimpleSmartAccountClient(
    //        pimlicoClient,
    //        publicClient
    //    )
    //    await anvilClient.setAutomine(false)

    //    await anvilClient.mine({ blocks: 1 })

    //    const op = await smartAccount.prepareUserOperationRequest({
    //        userOperation: {
    //            callData: await smartAccount.account.encodeCallData({
    //                to: target,
    //                value: amt,
    //                data: "0x"
    //            })
    //        }
    //    })
    //    op.signature = await smartAccount.account.signUserOperation(op)

    //    const opHash = await compressAndSendOp(op, publicClient, pimlicoClient)
    //    await new Promise((resolve) => setTimeout(resolve, 1500))

    //    await anvilClient.setNextBlockBaseFeePerGas({
    //        baseFeePerGas: parseGwei("150")
    //    })

    //    await anvilClient.mine({ blocks: 1 })
    //    await new Promise((resolve) => setTimeout(resolve, 1500))

    //    let opReceipt = await pimlicoClient.getUserOperationReceipt({
    //        hash: opHash
    //    })
    //    expect(opReceipt).toBeNull() // no tx should be mined

    //    await anvilClient.mine({ blocks: 1 })
    //    await new Promise((resolve) => setTimeout(resolve, 1500))

    //    opReceipt = await pimlicoClient.getUserOperationReceipt({ hash: opHash })

    //    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    //    expect(
    //        await publicClient.getBytecode({
    //            address: smartAccount.account.address
    //        })
    //    ).toEqual(simpleAccountDeployedBytecode)
    //})

    //test("pimlico_sendCompressedUserOperation can bundle multiple compressed userOps", async () => {
    //    const sender = await setupSimpleSmartAccountClient(
    //        pimlicoClient,
    //        publicClient
    //    )
    //    const relayer = await setupSimpleSmartAccountClient(
    //        pimlicoClient,
    //        publicClient
    //    )

    //    const target = newRandomAddress()
    //    const amt = parseEther("0.1337")

    //    // create sender op
    //    const senderOp = await sender.prepareUserOperationRequest({
    //        userOperation: {
    //            callData: await sender.account.encodeCallData({
    //                to: relayer.account.address,
    //                value: amt,
    //                data: "0x"
    //            })
    //        }
    //    })

    //    senderOp.signature = await sender.account.signUserOperation(senderOp)

    //    // create relayer op
    //    const relayerOp = await relayer.prepareUserOperationRequest({
    //        userOperation: {
    //            callData: await relayer.account.encodeCallData({
    //                to: target,
    //                value: amt,
    //                data: "0x"
    //            })
    //        }
    //    })

    //    relayerOp.signature = await relayer.account.signUserOperation(relayerOp)

    //    setBundlingMode("manual")

    //    const senderHash = await compressAndSendOp(
    //        senderOp,
    //        publicClient,
    //        pimlicoClient
    //    )
    //    const relayerHash = await compressAndSendOp(
    //        relayerOp,
    //        publicClient,
    //        pimlicoClient
    //    )

    //    expect(
    //        await pimlicoClient.getUserOperationReceipt({ hash: senderHash })
    //    ).toBeNull()
    //    expect(
    //        await pimlicoClient.getUserOperationReceipt({ hash: relayerHash })
    //    ).toBeNull()

    //    await sendBundleNow()

    //    expect(
    //        (await pimlicoClient.waitForUserOperationReceipt({ hash: senderHash }))
    //            .success
    //    ).toEqual(true)
    //    expect(
    //        (await pimlicoClient.waitForUserOperationReceipt({ hash: relayerHash }))
    //            .success
    //    ).toEqual(true)

    //    expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    //    expect(
    //        await publicClient.getBytecode({ address: sender.account.address })
    //    ).toEqual(simpleAccountDeployedBytecode)
    //    expect(
    //        await publicClient.getBytecode({ address: relayer.account.address })
    //    ).toEqual(simpleAccountDeployedBytecode)
    //})
})
