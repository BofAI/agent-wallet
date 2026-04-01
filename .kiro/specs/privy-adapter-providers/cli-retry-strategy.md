# CLI Retry Strategy

## Purpose

This document defines a single retry policy for interactive CLI input across the Python and TypeScript implementations.

The goal is to remove ad-hoc differences between the two CLIs and make retry behavior predictable for users and implementers.

## Core Rule

CLI retry behavior is based on the **type of input**, not on the command name.

There are three categories:

1. Security-sensitive verification
2. User-correctable interactive input
3. Non-interactive or explicit input errors

## 1. Security-sensitive verification

These inputs must have a bounded retry count because repeated failure may indicate the wrong secret or an unsafe unlock flow.

### Applies to

- Existing master password verification for `local_secure`
- Any future authorization challenge where the user is proving possession of an existing secret

### Policy

- Interactive input: allow **up to 3 total attempts**
- Explicit input (`--password`, env vars, runtime secrets): **fail immediately**
- On final failure: exit with a clear error

### Why

- This is a verification flow, not a form entry flow
- Bounded retries are safer and more predictable
- Explicit inputs should not silently re-prompt because they are usually automation inputs

## 2. User-correctable interactive input

These are normal form-like inputs where the user can fix the value immediately.

### Applies to

- New master password entry
- New master password confirmation
- Wallet ID entry
- Privy app ID / app secret / wallet ID entry
- Private key / mnemonic entry
- Account index entry
- Any future interactive required field where the user is composing new input rather than proving an existing secret

### Policy

- Interactive input: **retry until valid or cancelled by the user**
- Validation errors should be explained inline
- The CLI should re-prompt instead of exiting on the first mistake
- Empty input counts as invalid only when the field has no default value and no explicit empty-input behavior

### Examples

- Password too weak -> show requirements and ask again
- Password confirmation mismatch -> ask again
- Wallet ID already exists -> ask for another ID
- Empty required field -> ask again
- Invalid mnemonic index format -> explain and ask again

### Why

- These are fixable user entry mistakes, not security verification failures
- Exiting on the first invalid input creates a poor interactive experience
- This matches user expectations for CLI setup flows

## 3. Non-interactive or explicit input errors

These are inputs that come from flags, env vars, runtime secrets, or non-TTY execution where the CLI cannot safely continue by prompting.

### Applies to

- Missing required values in non-interactive mode
- Invalid explicit flag values
- Wrong password supplied via `--password`
- Invalid env-provided configuration

### Policy

- **Fail immediately**
- Print a clear explanation of what is missing or invalid
- Suggest the required flag or env variable when possible

### Why

- Non-interactive execution must be deterministic
- Silent fallback to prompts breaks scripts and automation
- Explicit inputs should be treated as authoritative

## Consistency Requirements

The Python and TypeScript CLIs must follow the same policy:

- Existing secret verification -> 3 attempts max in interactive mode
- New or correctable form input -> unlimited retries in interactive mode
- Explicit / non-interactive input -> immediate failure

Differences in framework or prompt library are acceptable. Differences in user-visible behavior are not.

## Implementation Guidance

### Python

- Replace one-shot exits in interactive new-password and required-field flows with loops
- Keep existing verified-password logic capped at 3 attempts

### TypeScript

- Keep the existing loop for new password entry
- Verify all required-field prompts follow the same retry policy
- Keep existing verified-password logic capped at 3 attempts

## Testing Expectations

Both CLIs should have coverage for:

- Wrong existing password three times -> exit
- Weak new password -> re-prompt
- Password confirmation mismatch -> re-prompt
- Duplicate wallet ID -> re-prompt
- Empty required field in interactive mode -> re-prompt
- Missing required field in non-interactive mode -> immediate failure

## Scope Note

This policy is about **retry behavior only**. It does not redefine wallet semantics, provider behavior, or security model.
