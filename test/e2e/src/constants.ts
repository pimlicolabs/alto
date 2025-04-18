import { Address } from "viem"
import {
    entryPoint06Address,
    entryPoint07Address
} from "viem/account-abstraction"

// biome-ignore format:
export const SIMPLE_ACCOUNT_FACTORY_V06 = "0x9406Cc6185a346906296840746125a0E44976454"
// biome-ignore format:
export const SIMPLE_ACCOUNT_FACTORY_V07 = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985"
// biome-ignore format:
export const SIMPLE_ACCOUNT_FACTORY_V08 = "0x13E9ed32155810FDbd067D4522C492D6f68E5944"

// biome-ignore format:
export const entryPoint08Address: Address = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"

export type EntryPointVersion = "0.6" | "0.7" | "0.8"

export const getFactoryAddress = (version: EntryPointVersion) => {
    switch (version) {
        case "0.6":
            return SIMPLE_ACCOUNT_FACTORY_V06
        case "0.7":
            return SIMPLE_ACCOUNT_FACTORY_V07
        case "0.8":
            return SIMPLE_ACCOUNT_FACTORY_V08
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
    }
}

export const getViemEntryPointVersion = (version: EntryPointVersion) => {
    switch (version) {
        case "0.6":
            return "0.6" as const
        case "0.7":
        case "0.8":
            return "0.7" as const
    }
}
