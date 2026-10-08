import {
    type Attributes,
    type Span,
    SpanStatusCode,
    context,
    trace
} from "@opentelemetry/api"

// Bundling runs outside any RPC request, so without these spans its outgoing
// RPC calls (simulation, nonce fetch, sends) have no parent and aren't traced.
export const executorTracer = trace.getTracer("alto-executor")

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
                span.recordException(err as Error)
                span.setStatus({ code: SpanStatusCode.ERROR })
                throw err
            } finally {
                span.end()
            }
        }
    )
}
