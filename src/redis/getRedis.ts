import Redis from "ioredis"

let redis: Redis | null = null

export function getRedis(endpoint: string): Redis {
    if (!redis) {
        redis = new Redis(endpoint)
    }
    return redis
}

export async function closeRedis(): Promise<void> {
    if (redis) {
        await redis.quit()
        redis = null
    }
}