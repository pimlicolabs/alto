import {
    Account,
    Address,
    Hex,
    createPublicClient,
    encodeFunctionData,
    getContract,
    http,
    parseAbi
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { ANVIL_RPC, SIMPLE_ACCOUNT_FACTORY_V07 } from "./constants"
import { foundry } from "viem/chains"

const publicClient = createPublicClient({
    transport: http(ANVIL_RPC),
    chain: foundry
})

type UserOperationExecuteParams = {
    calldata: Hex
    to: Address
    value: bigint
}

export const buildOpV07 = async ({
    owner = privateKeyToAccount(generatePrivateKey()),
    params
}: { owner?: Account; params: UserOperationExecuteParams }) => {
    const factoryContract = getContract({
        address: SIMPLE_ACCOUNT_FACTORY_V07,
        abi: parseAbi([
            "function getAddress(address,uint256) public view returns (address)",
            "function createAccount(address,uint256) public returns (address)"
        ]),
        client: publicClient
    })

    const sender = await factoryContract.read.getAddress([owner.address, 0n])
    const factoryData = encodeFunctionData({
        abi: factoryContract.abi,
        functionName: "createAccount",
        args: [owner.address, 0n]
    })

    return {
        sender,
        nonce: "0x0",
        factory: SIMPLE_ACCOUNT_FACTORY_V07,
        factoryData,
        callData: encodeFunctionData({
            abi: parseAbi([
                "function execute(address,uint256,bytes calldata) external"
            ]),
            args: [params.to, params.value, params.calldata]
        }),
        signature:
            "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c"
    }
}
