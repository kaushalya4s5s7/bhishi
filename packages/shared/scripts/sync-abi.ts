#!/usr/bin/env tsx
/**
 * sync-abi.ts — reads Foundry artifacts and writes ABI JSON files + addresses stub.
 * Run: pnpm --filter @bhishi/shared sync
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths relative to this script (packages/shared/scripts/)
const contractsOut = join(__dirname, "../../contracts/out");
const abisOut = join(__dirname, "../src/abis");
const addressesOut = join(__dirname, "../src/addresses.ts");

// Ensure abis dir exists
mkdirSync(abisOut, { recursive: true });

const contracts = [
  { name: "CircleFactory", sol: "CircleFactory.sol" },
  { name: "Circle", sol: "Circle.sol" },
  { name: "ReputationRegistry", sol: "ReputationRegistry.sol" },
  { name: "MockStable", sol: "MockStable.sol" },
] as const;

for (const { name, sol } of contracts) {
  const artifactPath = join(contractsOut, sol, `${name}.json`);
  let artifact: { abi: unknown[] };
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  } catch (e) {
    console.error(`ERROR: Could not read artifact for ${name} at ${artifactPath}`);
    process.exit(1);
  }

  const abi = artifact.abi;
  const outPath = join(abisOut, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(abi, null, 2) + "\n");
  console.log(`✓ ${name}: extracted ${abi.length} ABI entries → src/abis/${name}.json`);
}

// Write the placeholder addresses file ONLY if it doesn't already exist — never
// clobber real deployed addresses on an ABI re-sync. To reset it, delete the
// file first, or edit it by hand after a deploy.
if (existsSync(addressesOut)) {
  console.log("• addresses.ts already exists — left untouched (delete it to regenerate the stub)");
} else {
  const addressesContent = `// Deployed contract addresses. Edit by hand after each deploy — sync-abi.ts will
// NOT overwrite this file once it exists.
export const addresses = {
  monadTestnet: {
    factory: "0x0000000000000000000000000000000000000000" as \`0x\${string}\`,
    reputation: "0x0000000000000000000000000000000000000000" as \`0x\${string}\`,
    mockStable: "0x0000000000000000000000000000000000000000" as \`0x\${string}\`,
  },
} as const;
`;
  writeFileSync(addressesOut, addressesContent);
  console.log("✓ addresses.ts written (placeholder zeros — fill in after deploy)");
}
