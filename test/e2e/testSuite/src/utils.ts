import { type UserOperation, createSmartAccountClient } from "permissionless"
import { privateKeyToSimpleSmartAccount } from "permissionless/accounts"
import type { PimlicoBundlerClient } from "permissionless/clients/pimlico"
import {
    http,
    type PublicClient,
    type TestClient,
    createWalletClient,
    getContract,
    parseEther,
    parseGwei
} from "viem"
import {
    type Address,
    generatePrivateKey,
    mnemonicToAccount,
    privateKeyToAddress
} from "viem/accounts"
import { foundry } from "viem/chains"
import { simpleInflatorAbi } from "./data"

export const CREATE2_DEPLOYER_ADDRESS =
    "0x4e59b44847b379578588920ca78fbf26c0b4956c"
export const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
export const SIMPLE_ACCOUNT_FACTORY_ADDRESS =
    "0x9406Cc6185a346906296840746125a0E44976454"
export const BUNDLE_BULKER_ADDRESS =
    "0x09aeBCF1DF7d4D0FBf26073e79A6B250f458fFB8"
export const PER_OP_INFLATOR_ADDRESS =
    "0x79741195EA18e1ed7deD6C224e9037d673cE9484"
export const SIMPLE_INFLATOR_ADDRESS =
    "0x92d2f9EF7b520D91A34501FBb31E5428AB2fd5Df"

export const anvilEndpoint =
    process.env.ANVIL_ENDPOINT ?? "http://127.0.0.1:8545"
export const altoEndpoint = process.env.ALTO_ENDPOINT ?? "http://0.0.0.0:3000"
export const anvilAccount = mnemonicToAccount(
    "test test test test test test test test test test test junk"
)

export const clearBundlerState = async () => {
    await fetch(altoEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "debug_bundler_clearState",
            params: [],
            id: 4337
        })
    })
}

export const setBundlingMode = async (mode: "auto" | "manual") => {
    await fetch(altoEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "debug_bundler_setBundlingMode",
            params: [mode],
            id: 4337
        })
    })
}

export const sendBundleNow = async () => {
    await fetch(altoEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            method: "debug_bundler_sendBundleNow",
            params: [],
            id: 4337
        })
    })
}

export const compressAndSendOp = async (
    userOperation: UserOperation,
    publicClient: PublicClient,
    _pimlicoClient: PimlicoBundlerClient
) => {
    const simpleInflator = getContract({
        address: SIMPLE_INFLATOR_ADDRESS,
        abi: simpleInflatorAbi,
        publicClient
    })

    const compressed = await simpleInflator.read.compress([userOperation])

    const userOperationHash = (
        await fetch(altoEndpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "pimlico_sendCompressedUserOperation",
                params: [
                    compressed,
                    SIMPLE_INFLATOR_ADDRESS,
                    ENTRY_POINT_ADDRESS
                ],
                id: 4337
            })
        }).then((response) => response.json())
    ).result

    return userOperationHash
}

export const newRandomAddress = (): Address => {
    return privateKeyToAddress(generatePrivateKey())
}

export const setupSimpleSmartAccountClient = async (
    bundlerClient: PimlicoBundlerClient,
    publicClient: PublicClient
) => {
    const simpleAccount = await privateKeyToSimpleSmartAccount(publicClient, {
        privateKey: generatePrivateKey(),
        factoryAddress: SIMPLE_ACCOUNT_FACTORY_ADDRESS,
        entryPoint: ENTRY_POINT_ADDRESS
    })

    await fundAccount(simpleAccount.address, parseEther("1337"))

    return createSmartAccountClient({
        account: simpleAccount,
        chain: foundry,
        transport: http(altoEndpoint),
        sponsorUserOperation: async (args: {
            userOperation: UserOperation
            entryPoint: Address
        }) => {
            const gasInfo = await bundlerClient.estimateUserOperationGas(args)
            return Promise.resolve({
                ...args.userOperation,
                preVerificationGas: gasInfo.preVerificationGas,
                verificationGasLimit: gasInfo.verificationGasLimit,
                callGasLimit: gasInfo.callGasLimit * 5n
            })
        }
    })
}

export const resetAnvil = async (anvilClient: TestClient) => {
    await anvilClient.setAutomine(true)
    await anvilClient.setBlockGasLimit({ gasLimit: 30_000_000n })
    await anvilClient.setNextBlockBaseFeePerGas({
        baseFeePerGas: parseGwei("15")
    })

    // clear mempool
    const mempoolContent = await anvilClient.getTxpoolContent()

    for (const [_addr, pendingTxs] of Object.entries(mempoolContent.pending)) {
        for (const [_nonce, pendingTxInfo] of Object.entries(pendingTxs)) {
            await anvilClient.dropTransaction({ hash: pendingTxInfo.hash })
        }
    }

    for (const [_addr, queuedTxs] of Object.entries(mempoolContent.queued)) {
        for (const [_nonce, queuedTxInfo] of Object.entries(queuedTxs)) {
            await anvilClient.dropTransaction({ hash: queuedTxInfo.hash })
        }
    }
}

export const fundAccount = async (to: Address, value: bigint) => {
    const wallet = createWalletClient({
        account: anvilAccount,
        chain: foundry,
        transport: http(anvilEndpoint)
    })
    await wallet.sendTransaction({
        to,
        value
    })
}
