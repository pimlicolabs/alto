import { RpcHandler } from "../rpcHandler"
import { ethChainIdHandler } from "./eth_chainId"

export function registerHandlers(rpcHandler: RpcHandler) {
    rpcHandler.registerHandler(ethChainIdHandler)
}
