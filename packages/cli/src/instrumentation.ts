import { Attributes, Context, SpanKind } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino"
import { NodeSDK } from "@opentelemetry/sdk-node"
import {
    ParentBasedSampler,
    Sampler,
    SamplingDecision
} from "@opentelemetry/sdk-trace-base"
import { SemanticAttributes } from "@opentelemetry/semantic-conventions"
import { FetchInstrumentation } from "opentelemetry-instrumentation-fetch-node"

class CustomSampler implements Sampler {
    shouldSample(
        context: Context,
        traceId: string,
        spanName: string,
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
        new FetchInstrumentation({}),
        new FastifyInstrumentation(),
        new PinoInstrumentation()
    ],
    sampler: new ParentBasedSampler({ root: new CustomSampler() })
})

sdk.start()
