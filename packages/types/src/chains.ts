/**
 * @public
 */
export enum ChainId {
    ScrollTestnet = 534353,
    Mainnet = 1,
    Goerli = 5,
    Polygon = 137,
    Mumbai = 80001,
    Optimism = 10,
    OptimismGoerli = 420,
    Arbitrum = 42161,
    ArbitrumGoerli = 421613

}
/**
 * @public
 */
export type SUPPORTED_CHAIN_ID =
    | ChainId.Mainnet
    | ChainId.Goerli
    | ChainId.Mumbai
    | ChainId.Polygon
    | ChainId.Optimism
    | ChainId.OptimismGoerli
    | ChainId.Arbitrum
    | ChainId.ArbitrumGoerli

/**
 * @public
 */
export const SUPPORTED_CHAIN_IDS: SUPPORTED_CHAIN_ID[] = [
    ChainId.Mainnet,
    ChainId.Goerli,
    ChainId.Polygon,
    ChainId.Mumbai,
    ChainId.Optimism,
    ChainId.OptimismGoerli,
    ChainId.Arbitrum,
    ChainId.ArbitrumGoerli,

];


