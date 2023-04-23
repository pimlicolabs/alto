import { RpcHandlerConfig } from "@alto/config"
import {
    Address,
    BundlerClearStateResponseResult,
    BundlerDumpMempoolResponseResult,
    BundlerRequest,
    BundlerResponse,
    BundlerSendBundleNowResponseResult,
    BundlerSetBundlingModeResponseResult,
    ChainIdResponseResult,
    EstimateUserOperationGasResponseResult,
    GetUserOperationByHashResponseResult,
    GetUserOperationReceiptResponseResult,
    HexData32,
    SendUserOperationResponseResult,
    SupportedEntryPointsResponseResult,
    UserOperation,
    BundlingMode,
    EntryPointAbi,
    RpcError,
    ExecutionErrors
} from "@alto/types"
import { numberToHex, getContract, toHex } from "viem"
import { IValidator } from "@alto/validator"
import { calcPreVerificationGas } from "@alto/utils"
import { IExecutor } from "@alto/executor"

export interface IRpcEndpoint {
    handleMethod(request: BundlerRequest): Promise<BundlerResponse>
    eth_chainId(): Promise<ChainIdResponseResult>
    eth_supportedEntryPoints(): Promise<SupportedEntryPointsResponseResult>
    eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<EstimateUserOperationGasResponseResult>
    eth_sendUserOperation(userOperation: UserOperation, entryPoint: Address): Promise<SendUserOperationResponseResult>
    eth_getUserOperationByHash(userOperationHash: HexData32): Promise<GetUserOperationByHashResponseResult>
    eth_getUserOperationReceipt(userOperationHash: HexData32): Promise<GetUserOperationReceiptResponseResult>
}

export class RpcHandler implements IRpcEndpoint {
    constructor(readonly config: RpcHandlerConfig, readonly validator: IValidator, readonly executor: IExecutor) {}

    async handleMethod(request: BundlerRequest): Promise<BundlerResponse> {
        // call the method with the params
        const method = request.method
        switch (method) {
            case "eth_chainId":
                return { method, result: await this.eth_chainId(...request.params) }
            case "eth_supportedEntryPoints":
                return {
                    method,
                    result: await this.eth_supportedEntryPoints(...request.params)
                }
            case "eth_estimateUserOperationGas":
                return {
                    method,
                    result: await this.eth_estimateUserOperationGas(...request.params)
                }
            case "eth_sendUserOperation":
                return {
                    method,
                    result: await this.eth_sendUserOperation(...request.params)
                }
            case "eth_getUserOperationByHash":
                return {
                    method,
                    result: await this.eth_getUserOperationByHash(...request.params)
                }
            case "eth_getUserOperationReceipt":
                return {
                    method,
                    result: await this.eth_getUserOperationReceipt(...request.params)
                }
            case "debug_bundler_clearState":
                return {
                    method,
                    result: await this.debug_bundler_clearState(...request.params)
                }
            case "debug_bundler_dumpMempool":
                return {
                    method,
                    result: await this.debug_bundler_dumpMempool(...request.params)
                }
            case "debug_bundler_sendBundleNow":
                return {
                    method,
                    result: await this.debug_bundler_sendBundleNow(...request.params)
                }
            case "debug_bundler_setBundlingMode":
                return {
                    method,
                    result: await this.debug_bundler_setBundlingMode(...request.params)
                }
        }
    }

    async eth_chainId(): Promise<ChainIdResponseResult> {
        return numberToHex(this.config.chainId)
    }

    async eth_supportedEntryPoints(): Promise<SupportedEntryPointsResponseResult> {
        return [this.config.entryPoint]
    }

    async eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<EstimateUserOperationGasResponseResult> {
        // check if entryPoint is supported, if not throw
        if (this.config.entryPoint !== entryPoint) {
            throw new Error(`EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entryPoint}`)
        }

        const validationResult = await this.validator.validateUserOperation(userOperation)

        const preVerificationGas = toHex(calcPreVerificationGas(userOperation))
        const verificationGas = toHex(validationResult.returnInfo.preOpGas)
        const callGasLimit = await this.config.publicClient
            .estimateGas({
                to: userOperation.sender,
                data: userOperation.callData,
                account: entryPoint
            })
            .then((b) => toHex(b))
            .catch((err) => {
                if (err instanceof Error) {
                    const message = err.message.match(/reason="(.*?)"/)?.at(1) ?? "execution reverted"
                    throw new RpcError(message, ExecutionErrors.UserOperationReverted)
                } else {
                    throw err
                }
            })

        return {
            preVerificationGas,
            verificationGas,
            callGasLimit
        }
    }

    async eth_sendUserOperation(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult> {
        if (this.config.entryPoint !== entryPoint) {
            throw new Error(`EntryPoint ${entryPoint} not supported, supported EntryPoints: ${this.config.entryPoint}`)
        }

        await this.validator.validateUserOperation(userOperation)

        await this.executor.bundle(entryPoint, [userOperation])

        const entryPointContract = getContract({
            address: entryPoint,
            abi: EntryPointAbi,
            publicClient: this.config.publicClient
        })

        return await entryPointContract.read.getUserOpHash([userOperation])
    }

    async eth_getUserOperationByHash(userOperationHash: HexData32): Promise<GetUserOperationByHashResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_getUserOperationReceipt(userOperationHash: HexData32): Promise<GetUserOperationReceiptResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_clearState(): Promise<BundlerClearStateResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_dumpMempool(entryPoint: Address): Promise<BundlerDumpMempoolResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_sendBundleNow(): Promise<BundlerSendBundleNowResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_setBundlingMode(bundlingMode: BundlingMode): Promise<BundlerSetBundlingModeResponseResult> {
        throw new Error("Method not implemented.")
    }
}
