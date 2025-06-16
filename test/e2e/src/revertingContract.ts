// Utils for interacting with the contract located in alto/contracts/TestUtils/AlwaysReverting.sol

import {
    http,
    type Address,
    type Hex,
    concat,
    createPublicClient,
    decodeErrorResult,
    encodeFunctionData,
    getCreate2Address,
    parseAbi
} from "viem"
import { foundry } from "viem/chains"
import { getAnvilWalletClient } from "./utils/index.js"

// source: https://gist.github.com/mouseless-eth/41146d2392a520fbdff33b927fbe4cae
const ALWAYS_REVERTING_BYTECODE: Hex =
    "0x608060405234801561001057600080fd5b506101b4806100206000396000f3fe608060405234801561001057600080fd5b506004361061002b5760003560e01c8063ee781e4c14610030575b600080fd5b61004361003e36600461007e565b610045565b005b8060405162461bcd60e51b815260040161005f919061012f565b60405180910390fd5b634e487b7160e01b600052604160045260246000fd5b60006020828403121561009057600080fd5b813567ffffffffffffffff808211156100a857600080fd5b818401915084601f8301126100bc57600080fd5b8135818111156100ce576100ce610068565b604051601f8201601f19908116603f011681019083821181831017156100f6576100f6610068565b8160405282815287602084870101111561010f57600080fd5b826020860160208301376000928101602001929092525095945050505050565b60006020808352835180602085015260005b8181101561015d57858101830151858201604001528201610141565b506000604082860101526040601f19601f830116850101925050509291505056fea26469706673582212203d9ae150dc381f5576284267b878768b4759c473446960593b0bcdf27cfe788c64736f6c63430008170033"

// Deploy a contract that reverts with data
export const deployRevertingContract = async ({
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
        salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
        bytecode: ALWAYS_REVERTING_BYTECODE
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
                "0x0000000000000000000000000000000000000000000000000000000000000000",
                ALWAYS_REVERTING_BYTECODE
            ]),
            to: "0x4e59b44847b379578588920ca78fbf26c0b4956c"
        })
    }

    return counterFactual
}

export const getRevertCall = (msg: string) => {
    return encodeFunctionData({
        abi: parseAbi([
            "function revertWithMessage(string memory message) public"
        ]),
        args: [msg]
    })
}

export const decodeRevert = (data?: Hex) => {
    return decodeErrorResult({
        abi: parseAbi(["error Error(string)"]),
        data: data || "0x"
    }).args[0]
}
