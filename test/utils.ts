import { exec, type ChildProcess } from "child_process"
import { createPublicClient, http } from "viem"
import { foundry } from "viem/chains"

export const launchAnvil = async (): Promise<ChildProcess> => {
    const anvilProcess = exec(`anvil`)

    const client = createPublicClient({
        chain: foundry,
        transport: http()
    })

    // keep calling getNetwork every 2ms until it doesn't throw
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await client.getChainId()
            break
        } catch (e) {
            await new Promise((resolve) => setTimeout(resolve, 2))
        }
    }

    return anvilProcess
}
