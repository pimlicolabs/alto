import { z } from "zod"

/**
 * Custom Zod error map that provides detailed, user-friendly error messages
 * for validation failures in RPC requests.
 * 
 * Handles special cases for entryPoint, userOperation, and other common parameters
 * to give context-specific error messages that help users understand what went wrong.
 */
export const customErrorMap: z.ZodErrorMap = (issue, ctx) => {
    // Get description of the field if available
    const describedType = (ctx.data as any)?._zod_schema?._description;
    
    // Handle entryPoint validation errors (either from path or description)
    if (describedType === "entryPoint" || issue.path.includes("entryPoint")) {
        if (issue.code === z.ZodIssueCode.invalid_type) {
            return { 
                message: "Missing entryPoint: You must provide a valid entryPoint address as the second parameter" 
            }
        }
        if (issue.code === z.ZodIssueCode.invalid_string) {
            return { 
                message: "Invalid entryPoint: The entryPoint address must be a valid Ethereum address (0x...)" 
            }
        }
    }
    
    // Handle account validation for debug_bundler_getStakeStatus
    if (describedType === "account") {
        if (issue.code === z.ZodIssueCode.invalid_type) {
            return { 
                message: "Missing account address: You must provide a valid account address as the first parameter" 
            }
        }
        if (issue.code === z.ZodIssueCode.invalid_string) {
            return { 
                message: "Invalid account address: The account must be a valid Ethereum address (0x...)" 
            }
        }
    }
    
    // Handle UserOperation validation errors with clearer messages
    if (issue.path.includes("userOperation") || issue.path.includes("sender")) {
        if (issue.code === z.ZodIssueCode.invalid_type && issue.expected === "object") {
            return { 
                message: "Missing or invalid userOperation: You must provide a valid UserOperation object as the first parameter" 
            }
        }
    }
    
    if (issue.path.includes("userOpHash")) {
        return { 
            message: "Missing/invalid userOpHash: You must provide a valid 32-byte hex string (0x...) as the parameter" 
        }
    }
    
    // Handle generic field errors with more context
    if (issue.code === z.ZodIssueCode.invalid_type) {
        const path = issue.path.join(".");
        if (issue.received === "undefined") {
            return {
                message: `Missing required field: '${path}' is required but was not provided`
            }
        }
        return {
            message: `Invalid type for field '${path}': expected ${issue.expected} but received ${issue.received}`
        }
    }
    
    // Fall back to default error map for other cases
    return { message: ctx.defaultError }
}

// Export function to initialize the error map
export function initializeZodErrorMap(): void {
    z.setErrorMap(customErrorMap)
}
