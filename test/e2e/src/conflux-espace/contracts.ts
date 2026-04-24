import {
    type Address,
    type Chain,
    type Hex,
    type PublicClient,
    type WalletClient,
    createPublicClient,
    createWalletClient,
    getContract,
    http
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { SimpleAccountFactoryAbi } from "../../../../src/types/contracts/index.js"
import {
    DETERMINISTIC_DEPLOYER_ADDRESS,
    ENTRY_POINT_V08_ADDRESS,
    ENTRY_POINT_V08_CREATE_CALL,
    SIMPLE_ACCOUNT_FACTORY_V08_ADDRESS,
    SIMPLE_ACCOUNT_FACTORY_V08_CREATE_CALL
} from "./constants.js"

const DETERMINISTIC_DEPLOYER_TRANSACTION =
    "0xf8a58V85174876e80V830186aV8V80b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600V81602V82378035828234f58015156039578182fd5b8V82525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222".replaceAll(
        "V",
        "0"
    ) as Hex

const hasBytecode = async ({
    publicClient,
    address
}: {
    publicClient: PublicClient
    address: Address
}) => {
    const bytecode = await publicClient.getBytecode({ address })
    return bytecode !== undefined && bytecode !== "0x"
}

const ensureDeterministicDeployer = async ({
    publicClient,
    walletClient
}: {
    publicClient: PublicClient
    walletClient: WalletClient
}) => {
    if (
        await hasBytecode({
            publicClient,
            address: DETERMINISTIC_DEPLOYER_ADDRESS
        })
    ) {
        return
    }

    const hash = await walletClient.sendRawTransaction({
        serializedTransaction: DETERMINISTIC_DEPLOYER_TRANSACTION
    })

    await publicClient.waitForTransactionReceipt({ hash })
}

const ensureCreateCallDeployment = async ({
    publicClient,
    walletClient,
    address,
    createCall,
    label
}: {
    publicClient: PublicClient
    walletClient: WalletClient
    address: Address
    createCall: Hex
    label: string
}) => {
    if (await hasBytecode({ publicClient, address })) {
        return
    }

    const hash = await walletClient.sendTransaction({
        to: DETERMINISTIC_DEPLOYER_ADDRESS,
        data: createCall,
        gas: 15_000_000n,
        chain: publicClient.chain
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status !== "success") {
        throw new Error(`Failed to deploy ${label}`)
    }

    if (!(await hasBytecode({ publicClient, address }))) {
        throw new Error(`${label} deployment finished without bytecode`)
    }
}

export const createConfluxEspaceClients = ({
    chain,
    rpcUrl,
    privateKey
}: {
    chain: Chain
    rpcUrl: string
    privateKey: Hex
}) => {
    const account = privateKeyToAccount(privateKey)

    return {
        publicClient: createPublicClient({
            chain,
            transport: http(rpcUrl)
        }),
        walletClient: createWalletClient({
            account,
            chain,
            transport: http(rpcUrl)
        })
    }
}

export const ensureConfluxEspaceV08CoreContracts = async ({
    publicClient,
    walletClient
}: {
    publicClient: PublicClient
    walletClient: WalletClient
}) => {
    await ensureDeterministicDeployer({
        publicClient,
        walletClient
    })

    await ensureCreateCallDeployment({
        publicClient,
        walletClient,
        address: ENTRY_POINT_V08_ADDRESS,
        createCall: ENTRY_POINT_V08_CREATE_CALL,
        label: "EntryPoint v0.8"
    })

    await ensureCreateCallDeployment({
        publicClient,
        walletClient,
        address: SIMPLE_ACCOUNT_FACTORY_V08_ADDRESS,
        createCall: SIMPLE_ACCOUNT_FACTORY_V08_CREATE_CALL,
        label: "SimpleAccountFactory v0.8"
    })

    return {
        entryPoint: ENTRY_POINT_V08_ADDRESS,
        simpleAccountFactory: SIMPLE_ACCOUNT_FACTORY_V08_ADDRESS
    }
}

export const getPredictedSimpleAccountAddress = async ({
    publicClient,
    owner
}: {
    publicClient: PublicClient
    owner: Address
}) => {
    const simpleAccountFactory = getContract({
        address: SIMPLE_ACCOUNT_FACTORY_V08_ADDRESS,
        abi: SimpleAccountFactoryAbi,
        client: publicClient
    })

    return await simpleAccountFactory.read.getAddress([owner, 0n])
}
