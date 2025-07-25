import z from "zod/v4"
import {
    partialAuthorizationSchema,
    signedAuthorizationSchema
} from "./authorization"
import {
    type Address,
    addressSchema,
    compliantAddressSchema,
    hexData32Schema,
    hexDataSchema,
    hexNumberSchema
} from "./common"
import {
    ENTRYPOINT_V6_ADDRESS,
    ENTRYPOINT_V7_ADDRESS,
    ENTRYPOINT_V8_ADDRESS
} from "./entrypoints"

const baseUserOperationSchemaV6 = z.object({
    sender: compliantAddressSchema,
    nonce: hexNumberSchema,
    initCode: hexDataSchema,
    callData: hexDataSchema,
    callGasLimit: hexNumberSchema,
    verificationGasLimit: hexNumberSchema,
    preVerificationGas: hexNumberSchema,
    maxPriorityFeePerGas: hexNumberSchema,
    maxFeePerGas: hexNumberSchema,
    paymasterAndData: hexDataSchema,
    signature: hexDataSchema,
    eip7702Auth: signedAuthorizationSchema.optional().nullable()
})

const baseUserOperationSchemaV7 = z.object({
    sender: compliantAddressSchema,
    nonce: hexNumberSchema,
    factory: addressSchema
        .nullable()
        .optional()
        .transform((val) => val ?? null),
    factoryData: hexDataSchema
        .nullable()
        .optional()
        .transform((val) => val ?? null),
    callData: hexDataSchema,
    callGasLimit: hexNumberSchema,
    verificationGasLimit: hexNumberSchema,
    preVerificationGas: hexNumberSchema,
    maxFeePerGas: hexNumberSchema,
    maxPriorityFeePerGas: hexNumberSchema,
    paymaster: addressSchema
        .nullable()
        .optional()
        .transform((val) => val ?? null),
    paymasterVerificationGasLimit: hexNumberSchema
        .nullable()
        .optional()
        .transform((val) => val ?? null),
    paymasterPostOpGasLimit: hexNumberSchema
        .nullable()
        .optional()
        .transform((val) => val ?? null),
    paymasterData: hexDataSchema
        .nullable()
        .optional()
        .transform((val) => val ?? null),
    signature: hexDataSchema,
    eip7702Auth: signedAuthorizationSchema.optional().nullable()
})

// Base user operation schema for V8 (extends V7 with factory allowing "0x7702")
const baseUserOperationSchemaV8 = baseUserOperationSchemaV7.extend({
    factory: z
        .union([addressSchema, z.literal("0x7702")])
        .nullable()
        .optional()
        .transform((val) => val ?? null)
})

// Main user operation schemas (strict versions)
const userOperationSchemaV6 = baseUserOperationSchemaV6
    .strict()
    .transform((val) => val)

const userOperationSchemaV7 = baseUserOperationSchemaV7
    .strict()
    .transform((val) => val)

const userOperationSchemaV8 = baseUserOperationSchemaV8
    .strict()
    .transform((val) => val)

