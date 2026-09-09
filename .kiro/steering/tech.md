# Technology Stack

## Architecture

The project is a TypeScript SDK and CLI codebase. Core responsibilities are wallet resolution, signing adapters, external signer integration, and CLI interaction.

## Core Technologies

- **Language**: TypeScript 5.x
- **Runtime**: Node.js 18+
- **Package Layout**: Single TypeScript package under `packages/typescript/`

## Key Libraries

These are the primary libraries currently shaping implementation patterns in this repository.

- **TypeScript**: viem, zod, tronweb, inquirer-style prompts, vitest, tsup

These libraries describe the current center of gravity of the codebase, not a locked whitelist. New dependencies may be introduced when they provide clear value, reduce maintenance burden, or are required by a supported integration.

## Development Standards

### Type Safety

- TypeScript should maintain explicit typing and avoid `any`
- Public wallet and provider contracts should stay stable and well-typed

### Code Quality

- TypeScript uses TypeScript compiler checks, ESLint, Prettier-compatible formatting, and vitest
- Keep changes focused; avoid broad refactors unless required by the spec

### Testing

- New product behavior should be covered in the package it affects
- Cross-platform behavior, especially filesystem and path handling, should be tested explicitly when changed

### Post-Change Verification (Required)

After completing development work, the following checks must pass before declaring the change done:

- TypeScript: `pnpm test`, `pnpm lint`, `pnpm build`

If a check is not run, explicitly state why and provide a follow-up plan.

## Development Environment

### Required Tools

- Node.js `^20.19.0 || ^22.13.0 || >=24` for repository development; the published runtime contract remains Node.js 18+
- pnpm

### Common Commands

```bash
# TypeScript
cd packages/typescript && pnpm test
cd packages/typescript && pnpm lint
cd packages/typescript && pnpm build
```

## Dependency Decision Rules

- Prefer existing libraries when they already solve the problem cleanly
- New dependencies are allowed when justified by feature scope, maintainability, ecosystem fit, or official integration support
- Avoid adding thin wrapper packages when the same capability can be implemented clearly with current dependencies
- Evaluate new dependencies for maintenance risk, API stability, security posture, and package impact
- Do not introduce a new dependency for a product-level feature unless it genuinely requires a different implementation strategy

## Key Technical Decisions

- The project supports both config-backed and env-backed wallet resolution
- Every supplied signing network uses an exact canonical CAIP-2 identifier. Supported forms are
  `eip155:<positive decimal chainId>` and `tron:<positive decimal chainId>` with at most 32
  reference characters. Do not trim, case-fold, accept aliases/bare families, or rewrite namespaces.
  A network may remain omitted only where the adapter contract already supports omission (currently
  Privy); once supplied, the same validation applies to every provider and adapter.
- External signers are preferred for production workflows; plaintext config and env-based resolution are development fallbacks
- The core package signs data only; optional protocol integrations may orchestrate transaction building and broadcasting
- Features touching providers, adapters, config resolution, or CLI behavior should be scoped to the TypeScript package
