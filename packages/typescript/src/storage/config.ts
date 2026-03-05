import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Current config schema version.  Bump this when the schema changes and
 * add a corresponding migration function in MIGRATIONS.
 */
export const CURRENT_CONFIG_VERSION = 1;

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
  config_version: z.number().int().default(CURRENT_CONFIG_VERSION),
  wallets: z.record(z.string(), WalletConfigSchema),
});

export type WalletsTopology = z.infer<typeof WalletsTopologySchema>;

export interface WalletInfo {
  id: string;
  type: string;
  chain_id?: string;
}

// ---------------------------------------------------------------------------
// Migration functions
// ---------------------------------------------------------------------------
// Each function takes the raw object (as parsed from JSON) and returns the
// mutated object at the next version.

type MigrationFn = (data: Record<string, unknown>) => Record<string, unknown>;

function migrateV0ToV1(data: Record<string, unknown>): Record<string, unknown> {
  // v0 (no config_version field) → v1.
  // Adds config_version.  No schema changes.
  data.config_version = 1;
  return data;
}

/**
 * Ordered list of migrations.  Index `i` migrates from version `i` to `i+1`.
 * When you add a new version, append the function here AND bump
 * CURRENT_CONFIG_VERSION.
 */
const MIGRATIONS: MigrationFn[] = [migrateV0ToV1];

/**
 * Apply all pending migrations to `data` (in-place) and return it.
 * Idempotent: calling on an already-current config is a no-op.
 */
export function migrateConfig(
  data: Record<string, unknown>,
): Record<string, unknown> {
  let version =
    typeof data.config_version === "number" ? data.config_version : 0;

  if (version > CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version ${version} is newer than supported ` +
        `(${CURRENT_CONFIG_VERSION}). Please upgrade agent-wallet.`,
    );
  }

  while (version < CURRENT_CONFIG_VERSION) {
    data = MIGRATIONS[version](data);
    version =
      typeof data.config_version === "number"
        ? data.config_version
        : version + 1;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadConfig(secretsDir: string): WalletsTopology {
  const path = join(secretsDir, "wallets_config.json");
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Config not found: ${path}`);
  }

  const data = JSON.parse(text) as Record<string, unknown>;
  const oldVersion =
    typeof data.config_version === "number" ? data.config_version : 0;

  const migrated = migrateConfig(data);
  const topology = WalletsTopologySchema.parse(migrated);

  // Persist the migrated config so future loads are instant.
  if (oldVersion < CURRENT_CONFIG_VERSION) {
    writeConfig(path, topology);
  }

  return topology;
}

export function saveConfig(
  secretsDir: string,
  config: WalletsTopology,
): void {
  config.config_version = CURRENT_CONFIG_VERSION;
  const path = join(secretsDir, "wallets_config.json");
  writeConfig(path, config);
}

function writeConfig(path: string, config: WalletsTopology): void {
  const data = stripUndefined(config);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function stripUndefined(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      obj as Record<string, unknown>,
    )) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }
    return result;
  }
  return obj;
}
