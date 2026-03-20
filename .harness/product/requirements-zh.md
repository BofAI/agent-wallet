# Agent Wallet — 产品需求文档

**产品名称：** Agent Wallet (bankofai-agent-wallet / @bankofai/agent-wallet)
**版本：** 2.3.0
**组织：** BankOfAI
**许可证：** MIT
**最后更新：** 2026-03-20

---

## 1. 产品概述

### 1.1 目的

Agent Wallet 是一个面向 AI 代理和应用的通用多链安全签名 SDK。它是一个Agent钱包的适配层，可以接入privy等多种Agent钱包Provider，目前支持:
  - 本地钱包私钥管理Provider(Keystore V3)
  - 原始私钥配置钱包Provider

### 1.2 核心理念

- **仅签名** — SDK 只负责签名交易和消息；交易构建和广播由调用方负责。
- **本地优先** — 所有加密操作在客户端本地执行；密钥材料不会离开本机。
- **最小化攻击面** — 仅包含必要的加密库，降低依赖风险。

### 1.3 目标用户

- 需要程序化钱包签名的 AI 代理开发者
- 需要签名后端的 MCP（Model Context Protocol）服务器构建者
- 构建多链自动化的 DeFi/Web3 开发者

### 1.4 分发渠道

| 平台 | 包名 | 安装命令 |
|------|------|---------|
| Python (PyPI) | `bankofai-agent-wallet` | `pip install bankofai-agent-wallet` |
| npm | `@bankofai/agent-wallet` | `npm install @bankofai/agent-wallet` |

---

## 2. 支持的网络

### 2.1 网络类型

| 网络 | 标识符格式 | 示例 | HD 派生路径 |
|------|-----------|------|------------|
| EVM | `eip155` 或 `eip155:<chainId>` | `eip155`、`eip155:1`（以太坊）、`eip155:56`（BSC）、`eip155:97`（BSC 测试网） | `m/44'/60'/0'/0/{index}` |
| TRON | `tron` 或 `tron:<network>` | `tron`、`tron:mainnet`、`tron:nile`、`tron:shasta` | `m/44'/195'/0'/0/{index}` |

### 2.2 密钥派生

- **来源：** BIP-39 标准助记词（12、15、18、21 或 24 个单词）
- **方法：** 分层确定性（HD）钱包派生
- **账户索引：** 可配置（默认：0）

---

## 3. 钱包类型与存储

### 3.1 本地钱包私钥管理Provider(Keystore V3)（`local_secure`）

**使用场景：** 生产环境 / 长期密钥管理

- 私钥以 Keystore V3 格式加密存储在磁盘上
- 加密方式：scrypt（N=262144, r=8, p=1, dklen=32）+ AES-128-CTR + Keccak256 MAC
- 存储位置：`~/.agent-wallet/`（可通过 `AGENT_WALLET_DIR` 配置）
- 所有签名操作需要主密码

**生成的文件：**

| 文件 | 用途 |
|------|------|
| `master.json` | 加密哨兵文件，用于密码验证 |
| `wallets_config.json` | 钱包注册表（未加密的元数据） |
| `secret_<id>.json` | 每个钱包的加密私钥 |
| `runtime_secrets.json` | （可选）明文密码，便于自动化使用 |

**密码要求：**
- 最少 8 个字符
- 至少 1 个大写字母、1 个小写字母、1 个数字、1 个特殊字符
- 自动生成的密码：16 个随机字符

### 3.2 原始私钥配置钱包Provider（`raw_secret`）

**使用场景：** 仅限开发/测试

- 私钥或助记词以明文形式存储在 `wallets_config.json` 中
- 不应用任何加密
- 不适用于生产环境

### 3.3 环境变量回退（`EnvWalletProvider`）

**使用场景：** CI/CD、容器化代理、快速测试

- 无持久化存储；密钥通过环境变量在运行时提供
- 当未找到配置文件时自动回退

---

## 4. 签名操作

### 4.1 核心接口

所有钱包适配器均实现 `Wallet` 接口：

