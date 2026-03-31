# Privy Adapter Design Options

This document compares three design options for supporting Privy with EVM and TRON, evaluated across:
1) future extensibility, 2) design elegance, and 3) compatibility with current architecture.

## Option A: Config-Centric, Static Wallet IDs

**Summary**
- Store Privy wallet IDs in `wallets_config.json` (e.g., `privy_wallet_id_evm`, `privy_wallet_id_tron`).
- Adapter resolves IDs from config/env only; no CLI override.
- EVM uses RPC methods; TRON uses `raw_sign` if enabled.

**Extensibility**
- Medium: adding new chains requires new config keys and schema updates.
- Good for stable, long-lived deployments; less flexible for ephemeral wallets.

**Design Elegance**
- High: single source of truth, minimal runtime flags.
- Clear separation between config resolution and signing behavior.

**Compatibility**
- High: aligns with existing config-driven wallet selection.
- Minimal change to current CLI patterns beyond adding fields.

**Risks / Tradeoffs**
- Requires config edits for every wallet change.
- Less suitable if operators need frequent per-command wallet switching.

## Option B: Runtime Flag Override (Hybrid)

**Summary**
- Keep default wallet IDs in config/env.
- Allow CLI/SDK override (e.g., `--privy-wallet-id` or per-chain override flags).
- Adapter accepts an optional runtime wallet ID to override resolved config.

**Extensibility**
- High: supports new chains without forcing schema changes for every use case.
- Friendly to future features like session-based or per-request wallet routing.

**Design Elegance**
- Medium: introduces branching in resolution (config vs runtime override).
- Still clean if override is isolated to a single resolution layer.

**Compatibility**
- High: preserves current config behavior; adds optional override.
- Requires minimal CLI/SDK surface changes.

**Risks / Tradeoffs**
- More paths to test (config only, env only, override).
- Risk of inconsistent behavior if override rules are not explicit.

## Option C: Chain-Aware Wallet Profiles

**Summary**
- Introduce a chain-aware structure in config:
  - Example: `privy_wallet_ids: { evm: "...", tron: "..." }`
- Resolver selects wallet ID by chain type; CLI can still override per chain.

**Extensibility**
- Very High: scales to multiple chains and wallet types cleanly.
- Enables future chain-specific settings (timeouts, RPC features, auth).

**Design Elegance**
- High: models the real world (wallets vary by chain).
- Reduces ad-hoc flags; encourages structured config.

**Compatibility**
- Medium: requires a config schema change and migration logic.
- Might require updates across Python/TypeScript schemas and tests.

**Risks / Tradeoffs**
- Higher upfront change cost.
- Needs backward compatibility handling for existing configs.

## Recommendation

**Recommend Option B (Hybrid)** for the next iteration.

**Why**
- Balances extensibility with minimal disruption.
- Maintains compatibility with current architecture while enabling per-command overrides.
- Provides a clean bridge to Option C later if multi-chain expansion grows.

**Suggested Next Step**
- Implement Option B now, and add a clear roadmap note: “If more non-EVM chains are added, migrate to Option C with a structured, chain-aware config block.”
