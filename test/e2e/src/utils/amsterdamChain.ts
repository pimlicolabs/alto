import { anvil } from "prool/instances"
import { foundry } from "viem/chains"
import { setupContracts } from "../../deploy-contracts/index.js"

// Starts an extra anvil on the Amsterdam (Glamsterdam) hardfork with the
// ERC-4337 contracts deployed. Needs a Foundry nightly with Amsterdam gas
// rules (EIP-2780, EIP-7976, EIP-8037).
//
// Upstream anvil lifts the EIP-7825 cap, so its calls and transactions get no
// EIP-8037 state gas reservoir. ANVIL_BINARY_PATH can point at an anvil
// built from pimlicolabs/foundry's anvil-eip8037-reservoir branch, which keeps
// the cap.
export const startAmsterdamChain = async ({
    port
}: {
    port: number
}): Promise<{ anvilRpc: string; stop: () => Promise<void> }> => {
    const instance = anvil({
        binary: process.env.ANVIL_BINARY_PATH || undefined,
        chainId: foundry.id,
        port,
        hardfork: "Amsterdam",
        codeSizeLimit: 1000_000,
        gasLimit: 1_000_000_000
    })
    await instance.start()

    const anvilRpc = `http://${instance.host}:${instance.port}`
    await setupContracts({ anvilRpc, gas: 200_000_000n })

    return { anvilRpc, stop: () => instance.stop() }
}
