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

### Local secure storage
**Location**: `/packages/typescript/src/**/local/`  
**Purpose**: Storage and persistence logic that specifically supports `local_secure` wallets  
**Example**: encrypted secret files, secure KV storage, local secure read/write helpers

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
- The `local/` layer is reserved for `local_secure` storage concerns, not general provider resolution or unrelated filesystem helpers
- Cross-platform filesystem behavior must be explicit and tested when changed
- Do not mix transaction broadcasting or RPC orchestration into this project; this project signs only
