import { HexData32, UserOperationStatus } from "@alto/types"
import { expect } from "earl"
import { Monitor } from "../monitoring" // Update the import path according to your project structure

describe("Monitor", () => {
    const timeout = 500
    const userOperation: HexData32 = "0xabcdef1234567890"
    const status: UserOperationStatus = {
        status: "submitted",
        transactionHash: "0x1234567890abcdef"
    }

    it("should set user operation status", () => {
        const monitor = new Monitor(timeout)
        monitor.setUserOperationStatus(userOperation, status)
        const retrievedStatus = monitor.getUserOperationStatus(userOperation)
        expect(retrievedStatus).toEqual(status)
    })

    it("should return not_found status for an unknown user operation", () => {
        const monitor = new Monitor(timeout)
        const retrievedStatus = monitor.getUserOperationStatus(
            "0xunknownuseroperation"
        )
        expect(retrievedStatus).toEqual({
            status: "not_found",
            transactionHash: null
        })
    })

    it("should clear existing user operation status after timeout", async function () {
        this.timeout(timeout + 800)

        const monitor = new Monitor(timeout)
        monitor.setUserOperationStatus(userOperation, status)

        await new Promise((resolve) => setTimeout(resolve, timeout + 500))
        const retrievedStatus = monitor.getUserOperationStatus(userOperation)
        expect(retrievedStatus).toEqual({
            status: "not_found",
            transactionHash: null
        })
    })

    it("should overwrite existing user operation status and reset timeout", async () => {
        const monitor = new Monitor(timeout)
        const updatedStatus: UserOperationStatus = {
            status: "included",
            transactionHash: "0x1234567890abcdef"
        }

        monitor.setUserOperationStatus(userOperation, status)

        await new Promise((resolve) => setTimeout(resolve, timeout - 100))
        monitor.setUserOperationStatus(userOperation, updatedStatus)

        await new Promise((resolve) => setTimeout(resolve, timeout - 100))
        const retrievedStatus = monitor.getUserOperationStatus(userOperation)
        expect(retrievedStatus).toEqual(updatedStatus)
    })
})
