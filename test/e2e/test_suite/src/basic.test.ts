import { bundlerActions, getSenderAddress, signUserOperationHashWithECDSA } from "permissionless"
import { pimlicoBundlerActions } from "permissionless/actions/pimlico"
import { concat, createClient, createPublicClient, encodeFunctionData, http, parseEther, toHex } from "viem";
import { foundry } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENTRY_POINT_ADDRESS, SIMPLE_ACCOUNT_FACTORY_ADDRESS, altoEndpoint, anvilDumpState, anvilEndpoint, anvilLoadState, fundAccount } from "./utils";
import { setupEnvironment } from "./setup";

// Holds the checkpoint after all contracts have been deployed.
let anvilCheckpoint: string | null = null

// This function will deploy all contracts (called once before all tests).
beforeAll(async () => {
    await setupEnvironment()
});

// This function will revert all contracts to the state before the tests were run (called once before all tests).
beforeEach(async () => {
    if (!anvilCheckpoint) {
        anvilCheckpoint = await anvilDumpState()
    } else {
        await anvilLoadState(anvilCheckpoint)
    }
})

afterEach(() => {

})

test("eth_sendUserOperation can deploy a contract", async () => {
    // setup vars.
    const bundlerClient = createClient({
        transport: http(altoEndpoint),
        chain: foundry,
    }).extend(bundlerActions).extend(pimlicoBundlerActions)
    const publicClient = createPublicClient({
        transport: http(anvilEndpoint),
        chain: foundry,
    })

    const owner = privateKeyToAccount(generatePrivateKey())

    // generate init code.
    const initCode = concat([
      SIMPLE_ACCOUNT_FACTORY_ADDRESS,
      encodeFunctionData({
        abi: [{
          inputs: [{ name: "owner", type: "address" }, { name: "salt", type: "uint256" }],
          name: "createAccount",
          outputs: [{ name: "ret", type: "address" }],
          stateMutability: "nonpayable",
          type: "function",
        }],
        args: [owner.address, 0n]
      })
    ]);

    const senderAddress = await getSenderAddress(publicClient, {
      initCode,
      entryPoint: ENTRY_POINT_ADDRESS
    })

    const gasPrice = await bundlerClient.getUserOperationGasPrice()

    const userOperation = {
        sender: senderAddress,
        nonce: 0n,
        initCode,
        callData: toHex(""),
        maxFeePerGas: gasPrice.fast.maxFeePerGas,
        maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        callGasLimit: 1000000n,
        verificationGasLimit: 1000000n,
        preVerificationGas: 1000000n,
        paymasterAndData: toHex(""),
        signature: toHex(""),
    }

    // sign user operation.
    userOperation.signature = await signUserOperationHashWithECDSA({
      account: owner,
      userOperation,
      chainId: foundry.id,
      entryPoint: ENTRY_POINT_ADDRESS
    })

    await fundAccount(senderAddress, parseEther("1337"))

    await bundlerClient.sendUserOperation({
      userOperation: userOperation,
      entryPoint: ENTRY_POINT_ADDRESS
    })
})
