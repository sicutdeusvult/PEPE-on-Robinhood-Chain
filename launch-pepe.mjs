import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
import readline from "node:readline/promises";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  ZeroAddress,
  getAddress,
  hexlify,
  isAddress,
  isHexString,
  keccak256,
  randomBytes,
  toUtf8Bytes,
} from "ethers";

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

function fail(message) {
  throw new Error(message);
}

function envAddress(name, fallback) {
  const raw = process.env[name]?.trim() || fallback;
  if (!raw || !isAddress(raw)) fail(`${name} must be a valid EVM address.`);
  return getAddress(raw);
}

function parseBytes(name, value) {
  const raw = value?.trim();
  if (!raw) return "0x";
  if (raw.startsWith("0x")) {
    if (!isHexString(raw)) fail(`${name} starts with 0x but is not valid hex.`);
    return raw;
  }
  return hexlify(toUtf8Bytes(raw));
}

function parseBytes32(name, value) {
  const raw = value?.trim();
  if (!raw) return hexlify(randomBytes(32));
  if (!isHexString(raw, 32)) fail(`${name} must be exactly 32 bytes of 0x-prefixed hex.`);
  return raw;
}


function parseGasBufferPercent(value) {
  const raw = value?.trim() || "20";
  if (!/^\d+$/.test(raw)) fail("GAS_BUFFER_PERCENT must be an integer.");
  const percent = Number(raw);
  if (percent < 10 || percent > 100) {
    fail("GAS_BUFFER_PERCENT must be between 10 and 100.");
  }
  return BigInt(percent);
}

function assertEnvironmentSafety(mode) {
  if (fs.existsSync(path.resolve(process.cwd(), ".env.example"))) {
    const example = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
    if (/^PRIVATE_KEY=\S+/m.test(example)) {
      fail(".env.example contains a private key value. Remove it before continuing.");
    }
  }

  if (mode !== "broadcast") return;

  if (process.env.ALLOW_MAINNET_BROADCAST?.trim().toUpperCase() !== "YES") {
    fail("Set ALLOW_MAINNET_BROADCAST=YES only when you are ready for the irreversible mainnet launch.");
  }

  try {
    execFileSync("git", ["ls-files", "--error-unmatch", ".env"], { stdio: "ignore" });
    fail(".env is tracked by git. Remove it from git history/index before broadcasting.");
  } catch (error) {
    if (error?.message?.startsWith(".env is tracked")) throw error;
  }
}

function asJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}

loadLocalEnv();

const mode = process.argv.includes("--broadcast")
  ? "broadcast"
  : process.argv.includes("--simulate")
    ? "simulate"
    : "inspect";

assertEnvironmentSafety(mode);

const RPC_URL = process.env.RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = BigInt(process.env.CHAIN_ID?.trim() || "4663");

// Canonical contracts used by FRONG's launch transaction on Robinhood Chain.
const ADDRESSES = Object.freeze({
  liquidityLauncher: getAddress("0x00004c4ccc709Ef590F7C81102C0689F0263D4e9"),
  uerc20Factory: getAddress("0x000000e200088D55C39a11F609E5F667729ad49b"),
  instantLaunchStrategyFeesOn: getAddress("0x60D73b21cDf2EA846ab3d58699BBbb8F29d72491"),
  feeSplitterFeesOn: getAddress("0x7198C32a497c09497e04C86cf8F77A244A9E4b8F"),
  beneficiaryVault: getAddress("0x587D2fDDDF14F6f84022b51e8c3a473eB88C4544"),
  compoundingClaimRecipient: getAddress("0x666DA63451A502A323677C2Ef5F763181358be9b"),
  poolManager: getAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951"),
  positionManager: getAddress("0x58daec3116aae6D93017bAAea7749052E8a04fA7"),
});

const TOKEN_NAME = process.env.TOKEN_NAME?.trim() || "PEPE";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL?.trim() || "PEPE";
const TOKEN_DECIMALS = 18;
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const DISTRIBUTION_SALT = parseBytes32("DISTRIBUTION_SALT", process.env.DISTRIBUTION_SALT);
const GAS_BUFFER_PERCENT = parseGasBufferPercent(process.env.GAS_BUFFER_PERCENT);

if (TOKEN_NAME !== "PEPE") fail("This repository is locked to TOKEN_NAME=PEPE.");
if (TOKEN_SYMBOL !== "PEPE") fail("This repository is locked to TOKEN_SYMBOL=PEPE.");

