// Utils for interacting with the EventHelper contract

import {
    http,
    type Address,
    type Hex,
    concat,
    createPublicClient,
    encodeFunctionData,
    getCreate2Address,
    parseAbi
} from "viem"
import { foundry } from "viem/chains"
import { getAnvilWalletClient } from "./utils/index.js"

const EVENT_HELPER_BYTECODE: Hex =
    "0x6080806040523460155761020c908161001a8239f35b5f80fdfe60806040526004361015610011575f80fd5b5f3560e01c80632ac0df26146100af5763c019551d1461002f575f80fd5b346100ab5760403660031901126100ab5760043567ffffffffffffffff81116100ab576100986100847f3fdea94c3e08f3ff5c404a5e9e1c6bb7c747d08be1c56719c2c51e33679cc0e892369060040161011d565b6040519182916060835260608301906101b2565b60243560208301523360408301520390a1005b5f80fd5b346100ab5760203660031901126100ab5760043567ffffffffffffffff81116100ab576101186101047f50ede1f15a65bab9edf83cef0d1ffb1f21234653b3e58170594c3d8685d30e7a92369060040161011d565b6040519182916020835260208301906101b2565b0390a1005b81601f820112156100ab5780359067ffffffffffffffff82116101855760405192601f8301601f19908116603f0116840167ffffffffffffffff81118582101761018557604052828452602083830101116100ab57815f926020809301838601378301015290565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b805180835260209291819084018484015e5f828201840152601f01601f191601019056fea2646970667358221220b8f728d336dd2fcf0a36018bf370876be9f78981ed3a56682be2eef470d60e9f64736f6c634300081c0033"

// EventHelper ABI
export const eventHelperAbi = parseAbi([
    "event MessageEmitted(string message)",
    "event MessageWithSenderEmitted(string message, uint256 value, address sender)",
    "function emitMessage(string memory message) external",
    "function emitMultipleData(string memory message, uint256 value) external"
])

// Deploy the EventHelper contract
export const deployEventHelper = async ({
    anvilRpc
}: {
    anvilRpc: string
}): Promise<Address> => {
    const publicClient = createPublicClient({
        transport: http(anvilRpc),
        chain: foundry
    })

    const counterFactual = getCreate2Address({
        from: "0x4e59b44847b379578588920ca78fbf26c0b4956c",
        salt: "0x0000000000000000000000000000000000000000000000000000000000000001",
        bytecode: EVENT_HELPER_BYTECODE
    })

    const bytecode = await publicClient.getCode({
        address: counterFactual
    })

    if (!bytecode) {
        // if it doesn't exist, deploy it
        const walletClient = getAnvilWalletClient({
            addressIndex: 0,
            anvilRpc
        })

        await walletClient.sendTransaction({
            data: concat([
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                EVENT_HELPER_BYTECODE
            ]),
            to: "0x4e59b44847b379578588920ca78fbf26c0b4956c"
        })
    }

    return counterFactual
}

// Create calldata for emitting a simple message
export const getEmitMessageCall = (message: string): Hex => {
    return encodeFunctionData({
        abi: eventHelperAbi,
        functionName: "emitMessage",
        args: [message]
    })
}

// Create calldata for emitting multiple data
export const getEmitMultipleDataCall = (
    message: string,
    value: bigint
): Hex => {
    return encodeFunctionData({
        abi: eventHelperAbi,
        functionName: "emitMultipleData",
        args: [message, value]
    })
}
