# Project Structure

## Organization Philosophy

This project is package-oriented and layered by responsibility. The TypeScript implementation follows the conventions of its ecosystem while keeping signing logic separate from CLI interaction.

## Directory Patterns

### TypeScript package
**Location**: `/packages/typescript/`  
**Purpose**: TypeScript SDK and CLI implementation  
**Example**: `src/core/`, `src/delivery/`, `tests/`

### Core domain logic
**Location**: `/packages/typescript/src/**/core/`  
**Purpose**: Wallet abstractions, provider resolution, adapters, signer logic, and product-level business behavior  
**Example**: wallet interfaces, provider classes, network routing, adapter implementations

### Delivery layer
**Location**: `/packages/typescript/src/**/delivery/`  
**Purpose**: CLI-facing entry points and user interaction logic  
**Example**: command parsing, console output, interactive prompts

### Documentation
**Location**: `/doc/`  
**Purpose**: User-facing guides and process documentation  
**Example**: getting started, cc-sdd practice notes

## Naming Conventions

- **Files**: follow existing TypeScript file naming conventions in the package
- **Classes**: PascalCase
- **Functions**: camelCase
- **Feature specs**: kebab-case under `.kiro/specs/<feature-name>/`

## Import Organization

- Prefer package-local import patterns that match existing code style
- Do not introduce new alias systems unless the package already uses them
- Preserve existing public package entrypoints

## Code Organization Principles

- Keep signing logic separate from CLI interaction
- Keep provider resolution separate from adapter implementation
- 外部簽名器的共用 credential 正規化位於 `core/secret-resolver.ts`；wallet-cli 的 one-shot secret lifecycle 位於 `core/secret-provider.ts`；`local_secure` 與自有加密 KV 已移除
- Cross-platform filesystem behavior must be explicit and tested when changed
- Do not mix transaction broadcasting or RPC orchestration into the core wallet path; keep protocol-specific orchestration under explicit optional integrations