| 方法 | 输入 | 输出 | 描述 |
|------|------|------|------|
| `getAddress()` | — | 地址字符串 | 返回钱包公钥地址（EVM：EIP-55 校验和格式；TRON：Base58check 格式） |
| `signMessage(msg)` | 字节数组 | 十六进制签名 | 签名任意消息（EVM：EIP-191 包装；TRON：Keccak256 + ECDSA） |
| `signTransaction(payload)` | 交易字典/对象 | 签名后的交易十六进制或 JSON | 签名交易载荷 |
| `signRaw(rawTx)` | 字节数组 | 十六进制签名 | 签名预序列化/预哈希的字节 |

### 4.2 EIP-712 类型化数据签名

所有适配器还实现 `Eip712Capable` 接口：

| 方法 | 输入 | 输出 |
|------|------|------|
| `signTypedData(data)` | EIP-712 结构化数据对象 | 十六进制签名 |

**输入结构：**
```json
{
  "types": { "EIP712Domain": [...], "PrimaryType": [...] },
  "primaryType": "PrimaryType",
  "domain": { "name": "...", "chainId": ..., "verifyingContract": "0x..." },
  "message": { ... }
}
```

**兼容性：** 完全支持 x402 PaymentPermit（EIP-712 域不包含 "version" 字段的情况）。

### 4.3 EVM 签名细节

- **消息签名：** EIP-191 个人签名
- **交易类型：** Legacy（type 0）、EIP-2930（type 1）、EIP-1559（type 2）
- **交易输出：** 原始签名十六进制，可直接用于 `eth_sendRawTransaction`
- **使用库：** viem（TypeScript）、eth-account（Python）

### 4.4 TRON 签名细节

- **消息签名：** Keccak256 哈希 + secp256k1 ECDSA
- **交易输入：** 来自 TronGrid API 的未签名交易（`txID`、`raw_data_hex`、`raw_data`）
- **交易输出：** 附加 `signature` 数组的 JSON 字符串
- **使用库：** tronweb（TypeScript）、tronpy（Python）

### 4.5 跨链签名一致性

相同的私钥 + 相同的消息 = EVM 和 TRON 适配器产生完全相同的签名。这使得跨链验证场景成为可能。

---

## 5. 提供者解析

### 5.1 解析顺序

当调用 `resolveWallet()` 或 `resolveWalletProvider()` 时：

1. **ConfigWalletProvider** — 在以下情况下激活：
   - 密码可用（环境变量或 `runtime_secrets.json`），或
   - 配置目录中存在 `wallets_config.json`
2. **EnvWalletProvider** — 在以下情况下回退：
   - 设置了 `AGENT_WALLET_PRIVATE_KEY` 或 `AGENT_WALLET_MNEMONIC`

### 5.2 密码解析顺序（针对 `local_secure`）

1. `runtime_secrets.json` 文件（如果存在）
2. `AGENT_WALLET_PASSWORD` 环境变量
3. 交互式提示（仅 CLI）

---

## 6. SDK API

### 6.1 主要入口

**Python：**
```python
from agent_wallet import resolve_wallet, resolve_wallet_provider
from agent_wallet import ConfigWalletProvider, EnvWalletProvider
```

**TypeScript：**
```typescript
import { resolveWallet, resolveWalletProvider } from "@bankofai/agent-wallet";
import { ConfigWalletProvider, EnvWalletProvider } from "@bankofai/agent-wallet";
```

### 6.2 `resolveWallet(network)` → `Wallet`

解析并返回指定网络的可用钱包实例。异步方法。

### 6.3 `resolveWalletProvider(network)` → `WalletProvider`

返回可以管理和检索多个钱包的提供者。

### 6.4 ConfigWalletProvider 方法

