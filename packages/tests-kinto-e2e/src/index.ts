import {
    type Hex,
    createPublicClient,
    decodeEventLog,
    decodeFunctionData,
    http,
    parseAbi,
    parseAbiItem,
    slice,
    hexToNumber
} from "viem"
import { handleOpsAbi } from "./abi"
import { type Pool, createPool } from "@viem/anvil"
import type { UserOperation } from "permissionless"
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico"
import {
    KINTO_RPC,
    KINTO_ENTRYPOINT,
    kintoMainnet,
    prettyPrintTxHash,
    sleep,
    type OpInfoType,
    type CompressedOp,
    isCompressed
} from "./utils"
import { startAlto } from "./setupAlto"

const canReplayUserOperation = async ({
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
    const { blockNum, opParams } = opInfo

    const anvil = await anvilPool.start(anvilId, {
        forkUrl: KINTO_RPC,
        forkBlockNumber: blockNum - 1n,
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
    if (isCompressed(opParams)) {
        hash = await bundlerClient.sendCompressedUserOperation({
            compressedUserOperation: opParams.compressedBytes,
            inflatorAddress: opParams.inflator,
            entryPoint: KINTO_ENTRYPOINT
        })
    } else {
        hash = await bundlerClient.sendUserOperation({
            userOperation: opParams,
            entryPoint: KINTO_ENTRYPOINT
        })
    }

    await sleep(2500)

    const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash,
        timeout: 60_000
    })

    if (!receipt?.success) {
        return false
    }

    altoProcess.unref()
    if (altoProcess.pid) {
        process.kill(-altoProcess.pid, "SIGTERM")
    }

    await anvil.stop()
    await sleep(500)

    return true
}

const main = async () => {
    const publicClient = createPublicClient({
        transport: http(KINTO_RPC),
        chain: kintoMainnet
    })

    let latestBlock: bigint
    if (process.env.LATEST_BLOCK) {
        latestBlock = BigInt(process.env.LATEST_BLOCK)
    } else {
        latestBlock = await publicClient.getBlockNumber()
    }

    // biome-ignore lint/suspicious/noConsoleLog:
    console.log(`Using Latest Block: ${latestBlock}`)

    const userOperationEventAbi =
        "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"

    let userOperationEvents = await publicClient.getLogs({
        address: KINTO_ENTRYPOINT,
        event: parseAbiItem(userOperationEventAbi),
        fromBlock: latestBlock - 10_000n,
        toBlock: latestBlock
    })
    userOperationEvents = userOperationEvents.reverse()

    const failedOps: OpInfoType[] = []

    const chunkSize = 25
    const totalOps = 200
    let processed = 0

    while (userOperationEvents.length > 0) {
        const startTime = performance.now()

        if (processed >= totalOps) {
            break
        }

        const opEventsToProcess = userOperationEvents.splice(0, chunkSize)
        const opInfo = await Promise.all(
            opEventsToProcess.map(async (opEvent) => {
                const decodedReceipt = decodeEventLog({
                    abi: parseAbi([userOperationEventAbi]),
                    topics: [...opEvent.topics],
                    data: opEvent.data
                }).args

                if (!decodedReceipt.success) {
                    return undefined
                }

                const rawTx = await publicClient.getTransaction({
                    hash: opEvent.transactionHash
                })

                let opParams: UserOperation | CompressedOp
                try {
                    opParams = decodeFunctionData({
                        abi: handleOpsAbi,
                        data: rawTx.input
                    }).args[0][0]
                } catch {
                    // Extract first compressedUserOperation (compressedBytes)
                    // slice of 9 bytes:
                    // - 4 Bytes BundleBulker Payload (PerOpInflator Id)
                    // - 1 Bytes PerOpInflator Payload (number of ops)
                    // - 4 Bytes PerOpInflator Payload (inflator id)
                    const bytes = slice(rawTx.input, 9, undefined)

                    const compressedLength = hexToNumber(slice(bytes, 0, 2))

                    const compressedBytes = slice(
                        bytes,
                        2,
                        2 + compressedLength
                    )

                    opParams = {
                        compressedBytes,
                        inflator: "0x336a76a7A2a1e97CE20c420F39FC08c441234aa2"
                    }
                }

                return {
                    opParams,
                    blockNum: opEvent.blockNumber,
                    opHash: decodedReceipt.userOpHash,
                    txHash: opEvent.transactionHash
                }
            })
        )

        // Filter out any ops that returned 'success=false'
        const filteredOpInfo = opInfo.filter(
            (info) => info !== undefined
        ) as OpInfoType[]

        const anvilPool = createPool()
        let anvilIdCounter = 0
        let altoPortCounter = 4337

        const portNumbers = Array.from(
            { length: filteredOpInfo.length },
            () => ({
                anvilId: anvilIdCounter++,
                altoPort: altoPortCounter++
            })
        )

        const inputStream = filteredOpInfo.map(async (opInfo, index) => {
            try {
                const { anvilId, altoPort } = portNumbers[index]

                const canReplay = await canReplayUserOperation({
                    anvilPool,
                    anvilId,
                    altoPort,
                    opInfo
                })

                if (canReplay) {
                    return undefined
                }
            } catch {
                return opInfo
            }
            return opInfo
        })

        const failedOpsInChunk = (await Promise.all(inputStream)).filter(
            (res) => res !== undefined
        ) as OpInfoType[]

        if (failedOpsInChunk.length > 0) {
            // biome-ignore lint/suspicious/noConsoleLog:
            console.log(
                `Found ${failedOpsInChunk.length} failed operations in the current chunk.`
            )
        }

        failedOps.push(...failedOpsInChunk)

        processed += chunkSize

        const endTime = performance.now()
        const elapsedTime = (endTime - startTime) / 1000

        // biome-ignore lint/suspicious/noConsoleLog:
        console.log(
            `Processed ${processed}/${totalOps} operations. (processed in ${elapsedTime.toFixed(
                2
            )}s)`
        )
    }

    // if any ops failed, print them and exit with 1
    if (failedOps.length > 0) {
        for (const f of failedOps) {
            let opType = "uncompressed"
            if (isCompressed(f.opParams)) {
                opType = "compressed"
            }
            // biome-ignore lint/suspicious/noConsoleLog:
            console.log(
                `[${opType}] FAILED OP: ${
                    f.opHash
                } (txhash: ${prettyPrintTxHash(f.txHash)})`
            )
        }
        process.exit(1)
    }

    // biome-ignore lint/suspicious/noConsoleLog:
    console.log("Succesfully Resimulated All UserOperations")
    process.exit(0)
}

main()
