import { createSmartAccountClient } from "permissionless"
import { toSimpleSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import {
    type Address,
    createPublicClient,
    createWalletClient,
    defineChain,
    http,
    parseEther
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { expect, inject, test } from "vitest"
import { getPredictedSimpleAccountAddress } from "../src/conflux-espace/contracts.js"
import { MIN_SIMPLE_ACCOUNT_BALANCE } from "../src/conflux-espace/chain.js"

test("conflux eSpace testnet can deploy and execute with EntryPoint v0.8", async () => {
    const rpcUrl = inject("confluxEspaceRpc")
    const altoRpc = inject("confluxEspaceAltoRpc")
    const chainId = inject("confluxEspaceChainId")
    const entryPoint = inject("confluxEspaceEntryPointV08")
    const factoryAddress = inject("confluxEspaceSimpleAccountFactoryV08")
    const ownerPrivateKey = inject("confluxEspaceOwnerPrivateKey")
    const bundlerPrivateKey = inject("confluxEspaceBundlerPrivateKey")

    const chain = defineChain({
        id: chainId,
        name: "Conflux eSpace Testnet",
        nativeCurrency: {
            name: "Conflux",
            symbol: "CFX",
            decimals: 18
        },
        rpcUrls: {
            default: {
                http: [rpcUrl]
            },
            public: {
                http: [rpcUrl]
            }
        }
    })

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl)
    })

    const owner = privateKeyToAccount(ownerPrivateKey)
    const bundlerSigner = privateKeyToAccount(bundlerPrivateKey)

    const account = await toSimpleSmartAccount({
        client: publicClient,
        entryPoint: {
            address: entryPoint,
            version: "0.8"
        },
        factoryAddress,
        owner
    })

    const predictedAddress = await getPredictedSimpleAccountAddress({
        publicClient,
        owner: owner.address
    })

    expect(account.address).toBe(predictedAddress)

    const bundlerWalletClient = createWalletClient({
        account: bundlerSigner,
        chain,
        transport: http(rpcUrl)
    })

    const accountBalance = await publicClient.getBalance({
        address: account.address
    })

    if (accountBalance < MIN_SIMPLE_ACCOUNT_BALANCE) {
        const fundHash = await bundlerWalletClient.sendTransaction({
            to: account.address,
            value: MIN_SIMPLE_ACCOUNT_BALANCE - accountBalance
        })

        await publicClient.waitForTransactionReceipt({
            hash: fundHash
        })
    }

    const recipient = privateKeyToAccount(generatePrivateKey()).address
    const transferValue = parseEther("0.0001")
    const recipientBalanceBefore = await publicClient.getBalance({
        address: recipient
    })

    const pimlicoClient = createPimlicoClient({
        chain,
        transport: http(altoRpc),
        entryPoint: {
            address: entryPoint,
            version: "0.8"
        }
    })

    const smartAccountClient = createSmartAccountClient({
        account,
        chain,
        bundlerTransport: http(altoRpc),
        userOperation: {
            estimateFeesPerGas: async () =>
                (await pimlicoClient.getUserOperationGasPrice()).fast
        }
    })

    const userOpHash = await smartAccountClient.sendUserOperation({
        calls: [
            {
                to: recipient as Address,
                value: transferValue,
                data: "0x"
            }
        ]
    })

    const receipt = await smartAccountClient.waitForUserOperationReceipt({
        hash: userOpHash
    })

    expect(receipt.success).toBe(true)
    expect(receipt.entryPoint.toLowerCase()).toBe(entryPoint.toLowerCase())

    const deployedCode = await publicClient.getBytecode({
        address: account.address
    })
    expect(deployedCode).toBeTruthy()
    expect(deployedCode).not.toBe("0x")

    const recipientBalanceAfter = await publicClient.getBalance({
        address: recipient
    })
    expect(recipientBalanceAfter).toBeGreaterThan(recipientBalanceBefore)
}, 300_000)
