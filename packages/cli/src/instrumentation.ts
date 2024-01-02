import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { FetchInstrumentation } from 'opentelemetry-instrumentation-fetch-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';

propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
        new HttpInstrumentation({
            requireParentforOutgoingSpans: true,
        }),
        new FastifyInstrumentation(),
        new IORedisInstrumentation(),
        new FetchInstrumentation({}),
    ],
});

sdk.start();
