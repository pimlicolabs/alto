import { ChildProcess } from "child_process"
import {
    Clients,
    createClients,
    createMetrics,
    initDebugLogger,
    launchAnvil
} from "@entrypoint-0.6/utils"
import { expect } from "earl"
import { Registry } from "prom-client"
import { parseEther } from "viem"
import { Account, generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { SenderManager } from ".."
import { generateAccounts } from "./utils"

const fn = async (time: number, label: string) => {
    await new Promise((res) => setTimeout(res, time))
    return label
}

describe("senderManager", () => {
    let accounts: Account[]
    let senderManager: SenderManager

    let anvilProcess: ChildProcess
    let clients: Clients

    beforeEach(async function () {
        anvilProcess = await launchAnvil()
        clients = await createClients()
        accounts = await generateAccounts(clients)
        const logger = initDebugLogger("silent")
        const metrics = createMetrics(new Registry(), false)
        senderManager = new SenderManager(
            accounts,
            accounts[0],
            logger,
            metrics
        )
    })

    afterEach(function () {
        anvilProcess.kill()
    })

    it("should correctly take wallet", async function () {
        const initialLength = senderManager.availableWallets.length
        const account = accounts[0]
        const wallet = await senderManager.getWallet()
        expect(wallet).toEqual(account)
        expect(senderManager.availableWallets.length).toEqual(initialLength - 1)
    })

    it("should correctly push wallet", async function () {
        const initialLength = senderManager.availableWallets.length
        const account = accounts[0]
        const wallet = await senderManager.getWallet()
        expect(wallet).toEqual(account)
        expect(senderManager.availableWallets.length).toEqual(initialLength - 1)

        senderManager.pushWallet(wallet)
        expect(senderManager.availableWallets.length).toEqual(initialLength)
        expect(
            senderManager.availableWallets[
                senderManager.availableWallets.length - 1
            ]
        ).toEqual(wallet)
    })

    it("should correctly wait when all wallets are taken", async function () {
        const initialLength = senderManager.availableWallets.length
        const wallets = await Promise.all(
            accounts.map((_) => senderManager.getWallet())
        )
        expect(initialLength - wallets.length).toEqual(0)
        expect(senderManager.availableWallets.length).toEqual(
            initialLength - wallets.length
        )

        const promise = senderManager.getWallet()
        // either resolve the promise (which should not happen) or it should keep waiting, in which case reject it and make the test succeed
        const result = await Promise.race([promise, fn(100, "timeout")])
        expect(result).toEqual("timeout")

        senderManager.pushWallet(wallets[0])
        const promiseResult = await promise
        expect(promiseResult).toEqual(wallets[0])
    })

    it("should validate and refill wallets", async function () {
        this.timeout(10000)
        const utilityAccount = privateKeyToAccount(generatePrivateKey())
        clients.test.setBalance({
            address: utilityAccount.address,
            value: parseEther("100000000")
        })
        senderManager.utilityAccount = utilityAccount

        if (clients.wallet.chain === undefined) {
            throw new Error("chain is undefined")
        }

        const initialBalances = await Promise.all(
            senderManager.availableWallets.map(async (wallet) => {
                return await clients.public.getBalance({
                    address: wallet.address
                })
            })
        )

        expect(initialBalances).toEqual(
            Array(senderManager.availableWallets.length).fill(parseEther("100"))
        )

        // @ts-ignore
        await senderManager.validateAndRefillWallets(
            clients.public,
            clients.wallet,
            parseEther("1000")
        )

        const balances = await Promise.all(
            senderManager.availableWallets.map(async (wallet) => {
                return await clients.public.getBalance({
                    address: wallet.address
                })
            })
        )

        expect(balances).toEqual(
            Array(senderManager.availableWallets.length).fill(
                parseEther("1200")
            )
        )
    })
})
