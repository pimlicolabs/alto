import {
    createSmartAccountClient,
    type SmartAccountClient
} from "permissionless"
import {
    generatePrivateKey,
    getContract,
    type Address,
    type Chain,
    type Hex,
    type Transport,
    createClient,
    http,
    parseEther,
    encodeFunctionData,
    erc20Abi
} from "viem"
import { afterAll, beforeAll, beforeEach, describe, expect, test, inject } from "vitest"
import {
    beforeEachCleanUp,
    getAnvilWalletClient,
    getPublicClient,
    getSmartAccountClient,
    sendBundleNow
} from "../src/utils/index.js"
import { 
    type EntryPointVersion,
    entryPoint06Address,
    entryPoint07Address,
    entryPoint08Address
} from "viem/account-abstraction"
import { foundry } from "viem/chains"

describe.each([
    { entryPointVersion: "0.6" as EntryPointVersion },
    { entryPointVersion: "0.7" as EntryPointVersion },
    { entryPointVersion: "0.8" as EntryPointVersion }
])(
    "$entryPointVersion supports pimlico_simulateAssetChange",
    ({ entryPointVersion }) => {
        let smartAccountClient: SmartAccountClient<
            Transport,
            Chain | undefined
        >
        let owner: Hex
        const altoRpc = inject("altoRpc")
        const anvilRpc = inject("anvilRpc")
        let entryPoint: Address
        let bundlerClient: ReturnType<typeof createClient>
        let erc20Address: Address

        beforeAll(async () => {
            bundlerClient = createClient({
                transport: http(altoRpc)
            })
        })

        beforeEach(async () => {
            owner = generatePrivateKey()
            smartAccountClient = await getSmartAccountClient({
                entryPointVersion,
                privateKey: owner
            })
            entryPoint = smartAccountClient.account.entryPoint.address

            // Deploy a test ERC20 token
            const publicClient = getPublicClient(anvilRpc)
            const anvilClient = getAnvilWalletClient()
            
            // Deploy a simple ERC20 token contract
            const deployHash = await anvilClient.deployContract({
                abi: [
                    {
                        inputs: [],
                        stateMutability: "nonpayable",
                        type: "constructor"
                    },
                    ...erc20Abi,
                    {
                        inputs: [
                            { name: "to", type: "address" },
                            { name: "amount", type: "uint256" }
                        ],
                        name: "mint",
                        outputs: [],
                        stateMutability: "nonpayable",
                        type: "function"
                    }
                ],
                bytecode: "0x608060405234801561001057600080fd5b50336000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055506040518060400160405280600781526020017f546573744552430000000000000000000000000000000000000000000000000081525060039081610096919061031e565b506040518060400160405280600481526020017f544553540000000000000000000000000000000000000000000000000000000081525060049081610100919061031e565b50601260055f6101000a81548160ff021916908360ff1602179055506103f0565b5f81519050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b7f4e487b71000000000000000000000000000000000000000000000000000000005f52602260045260245ffd5b5f600282049050600182168061019d57607f821691505b6020821081036101b0576101af610159565b5b50919050565b5f819050815f5260205f209050919050565b5f6020601f8301049050919050565b5f82821b905092915050565b5f600883026102137fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff826101d8565b61021d86836101d8565b95508019841693508086168417925050509392505050565b5f819050919050565b5f819050919050565b5f61026161025c61025784610235565b61023f565b610235565b9050919050565b5f819050919050565b61027a83610248565b61028e61028682610268565b8484546101e4565b825550505050565b5f90565b6102a2610296565b6102ad818484610271565b505050565b5b818110156102d0576102c55f8261029a565b6001810190506102b3565b5050565b601f821115610315576102e6816101b6565b6102ef846101c8565b810160208510156102fe578190505b610312610310856101c8565b8301826102b2565b50505b505050565b5f82821c905092915050565b5f6103365f198460080261031a565b1980831691505092915050565b5f61034e8383610326565b9150826002028217905092915050565b61036882610122565b67ffffffffffffffff8111156103815761038061012c565b5b61038b8254610186565b6103968282856102d4565b5f60209050601f8311600181146103c7575f84156103b5578287015190505b6103bf8582610343565b865550610426565b601f1984166103d5866101b6565b5f5b828110156103fc578489015182556001820191506020850194506020810190506103d7565b868310156104195784890151610415601f891682610326565b8355505b6001600288020188555050505b505050505050565b6110a28061043b5f395ff3fe608060405234801561000f575f80fd5b5060043610610091575f3560e01c806340c10f191161006457806340c10f191461014d57806370a082311461016957806395d89b4114610199578063a9059cbb146101b7578063dd62ed3e146101e757610091565b806306fdde0314610095578063095ea7b3146100b357806318160ddd146100e357806323b872dd14610101578063313ce56714610131575b5f80fd5b61009d610217565b6040516100aa9190610abd565b60405180910390f35b6100cd60048036038101906100c89190610b6e565b6102a7565b6040516100da9190610bc6565b60405180910390f35b6100eb6103c4565b6040516100f89190610bee565b60405180910390f35b61011b60048036038101906101169190610c07565b6103ca565b6040516101289190610bc6565b60405180910390f35b6101396105f5565b604051610146919061 0c72565b60405180910390f35b61016760048036038101906101629190610b6e565b610607565b005b610183600480360381019061017e9190610c8b565b6106a3565b6040516101909190610bee565b60405180910390f35b6101a16106e8565b6040516101ae9190610abd565b60405180910390f35b6101d160048036038101906101cc9190610b6e565b610778565b6040516101de9190610bc6565b60405180910390f35b61020160048036038101906101fc9190610cb6565b610899565b60405161020e9190610bee565b60405180910390f35b60606003805461022690610d21565b80601f016020809104026020016040519081016040528092919081815260200182805461025290610d21565b801561029d5780601f106102745761010080835404028352916020019161029d565b820191905f5260205f20905b81548152906001019060200180831161028057829003601f168201915b5050505050905090565b5f8160025f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20819055508273ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925846040516103829190610bee565b60405180910390a3600190509291505 0565b5f600654905090565b5f8160025f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20541015610485576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161047c90610d9b565b60405180910390fd5b8160015f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205410156104ce575f80fd5b8160015f8673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546105199190610de6565b925050819055508160015f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f82825461056c9190610e19565b925050819055508273ffffffffffffffffffffffffffffffffffffffff168473ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef846040516105d09190610bee565b60405180910390a3600190509392505050565b60055f9054906101000a900460ff1681565b5f8054906101000a900473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff1614610694576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161068b90610e96565b60405180910390fd5b61069e82826106b8565b505050565b5f60015f8373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f20549050919050565b6060600480546106f790610d21565b80601f016020809104026020016040519081016040528092919081815260200182805461072390610d21565b801561076e5780601f106107455761010080835404028352916020019161076e565b820191905f5260205f20905b81548152906001019060200180831161075157829003601f168201915b5050505050905090565b5f8160015f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205410156107c3575f80fd5b8160015f3373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f82825461080e9190610de6565b925050819055508160015f8573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546108619190610e19565b925050819055506001905092915050565b5f60025f8473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f2054905092915050565b8160015f8373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020015f205f8282546109369190610e19565b925050819055508060065f82825461094e9190610e19565b925050819055505050565b5f81519050919050565b5f82825260208201905092915050565b5f5b83811015610990578082015181840152602081019050610975565b5f8484015250505050565b5f601f19601f8301169050919050565b5f6109b582610959565b6109bf8185610963565b93506109cf818560208601610973565b6109d88161099b565b840191505092915050565b5f6020820190508181035f8301526109fb81846109ab565b905092915050565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f610a3082610a07565b9050919050565b610a4081610a26565b8114610a4a575f80fd5b50565b5f81359050610a5b81610a37565b92915050565b5f819050919050565b610a7381610a61565b8114610a7d575f80fd5b50565b5f81359050610a8e81610a6a565b92915050565b5f8060408385031215610aaa57610aa9610a03565b5b5f610ab785828601610a4d565b9250506020610ac885828601610a80565b9150509250929050565b5f8115159050919050565b610ae681610ad2565b82525050565b5f602082019050610aff5f830184610add565b92915050565b610b0e81610a61565b82525050565b5f602082019050610b275f830184610b05565b92915050565b5f805f60608486031215610b4457610b43610a03565b5b5f610b5186828701610a4d565b9350506020610b6286828701610a4d565b9250506040610b7386828701610a80565b9150509250925092565b5f60ff82169050919050565b610b9281610b7d565b82525050565b5f602082019050610bab5f830184610b89565b92915050565b5f60208284031215610bc657610bc5610a03565b5b5f610bd384828501610a4d565b91505092915050565b5f8060408385031215610bf257610bf1610a03565b5b5f610bff85828601610a4d565b9250506020610c1085828601610a4d565b9150509250929050565b7f496e73756666696369656e7420616c6c6f77616e6365000000000000000000005f82015250565b5f610c4e601683610963565b9150610c5982610c1a565b602082019050919050565b5f6020820190508181035f830152610c7b81610c42565b9050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52601160045260245ffd5b5f610cc082610a61565b9150610ccb83610a61565b9250828203905081811115610ce357610ce2610c82565b5b92915050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52602260045260245ffd5b5f6002820490506001821680610d2e57607f821691505b602082108103610d4157610d40610cea565b5b50919050565b5f610d5182610a61565b9150610d5c83610a61565b9250828201905080821115610d7457610d73610c82565b5b92915050565b7f4f6e6c79206f776e6572000000000000000000000000000000000000000000005f82015250565b5f610dae600a83610963565b9150610db982610d7a565b602082019050919050565b5f6020820190508181035f830152610ddb81610da2565b905091905056fea26469706673582212203b8b3d0a8c0f5b5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e5c0e64736f6c63430008140033"
            })
            
            const receipt = await publicClient.waitForTransactionReceipt({
                hash: deployHash
            })
            
            erc20Address = receipt.contractAddress!

            // Fund the smart account with some ETH
            await anvilClient.sendTransaction({
                to: smartAccountClient.account.address,
                value: parseEther("1")
            })

            // Mint some tokens to the smart account
            const mintTx = {
                to: erc20Address,
                data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "transfer",
                    args: [smartAccountClient.account.address, parseEther("100")]
                }),
                value: 0n
            }

            // First mint tokens to the anvil account
            await anvilClient.sendTransaction({
                to: erc20Address,
                data: encodeFunctionData({
                    abi: [
                        {
                            inputs: [
                                { name: "to", type: "address" },
                                { name: "amount", type: "uint256" }
                            ],
                            name: "mint",
                            outputs: [],
                            stateMutability: "nonpayable",
                            type: "function"
                        }
                    ],
                    functionName: "mint",
                    args: [anvilClient.account.address, parseEther("1000")]
                })
            })

            // Then transfer to smart account
            await anvilClient.sendTransaction(mintTx)

            await beforeEachCleanUp()
        })

        test("should simulate asset changes for ETH transfer", async () => {
            const recipient = "0x1234567890123456789012345678901234567890"
            const transferAmount = parseEther("0.1")

            // Create a user operation that transfers ETH
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient,
                        value: transferAmount,
                        data: "0x"
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const result = await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, recipient], // addresses to monitor
                    [] // no tokens to monitor (ETH only)
                ]
            })

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)
            
            // Should have 2 entries for ETH changes
            expect(result.length).toBe(2)
            
            // Find the changes for sender and recipient
            const senderChange = result.find(
                (r: any) => r.owner.toLowerCase() === smartAccountClient.account.address.toLowerCase()
            )
            const recipientChange = result.find(
                (r: any) => r.owner.toLowerCase() === recipient.toLowerCase()
            )

            expect(senderChange).toBeDefined()
            expect(recipientChange).toBeDefined()

            // ETH is represented as zero address
            expect(senderChange.token).toBe("0x0000000000000000000000000000000000000000")
            expect(recipientChange.token).toBe("0x0000000000000000000000000000000000000000")

            // Sender should have negative change (including gas fees)
            expect(BigInt(senderChange.diff)).toBeLessThan(0n)
            
            // Recipient should have positive change
            expect(BigInt(recipientChange.diff)).toBe(transferAmount)
        })

        test("should simulate asset changes for ERC20 transfer", async () => {
            const recipient = "0x1234567890123456789012345678901234567890"
            const transferAmount = parseEther("10")

            // Create a user operation that transfers ERC20 tokens
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "transfer",
                            args: [recipient, transferAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const result = await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, recipient], // addresses to monitor
                    [erc20Address] // monitor the ERC20 token
                ]
            })

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)
            
            // Should have changes for both ETH (gas) and ERC20
            const erc20Changes = result.filter(
                (r: any) => r.token.toLowerCase() === erc20Address.toLowerCase()
            )
            const ethChanges = result.filter(
                (r: any) => r.token === "0x0000000000000000000000000000000000000000"
            )

            // Verify ERC20 changes
            expect(erc20Changes.length).toBe(2)
            
            const senderErc20Change = erc20Changes.find(
                (r: any) => r.owner.toLowerCase() === smartAccountClient.account.address.toLowerCase()
            )
            const recipientErc20Change = erc20Changes.find(
                (r: any) => r.owner.toLowerCase() === recipient.toLowerCase()
            )

            expect(BigInt(senderErc20Change.diff)).toBe(-transferAmount)
            expect(BigInt(recipientErc20Change.diff)).toBe(transferAmount)

            // Verify ETH changes (only sender pays gas)
            const senderEthChange = ethChanges.find(
                (r: any) => r.owner.toLowerCase() === smartAccountClient.account.address.toLowerCase()
            )
            expect(senderEthChange).toBeDefined()
            expect(BigInt(senderEthChange.diff)).toBeLessThan(0n) // Gas fees
        })

        test("should simulate asset changes for multiple transfers", async () => {
            const recipient1 = "0x1234567890123456789012345678901234567890"
            const recipient2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
            const ethAmount = parseEther("0.05")
            const tokenAmount = parseEther("5")

            // Create a user operation with multiple transfers
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient1,
                        value: ethAmount,
                        data: "0x"
                    },
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "transfer",
                            args: [recipient2, tokenAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const result = await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, recipient1, recipient2],
                    [erc20Address]
                ]
            })

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Verify recipient1 received ETH
            const recipient1EthChange = result.find(
                (r: any) => 
                    r.owner.toLowerCase() === recipient1.toLowerCase() && 
                    r.token === "0x0000000000000000000000000000000000000000"
            )
            expect(BigInt(recipient1EthChange.diff)).toBe(ethAmount)

            // Verify recipient2 received tokens
            const recipient2TokenChange = result.find(
                (r: any) => 
                    r.owner.toLowerCase() === recipient2.toLowerCase() && 
                    r.token.toLowerCase() === erc20Address.toLowerCase()
            )
            expect(BigInt(recipient2TokenChange.diff)).toBe(tokenAmount)
        })

        test("should return empty array for no asset changes", async () => {
            // Create a user operation that doesn't transfer any assets
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: smartAccountClient.account.address,
                        value: 0n,
                        data: "0x" // Empty call to self
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const result = await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address],
                    []
                ]
            })

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)
            
            // Should only have ETH change for gas
            const ethChanges = result.filter(
                (r: any) => r.token === "0x0000000000000000000000000000000000000000"
            )
            expect(ethChanges.length).toBe(1)
            expect(ethChanges[0].owner.toLowerCase()).toBe(smartAccountClient.account.address.toLowerCase())
            expect(BigInt(ethChanges[0].diff)).toBeLessThan(0n) // Only gas fees
        })

        test("should handle invalid user operation", async () => {
            // Create an invalid user operation with insufficient gas
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: "0x1234567890123456789012345678901234567890",
                        value: parseEther("0.1"),
                        data: "0x"
                    }
                ]
            })

            // Set gas limits to 0 to make it invalid
            userOp.verificationGasLimit = 0n
            userOp.callGasLimit = 0n

            // Call pimlico_simulateAssetChange and expect it to throw
            await expect(
                bundlerClient.request({
                    method: "pimlico_simulateAssetChange",
                    params: [
                        userOp,
                        entryPoint,
                        [smartAccountClient.account.address],
                        []
                    ]
                })
            ).rejects.toThrow()
        })

        test("should simulate asset changes with no monitored addresses", async () => {
            const recipient = "0x1234567890123456789012345678901234567890"
            const transferAmount = parseEther("0.1")

            // Create a user operation that transfers ETH
            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: recipient,
                        value: transferAmount,
                        data: "0x"
                    }
                ]
            })

            // Call pimlico_simulateAssetChange with empty addresses array
            const result = await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [], // no addresses to monitor
                    []
                ]
            })

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)
            expect(result.length).toBe(0) // No changes reported when no addresses monitored
        })

        test("should simulate asset changes for contract interaction", async () => {
            // Create a user operation that interacts with the ERC20 contract
            // but doesn't actually transfer tokens (e.g., approve)
            const spender = "0x1234567890123456789012345678901234567890"
            const approveAmount = parseEther("50")

            const userOp = await smartAccountClient.prepareUserOperation({
                calls: [
                    {
                        to: erc20Address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: erc20Abi,
                            functionName: "approve",
                            args: [spender, approveAmount]
                        })
                    }
                ]
            })

            // Call pimlico_simulateAssetChange
            const result = await bundlerClient.request({
                method: "pimlico_simulateAssetChange",
                params: [
                    userOp,
                    entryPoint,
                    [smartAccountClient.account.address, spender],
                    [erc20Address]
                ]
            })

            expect(result).toBeDefined()
            expect(Array.isArray(result)).toBe(true)

            // Should only have ETH change for gas (no token transfer)
            const tokenChanges = result.filter(
                (r: any) => r.token.toLowerCase() === erc20Address.toLowerCase()
            )
            expect(tokenChanges.length).toBe(0) // No token balance changes

            const ethChanges = result.filter(
                (r: any) => r.token === "0x0000000000000000000000000000000000000000"
            )
            expect(ethChanges.length).toBe(1)
            expect(BigInt(ethChanges[0].diff)).toBeLessThan(0n) // Only gas fees
        })
    }
)