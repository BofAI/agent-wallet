# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

**Usage**:
- Log research activities and outcomes during the discovery phase.
- Document design decision trade-offs that are too detailed for `design.md`.
- Provide references and evidence for future audits or reuse.
---

## Summary
- **Feature**: `privy-adapter-providers`
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - Privy wallet RPC signing uses `POST https://api.privy.io/v1/wallets/{wallet_id}/rpc` with method-specific payloads such as `personal_sign`, `eth_signTransaction`, and `eth_signTypedData_v4`, and responses include `data.signature` or `data.signed_transaction`. citeturn1view1turn1view2turn1view0
  - Raw signing for non-EVM chains uses a dedicated endpoint `POST /v1/wallets/{wallet_id}/raw_sign`, which accepts either a pre-computed `hash` or `bytes` + `encoding` + `hash_function`. citeturn1view5
  - `GET /v1/wallets/{wallet_id}` returns wallet metadata including `address` and `chain_type`, and the documented chain types include `tron`. citeturn0view0

## Research Log

### RPC signing endpoints (EVM)
- **Context**: Map agent-wallet EVM signing methods to Privy RPC endpoints.
- **Sources Consulted**: `personal_sign`, `eth_signTransaction`, `eth_signTypedData_v4` API references. citeturn1view1turn1view2turn1view0
- **Findings**:
  - EVM signing is performed by `POST /v1/wallets/{wallet_id}/rpc` with `method` and `params`.
  - Responses return `data.signature` for message/typed data, or `data.signed_transaction` for transactions.
- **Implications**: Privy adapter should map `signMessage`, `signTypedData`, and `signTransaction` to these RPC methods with strict response validation.

### Raw signing endpoint (Other chains)
- **Context**: Determine how to support TRON via raw signing.
- **Sources Consulted**: `raw_sign` API reference. citeturn1view5turn1view4
- **Findings**:
  - Raw signing is a separate endpoint: `POST /v1/wallets/{wallet_id}/raw_sign`.
  - The API accepts either `hash` OR (`bytes`, `encoding`, `hash_function`) and returns a signature with `encoding`.
- **Implications**: TRON support must route through `/raw_sign`, not `/rpc`. Signature format compatibility must be verified experimentally.

### Wallet metadata and chain type
- **Context**: Verify how to detect chain type for a wallet ID.
- **Sources Consulted**: `GET /v1/wallets/{wallet_id}` API reference. citeturn0view0
- **Findings**:
  - `chain_type` is returned and documented to include `tron` among supported values.
- **Implications**: `getAddress` can cache address and optionally validate chain type for routing.

## Verification (curl-ready)

> Note: These commands are designed to be executed by the operator with real credentials. Do not paste secrets into chat logs.

### 1) Get wallet metadata (confirm chain type)
```bash
APP_ID="<privy-app-id>"
APP_SECRET="<privy-app-secret>"
WALLET_ID="<wallet-id>"
BASIC_AUTH=$(printf '%s:%s' "$APP_ID" "$APP_SECRET" | base64)

curl --request GET \
  --url "https://api.privy.io/v1/wallets/${WALLET_ID}" \
  --header "Authorization: Basic ${BASIC_AUTH}" \
  --header "privy-app-id: ${APP_ID}"
```
Expected fields: `address`, `chain_type`. citeturn0view0

### 2) EVM sign typed data (eth_signTypedData_v4)
```bash
APP_ID="<privy-app-id>"
APP_SECRET="<privy-app-secret>"
WALLET_ID="<wallet-id>"
BASIC_AUTH=$(printf '%s:%s' "$APP_ID" "$APP_SECRET" | base64)

curl --request POST \
  --url "https://api.privy.io/v1/wallets/${WALLET_ID}/rpc" \
  --header "Authorization: Basic ${BASIC_AUTH}" \
  --header "Content-Type: application/json" \
  --header "privy-app-id: ${APP_ID}" \
  --data '{
    "method": "eth_signTypedData_v4",
    "params": {
      "typed_data": {
        "types": {
          "EIP712Domain": [
            {"name":"name","type":"string"},
            {"name":"chainId","type":"uint256"},
            {"name":"verifyingContract","type":"address"}
          ],
          "Message": [
            {"name":"content","type":"string"}
          ]
        },
        "primary_type": "Message",
        "domain": {
          "name": "Test",
          "chainId": 1,
          "verifyingContract": "0x0000000000000000000000000000000000000000"
        },
        "message": {"content": "hello"}
      }
    }
  }'
```
Expected fields: `data.signature`, `data.encoding`. citeturn1view0

### 3) EVM sign message (personal_sign)
```bash
APP_ID="<privy-app-id>"
APP_SECRET="<privy-app-secret>"
WALLET_ID="<wallet-id>"
BASIC_AUTH=$(printf '%s:%s' "$APP_ID" "$APP_SECRET" | base64)

curl --request POST \
  --url "https://api.privy.io/v1/wallets/${WALLET_ID}/rpc" \
  --header "Authorization: Basic ${BASIC_AUTH}" \
  --header "Content-Type: application/json" \
  --header "privy-app-id: ${APP_ID}" \
  --data '{
    "method": "personal_sign",
    "params": {
      "message": "Hello from Privy!",
      "encoding": "utf-8"
    }
  }'
```
Expected fields: `data.signature`, `data.encoding`. citeturn1view1

