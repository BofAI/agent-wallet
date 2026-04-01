/**
 * Verify TRON Privy signTypedData by recovering the TRON address
 * from the signature and comparing to the active wallet address.
 *
 * Usage:
 *   AGENT_WALLET_DIR=/tmp/test-wallet \
 *   AGENT_WALLET_PASSWORD='Abc12345!@' \
 *   npx tsx examples/verify-tron-privy-typed-data.ts
 */

import { resolveWalletProvider, ConfigWalletProvider } from "../src/index.js";
import { hashTypedData, keccak256 } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import bs58checkModule from "bs58check";

const DIR = process.env.AGENT_WALLET_DIR ?? "/tmp/test-wallet";
const PASSWORD = process.env.AGENT_WALLET_PASSWORD ?? "";
const NETWORK = process.env.AGENT_WALLET_NETWORK ?? "tron";

const bs58check =
  typeof (bs58checkModule as { encode?: unknown }).encode === "function"
    ? (bs58checkModule as typeof import("bs58check"))
    : ((bs58checkModule as { default?: typeof import("bs58check") }).default ??
      (bs58checkModule as typeof import("bs58check")));

if (!PASSWORD) {
  throw new Error("AGENT_WALLET_PASSWORD is required to access local_secure wallets.");
}

const provider = resolveWalletProvider({ dir: DIR, network: NETWORK });
if (!(provider instanceof ConfigWalletProvider)) {
  throw new Error("Expected a config-backed provider. Check AGENT_WALLET_DIR.");
}

function stripHexPrefix(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function tronAddressFromPublicKey(pubkey: Uint8Array) {
  const uncompressed = pubkey[0] === 4 ? pubkey.slice(1) : pubkey;
  const hash = keccak256(uncompressed);
  const addrBytes = Buffer.from(hash.slice(2), "hex").slice(-20);
  const tronAddrBytes = Buffer.concat([Buffer.from([0x41]), addrBytes]);
  return bs58check.encode(tronAddrBytes);
}

function buildTypedData() {
  return {
    domain: {
      name: "AgentWallet",
      version: "1",
      chainId: 1,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      Message: [{ name: "contents", type: "string" }],
    },
    primaryType: "Message",
    message: {
      contents: "Hello",
    },
  };
}

function cloneTypedData(data: ReturnType<typeof buildTypedData>) {
  return JSON.parse(JSON.stringify(data)) as ReturnType<typeof buildTypedData>;
}

function hashTypedDataForTron(data: ReturnType<typeof buildTypedData>) {
  const { domain, types, primaryType, message } = data;
  if (!primaryType || !(primaryType in types)) {
    throw new Error(`primaryType must be a key in types: ${primaryType ?? "undefined"}`);
  }
  return hashTypedData({
    domain,
    types,
    primaryType,
    message,
  });
}

async function main() {
  const activeId = provider.getActiveId();
  if (!activeId) {
    throw new Error("No active wallet set.");
  }

  const wallet = await provider.getActiveWallet(NETWORK);
  const address = await wallet.getAddress();

  const typedData = buildTypedData();
  const signature = await wallet.signTypedData(cloneTypedData(typedData));
  const sigHex = stripHexPrefix(signature);
  const sigBytes = Buffer.from(sigHex, "hex");
  if (sigBytes.length !== 65) {
    throw new Error(`Expected 65-byte signature, got ${sigBytes.length}`);
  }
  const recovery = sigBytes[64] - 27;
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(`Invalid recovery id: ${sigBytes[64]}`);
  }

  const hashHex = hashTypedDataForTron(cloneTypedData(typedData));
  const hashBytes = Buffer.from(hashHex.slice(2), "hex");
  const sig = secp256k1.Signature.fromCompact(sigBytes.slice(0, 64)).addRecoveryBit(
    recovery,
  );
  const pub = sig.recoverPublicKey(hashBytes);
  const recovered = tronAddressFromPublicKey(pub.toRawBytes(false));

  console.log(`Active wallet: ${activeId}`);
  console.log(`Wallet address: ${address}`);
  console.log(`Recovered addr: ${recovered}`);
  console.log(`Signature: ${signature}`);
  console.log(`Verified: ${recovered === address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
