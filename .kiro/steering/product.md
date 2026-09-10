# Product Overview

agent-wallet is a multi-chain signing toolkit for AI agents and applications. It provides a consistent way to configure or link wallets, resolve an active wallet, and sign transactions and typed data across TRON and EVM networks.

## Core Capabilities

- Plaintext local wallet setup for development and external signer integration for production
- Wallet resolution through config-backed and environment-backed providers
- Signing support for TRON and EVM networks
- CLI workflows for wallet setup, switching, and signing
- SDK usage in TypeScript

## Target Use Cases

- AI agents or MCP servers that need signing without exposing private keys in prompts
- Local applications that need a reusable wallet abstraction for TRON and EVM
- Tooling that wants a shared wallet resolution model across CLI and SDK environments

## Value Proposition

The core package focuses on wallet resolution and signing. Optional integrations may orchestrate protocol-specific transaction building and broadcasting without expanding the core wallet contract. This keeps the signing boundary narrow, safer to integrate, and easier to reason about in agent-driven workflows.
