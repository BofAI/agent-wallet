# 文件導覽

本專案採單一責任文件，避免同一 API 在多處重複維護。

## 使用者文件

- [`../README.md`](../README.md)：專案概覽與快速開始。
- [`../packages/typescript/README.md`](../packages/typescript/README.md)：npm package 的公開契約與安裝方式。
- [`getting-started.md`](./getting-started.md)：完整入門流程。
- [`migration-v3.md`](./migration-v3.md)：從 2.x 升級到 3.0 的 breaking changes 與操作步驟。
- [`how-to-add-privy-wallet.md`](./how-to-add-privy-wallet.md)：Privy wallet 設定。
- [`how-to-add-wallet-cli-wallet.md`](./how-to-add-wallet-cli-wallet.md)：wallet-cli wallet 設定。

## 維護規則

- 使用者行為改變時，只更新負責該流程的使用者文件與 active spec。
- 公開 package API 只在 package README 詳列；根 README 只提供摘要與連結。
- 專案架構與開發政策只放在 `AGENTS.md` 和 `.kiro/steering/`。
- 歷史材料集中於 [`archive/`](./archive/)，凍結後不再同步更新。
