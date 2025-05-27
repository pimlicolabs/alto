import {
    type EntryPointVersion,
    entryPoint06Abi,
    entryPoint06Address,
    entryPoint07Abi,
    entryPoint07Address,
    entryPoint08Abi,
    entryPoint08Address
} from "viem/account-abstraction"

export const getEntryPointAddress = (version: EntryPointVersion) => {
    switch (version) {
        case "0.6":
            return entryPoint06Address
        case "0.7":
            return entryPoint07Address
        case "0.8":
            return entryPoint08Address
    }
}

export const getEntryPointAbi = (version: EntryPointVersion) => {
    switch (version) {
        case "0.6":
            return entryPoint06Abi
        case "0.7":
            return entryPoint07Abi
        case "0.8":
            return entryPoint08Abi
    }
}
