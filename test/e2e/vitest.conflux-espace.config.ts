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
            ...config({
                path: join(__dirname, ".env.conflux-espace-testnet")
            }).parsed
        },
        sequence: {
            concurrent: false
        },
        fileParallelism: false,
        globalSetup: join(__dirname, "./conflux-espace.setup.ts"),
        include: ["tests/conflux-espace-testnet.simple-account.test.ts"],
        environment: "node",
        testTimeout: 300_000,
        hookTimeout: 180_000
    }
})
