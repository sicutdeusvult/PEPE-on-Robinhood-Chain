# Security policy

## Never disclose wallet secrets

This repository never needs a seed phrase. For a live launch, it accepts a single private key from a local, git-ignored `.env` file or the process environment. Never place a key in `.env.example`, source code, an issue, a pull request, a screenshot, or a deployment JSON file.

Use a fresh deployment wallet with only enough native ETH for gas. After launch, rotate away from that key or empty the wallet.

## Before broadcast

Run `npm ci`, `npm run check`, `npm run inspect`, and `npm run simulate`. Confirm chain ID `4663`, the predicted token address, the fee beneficiary, and the canonical contract checks. The broadcast command requires both `ALLOW_MAINNET_BROADCAST=YES` and the interactive phrase `DEPLOY PEPE`.

## Reporting

Do not publish active exploits or private keys in a public issue. Use GitHub private vulnerability reporting when enabled, or contact the repository owner privately.

## Scope

The script verifies the configured canonical contracts and simulates the full call at the current chain state. It cannot guarantee third-party indexing, market demand, token price, or future behavior of external contracts and RPC providers.
