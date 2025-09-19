export function getRedisPerformanceMarker(duration: number): string {
    if (duration < 25) {
        return "fast"
    } else if (duration < 50) {
        return "medium"
    } else {
        return "slow"
    }
}