// Partial user operation schemas (with defaults for gas fields)
const partialUserOperationSchemaV6 = baseUserOperationSchemaV6
    .extend({
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        maxPriorityFeePerGas: hexNumberSchema.default(1n),
        maxFeePerGas: hexNumberSchema.default(1n),
        eip7702Auth: partialAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

const partialUserOperationSchemaV7 = baseUserOperationSchemaV7
    .extend({
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        eip7702Auth: partialAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

const partialUserOperationSchemaV8 = baseUserOperationSchemaV8
    .extend({
        sender: addressSchema, // Remove compliant check for partial
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        maxFeePerGas: hexNumberSchema.default(1n),
        maxPriorityFeePerGas: hexNumberSchema.default(1n),
        eip7702Auth: partialAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

const eip7677UserOperationSchemaV6 = baseUserOperationSchemaV6
    .extend({
        paymasterAndData: hexDataSchema
            .nullable()
            .optional()
            .transform((val) => val ?? "0x"),
        signature: hexDataSchema
            .nullable()
            .optional()
            .transform((val) => val ?? "0x")
    })
    .strict()
    .transform((val) => val)

const eip7677UserOperationSchemaV7 = baseUserOperationSchemaV7
    .extend({
        signature: hexDataSchema.optional().transform((val) => val ?? "0x"),
        eip7702Auth: partialAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

const eip7677UserOperationSchemaV8 = baseUserOperationSchemaV8
    .extend({
        signature: hexDataSchema.optional().transform((val) => val ?? "0x"),
        eip7702Auth: partialAuthorizationSchema.optional().nullable()
    })
    .strict()
    .transform((val) => val)

// Paymaster user operation schemas (with defaults and special transforms)
const userOperationSchemaPaymasterV6 = baseUserOperationSchemaV6
    .extend({
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        paymasterAndData: z
            .union([hexDataSchema, z.literal("")])
            .optional()
            .transform((val) => {
                if (val === "" || val === undefined) {
                    return "0x"
                }
                return val
            }),
        signature: z
            .union([hexDataSchema, z.literal("")])
            .optional()
            .transform((val) => {
                if (val === "" || val === undefined) {
                    return "0x"
                }
                return val
            })
    })
    .strict()
    .transform((val) => val)

const userOperationSchemaPaymasterV7 = baseUserOperationSchemaV7
    .extend({
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        signature: hexDataSchema.optional().transform((val) => {
            if (val === undefined) {
                return "0x"
            }
            return val
        })
    })
    .strict()
    .transform((val) => val)

const userOperationSchemaPaymasterV8 = baseUserOperationSchemaV8
    .extend({
        callGasLimit: hexNumberSchema.default(1n),
        verificationGasLimit: hexNumberSchema.default(1n),
        preVerificationGas: hexNumberSchema.default(1n),
        signature: hexDataSchema.optional().transform((val) => {
            if (val === undefined) {
                return "0x"
            }
            return val
        })
    })
    .strict()
    .transform((val) => val)

const userOperationSchema = z.union([
    userOperationSchemaV6,
    userOperationSchemaV7,
    userOperationSchemaV8
])

const partialUserOperationSchema = z.union([
    partialUserOperationSchemaV6,
    partialUserOperationSchemaV7,
    partialUserOperationSchemaV8
])

const userOperationSchemaPaymaster = z.union([
    userOperationSchemaPaymasterV6,
    userOperationSchemaPaymasterV7,
    userOperationSchemaPaymasterV8
])

const eip7677UserOperationSchema = z.union([
    eip7677UserOperationSchemaV6,
    eip7677UserOperationSchemaV7,
    eip7677UserOperationSchemaV8
])

type UserOperationV06 = z.infer<typeof userOperationSchemaV6>
type UserOperationV07 = z.infer<typeof userOperationSchemaV7>
type UserOperationV08 = z.infer<typeof userOperationSchemaV8>

type UserOperation = z.infer<typeof userOperationSchema>
type Eip7677UserOperation = z.infer<typeof eip7677UserOperationSchema>

const packerUserOperationSchema = z
    .object({
        sender: addressSchema,
        nonce: hexNumberSchema,
        initCode: hexDataSchema,
        callData: hexDataSchema,
        accountGasLimits: hexData32Schema,
        preVerificationGas: hexNumberSchema,
        gasFees: hexData32Schema,
        paymasterAndData: hexDataSchema,
        signature: hexDataSchema
    })
    .strict()
    .transform((val) => val)

type PackedUserOperation = z.infer<typeof packerUserOperationSchema>

function isVersion06(operation: UserOperation): operation is UserOperationV06 {
    return "initCode" in operation && "paymasterAndData" in operation
}

function isVersion07(operation: UserOperation): operation is UserOperationV07 {
    return "factory" in operation && "paymaster" in operation
}

function isVersion08(
    operation: UserOperation,
    entryPoint: Address
): operation is UserOperationV08 {
    return (
        isVersion07(operation) &&
        entryPoint === "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
    )
}

const entryPointAwareUserOperationSchema = z.discriminatedUnion("entryPoint", [
    z.object({
        entryPoint: z.literal(ENTRYPOINT_V6_ADDRESS),
        userOp: userOperationSchemaV6
    }),
    z.object({
        entryPoint: z.literal(ENTRYPOINT_V7_ADDRESS),
        userOp: userOperationSchemaV7
    }),
    z.object({
        entryPoint: z.literal(ENTRYPOINT_V8_ADDRESS),
        userOp: userOperationSchemaV8
    })
])
const entryPointAwareEip7677UserOperationSchema = z.discriminatedUnion(
    "entryPoint",
    [
        z.object({
            entryPoint: z.literal(ENTRYPOINT_V6_ADDRESS),
            userOp: eip7677UserOperationSchemaV6
        }),
        z.object({
            entryPoint: z.literal(ENTRYPOINT_V7_ADDRESS),
            userOp: eip7677UserOperationSchemaV7
        }),
        z.object({
            entryPoint: z.literal(ENTRYPOINT_V8_ADDRESS),
            userOp: eip7677UserOperationSchemaV8
        })
    ]
)

const entryPointAwarePartialUserOperationSchema = z.discriminatedUnion(
    "entryPoint",
    [
        z.object({
            entryPoint: z.literal(ENTRYPOINT_V6_ADDRESS),
            userOp: partialUserOperationSchemaV6
        }),
        z.object({
            entryPoint: z.literal(ENTRYPOINT_V7_ADDRESS),
            userOp: partialUserOperationSchemaV7
        }),
        z.object({
            entryPoint: z.literal(ENTRYPOINT_V8_ADDRESS),
            userOp: partialUserOperationSchemaV8
        })
    ]
)

export {
    userOperationSchemaV6,
    userOperationSchemaV7,
    userOperationSchemaV8,
    userOperationSchema,
    partialUserOperationSchema,
    partialUserOperationSchemaV6,
    partialUserOperationSchemaV7,
    partialUserOperationSchemaV8,
    userOperationSchemaPaymaster,
    userOperationSchemaPaymasterV6,
    userOperationSchemaPaymasterV7,
    userOperationSchemaPaymasterV8,
    eip7677UserOperationSchema,
    eip7677UserOperationSchemaV6,
    eip7677UserOperationSchemaV7,
    eip7677UserOperationSchemaV8,
    packerUserOperationSchema,
    entryPointAwareUserOperationSchema,
    entryPointAwareEip7677UserOperationSchema,
    entryPointAwarePartialUserOperationSchema,
    type UserOperationV06,
    type UserOperationV07,
    type UserOperationV08,
    type UserOperation,
    type Eip7677UserOperation,
    type PackedUserOperation,
    isVersion06,
    isVersion07,
    isVersion08
}
