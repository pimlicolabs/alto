import { Address, EntryPointAbi, EntryPoint_bytecode, RpcError, UserOperation } from "@alto/types"
import { SimpleAccountFactoryAbi, SimpleAccountFactoryBytecode } from "@alto/types"
import { Clients, createClients, deployContract, getUserOpHash, launchAnvil } from "@alto/utils"
import { ChildProcess } from "child_process"
import { Account, concat, encodeFunctionData, getContract, parseEther } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { UnsafeValidator } from "../src"
import { foundry } from "viem/chains"
import { IValidator } from "../lib"
import { expect } from "earl"
import { parseSenderAddressError } from "@alto/utils"

const TEST_OP: UserOperation = {
	sender: "0x0000000000000000000000000000000000000000",
	nonce: 0n,
	initCode: "0x",
	callData: "0x",
	callGasLimit: 100_000n,
	verificationGasLimit: 1_000_000n,
	preVerificationGas: 60_000n,
	maxFeePerGas: 1n,
	maxPriorityFeePerGas: 1n,
	paymasterAndData: "0x",
	signature: "0x",
}

describe("validator", () => {
	describe("validateUserOperation", () => {
		let clients: Clients
		let anvilProcess: ChildProcess
		let entryPoint: Address
		let simpleAccountFactory: Address
		let validator: IValidator

		let signer: Account

		beforeEach(async function () {
			anvilProcess = await launchAnvil()
			const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" // first private key in anvil
			signer = privateKeyToAccount(privateKey)
			clients = await createClients(signer)
			entryPoint = await deployContract(clients, signer.address, EntryPointAbi, [], EntryPoint_bytecode)
			simpleAccountFactory = await deployContract(
				clients,
				signer.address,
				SimpleAccountFactoryAbi,
				[entryPoint],
				SimpleAccountFactoryBytecode,
			)

			validator = new UnsafeValidator(clients.public, entryPoint)
		})

		afterEach(async function () {
			anvilProcess.kill()
			await new Promise((resolve) => setTimeout(resolve, 50))

		})

		it("should return true for a valid user operation", async function () {
			const entryPointContract = getContract({
				address: entryPoint,
				abi: EntryPointAbi,
				publicClient: clients.public,
				walletClient: clients.wallet,
			})

			const initCode = concat([
				simpleAccountFactory,
				encodeFunctionData({
					abi: SimpleAccountFactoryAbi,
					functionName: "createAccount",
					args: [signer.address, 0n],
				}),
			])

			const sender = await entryPointContract.simulate
				.getSenderAddress([initCode])
				.then((_) => {
					throw new Error("Expected error")
				})
				.catch((e: Error) => {
					return parseSenderAddressError(e)
				})

			await clients.test.setBalance({
				address: sender,
				value: parseEther("1"),
			})

			const op = TEST_OP
			op.sender = sender
			op.initCode = initCode

			const opHash = getUserOpHash(op, entryPoint, foundry.id)

			const signature = await clients.wallet.signMessage({
				account: signer,
				message: opHash,
			})
			op.signature = signature

			const simulateValidationResult = await validator.validateUserOperation(op)
			expect(simulateValidationResult.returnInfo.sigFailed).toBeFalsy()
		})

		it("should throw on not enough payment", async function () {
			const entryPointContract = getContract({
				address: entryPoint,
				abi: EntryPointAbi,
				publicClient: clients.public,
				walletClient: clients.wallet,
			})

			const initCode = concat([
				simpleAccountFactory,
				encodeFunctionData({
					abi: SimpleAccountFactoryAbi,
					functionName: "createAccount",
					args: [signer.address, 1n],
				}),
			])

			const sender = await entryPointContract.simulate
				.getSenderAddress([initCode])
				.then((_) => {
					throw new Error("Expected error")
				})
				.catch((e: Error) => {
					return parseSenderAddressError(e)
				})

			const op = TEST_OP
			op.sender = sender
			op.initCode = initCode

			const opHash = getUserOpHash(op, entryPoint, foundry.id)

			const signature = await clients.wallet.signMessage({
				account: signer,
				message: opHash,
			})
			op.signature = signature

			await expect(validator.validateUserOperation(op)).toBeRejectedWith(RpcError, /AA21 didn't pay prefund/)
		})

		it("should throw on invalid signature", async function () {
			const entryPointContract = getContract({
				address: entryPoint,
				abi: EntryPointAbi,
				publicClient: clients.public,
				walletClient: clients.wallet,
			})

			const initCode = concat([
				simpleAccountFactory,
				encodeFunctionData({
					abi: SimpleAccountFactoryAbi,
					functionName: "createAccount",
					args: [signer.address, 2n],
				}),
			])

			const sender = await entryPointContract.simulate
				.getSenderAddress([initCode])
				.then((_) => {
					throw new Error("Expected error")
				})
				.catch((e: Error) => {
					return parseSenderAddressError(e)
				})

			await clients.test.setBalance({
				address: sender,
				value: parseEther("1"),
			})

			const op = TEST_OP
			op.sender = sender
			op.initCode = initCode

			// invalid signature
			op.signature =
				"0x21fbf0696d5e0aa2ef41a2b4ffb623bcaf070461d61cf7251c74161f82fec3a4370854bc0a34b3ab487c1bc021cd318c734c51ae29374f2beb0e6f2dd49b4bf41c"

			await expect(validator.validateUserOperation(op)).toBeRejectedWith(
				RpcError,
				/^Invalid UserOp signature or paymaster signature$/,
			)
		})
	})
})
