/**
 * Demo: Sign a TRON transaction and broadcast it using agent-wallet SDK.
 *
 * This example shows how mcp-server-tron (or any other integration) can use
 * the agent-wallet SDK to:
 *   1. Initialize a LocalWalletProvider (decrypt keys once)
 *   2. Get a wallet by ID
 *   3. Sign a message (pure local, no network)
 *   4. Build an unsigned tx via TronGrid, sign it with the SDK, and broadcast
 *
 * The SDK is signing-only. The caller is responsible for building transactions
 * (via TronGrid / TronWeb) and broadcasting them.
 *
 * Prerequisites:
 *   - agent-wallet init (create secrets dir + master password)
 *   - agent-wallet add  (add a tron_local wallet, e.g. "wallet-b")
 *   - The wallet address must be activated (have received TRX at least once)
 *
 * Usage:
 *   AGENT_WALLET_PASSWORD=<your-password> npx tsx examples/tron-sign-and-broadcast.ts
 */

import { WalletFactory } from "../src/index.js";

// --- Configuration ---

const SECRETS_DIR =
  process.env.AGENT_WALLET_DIR ?? `${process.env.HOME}/.agent-wallet`;
const PASSWORD = process.env.AGENT_WALLET_PASSWORD ?? "";
const WALLET_ID = "wallet-b";

// Transfer parameters
const TO_ADDRESS = "TVDGpn4hCSzJ5nkHPLetk8KQBtwaTppnkr";
const AMOUNT_SUN = 1_000_000; // 1 TRX = 1,000,000 SUN

// TronGrid endpoints by network
const TRONGRID_URLS: Record<string, string> = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
  shasta: "https://api.shasta.trongrid.io",
};

async function main() {
  // ----------------------------------------------------------------
  // Step 1: Create provider (decrypts all keys, then discards password)
  // ----------------------------------------------------------------
  const provider = WalletFactory({ secretsDir: SECRETS_DIR, password: PASSWORD });

  // ----------------------------------------------------------------
  // Step 2: List wallets (optional — shows what's available)
  // ----------------------------------------------------------------
  const wallets = await provider.listWallets();
  console.log("Available wallets:");
  for (const w of wallets) {
    console.log(`  - ${w.id} (${w.type}, ${w.chain_id})`);
  }
  console.log();

  // ----------------------------------------------------------------
  // Step 3: Get wallet instance
  // ----------------------------------------------------------------
  const wallet = await provider.getWallet(WALLET_ID);
  const address = await wallet.getAddress();
  console.log(`Using wallet: ${WALLET_ID}`);
  console.log(`Address:      ${address}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 4: Sign a message (pure local, no network)
  // ----------------------------------------------------------------
  const message = Buffer.from("Hello from agent-wallet!");
  const msgSig = await wallet.signMessage(message);
  console.log(`Message signature: ${msgSig}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 5: Build unsigned tx via TronGrid, then sign with SDK
  //
  // The caller builds the transaction using TronGrid's REST API.
  // The SDK only signs: it takes the unsigned tx { txID, raw_data_hex }
  // and returns a signed tx JSON with the signature attached.
  // ----------------------------------------------------------------
  const chainId =
    wallets.find((w) => w.id === WALLET_ID)?.chain_id ?? "tron:nile";
  const network = chainId.split(":").pop() ?? "nile";
  const baseUrl = TRONGRID_URLS[network] ?? TRONGRID_URLS["nile"];

  console.log(`Signing TRX transfer: ${AMOUNT_SUN} SUN -> ${TO_ADDRESS}`);
  console.log(`Network: ${chainId} (${baseUrl})`);

  // 5a. Caller builds unsigned tx via TronGrid
  const unsignedTx = await buildTrxTransfer(baseUrl, address, TO_ADDRESS, AMOUNT_SUN);
  console.log(`TX ID:     ${unsignedTx.txID}`);

  // 5b. SDK signs the unsigned tx
  const signedTxJson = await wallet.signTransaction(unsignedTx);
  const signedTx = JSON.parse(signedTxJson) as Record<string, unknown>;
  console.log(`Signature: ${(signedTx.signature as string[])[0]}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 6: Caller broadcasts the signed tx
  // ----------------------------------------------------------------
  console.log("Broadcasting...");
  const txid = await broadcastTransaction(signedTx, baseUrl);
  console.log(`Broadcasted! txid: ${txid}`);

  const explorerBase =
    network === "mainnet"
      ? "https://tronscan.org"
      : `https://${network}.tronscan.org`;
  console.log(`Explorer:   ${explorerBase}/#/transaction/${txid}`);
}

// --- Helper functions (caller's responsibility, NOT part of SDK) ---

async function buildTrxTransfer(
  baseUrl: string,
  from: string,
  to: string,
  amountSun: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/wallet/createtransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner_address: from,
      to_address: to,
      amount: amountSun,
      visible: true,
    }),
  });
  const tx = (await res.json()) as Record<string, unknown>;
  if (!tx.txID) {
    throw new Error(`Failed to build transaction: ${JSON.stringify(tx)}`);
  }
  return tx;
}

async function broadcastTransaction(
  signedTx: Record<string, unknown>,
  baseUrl: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/wallet/broadcasttransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedTx),
  });
  const result = (await res.json()) as Record<string, unknown>;
  if (result.result) {
    return (result.txid as string) ?? (signedTx.txID as string) ?? "";
  }
  throw new Error(`Broadcast rejected: ${JSON.stringify(result)}`);
}

main().catch(console.error);
