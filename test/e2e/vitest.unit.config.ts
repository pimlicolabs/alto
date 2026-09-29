import { defineConfig } from "vitest/config"

// Unit tests for pure logic. Unlike vitest.config.ts these do not use the
// globalSetup that spins up the full bundler/anvil stack, so they run without
// Docker or a blockchain.
export default defineConfig({
    test: {
        include: ["tests/unit/**/*.test.ts"],
        environment: "node"
    }
})
