import { ChildProcess } from "child_process"
import { Clients, createClients, initDebugLogger, launchAnvil } from "@alto/utils"
import { generateAccounts } from "./utils"
import { Account, generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { parseEther } from "viem"
import { SenderManager } from "../src"
import { expect } from "earl"

const fn = async (time: number, label: string) => {
	await new Promise((res) => setTimeout(res, time));
	return label;
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
        senderManager = new SenderManager(accounts, logger)
    })

    afterEach(function () {
        anvilProcess.kill()
    })

    it("should correctly take wallet", async function () {
        const initialLength = senderManager.wallets.length
        const account = accounts[0]
        const wallet = await senderManager.getWallet()
        expect(wallet).toEqual(account)
        expect(senderManager.wallets.length).toEqual(initialLength - 1)
    })

    it("should correctly push wallet", async function () {
        const initialLength = senderManager.wallets.length
        const account = accounts[0]
        const wallet = await senderManager.getWallet()
        expect(wallet).toEqual(account)
        expect(senderManager.wallets.length).toEqual(initialLength - 1)

        await senderManager.pushWallet(wallet)
        expect(senderManager.wallets.length).toEqual(initialLength)
        expect(senderManager.wallets[senderManager.wallets.length - 1]).toEqual(wallet)
    })

    it("should correctly wait when all wallets are taken", async function () {
        const initialLength = senderManager.wallets.length
        const wallets = await Promise.all(accounts.map((_) => senderManager.getWallet()))
        expect(initialLength - wallets.length).toEqual(0)
        expect(senderManager.wallets.length).toEqual(initialLength - wallets.length)

        const promise = senderManager.getWallet()
        // either resolve the promise (which should not happen) or it should keep waiting, in which case reject it and make the test succeed
        const result = await Promise.race([promise, fn(100, "timeout")])
        expect(result).toEqual("timeout")
        
        await senderManager.pushWallet(wallets[0])
        const promiseResult = await promise 
        expect(promiseResult).toEqual(wallets[0])
    })

    it("should validate and refill wallets", async function () {
        this.timeout(5000)
        const utilityAccount = privateKeyToAccount(generatePrivateKey());
        clients.test.setBalance({address: utilityAccount.address, value: parseEther("100000000")})

        if(clients.wallet.chain === undefined) {
            throw new Error("chain is undefined")
        } 

        const initialBalances = await Promise.all(senderManager.wallets.map(async (wallet) => {
            return await clients.public.getBalance({address: wallet.address})
        }))

        expect(initialBalances).toEqual(Array(senderManager.wallets.length).fill(parseEther("100")))

        // @ts-ignore
        await senderManager.validateAndRefillWallets(clients.public, clients.wallet, parseEther("1000"), utilityAccount)

        const balances = await Promise.all(senderManager.wallets.map(async (wallet) => {
            return await clients.public.getBalance({address: wallet.address})
        }))

        expect(balances).toEqual(Array(senderManager.wallets.length).fill(parseEther("1000")))
    })
})