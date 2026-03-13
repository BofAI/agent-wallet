/**
 * Demo: Switch active wallet via the agent-wallet SDK.
 *
 * This example shows how to use the active wallet feature programmatically:
 *   1. Initialize a LocalWalletProvider
 *   2. List all wallets and show which one is active
 *   3. Switch the active wallet
 *   4. Sign a message using the active wallet (no wallet ID needed)
 *
 * Prerequisites:
 *   - agent-wallet init
 *   - agent-wallet add  (add at least two wallets)
 *
 * Usage:
 *   AGENT_WALLET_PASSWORD=<your-password> npx tsx examples/switch-active-wallet.ts
 */

import { LocalWalletProvider } from "../src/index.js";

// --- Configuration ---

const SECRETS_DIR =
  process.env.AGENT_WALLET_DIR ?? `${process.env.HOME}/.agent-wallet`;
const PASSWORD = process.env.AGENT_WALLET_PASSWORD ?? "";

async function main() {
  // ----------------------------------------------------------------
  // Step 1: Create provider (decrypts all keys, then discards password)
  // ----------------------------------------------------------------
  const provider = new LocalWalletProvider(SECRETS_DIR, PASSWORD);

  // ----------------------------------------------------------------
  // Step 2: List wallets and show current active wallet
  // ----------------------------------------------------------------
  const wallets = await provider.listWallets();
  const activeId = provider.getActiveId();

  console.log("Available wallets:");
  for (const w of wallets) {
    const marker = w.id === activeId ? " *" : "";
    console.log(`  - ${w.id} (${w.type})${marker}`);
  }
  console.log(`\nActive wallet: ${activeId ?? "(none)"}`);
  console.log();

  // ----------------------------------------------------------------
  // Step 3: Sign a message using the active wallet (no ID needed)
  // ----------------------------------------------------------------
  if (activeId) {
    const wallet = await provider.getActiveWallet();
    const address = await wallet.getAddress();
    const sig = await wallet.signMessage(Buffer.from("Hello from active wallet!"));
    console.log(`Signed with active wallet '${activeId}':`);
    console.log(`  Address:   ${address}`);
    console.log(`  Signature: ${sig}`);
    console.log();
  }

  // ----------------------------------------------------------------
  // Step 4: Switch active wallet
  // ----------------------------------------------------------------
  if (wallets.length < 2) {
    console.log("Add at least 2 wallets to demo switching.");
    return;
  }

  // Pick a wallet that is NOT the current active one
  const newActive = wallets.find((w) => w.id !== activeId)!.id;
  provider.setActive(newActive);
  console.log(`Switched active wallet to '${newActive}'`);
  console.log();

  // ----------------------------------------------------------------
  // Step 5: Sign again with the new active wallet
  // ----------------------------------------------------------------
  const wallet = await provider.getActiveWallet();
  const address = await wallet.getAddress();
  const sig = await wallet.signMessage(Buffer.from("Hello from active wallet!"));
  console.log(`Signed with new active wallet '${newActive}':`);
  console.log(`  Address:   ${address}`);
  console.log(`  Signature: ${sig}`);
}

main().catch(console.error);
