# Project Structure

## Organization Philosophy

This project is package-oriented and layered by responsibility. Python and TypeScript implementations should mirror the same product behaviors where practical, while still following the conventions of their own ecosystems.

## Directory Patterns

### Python package
**Location**: `/packages/python/`  
**Purpose**: Python SDK and CLI implementation  
**Example**: `src/agent_wallet/core/`, `src/agent_wallet/delivery/`, `tests/`

### TypeScript package
**Location**: `/packages/typescript/`  
**Purpose**: TypeScript SDK and CLI implementation  
**Example**: `src/core/`, `src/delivery/`, `tests/`

### Core domain logic
**Location**: `/packages/*/src/**/core/`  
**Purpose**: Wallet abstractions, provider resolution, adapters, signer logic, and product-level business behavior  
**Example**: wallet interfaces, provider classes, network routing, adapter implementations

### Delivery layer
**Location**: `/packages/*/src/**/delivery/`  
**Purpose**: CLI-facing entry points and user interaction logic  
**Example**: command parsing, console output, interactive prompts

### Local secure storage
**Location**: `/packages/*/src/**/local/`  
**Purpose**: Storage and persistence logic that specifically supports `local_secure` wallets  
**Example**: encrypted secret files, secure KV storage, local secure read/write helpers

### Documentation
**Location**: `/doc/`  
**Purpose**: User-facing guides and process documentation  
**Example**: getting started, cc-sdd practice notes

## Naming Conventions

- **Files**: `snake_case.py` in Python; follow existing TypeScript file naming conventions in each package
- **Classes**: PascalCase
- **Functions**: `snake_case` in Python, `camelCase` in TypeScript
- **Feature specs**: kebab-case under `.kiro/specs/<feature-name>/`

## Import Organization

- Prefer package-local import patterns that match existing code style
- Do not introduce new alias systems unless the package already uses them
- Preserve existing public package entrypoints

## Code Organization Principles

- Keep signing logic separate from CLI interaction
- Keep provider resolution separate from adapter implementation
- The `local/` layer is reserved for `local_secure` storage concerns, not general provider resolution or unrelated filesystem helpers
- Prefer matching behavior across Python and TypeScript when the feature is product-level rather than ecosystem-specific
- Cross-platform filesystem behavior must be explicit and tested when changed
- Do not mix transaction broadcasting or RPC orchestration into this project; this project signs only
