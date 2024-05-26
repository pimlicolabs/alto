import {
    type Hash,
    type Address,
    type Hex,
    createPublicClient,
    decodeEventLog,
    decodeFunctionData,
    http,
    parseAbi,
    parseAbiItem,
    getAddress
} from "viem"
import { BundleBulkerAbi, handleOpsAbi } from "./abi"
import { type Pool, createPool } from "@viem/anvil"
import type { UserOperation } from "permissionless"
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico"
import {
    KINTO_RPC,
    KINTO_ENTRYPOINT,
    kintoMainnet,
    prettyPrintTxHash,
    sleep
} from "./utils"
import { startAlto } from "./setupAlto"

type CompressedOp = {
    compressedBytes: Hex
    inflator: Address
}

type OpInfoType = {
    txHash: Hex
    blockNum: bigint
    op: UserOperation | CompressedOp
}

const runAgainstBlockHeight = async ({
    anvilPool,
    anvilId,
    altoPort,
    opInfo
}: {
    anvilPool: Pool
    anvilId: number
    altoPort: number
    opInfo: OpInfoType
}) => {
    const anvil = await anvilPool.start(anvilId, {
        forkUrl: KINTO_RPC,
        forkBlockNumber: opInfo.blockNum - 1n,
        startTimeout: 25000
    })

    const altoRpc = `http://127.0.0.1:${altoPort}`
    const anvilRpc = `http://${anvil.host}:${anvil.port}`

    // spin up new alto instance
    const altoProcess = await startAlto(anvilRpc, altoPort.toString())

    // resend userOperation and that it gets mined
    const bundlerClient = createPimlicoBundlerClient({
        transport: http(altoRpc)
    })

    let hash: Hex
    if ("inflator" in opInfo.op) {
        hash = await bundlerClient.sendCompressedUserOperation({
            compressedUserOperation: opInfo.op.compressedBytes,
            inflatorAddress: opInfo.op.inflator,
            entryPoint: KINTO_ENTRYPOINT
        })
    } else {
        hash = await bundlerClient.sendUserOperation({
            userOperation: opInfo.op,
            entryPoint: KINTO_ENTRYPOINT
        })
    }

    await sleep(2500)

    const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash,
        timeout: 60_000
    })

    if (receipt?.success) {
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(
            `succesfully replayed and included userOperation from tx ${opInfo.txHash}`
        )
    } else {
        return { opHash: hash, txHash: opInfo.txHash }
    }

    altoProcess.unref()
    if (altoProcess.pid) {
        process.kill(-altoProcess.pid, "SIGTERM")
    }

    await anvil.stop()
    await sleep(500)

    return undefined
}

async function runPromiseChunks(
    inputStream: Promise<any>[],
    chunkSize: number
) {
    const results: any[] = []

    for (let i = 0; i < inputStream.length; i += chunkSize) {
        const chunk = inputStream.slice(i, i + chunkSize)
        const chunkResults = await Promise.all(chunk)
        results.push(...chunkResults)
    }

    return results
}

const main = async () => {
    const publicClient = createPublicClient({
        transport: http(KINTO_RPC),
        chain: kintoMainnet
    })

    const latestBlock = await publicClient.getBlockNumber()

    const userOperatinoEventAbi =
        "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"

    const userOperationEvents = await publicClient.getLogs({
        address: KINTO_ENTRYPOINT,
        event: parseAbiItem(userOperatinoEventAbi),
        fromBlock: latestBlock - 10_000n
    })

    const opInfos: OpInfoType[] = []

    for (const opEvent of userOperationEvents.reverse()) {
        // only capture the latest 100 successful ops
        if (opInfos.length === 100) {
            break
        }

        const opInfo = decodeEventLog({
            abi: parseAbi([userOperatinoEventAbi]),
            topics: [...opEvent.topics],
            data: opEvent.data
        }).args

        // we only want to simulate against successful userOperations
        if (!opInfo?.success) {
            continue
        }

        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log(`got op from txhash: ${opEvent.transactionHash}`)

        const rawTx = await publicClient.getTransaction({
            hash: opEvent.transactionHash
        })

        let op: UserOperation | CompressedOp
        try {
            op = decodeFunctionData({
                abi: handleOpsAbi,
                data: rawTx.input
            }).args[0][0]
        } catch {
            const compressedBytes = decodeFunctionData({
                abi: BundleBulkerAbi,
                data: rawTx.input
            }).args[0]

            op = {
                compressedBytes,
                inflator: getAddress(
                    "0x336a76a7A2a1e97CE20c420F39FC08c441234aa2"
                )
            }
        }

        opInfos.push({
            txHash: opEvent.transactionHash,
            blockNum: opEvent.blockNumber,
            op
        })
    }

    const anvilPool = createPool()
    let anvilIdCounter = 0
    let altoPortCounter = 4337

    const inputStream = opInfos.map((opInfo) =>
        runAgainstBlockHeight({
            anvilPool,
            anvilId: anvilIdCounter++,
            altoPort: altoPortCounter++,
            opInfo
        })
    )

    const failedOps = (await runPromiseChunks(inputStream, 20)).filter(
        (res) => res !== undefined
    ) as { opHash: Hash; txHash: Hash }[]

    // if any ops failed, print them and exit with 1
    if (failedOps.length > 0) {
        for (const f of failedOps) {
            // biome-ignore lint/suspicious/noConsoleLog:
            console.log(
                `FAILED: ${f.opHash} (txhash: ${prettyPrintTxHash(f.txHash)})`
            )
        }
        process.exit(1)
    }

    // biome-ignore lint/suspicious/noConsoleLog:
    console.log("Succesfully Resimulated All UserOperations")
    process.exit(0)
}

main()
