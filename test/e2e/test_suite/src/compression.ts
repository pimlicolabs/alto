import { setupEnvironment } from "./setup";
import { anvilDumpState, anvilLoadState } from "./utils";

// Holds the checkpoint after all contracts have been deployed.
//let anvilCheckpoint: string | null = null

// This function will deploy all contracts (called once before all tests).
//beforeAll(async () => {
//    await setupEnvironment()
//});

// This function will revert all contracts to the state before the tests were run (called once before all tests).
//beforeEach(async () => {
//    if (!anvilCheckpoint) {
//        anvilCheckpoint = await anvilDumpState()
//    } else {
//        await anvilLoadState(anvilCheckpoint)
//    }
//})

//afterEach(() => {
//
//})

//test("pimlico_sendCompressedUserOperation", async () => {
//
//})
