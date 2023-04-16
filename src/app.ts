import { Server } from "./api/server"

const runServer = async (): Promise<void> => {
    const server = new Server()
    await server.start()
}

runServer().catch((err) => {
    console.error(err)
    process.exit(1)
})
