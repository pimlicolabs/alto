import { join } from "node:path"
import { config } from "dotenv"
import { defineConfig } from "vitest/config"

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
        hookTimeout: 45_000
        // setupFiles: [join(__dirname, "./setup.ts")],
        // globalSetup: [join(__dirname, "./globalSetup.ts")]
    }
})
