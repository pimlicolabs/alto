import * as opentelemetry from "@opentelemetry/api"

export class AsyncTimeoutError extends Error {
    constructor() {
        super("Operation timed out")
        this.name = "AsyncTimeoutError"
    }
}

export const asyncCallWithTimeout = async <T>(
    asyncPromise: Promise<T>,
    timeLimit: number
): Promise<T> => {
    let timeoutHandle: ReturnType<typeof setTimeout>

    const timeoutPromise = new Promise((_resolve, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new AsyncTimeoutError()),
            timeLimit
        )
    })

    return Promise.race([asyncPromise, timeoutPromise])
        .then((result) => {
            clearTimeout(timeoutHandle)
            return result as T
        })
        .catch((error) => {
            opentelemetry.trace.getActiveSpan()?.recordException(error)
            throw error
        })
}