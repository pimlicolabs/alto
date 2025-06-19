// Utils for interacting with the EventHelper contract

import {
    http,
    type Address,
    type Hex,
    createPublicClient,
    encodeFunctionData,
    getCreate2Address,
    parseAbi,
    concat
} from "viem"
import { foundry } from "viem/chains"
import { getAnvilWalletClient } from "./utils/index.js"

const EVENT_HELPER_BYTECODE: Hex =
    "0x608080604052346015576103a2908161001a8239f35b5f80fdfe60806040526004361015610011575f80fd5b5f3560e01c80632ac0df2614610262578063beb39467146101f3578063c019551d146101775763df8bdd9614610045575f80fd5b346101465760203660031901126101465760043567ffffffffffffffff811161014657366023820112156101465780600401359067ffffffffffffffff821161014a578160051b906024602061009c8185016102d0565b809581520192820101903682116101465760248101925b82841061011657845f5b8151811015610114576001907f50ede1f15a65bab9edf83cef0d1ffb1f21234653b3e58170594c3d8685d30e7a61010b60208360051b86010151604051918291602083526020830190610348565b0390a1016100bd565b005b833567ffffffffffffffff81116101465760209161013b8392602436918701016102f6565b8152019301926100b3565b5f80fd5b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b346101465760403660031901126101465760043567ffffffffffffffff8111610146576101e06101cc7f3fdea94c3e08f3ff5c404a5e9e1c6bb7c747d08be1c56719c2c51e33679cc0e89236906004016102f6565b604051918291606083526060830190610348565b60243560208301523360408301520390a1005b346101465760203660031901126101465760043567ffffffffffffffff81116101465761022660209136906004016102f6565b604051918183925191829101835e81015f81520390207f6c03793be2537072af22c1ec74a0fb38eb04239f36f9bc05f51a0de6ba1723555f80a2005b346101465760203660031901126101465760043567ffffffffffffffff8111610146576102cb6102b77f50ede1f15a65bab9edf83cef0d1ffb1f21234653b3e58170594c3d8685d30e7a9236906004016102f6565b604051918291602083526020830190610348565b0390a1005b6040519190601f01601f1916820167ffffffffffffffff81118382101761014a57604052565b81601f820112156101465780359067ffffffffffffffff821161014a57610326601f8301601f19166020016102d0565b928284526020838301011161014657815f926020809301838601378301015290565b805180835260209291819084018484015e5f828201840152601f01601f191601019056fea26469706673582212205bf976312a6d1742fced6b1249ea7eefe46adfcb3a0ad3fa820ec6b84d582e0564736f6c634300081c0033"

// EventHelper ABI
export const eventHelperAbi = parseAbi([
    "event MessageEmitted(string message)",
    "event MessageWithIndexEmitted(string indexed message)",
    "event MessageWithSenderEmitted(string message, uint256 value, address sender)",
    "function emitMessage(string memory message) external",
    "function emitIndexedMessage(string memory message) external",
    "function emitMultipleData(string memory message, uint256 value) external",
    "function emitMultipleMessages(string[] memory messages) external"
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

// Create calldata for emitting an indexed message
export const getEmitIndexedMessageCall = (message: string): Hex => {
    return encodeFunctionData({
        abi: eventHelperAbi,
        functionName: "emitIndexedMessage",
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

// Create calldata for emitting multiple messages
export const getEmitMultipleMessagesCall = (messages: string[]): Hex => {
    return encodeFunctionData({
        abi: eventHelperAbi,
        functionName: "emitMultipleMessages",
        args: [messages]
    })
}
