import type { Logger } from "@alto/utils"
import {
    BaseError,
    type EIP1193RequestFn,
    type HttpTransportConfig,
    MethodNotFoundRpcError,
    MethodNotSupportedRpcError,
    type Transport,
    createTransport,
    numberToHex
} from "viem"
import { customTransport } from "./customTransport"

const isUnsupportedMethodError = (err: unknown): boolean =>
    err instanceof BaseError &&
    Boolean(
        err.walk(
            (e) =>
                e instanceof MethodNotFoundRpcError ||
                e instanceof MethodNotSupportedRpcError
        )
    )

// "already known" means the endpoint's pool holds this exact transaction, so
// it was broadcast no matter what the other endpoints answered.
//
// go-ethereum: https://github.com/ethereum/go-ethereum/blob/b05eff/core/txpool/errors.go#L26
//     ErrAlreadyKnown = errors.New("already known")
// op-geth: https://github.com/ethereum-optimism/op-geth/blob/79e9d2/core/txpool/errors.go#L26
//     ErrAlreadyKnown = errors.New("already known")
// bsc: https://github.com/bnb-chain/bsc/blob/4bd1c7/core/txpool/errors.go#L26
//     ErrAlreadyKnown = errors.New("already known")
// reth: https://github.com/paradigmxyz/reth/blob/6af8cd/crates/rpc/rpc-eth-types/src/error/mod.rs#L968
//     #[error("already known")]
// erigon: https://github.com/erigontech/erigon/blob/cfd011/txnprovider/txpool/txpoolcfg/txpoolcfg.go#L146
//     return "already known"
// nethermind: https://github.com/NethermindEth/nethermind/blob/93c1f9/src/Nethermind/Nethermind.TxPool/TxPoolErrorMessages.cs#L12
//     public const string AlreadyKnown = "already known";
const isAlreadyKnownError = (err: unknown): boolean =>
    err instanceof BaseError &&
    Boolean(
        err.walk((e) =>
            (e as Error).message?.toLowerCase().includes("already known")
        )
    )

// Fans out every request to all urls in parallel, resolving with the first
// successful response and rejecting only if every endpoint fails. Fanning out
// non-send methods too keeps a lagging or method-restricted endpoint (e.g. a
// sequencer that only accepts eth_sendRawTransaction) from stalling requests.
// eth_chainId is answered locally: viem calls it before every sendTransaction
// and some endpoints don't allow it.
export function multiRpcTransport(
    urls: string[],
    config: HttpTransportConfig & { logger: Logger; chainId: number }
): Transport {
    const {
        key = "multiRpc",
        name = "Multi RPC JSON-RPC",
        logger,
        chainId
    } = config

    return ({ chain, retryCount, timeout }) => {
        const transports = urls.map((url) =>
            customTransport(url, {
                ...config,
                logger: logger.child({ sendTransactionRpcUrl: url })
            })({ chain, retryCount: 0, timeout })
        )

        return createTransport({
            key,
            name,
            request: (async ({
                method,
                params
            }: {
                method: string
                params?: unknown
            }) => {
                if (method === "eth_chainId") {
                    return numberToHex(chainId)
                }

                const sends = transports.map((transport, index) => {
                    const send = transport.request({ method, params })
                    // Handle every rejection eagerly so an endpoint failing
                    // after another already succeeded can never become an
                    // unhandled rejection.
                    send.catch((err: unknown) => {
                        logger.warn(
                            { err, url: urls[index], method },
                            "multi rpc endpoint request failed"
                        )
                    })
                    return send
                })

                try {
                    return await Promise.any(sends)
                } catch (err) {
                    // Rethrow one endpoint's error instead of the
                    // AggregateError so viem's error classification (nonce
                    // too low, underpriced, ...) keeps working. Skip
                    // endpoints that don't support the method (e.g. a
                    // sequencer rejecting eth_sendRawTransactionSync), their
                    // error says nothing about the transaction. Prefer
                    // "already known": it proves the transaction was
                    // broadcast, which the caller must not treat as a failed
                    // send.
                    if (err instanceof AggregateError) {
                        throw (
                            err.errors.find(isAlreadyKnownError) ??
                            err.errors.find(
                                (error) => !isUnsupportedMethodError(error)
                            ) ??
                            err.errors[0]
                        )
                    }
                    throw err
                }
            }) as EIP1193RequestFn,
            retryCount: config.retryCount ?? retryCount,
            timeout,
            type: "http"
        })
    }
}