const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: true });

let wallet;
let deployerAddress;
const privateKey = process.env.PRIVATE_KEY?.trim();
if (privateKey) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail("PRIVATE_KEY must be 0x followed by exactly 64 hexadecimal characters.");
  }
  wallet = new Wallet(privateKey, provider);
  deployerAddress = await wallet.getAddress();
} else {
  const raw = process.env.DEPLOYER_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) {
    fail("Set PRIVATE_KEY, or set DEPLOYER_ADDRESS for inspect/simulate mode.");
  }
  deployerAddress = getAddress(raw);
}

if (mode === "broadcast" && !wallet) {
  fail("--broadcast requires PRIVATE_KEY in the local .env file.");
}

const feeBeneficiary = envAddress("FEE_BENEFICIARY", deployerAddress);
if (
  feeBeneficiary === ZeroAddress ||
  feeBeneficiary.toLowerCase() === ADDRESSES.liquidityLauncher.toLowerCase() ||
  feeBeneficiary.toLowerCase() === ADDRESSES.beneficiaryVault.toLowerCase()
) {
  fail("FEE_BENEFICIARY cannot be zero, LiquidityLauncher, or BeneficiaryVault.");
}

const metadata = {
  description: process.env.DESCRIPTION?.trim() || "PEPE on Robinhood Chain",
  website: process.env.WEBSITE?.trim() || "",
  image: process.env.IMAGE?.trim() || "",
  extraData: parseBytes("EXTRA_DATA", process.env.EXTRA_DATA),
};

const launcherAbi = [
  "function multicall(bytes[] data) returns (bytes[] results)",
  "function createToken(address factory,string name,string symbol,uint8 decimals,uint128 initialSupply,address recipient,bytes tokenData) returns (address tokenAddress)",
  "function distributeToken(address token,(address strategy,uint128 amount,bytes configData) distribution,bytes32 salt)",
  "function getGraffiti(address originalCreator) pure returns (bytes32 graffiti)",
  "event TokenCreated(address indexed tokenAddress)",
  "event TokenDistributed(address indexed tokenAddress,address indexed strategy,uint256 amount)",
];
const factoryAbi = [
  "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address)",
];
const strategyAbi = [
  "function launcher() view returns (address)",
  "function feeSplitter() view returns (address)",
  "function beneficiaryVault() view returns (address)",
  "function initialTick() view returns (int24)",
  "event DistributionInitialized(address indexed distributor,address indexed token,uint256 totalSupply)",
  "event TokenLaunched(bytes32 indexed poolId,address indexed token,address indexed finalPositionRecipient,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)",
];
const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function creator() view returns (address)",
  "function graffiti() view returns (bytes32)",
  "function metadata() view returns (string description,string website,string image,bytes extraData)",
];
const erc721Abi = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
];
const poolManagerEventsAbi = [
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
];

const launcher = new Contract(ADDRESSES.liquidityLauncher, launcherAbi, provider);
const factory = new Contract(ADDRESSES.uerc20Factory, factoryAbi, provider);
const strategy = new Contract(ADDRESSES.instantLaunchStrategyFeesOn, strategyAbi, provider);
const coder = AbiCoder.defaultAbiCoder();

const network = await provider.getNetwork();
if (network.chainId !== CHAIN_ID) {
  fail(`Wrong network: connected to chain ${network.chainId}, expected ${CHAIN_ID}.`);
}

for (const [label, address] of Object.entries(ADDRESSES)) {
  const code = await provider.getCode(address);
  if (code === "0x") fail(`No contract code at ${label}: ${address}`);
}

const [strategyLauncher, strategyFeeSplitter, strategyBeneficiaryVault, strategyInitialTick] =
  await Promise.all([
    strategy.launcher(),
    strategy.feeSplitter(),
    strategy.beneficiaryVault(),
    strategy.initialTick(),
  ]);

if (getAddress(strategyLauncher) !== ADDRESSES.liquidityLauncher) {
  fail(`Strategy launcher mismatch: ${strategyLauncher}`);
}
if (getAddress(strategyFeeSplitter) !== ADDRESSES.feeSplitterFeesOn) {
  fail(`Strategy FeeSplitter mismatch: ${strategyFeeSplitter}`);
}
if (getAddress(strategyBeneficiaryVault) !== ADDRESSES.beneficiaryVault) {
  fail(`Strategy BeneficiaryVault mismatch: ${strategyBeneficiaryVault}`);
}
if (BigInt(strategyInitialTick) !== 198060n) {
  fail(`Unexpected strategy initialTick: ${strategyInitialTick}`);
}

