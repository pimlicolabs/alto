import {
    BundlerClearStateRequestParams,
    BundlerClearStateResponseResult,
    BundlerDumpMempoolRequestParams,
    BundlerDumpMempoolResponseResult,
    BundlerRequest,
    BundlerResponse,
    BundlerSendBundleNowRequestParams,
    BundlerSendBundleNowResponseResult,
    BundlerSetBundlingModeRequestParams,
    BundlerSetBundlingModeResponseResult,
    ChainIdRequestParams,
    ChainIdResponseResult,
    CoinbaseRequestParams,
    CoinbaseResponseResult,
    EstimateUserOperationGasRequestParams,
    EstimateUserOperationGasResponseResult,
    GetUserOperationByHashRequestParams,
    GetUserOperationByHashResponseResult,
    GetUserOperationReceiptRequestParams,
    GetUserOperationReceiptResponseResult,
    SendUserOperationRequestParams,
    SendUserOperationResponseResult,
    SupportedEntryPointsRequestParams,
    SupportedEntryPointsResponseResult,
} from "./schemas"

export interface RpcEndpoint {
    handleMethod(request: BundlerRequest): Promise<BundlerResponse>
}

export class RpcHandler implements RpcEndpoint {
    async handleMethod(request: BundlerRequest): Promise<BundlerResponse> {
        // call the method with the params
        const method = request.method
        switch (method) {
            case "eth_chainId":
                return { method, result: await this.eth_chainId(request.params) }
            case "eth_supportedEntryPoints":
                return { method, result: await this.eth_supportedEntryPoints(request.params) }
            case "eth_coinbase":
                return { method, result: await this.eth_coinbase(request.params) }
            case "eth_estimateUserOperationGas":
                return { method, result: await this.eth_estimateUserOperationGas(request.params) }
            case "eth_sendUserOperation":
                return { method, result: await this.eth_sendUserOperation(request.params) }
            case "eth_getUserOperationByHash":
                return { method, result: await this.eth_getUserOperationByHash(request.params) }
            case "eth_getUserOperationReceipt":
                return { method, result: await this.eth_getUserOperationReceipt(request.params) }
            case "debug_bundler_clearState":
                return { method, result: await this.debug_bundler_clearState(request.params) }
            case "debug_bundler_dumpMempool":
                return { method, result: await this.debug_bundler_dumpMempool(request.params) }
            case "debug_bundler_sendBundleNow":
                return { method, result: await this.debug_bundler_sendBundleNow(request.params) }
            case "debug_bundler_setBundlingMode":
                return { method, result: await this.debug_bundler_setBundlingMode(request.params) }
        }
    }

    async eth_chainId(params: ChainIdRequestParams): Promise<ChainIdResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_supportedEntryPoints(
        params: SupportedEntryPointsRequestParams,
    ): Promise<SupportedEntryPointsResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_coinbase(params: CoinbaseRequestParams): Promise<CoinbaseResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_estimateUserOperationGas(
        params: EstimateUserOperationGasRequestParams,
    ): Promise<EstimateUserOperationGasResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_sendUserOperation(params: SendUserOperationRequestParams): Promise<SendUserOperationResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_getUserOperationByHash(
        params: GetUserOperationByHashRequestParams,
    ): Promise<GetUserOperationByHashResponseResult> {
        throw new Error("Method not implemented.")
    }

    async eth_getUserOperationReceipt(
        params: GetUserOperationReceiptRequestParams,
    ): Promise<GetUserOperationReceiptResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_clearState(params: BundlerClearStateRequestParams): Promise<BundlerClearStateResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_dumpMempool(
        params: BundlerDumpMempoolRequestParams,
    ): Promise<BundlerDumpMempoolResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_sendBundleNow(
        params: BundlerSendBundleNowRequestParams,
    ): Promise<BundlerSendBundleNowResponseResult> {
        throw new Error("Method not implemented.")
    }

    async debug_bundler_setBundlingMode(
        params: BundlerSetBundlingModeRequestParams,
    ): Promise<BundlerSetBundlingModeResponseResult> {
        throw new Error("Method not implemented.")
    }
}
