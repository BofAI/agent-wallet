/**
 * Demo: Sign EIP-712 typed data for x402 payment permit using agent-wallet SDK.
 *
 * This example shows how x402 integrations (e.g. mcp-server-tron) can use
 * the agent-wallet SDK to sign EIP-712 structured data — the same format
 * used by x402's PaymentPermit.
 *
 * agent-wallet's signTypedData() is fully compatible with x402's signing:
 *   - Supports domains with or without "version" field
 *   - Same ECDSA curve (secp256k1) for both EVM and Tron
 *   - Identical signatures for the same key + data, regardless of chain
 *
 * Prerequisites:
 *   - Either configure a wallet via the CLI:
 *       agent-wallet start local_secure --wallet-id tron-wallet
 *       agent-wallet start raw_secret --wallet-id tron-wallet --mnemonic "..."
 *   - Or provide env fallback:
 *       AGENT_WALLET_PRIVATE_KEY=<hex>
 *
 * Usage:
 *   AGENT_WALLET_PRIVATE_KEY=<hex> npx tsx examples/tron-x402-sign-typed-data.ts
 */

import { resolveWalletProvider, type Eip712Capable } from "../src/index.js";
import { recoverTypedDataAddress } from "viem";
import bs58check from "bs58check";

// --- x402 PaymentPermit typed data ---

// This is the exact format x402 uses for payment authorization.
// EIP712Domain does NOT include "version" — this is intentional and
// agent-wallet handles it correctly.

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
    chainId: 728126428, // Tron chain ID (use 1 for Ethereum mainnet)
    verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
  },
  message: {
    buyer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    amount: 1000000,
    nonce: 0,
  },
};

// Standard EIP-712 with "version" field also works:

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
    chainId: 728126428,
    verifyingContract: "0x1234567890AbcdEF1234567890aBcdef12345678",
  },
  message: {
    to: "0xabCDeF0123456789AbcdEf0123456789aBCDEF01",
    amount: 5000000,
  },
};

async function main() {
  // ----------------------------------------------------------------
  // Step 1: Resolve provider and active wallet
  // ----------------------------------------------------------------
  const provider = resolveWalletProvider({ network: "tron" });
  const wallet = await provider.getActiveWallet();
  const address = await wallet.getAddress();
  console.log(`Address: ${address}`);
  console.log();

  // Cast to Eip712Capable; both EvmAdapter and TronAdapter implement it.
  const signer = wallet as unknown as Eip712Capable;

  // ----------------------------------------------------------------
  // Step 2: Sign x402 PaymentPermit (no "version" in domain)
  // ----------------------------------------------------------------
  console.log("=== x402 PaymentPermit ===");
  console.log(`  Domain:      ${PAYMENT_PERMIT.domain.name}`);
  console.log(`  Chain ID:    ${PAYMENT_PERMIT.domain.chainId}`);
  console.log(`  Buyer:       ${PAYMENT_PERMIT.message.buyer}`);
  console.log(`  Amount:      ${PAYMENT_PERMIT.message.amount}`);

  const sig1 = await signer.signTypedData(PAYMENT_PERMIT);
  console.log(`  Signature:   ${sig1}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 3: Sign standard EIP-712 (with "version" in domain)
  // ----------------------------------------------------------------
  console.log("=== Standard EIP-712 Transfer ===");
  console.log(
    `  Domain:      ${STANDARD_TYPED_DATA.domain.name} v${STANDARD_TYPED_DATA.domain.version}`,
  );
  console.log(`  To:          ${STANDARD_TYPED_DATA.message.to}`);
  console.log(`  Amount:      ${STANDARD_TYPED_DATA.message.amount}`);

  const sig2 = await signer.signTypedData(STANDARD_TYPED_DATA);
  console.log(`  Signature:   ${sig2}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 4: Verify signature (optional — shows how to recover signer)
  // ----------------------------------------------------------------
  console.log("=== Verify Signature ===");

  // Use viem to recover the signer from the EIP-712 signature
  if (!PAYMENT_PERMIT.domain || !PAYMENT_PERMIT.message) {
    throw new Error("Missing EIP-712 domain or message for PAYMENT_PERMIT");
  }
  const { EIP712Domain: _EIP712Domain, ...msgTypes } = PAYMENT_PERMIT.types;
  const recovered = await recoverTypedDataAddress({
    domain: PAYMENT_PERMIT.domain as Record<string, unknown>,
    types: msgTypes as Record<string, Array<{ name: string; type: string }>>,
    primaryType: PAYMENT_PERMIT.primaryType,
    message: PAYMENT_PERMIT.message as Record<string, unknown>,
    signature: `0x${sig1}`,
  });

  // Tron address = base58check(0x41 + eth_addr), so decode and extract eth addr for comparison
  const tronBytes = bs58check.decode(address);
  const ethAddrFromTron = `0x${Buffer.from(tronBytes.slice(1)).toString("hex")}`;

  console.log(`  Recovered:   ${recovered}`);
  console.log(`  ETH addr:    ${ethAddrFromTron}`);
  console.log(
    `  Matches:     ${recovered.toLowerCase() === ethAddrFromTron.toLowerCase()}`,
  );
}

main().catch(console.error);
