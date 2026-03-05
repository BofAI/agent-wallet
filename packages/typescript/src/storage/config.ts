import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const WalletConfigSchema = z.object({
  type: z.enum(["evm_local", "tron_local"]),
  address: z.string().optional(),
  identity_file: z.string().optional(),
  cred_file: z.string().optional(),
  chain_id: z.string().optional(),
  wallet_id: z.string().optional(),
  remote_url: z.string().optional(),
});

export type WalletConfig = z.infer<typeof WalletConfigSchema>;

const WalletsTopologySchema = z.object({
  wallets: z.record(z.string(), WalletConfigSchema),
});

export type WalletsTopology = z.infer<typeof WalletsTopologySchema>;

export interface WalletInfo {
  id: string;
  type: string;
  chain_id?: string;
}

export function loadConfig(secretsDir: string): WalletsTopology {
  const path = join(secretsDir, "wallets_config.json");
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Config not found: ${path}`);
  }
  const data = JSON.parse(text);
  return WalletsTopologySchema.parse(data);
}

export function saveConfig(
  secretsDir: string,
  config: WalletsTopology,
): void {
  const path = join(secretsDir, "wallets_config.json");
  const data = stripUndefined(config);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function stripUndefined(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }
    return result;
  }
  return obj;
}
