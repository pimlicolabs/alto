import { Hex } from "viem";
import bundleBulkerJson from "./BundleBulker.json";
import entryPointJson from "./EntryPoint.json";
import perOpInflatorJson from "./PerOpInflator.json";
import simpleAccountFactoryJson from "./SimpleAccountFactory.json";
import simpleInflatorJson from "./SimpleInflator.json";
import simpleAccountJson from "./SimpleAccount.json";
import multicall3Json from "./Multicall3.json";

export const bundleBulkerAbi = bundleBulkerJson.abi
export const bundleBulkerCreateBytecode: Hex = bundleBulkerJson.bytecode.object as Hex
export const bundleBulkerDeployedBytecode: Hex = bundleBulkerJson.deployedBytecode.object as Hex

export const entryPointAbi = entryPointJson.abi
export const entryPointCreateBytecode: Hex = entryPointJson.bytecode.object as Hex
export const entryPointDeployedBytecode: Hex = entryPointJson.deployedBytecode.object as Hex

export const simpleInflatorAbi = simpleInflatorJson.abi
export const simpleInflatorCreateBytecode: Hex = simpleInflatorJson.bytecode.object as Hex
export const simpleInflatorDeployedBytecode: Hex = simpleInflatorJson.deployedBytecode.object as Hex

export const perOpInflatorAbi = perOpInflatorJson.abi
export const perOpInflatorCreateBytecode: Hex = perOpInflatorJson.bytecode.object as Hex
export const perOpInflatorDeployedBytecode: Hex = perOpInflatorJson.deployedBytecode.object as Hex

export const simpleAccountFactoryAbi = simpleAccountFactoryJson.abi
export const simpleAccountFactoryCreateBytecode: Hex = simpleAccountFactoryJson.bytecode.object as Hex
export const simpleAccountFactoryDeployedBytecode: Hex = simpleAccountFactoryJson.deployedBytecode.object as Hex

export const simpleAccountAbi = simpleAccountJson.abi
export const simpleAccountCreateBytecode: Hex = simpleAccountJson.bytecode.object as Hex
export const simpleAccountDeployedBytecode: Hex = simpleAccountJson.deployedBytecode.object as Hex

export const multicall3Abi = multicall3Json.abi
export const multicall3CreateBytecode: Hex = multicall3Json.bytecode.object as Hex
export const multicall3DeployedBytecode: Hex = multicall3Json.deployedBytecode.object as Hex
