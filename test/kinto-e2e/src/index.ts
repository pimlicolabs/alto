import {
    createPublicClient,
    decodeEventLog,
    decodeFunctionData,
    defineChain,
    http,
    parseAbi,
    parseAbiItem
} from "viem"
import { handleOpsAbi } from "./abi"
import { createAnvil } from "@viem/anvil"
import type { UserOperation } from "permissionless"

const kintoMainnet = defineChain({
    id: 7887,
    name: "Kinto Mainnet",
    nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18
    },
    rpcUrls: {
        default: {
            http: [],
            webSocket: undefined
        }
    }
})

const KINTO_RPC = "https://kinto-mainnet.calderachain.xyz/http"

const main = async () => {
    const entryPoint = "0x2843C269D2a64eCfA63548E8B3Fc0FD23B7F70cb"
    const publicClient = createPublicClient({
        transport: http(KINTO_RPC),
        chain: kintoMainnet
    })

    const latestBlock = await publicClient.getBlockNumber()

    const userOperatinoEventAbi =
        "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"

    const userOperationEvents = await publicClient.getLogs({
        address: entryPoint,
        event: parseAbiItem(userOperatinoEventAbi),
        fromBlock: latestBlock - 20_000n
    })

    const opInfos: { blockNum: bigint; op: UserOperation<"v0.6"> }[] = []

    userOperationEvents.reverse().map(async (opEvent) => {
        // only capture the latest 50 succesful ops
        if (opInfos.length === 50) {
            return
        }

        const opInfo = decodeEventLog({
            abi: parseAbi([userOperatinoEventAbi]),
            topics: [...opEvent.topics]
        }).args

        // we only want to simulate against succesful userOperations
        if (!opInfo.success) {
            return
        }

        const rawTx = await publicClient.getTransaction({
            hash: opEvent.transactionHash
        })

        const rawUserOperation = decodeFunctionData({
            abi: handleOpsAbi,
            data: rawTx.input
        }).args[0][0]

        opInfos.push({
            blockNum: opEvent.blockNumber,
            op: rawUserOperation
        })
    })

    // check historic ops against alto bundler
    for (const opInfo of opInfos) {
        const anvil = createAnvil({
            forkUrl: KINTO_RPC,
            forkBlockNumber: opInfo.blockNum
        })

        await anvil.start()
    }
}

main()
