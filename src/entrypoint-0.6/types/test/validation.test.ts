import { expect } from "earl"
import { entryPointErrorsSchema } from "../src"
import "./validationTestErrors"
import {
    contractRevertErrorExample,
    vmExecutionErrorExample
} from "./validationTestErrors"

describe("validation", () => {
    // it("should parse VM Execution Error (error on Gnosis)", function () {
    //     const entryPointError = entryPointErrorsSchema.parse(JSON.parse(vmExecutionErrorExample))
    //     expect(entryPointError.errorName).toEqual("ValidationResult")
    // })
    // it("should parse normal Validation error", function () {
    //     const entryPointError = entryPointErrorsSchema.parse(JSON.parse(contractRevertErrorExample))
    //     expect(entryPointError.errorName).toEqual("ValidationResult")
    // })
})
