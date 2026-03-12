/**
 * Demo: Sign EIP-712 typed data for x402 payment permit with an EVM/BSC wallet.
 *
 * This example is the EVM/BSC counterpart to tron-x402-sign-typed-data.ts.
 * It resolves the active wallet from environment variables via resolveWalletProvider()
 * and verifies the recovered signer directly against the EVM address.
 *
 * Recommended env:
 *   AGENT_WALLET_PRIVATE_KEY=<hex> npx tsx examples/bsc-x402-sign-typed-data.ts
 *   AGENT_WALLET_MNEMONIC="word1 word2 ..." npx tsx examples/bsc-x402-sign-typed-data.ts
 *
 * Optional local mode also works:
 *   AGENT_WALLET_PASSWORD=<password> npx tsx examples/bsc-x402-sign-typed-data.ts
 */

import { resolveWalletProvider, type Eip712Capable } from "../src/index.js";
import { recoverTypedDataAddress } from "viem";

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
    chainId: 97,
    verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
  },
  message: {
    buyer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    amount: 1000000,
    nonce: 0,
  },
};

const STANDARD_TYPED_DATA = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Transfer: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  primaryType: "Transfer",
  domain: {
    name: "MyDApp",
    version: "1",
    chainId: 97,
    verifyingContract: "0x1234567890AbcdEF1234567890aBcdef12345678",
  },
  message: {
    to: "0xabCDeF0123456789AbcdEf0123456789aBCDEF01",
    amount: 5000000,
  },
};

async function main() {
  const provider = resolveWalletProvider({ network: "eip155:97" });
  const wallet = await provider.getActiveWallet();
  const address = await wallet.getAddress();

  if (!address.startsWith("0x")) {
    throw new Error(
      "bsc-x402-sign-typed-data.ts expects an EVM wallet. Set AGENT_WALLET_PRIVATE_KEY or AGENT_WALLET_MNEMONIC.",
    );
  }

  console.log(`Address: ${address}`);
  console.log();

  const signer = wallet as unknown as Eip712Capable;

  console.log("=== x402 PaymentPermit (BSC) ===");
  console.log(`  Domain:      ${PAYMENT_PERMIT.domain.name}`);
  console.log(`  Chain ID:    ${PAYMENT_PERMIT.domain.chainId}`);
  console.log(`  Buyer:       ${PAYMENT_PERMIT.message.buyer}`);
  console.log(`  Amount:      ${PAYMENT_PERMIT.message.amount}`);

  const sig1 = await signer.signTypedData(PAYMENT_PERMIT);
  console.log(`  Signature:   ${sig1}`);
  console.log();

  console.log("=== Standard EIP-712 Transfer ===");
  console.log(
    `  Domain:      ${STANDARD_TYPED_DATA.domain.name} v${STANDARD_TYPED_DATA.domain.version}`,
  );
  console.log(`  To:          ${STANDARD_TYPED_DATA.message.to}`);
  console.log(`  Amount:      ${STANDARD_TYPED_DATA.message.amount}`);

  const sig2 = await signer.signTypedData(STANDARD_TYPED_DATA);
  console.log(`  Signature:   ${sig2}`);
  console.log();

  console.log("=== Verify Signature ===");
  const { EIP712Domain, ...msgTypes } = PAYMENT_PERMIT.types;
  const recovered = await recoverTypedDataAddress({
    domain: PAYMENT_PERMIT.domain as any,
    types: msgTypes as any,
    primaryType: PAYMENT_PERMIT.primaryType,
    message: PAYMENT_PERMIT.message as any,
    signature: `0x${sig1}`,
  });

  console.log(`  Recovered:   ${recovered}`);
  console.log(`  Matches:     ${recovered.toLowerCase() === address.toLowerCase()}`);
}

main().catch(console.error);
