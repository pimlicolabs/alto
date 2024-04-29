import type { HexData32, UserOperationStatus } from "@alto/types"

export class Monitor {
    private userOperationToStatus: Record<HexData32, UserOperationStatus>
    private userOperationTimeouts: Record<HexData32, NodeJS.Timeout>
    private timeout: number

    constructor(timeout: number = 60 * 60 * 1000) {
        this.timeout = timeout
        this.userOperationToStatus = {}
        this.userOperationTimeouts = {}
    }

    public setUserOperationStatus(
        userOperation: HexData32,
        status: UserOperationStatus
    ): void {
        // Clear existing timer if it exists
        if (this.userOperationTimeouts[userOperation]) {
            clearTimeout(this.userOperationTimeouts[userOperation])
        }

        // Set the user operation status
        this.userOperationToStatus[userOperation] = status

        // Set a new timer and store its identifier
        this.userOperationTimeouts[userOperation] = setTimeout(() => {
            delete this.userOperationToStatus[userOperation]
            delete this.userOperationTimeouts[userOperation]
        }, this.timeout) as NodeJS.Timeout
    }

    public getUserOperationStatus(
        userOperation: HexData32
    ): UserOperationStatus {
        const status = this.userOperationToStatus[userOperation]
        if (status === undefined) {
            return {
                status: "not_found",
                transactionHash: null
            }
        }
        return status
    }
}
