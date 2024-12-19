import { Account } from "viem"
import { SignedAuthorizationList } from "viem/experimental"

export type SendTransactionOptions =
    | {
          type: "legacy"
          gasPrice: bigint
          account: Account
          gas: bigint
          nonce: number
      }
    | {
          type: "eip1559"
          maxFeePerGas: bigint
          maxPriorityFeePerGas: bigint
          account: Account
          gas: bigint
          nonce: number
      }
    | {
          type: "eip7702"
          maxFeePerGas: bigint
          maxPriorityFeePerGas: bigint
          account: Account
          gas: bigint
          nonce: number
          authorizationList: SignedAuthorizationList
      }
