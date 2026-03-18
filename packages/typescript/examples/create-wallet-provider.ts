/**
 * Demo: Create wallet providers using `createWalletProvider` with explicit options.
 *
 * This example shows all four modes of `createWalletProvider`:
 *
 *   1. Private key mode  — pass a hex private key + network
 *   2. Mnemonic mode     — pass a BIP-39 mnemonic + network (+ optional account index)
 *   3. Local mode        — pass a password (+ optional secrets dir)
 *   4. Env fallback mode — no explicit credentials, reads from environment variables
 *
 * Usage:
 *   PRIVATE_KEY=<hex> npx tsx examples/create-wallet-provider.ts
 *   MNEMONIC="word1 word2 ..." npx tsx examples/create-wallet-provider.ts
 *   MNEMONIC="word1 word2 ..." MNEMONIC_ACCOUNT_INDEX=1 npx tsx examples/create-wallet-provider.ts
 *   WALLET_PASSWORD=<password> npx tsx examples/create-wallet-provider.ts
 */

import {
  createWalletProvider,
  type Eip712Capable,
} from "../src/index.js";

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

  // --- Build providers using createWalletProvider with explicit options ---

  if (privateKey) {
    console.log("Mode: privateKey\n");

    const tronProvider = createWalletProvider({ privateKey, network: "tron" });
    const evmProvider = createWalletProvider({ privateKey, network: "eip155" });

    await printWallet("TRON", tronProvider);
    await printWallet("EVM", evmProvider);
  } else if (mnemonic) {
    console.log(`Mode: mnemonic (accountIndex=${accountIndex})\n`);

    const tronProvider = createWalletProvider({ mnemonic, network: "tron", accountIndex });
    const evmProvider = createWalletProvider({ mnemonic, network: "eip155", accountIndex });

    await printWallet("TRON", tronProvider);
    await printWallet("EVM", evmProvider);
  } else {
    console.log("Mode: local (password)\n");

    const provider = createWalletProvider({ password: walletPassword });

    await printWallet("Local", provider);
  }
}

async function printWallet(label: string, provider: Awaited<ReturnType<typeof createWalletProvider>>) {
  const wallet = (await provider.getActiveWallet()) as unknown as Eip712Capable & {
    getAddress(): Promise<string>;
  };
  const address = await wallet.getAddress();

  console.log(`=== ${label} ===`);
  console.log(`Address: ${address}`);
  console.log();
}

main().catch(console.error);