| 方法 | 描述 |
|------|------|
| `isInitialized()` | 检查 `wallets_config.json` 是否存在 |
| `ensureStorage()` | 如果缺失则创建配置目录和文件 |
| `listWallets()` | 列出所有钱包及其激活状态 |
| `getWalletConfig(walletId)` | 获取钱包配置 |
| `getActiveId()` | 获取当前激活的钱包 ID |
| `getActiveWallet(network?)` | 获取激活钱包实例（异步） |
| `getWallet(walletId, network?)` | 获取指定钱包实例（异步） |
| `addWallet(walletId, config)` | 添加新钱包 |
| `setActive(walletId)` | 设置钱包为激活状态 |
| `removeWallet(walletId)` | 删除钱包及其密钥文件 |
| `hasSecretFile(walletId)` | 检查加密密钥文件是否存在 |
| `hasRuntimeSecrets()` | 检查 `runtime_secrets.json` 是否存在 |
| `loadRuntimeSecretsPassword()` | 从 `runtime_secrets.json` 加载密码 |
| `saveRuntimeSecrets(password)` | 将密码持久化到 `runtime_secrets.json` |

---

## 7. CLI 命令

入口命令：`agent-wallet`（pip 和 npm 安装均可用）

### 7.1 设置与初始化

| 命令 | 描述 |
|------|------|
| `start [wallet_type]` | 快速设置向导：初始化 + 创建默认钱包 |
| `init` | 初始化配置目录并设置主密码（不创建钱包） |
| `add <wallet_type>` | 向已初始化的目录添加钱包 |

**设置命令的通用选项：**

| 选项 | 描述 |
|------|------|
| `--wallet-id, -w` | 钱包名称 |
| `--generate, -g` | 生成新私钥 |
| `--private-key, -k` | 导入十六进制私钥 |
| `--mnemonic, -m` | 导入 BIP-39 助记词 |
| `--mnemonic-index, -mi` | 账户派生索引（默认：0） |
| `--derive-as` | `eip155` 或 `tron`（助记词模式） |
| `--password, -p` | 主密码 |
| `--save-runtime-secrets` | 将密码持久化到 `runtime_secrets.json` |
| `--dir, -d` | 覆盖配置目录路径 |

### 7.2 钱包管理

| 命令 | 描述 |
|------|------|
| `list` | 显示所有钱包及激活标记 |
| `use <wallet_id>` | 设置钱包为激活状态 |
| `inspect <wallet_id>` | 显示钱包详细信息 |
| `remove <wallet_id>` | 删除钱包和密钥文件（需确认） |

### 7.3 签名操作

| 命令 | 描述 |
|------|------|
| `sign msg <message> -n NETWORK` | 签名纯文本消息 |
| `sign tx '<json>' -n NETWORK` | 签名交易载荷 |
| `sign typed-data '<json>' -n NETWORK` | 签名 EIP-712 类型化数据 |

**必需选项：** `-n, --network`（如 `eip155:1`、`tron:nile`）

**可选选项：** `--wallet-id`、`--password`、`--dir`、`--save-runtime-secrets`

### 7.4 安全管理

| 命令 | 描述 |
|------|------|
| `change-password` | 更改主密码；重新加密所有密钥 |
| `reset` | 删除所有钱包文件（需要二次确认） |

---

## 8. 环境变量

| 变量 | 类型 | 用途 | 默认值 |
|------|------|------|--------|
| `AGENT_WALLET_DIR` | string | 配置目录路径 | `~/.agent-wallet` |
| `AGENT_WALLET_PASSWORD` | string | 加密钱包的主密码 | — |
| `AGENT_WALLET_PRIVATE_KEY` | string | EnvWalletProvider 使用的私钥 | — |
| `AGENT_WALLET_MNEMONIC` | string | EnvWalletProvider 使用的 BIP-39 助记词 | — |
| `AGENT_WALLET_MNEMONIC_ACCOUNT_INDEX` | int | 助记词派生索引 | `0` |

---

## 9. 配置文件格式

### 9.1 wallets_config.json