### 4) EVM sign transaction (eth_signTransaction)
```bash
APP_ID="<privy-app-id>"
APP_SECRET="<privy-app-secret>"
WALLET_ID="<wallet-id>"
BASIC_AUTH=$(printf '%s:%s' "$APP_ID" "$APP_SECRET" | base64)

curl --request POST \
  --url "https://api.privy.io/v1/wallets/${WALLET_ID}/rpc" \
  --header "Authorization: Basic ${BASIC_AUTH}" \
  --header "Content-Type: application/json" \
  --header "privy-app-id: ${APP_ID}" \
  --data '{
    "method": "eth_signTransaction",
    "params": {
      "transaction": {
        "to": "0x0000000000000000000000000000000000000000",
        "value": "0x1",
        "chain_id": 1,
        "data": "0x",
        "gas_limit": 21000,
        "nonce": 0,
        "max_fee_per_gas": 1000000000,
        "max_priority_fee_per_gas": 1000000000
      }
    }
  }'
```
Expected fields: `data.signed_transaction`, `data.encoding`. citeturn1view2

### 5) TRON experiment: raw_sign
```bash
APP_ID="<privy-app-id>"
APP_SECRET="<privy-app-secret>"
WALLET_ID="<tron-wallet-id>"
BASIC_AUTH=$(printf '%s:%s' "$APP_ID" "$APP_SECRET" | base64)

# Option A: sign a pre-computed hash
curl --request POST \
  --url "https://api.privy.io/v1/wallets/${WALLET_ID}/raw_sign" \
  --header "Authorization: Basic ${BASIC_AUTH}" \
  --header "Content-Type: application/json" \
  --header "privy-app-id: ${APP_ID}" \
  --data '{
    "params": {
      "hash": "0x<sha256-of-tron-raw_data>"
    }
  }'
```
Expected fields: `data.signature`, `data.encoding`. citeturn1view4

## Verification Results (2026-03-26)

The following verification attempts were executed against the Privy API using the test credentials stored in `test-secrets.json`:

- `GET /v1/wallets/{wallet_id}` (EVM + TRON)
- `POST /v1/wallets/{wallet_id}/rpc` (`personal_sign`)
- `POST /v1/wallets/{wallet_id}/raw_sign` (zero hash)

**Result Summary**:
- EVM wallet metadata returned `chain_type: "ethereum"` and an EVM address.
- TRON wallet metadata returned `chain_type: "tron"` and a base58 TRON address.
- `personal_sign` returned `data.signature` with `encoding: "hex"`.
- `raw_sign` returned `data.signature` with `encoding: "hex"` for the zero hash input.
- TRON `raw_sign` signature was validated by recovering the wallet address from `r||s||v` (with `v=1`).

**Sanitized Output Snapshot**:
```
GET /v1/wallets/{evm}
{"id":"...","address":"0x39bA22E0d14b33C90a481E7379d233F8acCAAA90","chain_type":"ethereum", ...}

GET /v1/wallets/{tron}
{"id":"...","address":"TJxXP8otnUwAV3zJrGGsMwwna1GyRSjfjC","chain_type":"tron", ...}

POST /rpc personal_sign
{"method":"personal_sign","data":{"signature":"0xf838...f5d61c","encoding":"hex"}}

POST /raw_sign
{"method":"raw_sign","data":{"signature":"0xd7ce...20be77","encoding":"hex"}}
```

**Implications**:
- The test wallets are active and correctly typed (ethereum / tron).
- `raw_sign` returns a 64-byte `r||s` signature for TRON; the recovery id `v` can be derived (try 0/1) by matching the recovered address to the wallet address.
- This is sufficient to construct a TRON-style 65-byte signature (`r||s||v`) for signing a known hash, but end-to-end transaction assembly should still be validated with real `raw_data` hashes.

## TRON raw_sign Signature Recovery (2026-03-26)

**Goal**: Determine whether the TRON `raw_sign` signature can be used to recover the wallet address (i.e., is it a valid secp256k1 signature for the given hash?).

**Method**:
- Call `raw_sign` with a 32-byte zero hash.
- Parse the 64-byte signature as `r||s`.
- Attempt recovery with `v` in `{0, 1}` and compare recovered address to `GET /v1/wallets/{wallet_id}` address.

**Result**:
- `v=1` produced a recovered address that matches the wallet address.
- This indicates `raw_sign` is compatible with TRON-style signatures when `v` is appended as the recovery id.

**Design Implication**:
- TRON signing via Privy can be implemented by:
  1) computing the TRON message/transaction hash,
  2) calling `raw_sign` to get `r||s`,
  3) deriving `v` by recovery against the wallet address,
  4) returning `r||s||v` as the TRON signature.

## Design Decisions (Updated)

### Decision: Keep Privy adapter; add TRON via raw_sign experiments
- **Context**: TRON does not have an explicit RPC signing method in Privy docs, while raw signing is supported via `/raw_sign`.
- **Selected Approach**: Use EVM RPC for EVM chains; attempt TRON via raw_sign with experimental validation.
- **Rationale**: Matches documented API surface and provides a verifiable path for TRON.
- **Risks**: Raw signature format may not match TRON transaction signature requirements; must validate end-to-end before declaring TRON support.

## References
- Privy get wallet — https://docs.privy.io/api-reference/wallets/get citeturn0view0
- Privy eth_signTypedData_v4 — https://docs.privy.io/api-reference/wallets/ethereum/eth-signtypeddata-v4 citeturn1view0
- Privy personal_sign — https://docs.privy.io/api-reference/wallets/ethereum/personal-sign citeturn1view1
- Privy eth_signTransaction — https://docs.privy.io/api-reference/wallets/ethereum/eth-sign-transaction citeturn1view2
- Privy raw_sign — https://docs.privy.io/api-reference/wallets/raw-sign citeturn1view5
