# FRONG launch reconstruction

This package was built from the supplied trace of transaction:

`0xbe6b90c58c017b4754a6a6ee6d65be9a682d2b79de0142954ae345f1dce8f35c`

Token:

`0x6245e67affA44a23077f0Ea7f981a8DC743a0c47`

## What the trace proves

FRONG did **not** launch through an auction. It used the canonical Uniswap **Instant Launch** flow on Robinhood Chain:

1. The wallet called `LiquidityLauncher.multicall(bytes[])`.
2. Inner call 1 called `LiquidityLauncher.createToken(...)`.
3. The canonical UERC20 factory created FRONG with 18 decimals and a fixed 1 billion supply.
4. The supply was minted directly to the LiquidityLauncher.
5. Inner call 2 called `LiquidityLauncher.distributeToken(...)` using the fees-on InstantLaunchStrategy.
6. The strategy pulled the complete 1 billion supply.
7. It initialized a hookless native ETH/FRONG Uniswap V4 pool.
8. It deposited effectively the complete supply into a single-sided V4 position.
9. A 235-wei token rounding remainder was sent to the dead address.
10. The LP position NFT was transferred to the canonical FeeSplitter.
11. The BeneficiaryVault minted a transferable beneficiary NFT to the configured fee beneficiary.

## Exact observed FRONG values

| Field | Value |
|---|---|
| LiquidityLauncher | `0x00004c4ccc709Ef590F7C81102C0689F0263D4e9` |
| UERC20Factory | `0x000000e200088D55C39a11F609E5F667729ad49b` |
| Fees-on InstantLaunchStrategy | `0x60D73b21cDf2EA846ab3d58699BBbb8F29d72491` |
| FeeSplitter | `0x7198C32a497c09497e04C86cf8F77A244A9E4b8F` |
| BeneficiaryVault | `0x587D2fDDDF14F6f84022b51e8c3a473eB88C4544` |
| PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| PositionManager | `0x58daec3116aae6D93017bAAea7749052E8a04fA7` |
| Pair | Native ETH / FRONG |
| V4 pool fee | 2500 pips = 0.25% |
| Tick spacing | 60 |
| Hook | Zero address |
| Initial tick | 198,060 |
| Position lower tick | -208,980 |
| Position upper tick | 198,060 |
| Total supply | 1,000,000,000 FRONG |
| ETH supplied at creation | 0 |
| Position NFT ID | 409801 |
| Position owner after launch | FeeSplitter |
| Fee-beneficiary NFT owner | `0x1db6aD3344F1Ae0A495b28B031B80cDDd99f2FD0` |

The pool starts with token-side liquidity only. Buyers bring native ETH and receive tokens from the position. This is why the creator did not need to contribute ETH liquidity.

## Fee behavior

The official Instant Launch deployment registry describes the fees-on variant as:

- 40% of collected native ETH-side LP fees attributed to the beneficiary vault.
- 0% of collected launched-token-side LP fees attributed to the creator.
- The remaining fees flow through the compounding recipient and increase the same LP position.

The beneficiary right is represented by the BeneficiaryVault ERC721. The underlying LP NFT remains in the FeeSplitter and is not transferred to the token creator.
