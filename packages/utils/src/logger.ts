import logger, { pino, Logger, SerializerFn } from "pino"
import { toHex } from "viem"
import "pino-loki"

// customFormatter.ts
type AnyObject = { [key: string]: any }

function bigintToJson(_key: string, value: any): any {
    if (typeof value === "bigint") {
        return toHex(value)
    }
    return value
}

function stringifyWithCircularHandling(obj: AnyObject, replacer?: (key: string, value: any) => any): string {
    const cache: Set<any> = new Set()
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (cache.has(value)) {
                return // Circular reference found, discard the key
            }
            cache.add(value)
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return replacer ? replacer(key, value) : value
    })
}

export const customSerializer: SerializerFn = (input: AnyObject): AnyObject => {
    const output: AnyObject = {}
    for (const key in input) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const value = input[key]
            if (typeof value === "object" && value !== null) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument
                output[key] = JSON.parse(stringifyWithCircularHandling(value, bigintToJson))
            } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                output[key] = bigintToJson(key, value)
            }
        }
    }
    return output
}

export const initDebugLogger = (level = "debug"): Logger => {
    const l = logger({
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true
            }
        },
        formatters: {
            log: customSerializer
        }
    })

    l.level = level

    return l
}

export const initProductionLogger = (
    level: string,
    chainId: number,
    network: string,
    environment: string,
    lokiHost?: string,
    lokiUsername?: string,
    lokiPassword?: string
): Logger => {
    if (lokiHost && lokiUsername && lokiPassword) {
        const transport = pino.transport({
            target: "pino-loki",
            options: {
                batching: true,
                interval: 1,
                labels: { app: "alto", chainId: chainId.toString(), env: environment, network },
                host: lokiHost,
                basicAuth: {
                    username: lokiUsername,
                    password: lokiPassword
                },
                replaceTimestamp: false
            }
        })

        const l = logger(transport)
        l.level = level
        return l
    } else {
        const l = logger({
            formatters: {
                log: customSerializer
            }
        })
        l.level = level
        return l
    }
}
