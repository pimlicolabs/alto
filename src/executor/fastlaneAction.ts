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
import axios from "axios"
import { FastLaneAbi } from "../../types/contracts/FastLane"

const DAPP_CONTROL_ADDRESS = "0x3e23e4282FcE0cF42DCd0E9bdf39056434E65C1F"
const DAPP_OR_SIGNER_ADDRESS = "0x96D501A4C52669283980dc5648EEC6437e2E6346"
const ATLAST_VERIFICATION_ADDRESS = "0xf31cf8740Dc4438Bb89a56Ee2234Ba9d5595c0E9"
const ATLAS_ADDRESS = "0x4A394bD4Bc2f4309ac0b75c052b242ba3e0f32e0"
const SOLVER_ADDRESS = "0x3610C8547cF6508C2567948f9bD80eA3377D0a22"
const FASTLANE_ENDPOINT = "https://polygon-rpc.fastlane.xyz"

// Sends ERC-4337 userOps through PFL auction using pfl_addSearcherBundle endpoint
// Bundles [opportunity_tx, solver_operation] where solver_operation calls our solver contract
// solver contract handles bribes & returns unused funds to executor EOA to keeping the contract refilled

export function fastlaneActions<
    transport extends Transport = Transport,
    chain extends Chain | undefined = Chain | undefined,
    account extends Account | undefined = Account | undefined
>({
    publicClient,
    solverSigner
}: { publicClient: PublicClient; solverSigner: Account }) {
    return (client: Client<transport, chain, account>) => {
        console.log("SETTING UP FASTLANE ACTIONS")
        return {
            // Currently only supports sending userOperations to EntryPoint v0.6
            sendPflConditional: async ({
                serializedTransaction
            }: SendRawTransactionParameters) => {
                console.log("SENDING TRANSACTION THROUGH FASTLANE")
                console.log(serializedTransaction)
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

                    const solverOpTypedData = {
                        SolverOp: [
                            { name: "from", type: "address" },
                            { name: "to", type: "address" },
                            { name: "value", type: "uint256" },
                            { name: "gas", type: "uint256" },
                            { name: "maxFeePerGas", type: "uint256" },
                            { name: "deadline", type: "uint256" },
                            { name: "solver", type: "address" },
                            { name: "control", type: "address" },
                            { name: "userOpHash", type: "bytes32" },
                            { name: "bidToken", type: "address" },
                            { name: "bidAmount", type: "uint256" },
                            { name: "data", type: "bytes" }
                        ]
                    }

                    const solverOp = {
                        from: solverSigner.address,
                        to: ATLAS_ADDRESS,
                        value: 0n,
                        gas: 250_000n,
                        maxFeePerGas,
                        deadline: 0n,
                        control: DAPP_CONTROL_ADDRESS,
                        userOpHash: userOpHash,
                        bidToken: zeroAddress,
                        bidAmount: bidAmount,
                        solver: solverSigner.address,
                        data: "0x",
                        signature: "0x"
                    }

                    solverOp.signature = await solverSigner.signTypedData!({
                        domain: {
                            name: "AtlasVerification",
                            version: "1.0",
                            chainId: 137,
                            verifyingContract: ATLAST_VERIFICATION_ADDRESS
                        },
                        types: solverOpTypedData,
                        primaryType: "SolverOp",
                        message: solverOp
                    })

                    const pflBundle = {
                        id: Math.floor(Math.random() * 10000),
                        jsonrpc: "2.0",
                        method: "pfl_addSearcherBundle",
                        params: [
                            `${serializedTransaction}`,
                            `${JSON.stringify(solverOp)}`
                        ]
                    }

                    const conn = axios.create({
                        baseURL: FASTLANE_ENDPOINT,
                        timeout: 10000
                    })

                    // Send pflBundle
                    const res = await conn.post("/", pflBundle)

                    console.log(res)

                    console.log("TRANSACTION SENT THROUGH FASTLANE :", txHash)

                    return txHash
                } catch (e) {
                    console.log("ERROR SENDING TRANSACTION THROUGH FASTLANE")
                    console.log(e)
                    return await (
                        client as unknown as WalletClient
                    ).sendRawTransaction({
                        serializedTransaction
                    })
                }
            }
        }
    }
}
