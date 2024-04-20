//import { createPimlicoBundlerClient } from "permissionless/clients/pimlico"
//import {
//    http,
//    createPublicClient,
//    createTestClient,
//    parseEther,
//    parseGwei
//} from "viem"
//import { foundry } from "viem/chains"
//import {
//    simpleAccountDeployedBytecode,
//} from "./data"
//import {
//    altoEndpoint,
//    anvilEndpoint,
//    compressAndSendOp,
//    newRandomAddress,
//    sendBundleNow,
//    setBundlingMode,
//    setupSimpleSmartAccountClient
//} from "./utils"
//
//const pimlicoClient = createPimlicoBundlerClient({
//    transport: http(altoEndpoint)
//})
//const publicClient = createPublicClient({
//    transport: http(anvilEndpoint),
//    chain: foundry
//})
//const anvilClient = createTestClient({
//    chain: foundry,
//    mode: "anvil",
//    transport: http(anvilEndpoint)
//})
//
test("eth_sendUserOperation can submit a userOperation", async () => {
    //const smartAccount = await setupSimpleSmartAccountClient(
    //    pimlicoClient,
    //    publicClient
    //)

    //const target = newRandomAddress()
    //const amt = parseEther("0.1337")

    //smartAccount.prepareUserOperationRequest

    //await smartAccount.sendTransaction({
    //    to: target,
    //    value: amt
    //})

    //expect(await publicClient.getBalance({ address: target })).toEqual(amt)
    //expect(
    //    await publicClient.getBytecode({
    //        address: smartAccount.account.address
    //    })
    //).toEqual(simpleAccountDeployedBytecode)
})
