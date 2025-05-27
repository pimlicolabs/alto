import type { Store, UserOpType } from "."
import type { AltoConfig } from "../createConfig"
import type { HexData32, UserOperation } from "../types/schemas"
import { isVersion06, isVersion07 } from "../utils/userop"

export const createMemoryStore = <T extends UserOpType>({
    config
}: { config: AltoConfig }): Store<T> => {
    let store: T[] = []

    return {
        findConflicting: async (userOp: UserOperation) => {
            const dump = [...store]
            const { sender, nonce } = userOp

            // Check for same sender and nonce
            const conflictingNonce = dump.find((userOpInfo) => {
                const { userOp: mempoolUserOp } = userOpInfo
                return (
                    mempoolUserOp.sender === sender &&
                    mempoolUserOp.nonce === nonce
                )
            })

            if (conflictingNonce) {
                return {
                    reason: "conflicting_nonce",
                    userOp: conflictingNonce.userOp
                }
            }

            // Check for deployment conflict
            const isCurrentOpDeployment =
                (isVersion06(userOp) &&
                    userOp.initCode &&
                    userOp.initCode !== "0x") ||
                (isVersion07(userOp) &&
                    userOp.factory &&
                    userOp.factory !== "0x")

            if (isCurrentOpDeployment) {
                const conflictingDeployment = dump.find((userOpInfo) => {
                    const { userOp: mempoolUserOp } = userOpInfo

                    const isV6Deployment =
                        isVersion06(mempoolUserOp) &&
                        mempoolUserOp.initCode &&
                        mempoolUserOp.initCode !== "0x"

                    const isV7Deployment =
                        isVersion07(mempoolUserOp) &&
                        mempoolUserOp.factory &&
                        mempoolUserOp.factory !== "0x"

                    const isDeployment = isV6Deployment || isV7Deployment

                    return mempoolUserOp.sender === sender && isDeployment
                })

                if (conflictingDeployment) {
                    return {
                        reason: "conflicting_deployment",
                        userOp: conflictingDeployment.userOp
                    }
                }
            }

            return undefined
        },
        add: (op: T) => {
            store = [...store, op]
            return Promise.resolve()
        },
        remove: (userOpHash: HexData32) => {
            const exists = store.some((op) => op.userOpHash === userOpHash)
            store = store.filter((op) => op.userOpHash !== userOpHash)
            return Promise.resolve(exists)
        },
        contains: (userOpHash: HexData32) => {
            const contains = store.some((op) => op.userOpHash === userOpHash)
            return Promise.resolve(contains)
        },
        dumpLocal: () => {
            return Promise.resolve([...store])
        }
    }
}
