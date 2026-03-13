/**
 * Demo: Sign a BSC (BNB Smart Chain) transaction and broadcast it using agent-wallet SDK.
 *
 * This example shows how to use the agent-wallet SDK to:
 *   1. Initialize via resolveWalletProvider (decrypt keys once)
 *   2. Get an EVM wallet by ID
 *   3. Sign a message (pure local, no network)
 *   4. Build a BNB transfer tx, sign it with the SDK, and broadcast via BSC testnet RPC
 *
 * Prerequisites:
 *   - agent-wallet init (create secrets dir + master password)
 *   - agent-wallet add  (add an evm_local wallet, e.g. "wallet-evm")
 *   - The wallet address must have testnet BNB (use https://www.bnbchain.org/en/testnet-faucet)
 *
 * Usage:
 *   AGENT_WALLET_PRIVATE_KEY=<hex> npx tsx examples/bsc-sign-and-broadcast.ts
 */

import { resolveWalletProvider } from "../src/index.js";

// Transfer parameters
const TO_ADDRESS = "0x565d490806a6d8ef532f4d29ec00ef6aac71a17a"; // replace with recipient
const AMOUNT_WEI = 1_000_000_000_000_000n; // 0.001 BNB

// BSC testnet RPC
const BSC_TESTNET_RPC = "https://data-seed-prebsc-1-s1.binance.org:8545";
const CHAIN_ID = 97; // BSC testnet

async function main() {
  // ----------------------------------------------------------------
  // Step 1: Create provider from env and resolve the active wallet
  // ----------------------------------------------------------------
  const provider = resolveWalletProvider({ network: "eip155:97" });

  // ----------------------------------------------------------------
  // Step 2: Get wallet instance
  // ----------------------------------------------------------------
  const wallet = await provider.getActiveWallet();
  const address = await wallet.getAddress();
  console.log(`Address:      ${address}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 3: Sign a message (pure local, no network)
  // ----------------------------------------------------------------
  const message = Buffer.from("Hello from agent-wallet on BSC!");
  const msgSig = await wallet.signMessage(message);
  console.log(`Message signature: ${msgSig}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 4: Build tx, sign with SDK, and broadcast
  //
  // For EVM chains, signTransaction accepts a standard tx dict with
  // fields like to, value, gas, gasPrice, nonce, chainId.
  // The caller is responsible for fetching nonce & gas prices from RPC.
  // ----------------------------------------------------------------
  console.log(`Signing BNB transfer: ${AMOUNT_WEI} wei -> ${TO_ADDRESS}`);
  console.log(`Network: BSC testnet (chainId=${CHAIN_ID})`);
  console.log();

  // 5a. Get nonce
  const nonce = await ethGetNonce(address);
  console.log(`Nonce: ${nonce}`);

  // 5b. Get gas price
  const gasPrice = await ethGetGasPrice();
  console.log(`Gas price: ${gasPrice}`);

  // 5c. Build unsigned tx
  const tx = {
    to: TO_ADDRESS as `0x${string}`,
    value: AMOUNT_WEI,
    gas: 21000n,
    gasPrice,
    nonce,
    chainId: CHAIN_ID,
    type: "legacy" as const,
  };

  // 5d. Sign with agent-wallet SDK
  const signedRawHex = await wallet.signTransaction(tx as unknown as Record<string, unknown>);
  console.log(`Signed raw tx: 0x${signedRawHex.slice(0, 40)}...`);
  console.log();

  // 5e. Broadcast
  console.log("Broadcasting...");
  const txHash = await ethSendRawTransaction(signedRawHex);
  console.log(`Broadcasted! tx hash: ${txHash}`);
  console.log(`Explorer: https://testnet.bscscan.com/tx/${txHash}`);
}

// --- Helper functions (caller's responsibility, NOT part of SDK) ---

async function ethRpc(method: string, params: unknown[]): Promise<Record<string, unknown>> {
  const res = await fetch(BSC_TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) {
    throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
  }
  return data;
}

async function ethGetNonce(address: string): Promise<number> {
  const data = await ethRpc("eth_getTransactionCount", [address, "pending"]);
  return Number(data.result);
}

async function ethGetGasPrice(): Promise<bigint> {
  const data = await ethRpc("eth_gasPrice", []);
  return BigInt(data.result as string);
}

async function ethSendRawTransaction(signedRawHex: string): Promise<string> {
  const raw = signedRawHex.startsWith("0x") ? signedRawHex : `0x${signedRawHex}`;
  const data = await ethRpc("eth_sendRawTransaction", [raw]);
  return data.result as string;
}

main().catch(console.error);
