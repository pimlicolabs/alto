import { defineConfig } from "vitest/config"
import { join } from "node:path"
import { config } from "dotenv"

export default defineConfig({
    test: {
        coverage: {
            all: false,
            provider: "v8",
            reporter: process.env.CI ? ["lcov"] : ["text", "json", "html"],
            exclude: [
                "**/errors/utils.ts",
                "**/_cjs/**",
                "**/_esm/**",
                "**/_types/**"
            ]
        },
        env: {
            ...config({ path: join(__dirname, "../.env") }).parsed
        },
        sequence: {
            concurrent: false
        },
        fileParallelism: false,
        globalSetup: join(__dirname, "./setup.ts"),
        environment: "node",
        testTimeout: 60_000,
        hookTimeout: 45_000,
        include: ["**/eth_estimateUserOperationGas.test.ts"],
        // Only run the revert reason test
        testNamePattern: "Should throw revert reason if simulation reverted during callphase"
        // setupFiles: [join(__dirname, "./setup.ts")],
        // globalSetup: [join(__dirname, "./globalSetup.ts")]
    }
})
