import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const excluded = new Set([".git", "node_modules", "assets", "coverage", "dist"]);
const textExtensions = new Set([".md", ".mjs", ".js", ".json", ".yml", ".yaml", ".txt", ".example", ""]);
const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else scan(full);
  }
}

function scan(file) {
  const rel = path.relative(root, file).replaceAll("\\", "/");
  if (rel === ".env") findings.push(`${rel}: local .env must never be committed`);
  if (!textExtensions.has(path.extname(file).toLowerCase()) && path.basename(file) !== ".gitignore") return;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*PRIVATE_KEY\s*=\s*0x[0-9a-fA-F]{64}\s*$/i.test(line)) {
      findings.push(`${rel}:${i + 1}: possible EVM private key`);
    }
    if (/^\s*(MNEMONIC|SEED_PHRASE)\s*=\s*\S+/i.test(line)) {
      findings.push(`${rel}:${i + 1}: possible recovery phrase assignment`);
    }
  }
}

walk(root);
if (findings.length) {
  console.error("Secret scan failed:\n" + findings.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}
console.log("Secret scan: PASS");
