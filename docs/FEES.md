# Creator fee operations

The Instant Launch FeeSplitter permanently owns the Uniswap V4 LP NFT. The beneficiary vault owns the creator-fee accounting for the same token ID.

## Commands

```powershell
npm run fees
```

Reads the current beneficiary NFT owner, verifies permanent LP custody, and shows fees already credited to the BeneficiaryVault. It does not send a transaction.

```powershell
npm run collect
```

Calls `FeeSplitter.collectFees([tokenId])`. This is permissionless and costs gas. It harvests accrued V4 LP fees, routes the creator allocation into BeneficiaryVault, and routes the remaining allocation to the configured compounding recipient. It does not send the creator share directly to the wallet.

```powershell
npm run claim
```

Calls `BeneficiaryVault.claim(tokenId, minNative, minToken)` using the amounts read immediately before submission. The command refuses to send unless the connected wallet currently owns the beneficiary NFT.

```powershell
npm run collect-and-claim
```

Sends a collect transaction, waits for confirmation, reads the newly claimable amounts, and then sends a separate claim transaction. Two confirmations and two gas payments are required.

## Configuration

After a successful launch, `launch-pepe.mjs` saves a local file named:

```text
pepe-instant-launch-0xTOKEN.json
```

The fee tool finds the newest completed launch record automatically. Simulation JSON files are ignored.

When the record is unavailable, set one of these in the local `.env`:

```env
POSITION_TOKEN_ID=123
```

or:

```env
LAUNCH_TX_HASH=0xSuccessfulLaunchTransactionHash
```

Before sending collect or claim transactions, set:

```env
ALLOW_FEE_TRANSACTIONS=YES
PRIVATE_KEY=0xYourPrivateKey
```

Never commit `.env`. Return `ALLOW_FEE_TRANSACTIONS=` to blank after use.

## Important distinction

`npm run fees` shows amounts already credited to BeneficiaryVault. Newly accrued fees still inside the LP position are not included until `collectFees` executes. Anyone may pay gas to call collect. Only the current beneficiary NFT owner should use this repository's claim command.
