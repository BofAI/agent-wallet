# Requirements Document

## Introduction
This specification defines requirements for integrating a Privy adapter into agent-wallet and supporting multiple configuration sources (config provider and env provider), focusing on verifiable behaviors and configuration resolution.

## Requirements

### Requirement 1: Privy adapter integration
**Objective:** As an integrator, I want to enable a Privy adapter in agent-wallet, so that wallet-related capabilities can be connected through Privy.

#### Acceptance Criteria
1. When a user or system selects the Privy adapter, the agent-wallet system shall register the Privy adapter as an available provider.
2. While the Privy adapter is enabled, the agent-wallet system shall initialize the Privy adapter with resolved configuration values.
3. If Privy adapter initialization fails, the agent-wallet system shall report a distinguishable error state.
4. The agent-wallet system shall provide a verifiable way to confirm whether the Privy adapter is enabled.

### Requirement 2: Configuration sources and providers
**Objective:** As an operator, I want to support both config provider and env provider, so that settings such as API_KEY can be supplied from multiple sources.

#### Acceptance Criteria
1. The agent-wallet system shall support retrieving configuration values from a config provider.
2. The agent-wallet system shall support retrieving configuration values from an env provider. -> remove, only support private key & mnemonic 
3. When the same configuration key exists in both config provider and env provider, the agent-wallet system shall resolve the final value by a clearly defined precedence order.
4. If a required configuration key is missing from all providers, the agent-wallet system shall report the missing information and refuse to enable the related feature.

### Requirement 3: Configuration keys and validation
**Objective:** As an operator, I want clear configuration key validation rules, so that misconfigurations are detected early.

#### Acceptance Criteria
1. The agent-wallet system shall define the minimal required configuration keys for the Privy adapter (for example, API_KEY).
2. When enabling the Privy adapter, the agent-wallet system shall validate that all required configuration keys are resolved.
3. If any required configuration key has an invalid format, the agent-wallet system shall report the specific validation failure reason.

### Requirement 4: Observability and security
**Objective:** As an operator, I want clear status signals and safe outputs, so that troubleshooting is possible without leaking sensitive data.

#### Acceptance Criteria
1. The agent-wallet system shall emit information that allows tracking the Privy adapter enable/disable status.
2. If configuration resolution or validation fails, the agent-wallet system shall record the corresponding failure reason.
3. The agent-wallet system shall avoid exposing full sensitive configuration values (for example, API_KEY) in any output.
