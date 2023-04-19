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
    BundlingMode
} from "@alto/types"
import { numberToHex } from "viem"
import { IValidator } from "@alto/validator"

export interface IRpcEndpoint {
    handleMethod(request: BundlerRequest): Promise<BundlerResponse>
}

export class RpcHandler implements IRpcEndpoint {
    constructor(readonly config: RpcHandlerConfig, readonly validators: Map<Address, IValidator>) {}

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
        return this.config.entryPoints
    }

    async eth_estimateUserOperationGas(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<EstimateUserOperationGasResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_sendUserOperation(
        userOperation: UserOperation,
        entryPoint: Address
    ): Promise<SendUserOperationResponseResult> {
        throw new Error("Method not implemented.")
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
