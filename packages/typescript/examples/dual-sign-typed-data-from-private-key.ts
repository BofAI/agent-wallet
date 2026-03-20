/**
 * Demo: Resolve both TRON and EVM signers from one external input.
 *
 * This example maps one of these external environment variables into the SDK's
 * expected env vars:
 *
 *   - `PRIVATE_KEY`
 *   - `MNEMONIC`
 *   - `WALLET_PASSWORD`
 *   - `MNEMONIC_ACCOUNT_INDEX` (optional, mnemonic mode only)
 *
 * Then it resolves two wallet providers:
 *
 *   - TRON via `resolveWalletProvider({ network: "tron" })`
 *   - EVM via `resolveWalletProvider({ network: "eip155" })`
 *
 * Usage:
 *   PRIVATE_KEY=<hex> npx tsx examples/dual-sign-typed-data-from-private-key.ts
 *   MNEMONIC="word1 word2 ..." npx tsx examples/dual-sign-typed-data-from-private-key.ts
 *   MNEMONIC="word1 word2 ..." MNEMONIC_ACCOUNT_INDEX=1 npx tsx examples/dual-sign-typed-data-from-private-key.ts
 *   WALLET_PASSWORD=<password> npx tsx examples/dual-sign-typed-data-from-private-key.ts
 */

import { resolveWalletProvider, type Eip712Capable } from "../src/index.js";

const PAYMENT_PERMIT = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    PaymentPermitDetails: [
      { name: "buyer", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  },
  primaryType: "PaymentPermitDetails",
  domain: {
    name: "x402PaymentPermit",
    chainId: 1,
    verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
  },
  message: {
    buyer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    amount: 1000000,
    nonce: 0,
  },
};

async function main() {
  const privateKey = process.env.PRIVATE_KEY?.trim() ?? "";
  const mnemonic = process.env.MNEMONIC?.trim() ?? "";
  const walletPassword = process.env.WALLET_PASSWORD?.trim() ?? "";
  const accountIndex = process.env.MNEMONIC_ACCOUNT_INDEX?.trim() ?? "";
  const configuredModes = [privateKey, mnemonic, walletPassword].filter(Boolean).length;

  if (configuredModes > 1) {
    throw new Error("Set only one of PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD.");
  }
  if (configuredModes === 0) {
    throw new Error("Set PRIVATE_KEY, MNEMONIC, or WALLET_PASSWORD before running this example.");
  }

  delete process.env.AGENT_WALLET_PRIVATE_KEY;
  delete process.env.AGENT_WALLET_MNEMONIC;
  delete process.env.AGENT_WALLET_PASSWORD;
  delete process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX;
  if (privateKey) {
    process.env.AGENT_WALLET_PRIVATE_KEY = privateKey;
  } else if (mnemonic) {
    process.env.AGENT_WALLET_MNEMONIC = mnemonic;
    if (accountIndex) {
      process.env.AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX = accountIndex;
    }
  } else {
    process.env.AGENT_WALLET_PASSWORD = walletPassword;
  }

  const tronProvider = resolveWalletProvider({ network: "tron" });
  const tronWallet = (await tronProvider.getActiveWallet()) as unknown as Eip712Capable & {
    getAddress(): Promise<string>;
  };
  const tronAddress = await tronWallet.getAddress();
  const tronSignature = await tronWallet.signTypedData(PAYMENT_PERMIT);

  const evmProvider = resolveWalletProvider({ network: "eip155" });
  const evmWallet = (await evmProvider.getActiveWallet()) as unknown as Eip712Capable & {
    getAddress(): Promise<string>;
  };
  const evmAddress = await evmWallet.getAddress();
  const evmSignature = await evmWallet.signTypedData(PAYMENT_PERMIT);

  console.log("=== TRON ===");
  console.log(`Address:    ${tronAddress}`);
  console.log(`Signature:  ${tronSignature}`);
  console.log();

  console.log("=== EVM ===");
  console.log(`Address:    ${evmAddress}`);
  console.log(`Signature:  ${evmSignature}`);
}

main().catch(console.error);
