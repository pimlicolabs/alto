import { Store, UserOpType } from "."
import { AltoConfig } from "../createConfig"
import { HexData32 } from "../types/schemas"

export const createStore = <T extends UserOpType>({
    config
}: { config: AltoConfig }): Store<T> => {
    let store: T[] = []

    return {
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
        dump: () => {
            return Promise.resolve([...store])
        },
        length: () => {
            return Promise.resolve(store.length)
        },
        clear: () => {
            store = []
            return Promise.resolve()
        }
    }
}
