import {
    type Address,
    type Hex,
    encodeAbiParameters,
    keccak256,
    parseAbi,
    stringToHex
} from "viem"
import type { EntryPointVersion } from "viem/account-abstraction"

// Base's EIP7702Proxy suite (https://github.com/base/eip-7702-proxy),
// deployed by deploy-contracts (see the BaseEIP7702Proxy section in
// constants.ts).
export const BASE_EIP7702_PROXY: Address =
    "0x5b10769570856Ee76EE54A463e97fCB7D20314fa"
export const NONCE_TRACKER: Address =
    "0x5ABb791E1C8EE1D023079a65874Dd4EB87b206e9"

// Minimal IAccountStateValidator for the BaseEIP7702Proxy that accepts the
// version's Simple7702Account implementation. The proxy unconditionally
// calls the validator after an upgrade and reverts unless it returns the
// ACCOUNT_STATE_VALIDATION_SUCCESS magic value.
export const getSimple7702AccountValidatorAddress = (
    entryPointVersion: EntryPointVersion
): Address => {
    switch (entryPointVersion) {
        case "0.9":
            return "0xA4d83818BD131FACa06ABC090617930b1df2AE53"
        case "0.8":
            return "0xdf21d27991F8F4a0D1526308f620A75d1185e7a3"
        default:
            throw new Error(
                "Simple7702AccountValidator is only deployed for EntryPoint 0.8 and 0.9"
            )
    }
}

export const baseEip7702ProxyAbi = parseAbi([
    "function setImplementation(address newImplementation, bytes callData, address validator, uint256 expiry, bytes signature, bool allowCrossChainReplay)"
])

export const nonceTrackerAbi = parseAbi([
    "function nonces(address account) view returns (uint256)"
])

export const ERC1967_IMPLEMENTATION_SLOT =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"

const IMPLEMENTATION_SET_TYPEHASH = keccak256(
    stringToHex(
        "EIP7702ProxyImplementationSet(uint256 chainId,address proxy,uint256 nonce,address currentImplementation,address newImplementation,bytes callData,address validator,uint256 expiry)"
    )
)

// Hash authorizing BaseEIP7702Proxy.setImplementation. Signed by the EOA key
// as a bare ECDSA hash: the proxy uses no EIP-191/712 wrapping.
// https://github.com/base/eip-7702-proxy/blob/main/src/EIP7702Proxy.sol
export const getSetImplementationHash = ({
    chainId,
    nonce,
    currentImplementation,
    newImplementation,
    callData,
    validator,
    expiry
}: {
    chainId: number
    nonce: bigint
    currentImplementation: Address
    newImplementation: Address
    callData: Hex
    validator: Address
    expiry: bigint
}): Hex => {
    return keccak256(
        encodeAbiParameters(
            [
                { type: "bytes32" },
                { type: "uint256" }, // chainId
                { type: "address" }, // proxy
                { type: "uint256" }, // NonceTracker nonce
                { type: "address" }, // current implementation
                { type: "address" }, // new implementation
                { type: "bytes32" }, // keccak256(callData)
                { type: "address" }, // validator
                { type: "uint256" } // expiry
            ],
            [
                IMPLEMENTATION_SET_TYPEHASH,
                BigInt(chainId),
                BASE_EIP7702_PROXY,
                nonce,
                currentImplementation,
                newImplementation,
                keccak256(callData),
                validator,
                expiry
            ]
        )
    )
}
