/**
 * Demo: Resolve wallet providers using `resolveWalletProvider`.
 *
 * This example shows three resolution paths:
 *
 *   1. Raw private key env fallback
 *   2. Raw mnemonic env fallback
 *   3. Config-backed local_secure mode
 *
 * Usage:
 *   PRIVATE_KEY=<hex> npx tsx examples/create-wallet-provider.ts
 *   MNEMONIC="word1 word2 ..." npx tsx examples/create-wallet-provider.ts
 *   MNEMONIC="word1 word2 ..." MNEMONIC_ACCOUNT_INDEX=1 npx tsx examples/create-wallet-provider.ts
 *   WALLET_PASSWORD=<password> npx tsx examples/create-wallet-provider.ts
 */

import { resolveWalletProvider, type Eip712Capable } from "../src/index.js";

async function main() {
  const privateKey = process.env.PRIVATE_KEY?.trim() ?? "";
  const mnemonic = process.env.MNEMONIC?.trim() ?? "";
  const walletPassword = process.env.WALLET_PASSWORD?.trim() ?? "";
  const accountIndex = Number(process.env.MNEMONIC_ACCOUNT_INDEX?.trim() ?? "0");
  const configuredModes = [privateKey, mnemonic, walletPassword].filter(Boolean).length;

  if (configuredModes > 1) {
    throw new Error("Set only one of PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD.");
  }
  if (configuredModes === 0) {
    throw new Error("Set PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD before running this example.");
  }

  // --- Build providers via env/config resolution ---

  if (privateKey) {
    console.log("Mode: privateKey\n");
    process.env.AGENT_WALLET_PRIVATE_KEY = privateKey

    const tronProvider = resolveWalletProvider({ network: "tron" });
    const evmProvider = resolveWalletProvider({ network: "eip155" });

    await printWallet("TRON", tronProvider);
    await printWallet("EVM", evmProvider);
  } else if (mnemonic) {
    console.log(`Mode: mnemonic (accountIndex=${accountIndex})\n`);
    process.env.AGENT_WALLET_MNEMONIC = mnemonic
    process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = String(accountIndex)

    const tronProvider = resolveWalletProvider({ network: "tron" });
    const evmProvider = resolveWalletProvider({ network: "eip155" });

    await printWallet("TRON", tronProvider);
    await printWallet("EVM", evmProvider);
  } else {
    console.log("Mode: local_secure (password)\n");
    process.env.AGENT_WALLET_PASSWORD = walletPassword

    const provider = resolveWalletProvider({ network: "eip155" });

    await printWallet("Local", provider);
  }
}

async function printWallet(label: string, provider: ReturnType<typeof resolveWalletProvider>) {
  const wallet = (await provider.getActiveWallet()) as unknown as Eip712Capable & {
    getAddress(): Promise<string>;
  };
  const address = await wallet.getAddress();

  console.log(`=== ${label} ===`);
  console.log(`Address: ${address}`);
  console.log();
}

main().catch(console.error);