const graffitiOnChain = await launcher.getGraffiti(deployerAddress);
const graffitiLocally = keccak256(coder.encode(["address"], [deployerAddress]));
if (graffitiOnChain !== graffitiLocally) fail("Launcher graffiti calculation mismatch.");

const predictedToken = getAddress(
  await factory.getUERC20Address(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS,
    ADDRESSES.liquidityLauncher,
    graffitiOnChain,
  ),
);

const existingCode = await provider.getCode(predictedToken);
if (existingCode !== "0x") {
  fail(
    `The deterministic token address ${predictedToken} already has code. Change name/symbol or use a different deploying wallet.`,
  );
}

const tokenData = coder.encode(
  ["tuple(string description,string website,string image,bytes extraData)"],
  [[metadata.description, metadata.website, metadata.image, metadata.extraData]],
);
const instantLaunchConfig = coder.encode(
  ["tuple(address feeBeneficiary)"],
  [[feeBeneficiary]],
);

const launcherInterface = new Interface(launcherAbi);
const createTokenCall = launcherInterface.encodeFunctionData("createToken", [
  ADDRESSES.uerc20Factory,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOKEN_DECIMALS,
  TOTAL_SUPPLY,
  ADDRESSES.liquidityLauncher,
  tokenData,
]);
const distributeTokenCall = launcherInterface.encodeFunctionData("distributeToken", [
  predictedToken,
  {
    strategy: ADDRESSES.instantLaunchStrategyFeesOn,
    amount: TOTAL_SUPPLY,
    configData: instantLaunchConfig,
  },
  DISTRIBUTION_SALT,
]);
const multicallData = launcherInterface.encodeFunctionData("multicall", [
  [createTokenCall, distributeTokenCall],
]);

const summary = {
  mode,
  chainId: CHAIN_ID,
  deployer: deployerAddress,
  token: {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    decimals: TOKEN_DECIMALS,
    totalSupplyRaw: TOTAL_SUPPLY,
    totalSupplyWhole: "1000000000",
    predictedAddress: predictedToken,
    creatorRecordedInToken: ADDRESSES.liquidityLauncher,
    graffiti: graffitiOnChain,
    metadata,
  },
  launch: {
    launcher: ADDRESSES.liquidityLauncher,
    factory: ADDRESSES.uerc20Factory,
    strategy: ADDRESSES.instantLaunchStrategyFeesOn,
    feeBeneficiary,
    feeSplitter: ADDRESSES.feeSplitterFeesOn,
    beneficiaryVault: ADDRESSES.beneficiaryVault,
    poolManager: ADDRESSES.poolManager,
    positionManager: ADDRESSES.positionManager,
    distributionSalt: DISTRIBUTION_SALT,
    pool: {
      currency0: ZeroAddress,
      currency1: predictedToken,
      pair: `ETH/${TOKEN_SYMBOL}`,
      version: "Uniswap V4",
      lpFeePips: 2500,
      lpFeePercent: "0.25%",
      tickSpacing: 60,
      hooks: ZeroAddress,
      initialTick: Number(strategyInitialTick),
      positionLowerTick: -208980,
      positionUpperTick: Number(strategyInitialTick),
      initialTokenLiquidityRaw: TOTAL_SUPPLY,
      initialEthLiquidityWei: "0",
      removable: false,
    },
    feePolicy: {
      creatorNativeFeeBps: 4000,
      creatorTokenFeeBps: 0,
      creatorNativeFeePercent: "40% of collected ETH-side LP fees",
      creatorTokenFeePercent: "0% of collected PEPE-side LP fees",
      remainingFees: "Auto-compounded through the FeeSplitter/CompoundingClaimRecipient",
    },
  },
  transaction: {
    to: ADDRESSES.liquidityLauncher,
    value: "0",
    data: multicallData,
    innerCalls: [createTokenCall, distributeTokenCall],
  },
};

console.log("\n=== PEPE FRONG-style Instant Launch ===");
console.log(`Mode:                 ${mode}`);
console.log(`Chain:                ${network.name} (${network.chainId})`);
console.log(`Deployer:             ${deployerAddress}`);
console.log(`Fee beneficiary:      ${feeBeneficiary}`);
console.log(`Predicted PEPE:       ${predictedToken}`);
console.log(`Supply to V4 LP:      1,000,000,000 ${TOKEN_SYMBOL}`);
console.log("Creator ETH required: 0 ETH (gas only)");
console.log("Pool:                 native ETH/PEPE Uniswap V4");
console.log("LP custody:           permanent FeeSplitter custody");
console.log("Creator fee share:    40% of ETH-side LP fees; 0% of token-side fees");
console.log(`Distribution salt:    ${DISTRIBUTION_SALT}`);

