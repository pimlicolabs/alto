import { Address, EntryPointAbi, HexData } from "@alto/types";
import { Clients, parseSenderAddressError } from "@alto/utils";
import {getContract} from "viem"

export async function getSender(entryPoint: Address, initCode: HexData, clients: Clients): Promise<Address> {
    const entryPointContract = getContract({
      address: entryPoint,
      abi: EntryPointAbi,
      publicClient: clients.public,
      walletClient: clients.wallet,
    });
  
    const sender = await entryPointContract.simulate
      .getSenderAddress([initCode])
      .then((_) => {
        throw new Error("Expected error");
      })
      .catch((e: Error) => {
        return parseSenderAddressError(e);
      });
  
    return sender;
}