```json
{
  "active_wallet": "wallet-id",
  "wallets": {
    "wallet-id": {
      "type": "local_secure",  /// Keystore v3
      "param": {
        "secret_ref": "wallet-id"
      },
    },
    "raw-wallet": {
      "type": "env_secure",   /// 直接配置环境变量
      "param": {
        "apikey": ".....",
        "phmore": ".....",
        "need_": true,
        #"source": "private_key",
        #"private_key": "0x..."
      }
    }                          /// privy方式
  }
}
```

### 9.2 secret_<id>.json（Keystore V3）

包含私钥材料的加密 JSON 文件。需要主密码才能解密。

### 9.3 runtime_secrets.json

```json
{
  "password": "..."
}
```

可选的便利文件。由 `--save-runtime-secrets` 创建。下次运行时自动检测。

---

## 10. 错误处理

| 错误类 | 原因 |
|--------|------|
| `WalletError` | 所有钱包操作的基础错误 |
| `WalletNotFoundError` | 配置中未找到钱包 ID |
| `DecryptionError` | 加密钱包的密码不正确 |
| `SigningError` | 签名失败（无效载荷、密钥问题） |
| `NetworkError` | 无效或不支持的网络标识符 |
| `UnsupportedOperationError` | 钱包类型不支持此操作 |

---

## 11. 安全要求

### 11.1 加密

- `local_secure` 钱包使用 Keystore V3 标准加密
- scrypt 密钥派生（N=262144, r=8, p=1）
- AES-128-CTR 密码和 Keccak256 MAC 验证

### 11.2 网络安全

- SDK 不发起任何网络调用
- 私钥材料不通过任何网络传输
- 所有签名操作完全在本地执行

### 11.3 密码策略

- 强制执行主密码最低复杂度要求
- 在任何解密操作前通过 `master.json` 哨兵验证密码

### 11.4 威胁模型

| 可防护 | 不可防护 |
|--------|---------|
| 磁盘被盗 / 备份泄露 | 键盘记录器 / 本机恶意软件 |
| 未授权的文件访问 | 进程内存检查 |
| 意外的密钥暴露 | 运行时环境被入侵 |

---

## 12. 跨语言兼容性

### 12.1 要求

| 要求 | 状态 |
|------|------|
| 两种语言可读取相同的密钥库格式 | 必需 |
| 相同密钥+消息产生完全相同的签名 | 必需 |
| 相同的网络标识符格式 | 必需 |
| 相同的 CLI 命令结构 | 必需 |
| 相同的环境变量名称 | 必需 |

### 12.2 平台要求

| 平台 | 最低版本 |
|------|---------|
| Python | 3.10 |
| Node.js | 18.0 |

---

## 13. 测试要求

### 13.1 覆盖率阈值

| 平台 | 最低覆盖率 |
|------|-----------|
| Python | 80% |
| TypeScript | 60% |

### 13.2 必需的测试类别

1. **签名验证** — 所有适配器和网络的签名 + 恢复往返测试
2. **确定性签名** — 相同输入始终产生相同输出
3. **跨库兼容性** — Python 和 TypeScript 之间签名可互相验证
4. **加密往返** — 加密 → 解密得到原始密钥材料
5. **密码验证** — 强度要求被正确执行
6. **配置管理** — 钱包添加/删除/切换/列表操作
7. **CLI 集成** — 所有命令产生预期输出
8. **错误处理** — 无效输入触发正确的错误类型

---

## 14. CI/CD 要求

### 14.1 流水线

| 阶段 | Python | TypeScript |
|------|--------|------------|
| 代码检查 | ruff check (E,W,F,I,B,UP,RUF) | tsc --noEmit + eslint |
| 测试 | pytest + 覆盖率 | vitest + v8 覆盖率 |
| 构建 | python -m build | tsup (ESM + CJS) |

### 14.2 触发条件

- 推送到 `main` 分支
- Pull Request
- 手动触发

---

## 15. 非目标

以下内容明确不在项目范围内：

- 硬件钱包支持（HSM、Ledger、Trezor）
- 交易构建或 RPC 交互
- 交易广播
- 钱包恢复或备份管理
- 基于云/网络的密钥存储
- 多重签名钱包协调
- Gas 估算或手续费计算
