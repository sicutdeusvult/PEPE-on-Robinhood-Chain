import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  isHexString,
} from "ethers";

function fail(message) {
  throw new Error(message);
}

function loadLocalEnv(filename = ".env") {
  const envPath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parsePositiveTokenId(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) fail(`${label} must be a non-negative integer token ID.`);
  return BigInt(raw);
}

function parseGasBufferPercent(value) {
  const raw = value?.trim() || "20";
  if (!/^\d+$/.test(raw)) fail("FEE_GAS_BUFFER_PERCENT must be an integer.");
  const percent = Number(raw);
  if (percent < 10 || percent > 100) {
    fail("FEE_GAS_BUFFER_PERCENT must be between 10 and 100.");
  }
  return BigInt(percent);
}

function asJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}

function findLaunchRecords() {
  const candidates = [];
  const roots = [process.cwd(), path.join(process.cwd(), "deployments")];
  for (const root of roots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const name of fs.readdirSync(root)) {
      if (!/^pepe-instant-launch-0x[0-9a-fA-F]{40}\.json$/.test(name)) continue;
      const full = path.join(root, name);
      candidates.push({ full, modified: fs.statSync(full).mtimeMs });
    }
  }
  return candidates.sort((a, b) => b.modified - a.modified);
}

function readTokenIdFromRecord(file) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Could not parse launch record ${file}: ${error.message}`);
  }
  const position = record?.launch?.positionTokenId;
  const beneficiary = record?.launch?.beneficiaryTokenId;
  if (position === undefined && beneficiary === undefined) return null;
  const positionId = position === undefined ? null : parsePositiveTokenId(position, "positionTokenId");
  const beneficiaryId = beneficiary === undefined ? null : parsePositiveTokenId(beneficiary, "beneficiaryTokenId");
  if (positionId !== null && beneficiaryId !== null && positionId !== beneficiaryId) {
    fail(`Launch record has different LP and beneficiary token IDs (${positionId} vs ${beneficiaryId}).`);
  }
  return {
    tokenId: positionId ?? beneficiaryId,
    tokenAddress: record?.token?.predictedAddress || record?.verifiedToken?.address || null,
    transactionHash: record?.receipt?.transactionHash || null,
    source: file,
  };
}

async function readTokenIdFromReceipt(provider, transactionHash, addresses, abis) {
  if (!isHexString(transactionHash, 32)) fail("LAUNCH_TX_HASH must be a 32-byte transaction hash.");
  const receipt = await provider.getTransactionReceipt(transactionHash);
  if (!receipt) fail(`No receipt found for LAUNCH_TX_HASH ${transactionHash}.`);
  if (receipt.status !== 1) fail(`LAUNCH_TX_HASH ${transactionHash} did not succeed.`);

  const erc721 = new Interface(abis.erc721);
  let positionTokenId = null;
  let beneficiaryTokenId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = erc721.parseLog(log);
      if (!parsed || parsed.name !== "Transfer") continue;
      if (
        log.address.toLowerCase() === addresses.positionManager.toLowerCase() &&
        parsed.args.to.toLowerCase() === addresses.feeSplitter.toLowerCase()
      ) {
        positionTokenId = BigInt(parsed.args.tokenId);
      }
      if (
        log.address.toLowerCase() === addresses.beneficiaryVault.toLowerCase() &&
        parsed.args.from === ZeroAddress
      ) {
        beneficiaryTokenId = BigInt(parsed.args.tokenId);
      }
    } catch {}
  }
  if (positionTokenId === null && beneficiaryTokenId === null) {
    fail("The launch receipt did not contain an LP or beneficiary NFT transfer.");
  }
  if (
    positionTokenId !== null &&
    beneficiaryTokenId !== null &&
    positionTokenId !== beneficiaryTokenId
  ) {
    fail(`Launch receipt has different LP and beneficiary token IDs (${positionTokenId} vs ${beneficiaryTokenId}).`);
  }
  return {
    tokenId: positionTokenId ?? beneficiaryTokenId,
    tokenAddress: null,
    transactionHash,
    source: "LAUNCH_TX_HASH",
  };
}

async function resolveLaunch(provider, addresses, abis) {
  const explicit = process.env.POSITION_TOKEN_ID?.trim() || process.env.BENEFICIARY_TOKEN_ID?.trim();
  if (explicit) {
    return {
      tokenId: parsePositiveTokenId(explicit, "POSITION_TOKEN_ID"),
      tokenAddress: process.env.TOKEN_ADDRESS?.trim() || null,
      transactionHash: process.env.LAUNCH_TX_HASH?.trim() || null,
      source: "environment",
    };
  }

  for (const candidate of findLaunchRecords()) {
    const launch = readTokenIdFromRecord(candidate.full);
    if (launch) return launch;
  }

  const hash = process.env.LAUNCH_TX_HASH?.trim();
  if (hash) return readTokenIdFromReceipt(provider, hash, addresses, abis);

  fail(
    "No completed launch record was found. This command cannot use a simulation JSON. " +
      "After a successful launch, keep pepe-instant-launch-0x....json in this folder, " +
      "or set POSITION_TOKEN_ID=<the locked LP token ID>, or set LAUNCH_TX_HASH=<successful launch tx> in .env.",
  );
}

async function askConfirmation(phrase, message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message}\nType ${phrase} to continue: `);
  rl.close();
  if (answer.trim() !== phrase) {
    console.log("Cancelled. No transaction sent.");
    process.exit(0);
  }
}

