import {
    type Attributes,
    ProxyTracerProvider,
    type Span,
    SpanStatusCode,
    context,
    trace
} from "@opentelemetry/api"
import { BaseError } from "viem"

// Bundling runs outside any RPC request, so without these spans its outgoing
// RPC calls (simulation, nonce fetch, sends) have no parent and aren't traced.
export const executorTracer = trace.getTracer("alto-executor")

// Viem error messages embed the full request, calldata included, so spans
// only get the short message.
export const getShortErrorMessage = (err: unknown): string => {
    if (err instanceof BaseError) {
        return err.shortMessage
    }
    return err instanceof Error ? err.message : String(err)
}

export const recordSpanError = (span: Span, err: unknown) => {
    const message = getShortErrorMessage(err)
    span.recordException({
        name: err instanceof Error ? err.name : "Error",
        message
    })
    span.setStatus({ code: SpanStatusCode.ERROR, message })
}

// Spans are exported in batches, so export whatever is buffered before the
// process exits. The SDK is preloaded, so reach it through the global
// provider. A no-op when tracing is not enabled.
export const flushTraces = async (): Promise<void> => {
    const globalProvider = trace.getTracerProvider()
    const provider =
        globalProvider instanceof ProxyTracerProvider
            ? globalProvider.getDelegate()
            : globalProvider

    if ("forceFlush" in provider && typeof provider.forceFlush === "function") {
        await provider.forceFlush()
    }
}

// Runs fn inside an active span so outgoing RPC spans nest under it. Without
// a parent, the span is a child of the currently active span (if any).
export const withSpan = async <T>({
    name,
    attributes,
    parent,
    fn
}: {
    name: string
    attributes?: Attributes
    parent?: Span
    fn: (span: Span) => Promise<T>
}): Promise<T> => {
    const parentContext = parent
        ? trace.setSpan(context.active(), parent)
        : context.active()

    return await executorTracer.startActiveSpan(
        name,
        { attributes },
        parentContext,
        async (span) => {
            try {
                return await fn(span)
            } catch (err) {
                recordSpanError(span, err)
                throw err
            } finally {
                span.end()
            }
        }
    )
}
