import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const env = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const gitignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const launcher = fs.readFileSync(new URL("../launch-pepe.mjs", import.meta.url), "utf8");
const feeTool = fs.readFileSync(new URL("../fees-pepe.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("published env example contains no private key", () => {
  assert.match(env, /^PRIVATE_KEY=\s*$/m);
  assert.doesNotMatch(env, /^PRIVATE_KEY=0x[0-9a-fA-F]{64}$/m);
});

test("local env files are ignored", () => {
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});

test("broadcast requires two independent confirmations", () => {
  assert.match(launcher, /ALLOW_MAINNET_BROADCAST/);
  assert.match(launcher, /DEPLOY PEPE/);
});

test("canonical launch value is zero", () => {
  assert.match(launcher, /value:\s*0n/);
});


test("fee transactions require explicit opt-in", () => {
  assert.match(feeTool, /ALLOW_FEE_TRANSACTIONS/);
  assert.match(feeTool, /COLLECT PEPE FEES/);
  assert.match(feeTool, /CLAIM PEPE FEES/);
});

test("fee scripts are published", () => {
  assert.equal(packageJson.scripts.fees, "node fees-pepe.mjs status");
  assert.equal(packageJson.scripts.collect, "node fees-pepe.mjs collect");
  assert.equal(packageJson.scripts.claim, "node fees-pepe.mjs claim");
});
