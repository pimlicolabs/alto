import { type Attributes, type Context, SpanKind } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino"
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici"
import { ViemInstrumentation } from "@pimlico/opentelemetry-instrumentation-viem"
import { NodeSDK } from "@opentelemetry/sdk-node"
import {
    ParentBasedSampler,
    type Sampler,
    SamplingDecision
} from "@opentelemetry/sdk-trace-base"
import { SemanticAttributes } from "@opentelemetry/semantic-conventions"
import module from "node:module"
import { createAddHookMessageChannel } from "import-in-the-middle"

const { registerOptions, waitForAllMessagesAcknowledged } =
    createAddHookMessageChannel()
// @ts-ignore —  @types/node needs to be updated first
module.register(
    "import-in-the-middle/hook.mjs",
    import.meta.url,
    registerOptions
)

class CustomSampler implements Sampler {
    shouldSample(
        _context: Context,
        _traceId: string,
        _spanName: string,
        spanKind: SpanKind,
        attributes: Attributes
    ) {
        const ignoredRoutes = ["/metrics", "/health"]

        const httpTarget = attributes[SemanticAttributes.HTTP_TARGET]

        if (
            spanKind === SpanKind.SERVER &&
            httpTarget &&
            ignoredRoutes.includes(httpTarget.toString())
        ) {
            return { decision: SamplingDecision.NOT_RECORD }
        }
        // fallback
        return { decision: SamplingDecision.RECORD_AND_SAMPLED }
    }
    toString() {
        return "CustomSampler"
    }
}

const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
        new HttpInstrumentation({
            requireParentforOutgoingSpans: true
        }),
        new UndiciInstrumentation({
            requireParentforSpans: true
        }),
        new FastifyInstrumentation(),
        new PinoInstrumentation(),
        new ViemInstrumentation({
            captureOperationResult: true
        })
    ],
    sampler: new ParentBasedSampler({ root: new CustomSampler() })
})

sdk.start()
await waitForAllMessagesAcknowledged()
