# Product Overview

agent-wallet is a multi-chain signing toolkit for AI agents and applications. It provides a consistent way to create or import wallets, resolve an active wallet, and sign transactions, messages, and typed data across TRON and EVM networks.

## Core Capabilities

- Secure local wallet setup with encrypted and plaintext development modes
- Wallet resolution through config-backed and environment-backed providers
- Signing support for TRON and EVM networks
- CLI workflows for wallet setup, switching, and signing
- SDK usage in both Python and TypeScript

## Target Use Cases

- AI agents or MCP servers that need signing without exposing private keys in prompts
- Local applications that need a reusable wallet abstraction for TRON and EVM
- Tooling that wants a shared wallet resolution model across CLI and SDK environments

## Value Proposition

The project focuses on wallet resolution and signing only. It does not build or broadcast transactions. This keeps the library narrow, safer to integrate, and easier to reason about in agent-driven workflows.
