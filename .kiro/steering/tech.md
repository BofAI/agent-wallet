# Technology Stack

## Architecture

The project is a dual-package SDK and CLI codebase with parallel Python and TypeScript implementations. Core responsibilities are wallet resolution, signing adapters, local secure storage, and CLI interaction.

## Core Technologies

- **Languages**: Python 3.11+, TypeScript 5.x
- **Python Runtime**: Python CLI and SDK package
- **TypeScript Runtime**: Node.js 18+
- **Package Layout**: Monorepo with separate Python and TypeScript packages

## Key Libraries

These are the primary libraries currently shaping implementation patterns in this repository.

- **Python**: typer, rich, questionary, pydantic, eth-account, tronpy
- **TypeScript**: viem, zod, tronweb, inquirer-style prompts, vitest, tsup

These libraries describe the current center of gravity of the codebase, not a locked whitelist. New dependencies may be introduced when they provide clear value, reduce maintenance burden, or are required by a supported integration.

## Development Standards

### Type Safety

- Python code should use type hints for public and non-trivial internal functions
- TypeScript should maintain explicit typing and avoid `any`
- Public wallet and provider contracts should stay aligned across Python and TypeScript where practical

### Code Quality

- Python uses Ruff and pytest
- TypeScript uses TypeScript compiler checks, ESLint, Prettier-compatible formatting, and vitest
- Keep changes focused; avoid broad refactors unless required by the spec

### Testing

- New product behavior should be covered in the package it affects
- When behavior is product-level, consider whether Python and TypeScript both need coverage
- Cross-platform behavior, especially filesystem and path handling, should be tested explicitly when changed

### Post-Change Verification (Required)

After completing development work, the following checks must pass before declaring the change done:

- TypeScript: `pnpm test`, `pnpm lint`, `pnpm build`
- Python: `pytest`, `ruff check src tests examples`

If a check is not run, explicitly state why and provide a follow-up plan.

## Development Environment

### Required Tools

- Python 3.11+
- Node.js 18+
- pnpm
- pytest
- Ruff

### Common Commands

```bash
# Python
cd packages/python && pytest
cd packages/python && ruff check src tests examples

# TypeScript
cd packages/typescript && pnpm test
cd packages/typescript && pnpm lint
cd packages/typescript && pnpm build
```

## Dependency Decision Rules

- Prefer existing libraries when they already solve the problem cleanly
- New dependencies are allowed when justified by feature scope, maintainability, ecosystem fit, or official integration support
- Avoid adding thin wrapper packages when the same capability can be implemented clearly with current dependencies
- Evaluate new dependencies for maintenance risk, API stability, security posture, and cross-package impact
- Do not introduce a new dependency in only one package for a product-level feature unless the ecosystems genuinely require different implementation strategies

## Key Technical Decisions

- The project supports both config-backed and env-backed wallet resolution
- Secure local storage is preferred for user workflows; env-based resolution is the fallback
- Python and TypeScript should expose comparable product behavior even if internal implementation differs
- This project signs data only and intentionally does not own transaction broadcasting
- Features touching providers, adapters, config resolution, or CLI behavior should consider both packages unless the scope is explicitly package-specific
