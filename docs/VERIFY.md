# Post-launch verification

The launcher automatically verifies the receipt before reporting success.

## Token

Confirm:

- `name()` is `PEPE`.
- `symbol()` is `PEPE`.
- `decimals()` is `18`.
- `totalSupply()` is exactly `1e27` base units.
- `creator()` is the LiquidityLauncher.
- `graffiti()` binds the original deployment wallet.
- `metadata().image` contains the configured IPFS URI.

## Pool

The receipt must include the V4 PoolManager `Initialize` event for:

```text
currency0   = address(0), native ETH
currency1   = PEPE
fee         = 2500
spacing     = 60
hooks       = address(0)
tick        = 198060
```

## LP custody

The PositionManager ERC721 `Transfer` event must send the launch position to the canonical FeeSplitter. `ownerOf(positionTokenId)` must return the FeeSplitter address.

## Fee beneficiary

The BeneficiaryVault must mint an ERC721 to the configured `FEE_BENEFICIARY`. This NFT is a fee right, not the liquidity position.

## Explorer and terminals

Explorer verification and third-party trading-terminal indexing can be delayed. A valid Uniswap V4 pool does not guarantee that every terminal supports the chain, V4, or the pool immediately.
