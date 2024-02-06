import { NodeSDK } from "@opentelemetry/sdk-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { Sampler, SamplingDecision, ParentBasedSampler } from "@opentelemetry/sdk-trace-base"
import { Context, Attributes, SpanKind } from "@opentelemetry/api"
import { SemanticAttributes } from "@opentelemetry/semantic-conventions"
import { FetchInstrumentation } from "opentelemetry-instrumentation-fetch-node"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify"
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino"

class CustomSampler implements Sampler {
    shouldSample(context: Context, traceId: string, spanName: string, spanKind: SpanKind, attributes: Attributes) {
        const ignoredRoutes = ["/metrics", "/health"]

        const httpTarget = attributes[SemanticAttributes.HTTP_TARGET]

        if (
            spanKind === SpanKind.SERVER && httpTarget && ignoredRoutes.includes(httpTarget.toString())
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
        new FetchInstrumentation({}),
        new FastifyInstrumentation(),
        new PinoInstrumentation(),
    ],
    sampler: new ParentBasedSampler({root: new CustomSampler()})
})

sdk.start()
