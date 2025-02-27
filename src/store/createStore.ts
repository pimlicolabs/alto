import { Store, UserOpType } from "."
import { AltoConfig } from "../createConfig"
import { HexData32 } from "../types/schemas"

export const createStore = <T extends UserOpType>({
    config
}: { config: AltoConfig }): Store<T> => {
    let store: T[] = []

    return {
        add: async ({ op }: { op: T }) => {
            store = [...store, op]
            return Promise.resolve()
        },
        remove: async ({ userOpHash }: { userOpHash: HexData32 }) => {
            const exists = store.some((op) => op.userOpHash === userOpHash)
            store = store.filter((op) => op.userOpHash !== userOpHash)
            return Promise.resolve(exists)
        },
        dump: async () => {
            return Promise.resolve([...store])
        },
        length: async () => {
            return Promise.resolve(store.length)
        },
        clear: async () => {
            store = []
            return Promise.resolve()
        }
    }
}
