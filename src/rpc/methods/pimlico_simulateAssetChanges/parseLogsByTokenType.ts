import { Address } from "viem"
import { LogType, TokenInfo } from "./types"
import { TokenIsEthError } from "viem/_types/zksync/errors/token-is-eth"

export function parseLogsByTokenType(
    address: Address,
    logs: LogType[],
    tokenInfo: TokenInfo,
    userOpSender: Address
) {}
