# Claude 專案入口

此檔只提供相容入口，不維護另一份專案架構副本。

開始工作前依序閱讀：

1. [`AGENTS.md`](./AGENTS.md)：工作流程、文件責任與開發規則。
2. [`.kiro/steering/`](./.kiro/steering/)：產品、技術棧與目錄原則。
3. [`.kiro/specs/`](./.kiro/specs/)：目前 active specification。
4. [`README.md`](./README.md) 與 [`doc/`](./doc/)：使用者操作文件。

歷史材料位於 [`doc/archive/`](./doc/archive/)，僅供追溯，不是現行契約。

TypeScript 驗證指令：

```bash
cd packages/typescript
pnpm test
pnpm lint
pnpm build
```
