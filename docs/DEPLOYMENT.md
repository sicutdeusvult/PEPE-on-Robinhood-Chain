# Deployment guide

## 1. Prepare a wallet

Use a fresh wallet holding only enough native ETH for gas. Never use a treasury wallet or a wallet that stores unrelated assets. Do not share its private key or seed phrase.

## 2. Install and validate

```powershell
npm install
npm run check
Copy-Item .env.example .env
```

For a read-only inspection, set `DEPLOYER_ADDRESS` to the wallet that would launch the token. A private key is not required.

## 3. Inspect

```powershell
npm run inspect
```

Confirm:

- Chain ID is `4663`.
- All canonical addresses have bytecode.
- The strategy points to the expected launcher, FeeSplitter, and BeneficiaryVault.
- The immutable initial tick is `198060`.
- The predicted PEPE address is unoccupied.

## 4. Simulate

Set the private key only in the local `.env` if you also want the script to verify wallet balance. Then run:

```powershell
npm run simulate
```

Simulation performs `eth_call` and `eth_estimateGas`. It sends no transaction. Review the JSON record generated in the project root.

A blank `DISTRIBUTION_SALT` creates a random bytes32 per run. The Instant Launch strategy ignores this salt for its pool configuration, so a new salt does not change the deterministic PEPE address or pool parameters.

## 5. Enable broadcast

Immediately before launch:

```env
PRIVATE_KEY=0x...
ALLOW_MAINNET_BROADCAST=YES
```

The script refuses to broadcast if `.env` is tracked by git, if `.env.example` contains a private key, if the wallet lacks the buffered gas estimate, or if the predicted token address already has code.

## 6. Launch

```powershell
npm run launch
```

After the initial simulation, type `DEPLOY PEPE`. The script then re-checks the network, address collision, and full transaction simulation before sending.

## 7. Secure the wallet

After confirmation, remove the private key from `.env` and empty or retire the deployment wallet. The fee-beneficiary NFT is held by `FEE_BENEFICIARY`; if blank, that is the deployment wallet, so preserve access to that address securely.
