# Contributing

Keep changes small and auditable. Never commit `.env`, wallet keys, seed phrases, deployment-wallet backups, or authenticated RPC URLs.

Before opening a pull request:

```bash
npm install
npm run check
```

Changes to canonical addresses, ABI signatures, pool parameters, fee splits, or transaction construction must include an on-chain source reference and a successful Robinhood Chain simulation.