if (mode === "inspect") {
  console.log("\nInspection passed. No transaction was simulated or sent.");
  process.exit(0);
}

const txRequest = {
  from: deployerAddress,
  to: ADDRESSES.liquidityLauncher,
  data: multicallData,
  value: 0n,
};

console.log("\nSimulating the complete atomic launch...");
await provider.call(txRequest);
const estimatedGas = await provider.estimateGas(txRequest);
const gasLimit = (estimatedGas * (100n + GAS_BUFFER_PERCENT)) / 100n;
const feeData = await provider.getFeeData();
const estimatedCost = feeData.gasPrice ? estimatedGas * feeData.gasPrice : null;
summary.transaction.estimatedGas = estimatedGas;
summary.transaction.gasLimit = gasLimit;
summary.transaction.estimatedGasCostWei = estimatedCost;
console.log(`Simulation:            PASS`);
console.log(`Estimated gas:         ${estimatedGas}`);
if (estimatedCost !== null) console.log(`Estimated gas cost:    ${estimatedCost} wei`);

if (wallet) {
  const feeCap = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (feeCap !== null) {
    const requiredWei = gasLimit * feeCap;
    const balanceWei = await provider.getBalance(deployerAddress);
    summary.transaction.walletBalanceWei = balanceWei;
    summary.transaction.maximumEstimatedCostWei = requiredWei;
    if (balanceWei < requiredWei) {
      fail(`Insufficient native ETH for the buffered gas estimate. Balance ${balanceWei} wei, required at least ${requiredWei} wei.`);
    }
  }
}

if (mode === "simulate") {
  const filename = `pepe-instant-launch-simulation-${predictedToken}.json`;
  fs.writeFileSync(filename, JSON.stringify(asJson(summary), null, 2));
  console.log(`\nNo transaction sent. Saved ${filename}`);
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `\nType DEPLOY PEPE to irreversibly create ${predictedToken} and lock its full supply in V4 liquidity: `,
);
rl.close();
if (answer.trim() !== "DEPLOY PEPE") {
  console.log("Cancelled. No transaction sent.");
  process.exit(0);
}

console.log("\nRevalidating chain state immediately before broadcast...");
const finalNetwork = await provider.getNetwork();
if (finalNetwork.chainId !== CHAIN_ID) fail("Network changed after simulation.");
if ((await provider.getCode(predictedToken)) !== "0x") {
  fail("Predicted token address was occupied after simulation. Nothing was sent.");
}
await provider.call(txRequest);
console.log("Final simulation:       PASS");

console.log("\nBroadcasting atomic create + Instant Launch transaction...");
const sent = await wallet.sendTransaction({
  to: ADDRESSES.liquidityLauncher,
  data: multicallData,
  value: 0n,
  gasLimit,
});
console.log(`Transaction:           ${sent.hash}`);
const receipt = await sent.wait();
if (!receipt || receipt.status !== 1) fail("Launch transaction failed.");

const launcherEvents = new Interface(launcherAbi);
const strategyEvents = new Interface(strategyAbi);
const poolEvents = new Interface(poolManagerEventsAbi);
const erc721Events = new Interface(erc721Abi);
let launchedEvent;
let initializedEvent;
let positionTokenId;
let beneficiaryTokenId;

for (const log of receipt.logs) {
  try {
    if (log.address.toLowerCase() === ADDRESSES.instantLaunchStrategyFeesOn.toLowerCase()) {
      const parsed = strategyEvents.parseLog(log);
      if (parsed?.name === "TokenLaunched") launchedEvent = parsed;
    }
  } catch {}
  try {
    if (log.address.toLowerCase() === ADDRESSES.poolManager.toLowerCase()) {
      const parsed = poolEvents.parseLog(log);
      if (parsed?.name === "Initialize") initializedEvent = parsed;
    }
  } catch {}
  try {
    if (log.address.toLowerCase() === ADDRESSES.positionManager.toLowerCase()) {
      const parsed = erc721Events.parseLog(log);
      if (parsed?.name === "Transfer" && parsed.args.to.toLowerCase() === ADDRESSES.feeSplitterFeesOn.toLowerCase()) {
        positionTokenId = parsed.args.tokenId;
      }
    }
  } catch {}
  try {
    if (log.address.toLowerCase() === ADDRESSES.beneficiaryVault.toLowerCase()) {
      const parsed = erc721Events.parseLog(log);
      if (parsed?.name === "Transfer" && parsed.args.from === ZeroAddress) {
        beneficiaryTokenId = parsed.args.tokenId;
      }
    }
  } catch {}
}