function requireFeeTransactionOptIn() {
  if (process.env.ALLOW_FEE_TRANSACTIONS?.trim().toUpperCase() !== "YES") {
    fail("Set ALLOW_FEE_TRANSACTIONS=YES in your local .env before collect or claim transactions.");
  }
}

async function sendGuarded(contractMethod, args, wallet, provider, gasBufferPercent) {
  await contractMethod.staticCall(...args);
  const estimatedGas = await contractMethod.estimateGas(...args);
  const gasLimit = (estimatedGas * (100n + gasBufferPercent)) / 100n;
  const feeData = await provider.getFeeData();
  const feeCap = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (feeCap !== null) {
    const required = gasLimit * feeCap;
    const balance = await provider.getBalance(await wallet.getAddress());
    if (balance < required) {
      fail(`Insufficient ETH for gas. Balance ${balance} wei; buffered maximum estimate ${required} wei.`);
    }
  }
  const tx = await contractMethod(...args, { gasLimit });
  console.log(`Transaction:           ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) fail("Transaction failed.");
  return receipt;
}

loadLocalEnv();

const command = process.argv[2] || "status";
if (!["status", "collect", "claim", "collect-and-claim"].includes(command)) {
  fail("Usage: node fees-pepe.mjs status|collect|claim|collect-and-claim");
}

const RPC_URL = process.env.RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = BigInt(process.env.CHAIN_ID?.trim() || "4663");
const GAS_BUFFER_PERCENT = parseGasBufferPercent(process.env.FEE_GAS_BUFFER_PERCENT);

const ADDRESSES = Object.freeze({
  feeSplitter: getAddress("0x7198C32a497c09497e04C86cf8F77A244A9E4b8F"),
  beneficiaryVault: getAddress("0x587D2fDDDF14F6f84022b51e8c3a473eB88C4544"),
  compoundingClaimRecipient: getAddress("0x666DA63451A502A323677C2Ef5F763181358be9b"),
  positionManager: getAddress("0x58daec3116aae6D93017bAAea7749052E8a04fA7"),
});

const ABIS = Object.freeze({
  feeSplitter: [
    "function collectFees(uint256[] tokenIds)",
    "function getSplits() view returns ((address recipient,uint16 nativeBps,uint16 tokenBps,bool useCallback)[])",
    "event FeesCollected(uint256 indexed tokenId,address indexed token,uint256 nativeAmount,uint256 tokenAmount)",
    "event FeesForwarded(address indexed recipient,address indexed currency,uint256 amount)",
  ],
  beneficiaryVault: [
    "function ownerOf(uint256 id) view returns (address)",
    "function amounts(uint256 tokenId) view returns (uint128 currency0Amount,uint128 currency1Amount)",
    "function claim(uint256 tokenId,uint256 minCurrency0Amount,uint256 minCurrency1Amount)",
    "event Claimed(uint256 indexed tokenId,uint256 currency0Amount,uint256 currency1Amount,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey)",
  ],
  compounding: [
    "function amounts(uint256 tokenId) view returns (uint128 currency0Amount,uint128 currency1Amount)",
  ],
  erc721: [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  ],
});

const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: true });
const network = await provider.getNetwork();
if (network.chainId !== CHAIN_ID) {
  fail(`Wrong network: connected to chain ${network.chainId}, expected ${CHAIN_ID}.`);
}
for (const [label, address] of Object.entries(ADDRESSES)) {
  if ((await provider.getCode(address)) === "0x") fail(`No contract code at ${label}: ${address}`);
}

const launch = await resolveLaunch(provider, ADDRESSES, ABIS);
const tokenId = launch.tokenId;
const beneficiaryRead = new Contract(ADDRESSES.beneficiaryVault, ABIS.beneficiaryVault, provider);
const compoundingRead = new Contract(ADDRESSES.compoundingClaimRecipient, ABIS.compounding, provider);
const feeSplitterRead = new Contract(ADDRESSES.feeSplitter, ABIS.feeSplitter, provider);
const positionManager = new Contract(ADDRESSES.positionManager, ABIS.erc721, provider);

async function readStatus() {
  const [owner, claimable, compounding, positionOwner, splits] = await Promise.all([
    beneficiaryRead.ownerOf(tokenId),
    beneficiaryRead.amounts(tokenId),
    compoundingRead.amounts(tokenId),
    positionManager.ownerOf(tokenId),
    feeSplitterRead.getSplits(),
  ]);
  if (getAddress(positionOwner) !== ADDRESSES.feeSplitter) {
    fail(`LP NFT ${tokenId} is not owned by the canonical FeeSplitter. Current owner: ${positionOwner}`);
  }
  const normalizedSplits = splits.map((split) => ({
    recipient: getAddress(split.recipient),
    nativeBps: Number(split.nativeBps),
    tokenBps: Number(split.tokenBps),
    useCallback: Boolean(split.useCallback),
  }));
  return {
    chainId: CHAIN_ID,
    tokenId,
    tokenAddress: launch.tokenAddress,
    launchTransactionHash: launch.transactionHash,
    tokenIdSource: launch.source,
    beneficiaryOwner: getAddress(owner),
    lpOwner: getAddress(positionOwner),
    claimable: {
      nativeWei: BigInt(claimable.currency0Amount),
      nativeEth: formatEther(claimable.currency0Amount),
      tokenRaw: BigInt(claimable.currency1Amount),
      tokenWhole: formatUnits(claimable.currency1Amount, 18),
    },
    pendingForCompounding: {
      nativeWei: BigInt(compounding.currency0Amount),
      nativeEth: formatEther(compounding.currency0Amount),
      tokenRaw: BigInt(compounding.currency1Amount),
      tokenWhole: formatUnits(compounding.currency1Amount, 18),
    },
    splits: normalizedSplits,
  };
}

function printStatus(status) {
  console.log("\n=== PEPE creator fee status ===");
  console.log(`Chain:                ${network.name} (${network.chainId})`);
  console.log(`Position/NFT ID:      ${status.tokenId}`);
  if (status.tokenAddress && isAddress(status.tokenAddress)) {
    console.log(`PEPE token:           ${getAddress(status.tokenAddress)}`);
  }
  console.log(`Beneficiary owner:    ${status.beneficiaryOwner}`);
  console.log(`LP owner:             ${status.lpOwner}`);
  console.log(`Claimable ETH:        ${status.claimable.nativeEth} ETH`);
  console.log(`Claimable PEPE:       ${status.claimable.tokenWhole} PEPE`);
  console.log(`Pending compound ETH: ${status.pendingForCompounding.nativeEth} ETH`);
  console.log(`Pending compound PEPE:${status.pendingForCompounding.tokenWhole} PEPE`);
  console.log("\nNote: claimable values include only fees already harvested by FeeSplitter.collectFees().");
  console.log("Run npm run collect to harvest newly accrued LP fees, then npm run fees again.");
}

let status = await readStatus();
printStatus(status);

if (command === "status") {
  const filename = `pepe-fees-${tokenId}.json`;
  fs.writeFileSync(filename, JSON.stringify(asJson(status), null, 2));
  console.log(`\nSaved ${filename}`);
  process.exit(0);
}

requireFeeTransactionOptIn();
const privateKey = process.env.PRIVATE_KEY?.trim();
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  fail("collect and claim require PRIVATE_KEY=0x... in the local, git-ignored .env file.");
}
const wallet = new Wallet(privateKey, provider);
const walletAddress = getAddress(await wallet.getAddress());
const feeSplitterWrite = new Contract(ADDRESSES.feeSplitter, ABIS.feeSplitter, wallet);
const beneficiaryWrite = new Contract(ADDRESSES.beneficiaryVault, ABIS.beneficiaryVault, wallet);

async function collect() {
  await askConfirmation(
    "COLLECT PEPE FEES",
    `This sends a gas-paying collectFees transaction from ${walletAddress}. Collection is permissionless and does not pay the wallet directly.`,
  );
  const before = await beneficiaryRead.amounts(tokenId);
  const receipt = await sendGuarded(
    feeSplitterWrite.collectFees,
    [[tokenId]],
    wallet,
    provider,
    GAS_BUFFER_PERCENT,
  );
  const after = await beneficiaryRead.amounts(tokenId);
  console.log("\n[OK] LP fees harvested and split.");
  console.log(`Gas used:              ${receipt.gasUsed}`);
  console.log(`New creator ETH:       ${formatEther(BigInt(after.currency0Amount) - BigInt(before.currency0Amount))} ETH`);
  console.log(`New creator PEPE:      ${formatUnits(BigInt(after.currency1Amount) - BigInt(before.currency1Amount), 18)} PEPE`);
}

async function claim() {
  status = await readStatus();
  if (status.beneficiaryOwner !== walletAddress) {
    fail(
      `The connected wallet is not the beneficiary NFT owner. Owner: ${status.beneficiaryOwner}; wallet: ${walletAddress}`,
    );
  }
  const minNative = status.claimable.nativeWei;
  const minToken = status.claimable.tokenRaw;
  if (minNative === 0n && minToken === 0n) {
    fail("Nothing is currently claimable. Run npm run collect first, then npm run fees.");
  }
  await askConfirmation(
    "CLAIM PEPE FEES",
    `This claims at least ${formatEther(minNative)} ETH and ${formatUnits(minToken, 18)} PEPE for beneficiary NFT ${tokenId}.`,
  );
  const receipt = await sendGuarded(
    beneficiaryWrite.claim,
    [tokenId, minNative, minToken],
    wallet,
    provider,
    GAS_BUFFER_PERCENT,
  );
  console.log("\n[OK] Creator fees claimed.");
  console.log(`Recipient:             ${walletAddress}`);
  console.log(`Minimum ETH claimed:   ${formatEther(minNative)} ETH`);
  console.log(`Minimum PEPE claimed:  ${formatUnits(minToken, 18)} PEPE`);
  console.log(`Gas used:              ${receipt.gasUsed}`);
}

if (command === "collect") {
  await collect();
} else if (command === "claim") {
  await claim();
} else {
  await collect();
  status = await readStatus();
  printStatus(status);
  await claim();
}
