import {
    Account,
    Chain,
    Client,
    PublicClient,
    SendRawTransactionParameters,
    Transport,
    WalletClient,
    getContract,
    keccak256,
    parseEther,
    parseTransaction,
    zeroAddress
} from "viem"
import { OperationBuilder } from "@fastlane-labs/atlas-sdk"
import { FastLaneAbi } from "../../types/contracts/FastLane"
import axios from "axios"

const DAPP_CONTROL_ADDRESS = "0x3e23e4282FcE0cF42DCd0E9bdf39056434E65C1F"
const DAPP_OR_SIGNER_ADDRESS = "0x96D501A4C52669283980dc5648EEC6437e2E6346"
const ATLAST_VERIFICATION_ADDRESS = "0xf31cf8740Dc4438Bb89a56Ee2234Ba9d5595c0E9"
const ATLAS_ADDRESS = "0x4A394bD4Bc2f4309ac0b75c052b242ba3e0f32e0"
const SEARCHER_ADDRESS = "0x3610C8547cF6508C2567948f9bD80eA3377D0a22"
const FASTLANE_ENDPOINT = "https://polygon-rpc.fastlane.xyz"

// Sends ERC-4337 userOps through PFL auction using pfl_addSearcherBundle endpoint
// Bundles [opportunity_tx, solver_operation] where solver_operation calls our solver contract
// solver contract handles bribes & returns unused funds to executor EOA to keeping the contract refilled

export function fastlaneActions<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined
>(client: Client<transport, chain, account>, publicClient: PublicClient) {
    return {
        sendRawTransaction: async ({
            serializedTransaction
        }: SendRawTransactionParameters) => {
            try {
                const bidAmount = parseEther("0.01")

                const dappControlContract = getContract({
                    address: DAPP_CONTROL_ADDRESS,
                    client: { public: publicClient },
                    abi: FastLaneAbi
                })

                const txHash = keccak256(serializedTransaction)
                const tx = parseTransaction(serializedTransaction)
                const maxFeePerGas = tx.maxFeePerGas || 0n
                const maxPriorityFeePerGas = tx.maxPriorityFeePerGas || 0n

                const userOpHash =
                    await dappControlContract.read.getBackrunUserOpHash([
                        txHash,
                        maxFeePerGas,
                        maxPriorityFeePerGas,
                        DAPP_OR_SIGNER_ADDRESS
                    ])

                const solverSigner = client.account
                if (!solverSigner) {
                    throw new Error("No signer provided")
                }

                // Generate the solver operation
                const solverOp = OperationBuilder.newSolverOperation({
                    from: solverSigner.address,
                    to: ATLAS_ADDRESS,
                    value: 0n,
                    gas: 250_000n,
                    maxFeePerGas,
                    deadline: 0n,
                    solver: solverSigner.address,
                    control: DAPP_CONTROL_ADDRESS,
                    userOpHash: userOpHash,
                    bidToken: zeroAddress,
                    bidAmount: bidAmount,
                    data: "0x",
                    signature: "0x"
                })
                solverOp.setField(
                    "signature",
                    await solverSigner.signTypedData!({
                        domain: {
                            name: "AtlasVerification",
                            version: "1.0",
                            chainId: 137,
                            verifyingContract: ATLAST_VERIFICATION_ADDRESS
                        },
                        types: solverOp.toTypedDataTypes(),
                        primaryType: "SolverOp",
                        message: solverOp.toTypedDataValues()
                    })
                )

                const pflBundle = {
                    id: Math.floor(Math.random() * 10000),
                    jsonrpc: "2.0",
                    method: "pfl_addSearcherBundle",
                    params: [
                        `${serializedTransaction}`,
                        `${JSON.stringify(solverOp.toStruct())}`
                    ]
                }

                const conn = axios.create({
                    baseURL: FASTLANE_ENDPOINT,
                    timeout: 10000
                })

                // Send pflBundle
                await conn.post("/", pflBundle)

                return txHash
            } catch {
                return await (
                    client as unknown as WalletClient
                ).sendRawTransaction({
                    serializedTransaction
                })
            }
        }
    }
}