const token = new Contract(predictedToken, tokenAbi, provider);
const [actualName, actualSymbol, actualDecimals, actualSupply, actualCreator, actualGraffiti, actualMetadata] =
  await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
    token.totalSupply(),
    token.creator(),
    token.graffiti(),
    token.metadata(),
  ]);

if (actualName !== TOKEN_NAME) fail(`Token name mismatch: ${actualName}`);
if (actualSymbol !== TOKEN_SYMBOL) fail(`Token symbol mismatch: ${actualSymbol}`);
if (BigInt(actualDecimals) !== 18n) fail(`Token decimals mismatch: ${actualDecimals}`);
if (actualSupply !== TOTAL_SUPPLY) fail(`Token supply mismatch: ${actualSupply}`);
if (getAddress(actualCreator) !== ADDRESSES.liquidityLauncher) fail(`Token creator mismatch: ${actualCreator}`);
if (actualGraffiti !== graffitiOnChain) fail(`Token graffiti mismatch: ${actualGraffiti}`);
if (!launchedEvent) fail("TokenLaunched event not found.");
if (!initializedEvent) fail("PoolManager Initialize event not found.");
if (getAddress(launchedEvent.args.token) !== predictedToken) fail("TokenLaunched token mismatch.");
if (getAddress(launchedEvent.args.finalPositionRecipient) !== ADDRESSES.feeSplitterFeesOn) {
  fail("LP position recipient is not the canonical FeeSplitter.");
}

if (positionTokenId !== undefined) {
  const positionManager = new Contract(ADDRESSES.positionManager, erc721Abi, provider);
  const positionOwner = getAddress(await positionManager.ownerOf(positionTokenId));
  if (positionOwner !== ADDRESSES.feeSplitterFeesOn) fail(`Unexpected LP owner: ${positionOwner}`);
  summary.launch.positionTokenId = positionTokenId;
  summary.launch.positionOwner = positionOwner;
}
if (beneficiaryTokenId !== undefined) {
  const beneficiaryVault = new Contract(ADDRESSES.beneficiaryVault, erc721Abi, provider);
  const beneficiaryNftOwner = getAddress(await beneficiaryVault.ownerOf(beneficiaryTokenId));
  if (beneficiaryNftOwner !== feeBeneficiary) {
    fail(`Fee-beneficiary NFT owner mismatch: ${beneficiaryNftOwner}`);
  }
  summary.launch.beneficiaryTokenId = beneficiaryTokenId;
  summary.launch.beneficiaryNftOwner = beneficiaryNftOwner;
}

summary.receipt = {
  transactionHash: receipt.hash,
  blockNumber: receipt.blockNumber,
  gasUsed: receipt.gasUsed,
  poolId: launchedEvent.args.poolId,
  initializedSqrtPriceX96: initializedEvent.args.sqrtPriceX96,
  initializedTick: initializedEvent.args.tick,
};
summary.verifiedToken = {
  address: predictedToken,
  name: actualName,
  symbol: actualSymbol,
  decimals: actualDecimals,
  totalSupply: actualSupply,
  creator: actualCreator,
  graffiti: actualGraffiti,
  metadata: {
    description: actualMetadata.description,
    website: actualMetadata.website,
    image: actualMetadata.image,
    extraData: actualMetadata.extraData,
  },
};

const filename = `pepe-instant-launch-${predictedToken}.json`;
fs.writeFileSync(filename, JSON.stringify(asJson(summary), null, 2));
console.log("\n[OK] PEPE launched with the FRONG Instant Launch structure.");
console.log(`Token:                 ${predictedToken}`);
console.log(`Pool ID:               ${launchedEvent.args.poolId}`);
if (positionTokenId !== undefined) console.log(`Locked LP token ID:    ${positionTokenId}`);
if (beneficiaryTokenId !== undefined) console.log(`Fee-beneficiary NFT:   ${beneficiaryTokenId}`);
console.log(`Deployment record:     ${filename}`);
