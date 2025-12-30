import {
    type EntryPointVersion,
    entryPoint06Abi,
    entryPoint06Address,
    entryPoint07Abi,
    entryPoint07Address,
    entryPoint08Abi,
    entryPoint08Address,
    entryPoint09Abi,
    entryPoint09Address
} from "viem/account-abstraction"

export const getSimpleFactoryAddress = (version: EntryPointVersion) => {
    switch (version) {
        case "0.6":
            return "0x9406Cc6185a346906296840746125a0E44976454"
        case "0.7":
            return "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985"
        case "0.8":
            return "0x13E9ed32155810FDbd067D4522C492D6f68E5944"
        case "0.9":
            return "0xf4a7018fdbf22804526ec4b77dce4f9b0d27a395"
    }
}

export const getEntryPointAddress = (version: EntryPointVersion) => {
    switch (version) {
        case "0.6":
            return entryPoint06Address
        case "0.7":
            return entryPoint07Address
        case "0.8":
            return entryPoint08Address
        case "0.9":
            return entryPoint09Address
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
        case "0.9":
            return entryPoint09Abi
    }
}
