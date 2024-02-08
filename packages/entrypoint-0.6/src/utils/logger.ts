import logger, { type Logger, type SerializerFn } from "pino"
import { toHex } from "viem"

// customFormatter.ts
type AnyObject = { [key: string]: any }

function bigintToJson(_key: string, value: any): any {
    if (typeof value === "bigint") {
        return toHex(value)
    }
    return value
}

function logLevel(label: string) {
    return {
        level: label
    }
}

function stringifyWithCircularHandling(
    obj: AnyObject,
    replacer?: (key: string, value: any) => any
): string {
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
                output[key] = JSON.parse(
                    stringifyWithCircularHandling(value, bigintToJson)
                )
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
            level: logLevel,
            log: customSerializer
        }
    })

    l.level = level

    return l
}

export const initProductionLogger = (level: string): Logger => {
    const l = logger({
        base: undefined, // do not log pid and hostname, we don't need it
        formatters: {
            level: logLevel,
            log: customSerializer
        }
    })
    l.level = level
    return l
}
