/**
 * Tests for the agent-wallet CLI.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  type CliIO,
  CliExit,
  cmdInit,
  cmdAdd,
  cmdList,
  cmdInspect,
  cmdRemove,
  cmdUse,
  cmdSignMsg,
  cmdChangePassword,
  main,
} from "../src/delivery/cli.js";

const TEST_PASSWORD = "Test-password-123!";

/** Create a mock CliIO that feeds answers from a queue. */
function mockIO(answers: string[] = []): CliIO & { output: string[] } {
  const queue = [...answers];
  const output: string[] = [];
  return {
    output,
    print(msg: string) {
      output.push(msg);
    },
    async prompt(_question: string, _opts?: any) {
      return queue.shift() ?? "";
    },
    async confirm(_question: string, defaultValue = false) {
      const answer = queue.shift();
      if (!answer) return defaultValue;
      return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
    },
  };
}

function getOutput(io: ReturnType<typeof mockIO>): string {
  return io.output.join("\n");
}

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-wallet-test-"));
}

async function initDir(dir: string): Promise<void> {
  const io = mockIO([TEST_PASSWORD, TEST_PASSWORD]);
  await cmdInit(dir, io);
}

describe("TestInit", () => {
  let secretsDir: string;

  beforeEach(() => {
    secretsDir = createTempDir();
  });

  it("init creates files", async () => {
    const io = mockIO([TEST_PASSWORD, TEST_PASSWORD]);
    await cmdInit(secretsDir, io);

    expect(getOutput(io)).toContain("Initialized");
    expect(existsSync(join(secretsDir, "master.json"))).toBe(true);
    expect(existsSync(join(secretsDir, "wallets_config.json"))).toBe(true);
  });

  it("init already initialized", async () => {
    await initDir(secretsDir);

    const io = mockIO([TEST_PASSWORD, TEST_PASSWORD]);
    await expect(cmdInit(secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("Already initialized");
  });

  it("init password mismatch", async () => {
    const io = mockIO(["Strong-pass-1!", "Strong-pass-2!"]);
    await expect(cmdInit(secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("do not match");
  });
});

describe("TestAdd", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
  });

  it("add evm generate", async () => {
    // answers: password, wallet name, type, action
    const io = mockIO([TEST_PASSWORD, "my_evm", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("added");
    expect(output).toContain("0x"); // EVM address

    // Verify config updated
    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.wallets.my_evm).toBeDefined();
    expect(config.wallets.my_evm.type).toBe("evm_local");
  });

  it("add tron generate", async () => {
    const io = mockIO([TEST_PASSWORD, "my_tron", "tron_local", "generate"]);
    await cmdAdd(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("added");
    expect(output).toContain("T"); // Tron address starts with T
  });

  it("add evm import", async () => {
    const testKey = "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b";
    const io = mockIO([TEST_PASSWORD, "imported_evm", "evm_local", "import", testKey]);
    await cmdAdd(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Imported");
  });

  it("add duplicate name", async () => {
    // Add first
    const io1 = mockIO([TEST_PASSWORD, "dup_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    // Add duplicate
    const io2 = mockIO([TEST_PASSWORD, "dup_wallet", "evm_local", "generate"]);
    await expect(cmdAdd(secretsDir, io2)).rejects.toThrow(CliExit);
    expect(getOutput(io2)).toContain("already exists");
  });
});

describe("TestList", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
  });

  it("list empty", async () => {
    const io = mockIO();
    await cmdList(secretsDir, io);

    expect(getOutput(io)).toContain("No wallets");
  });

  it("list with wallets", async () => {
    // Add a wallet first
    const io1 = mockIO([TEST_PASSWORD, "test_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    const io = mockIO();
    await cmdList(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("test_wallet");
    expect(output).toContain("evm_local");
  });
});

describe("TestInspect", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
  });

  it("inspect wallet", async () => {
    // Add a wallet
    const io1 = mockIO([TEST_PASSWORD, "inspect_me", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    const io = mockIO();
    await cmdInspect("inspect_me", secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("inspect_me");
    expect(output).toContain("0x");
  });

  it("inspect not found", async () => {
    const io = mockIO();
    await expect(cmdInspect("nonexistent", secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("not found");
  });
});

describe("TestRemove", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
  });

  it("remove wallet", async () => {
    // Add a wallet
    const io1 = mockIO([TEST_PASSWORD, "remove_me", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    // Verify file exists
    expect(existsSync(join(secretsDir, "id_remove_me.json"))).toBe(true);

    // Remove with yes=true
    const io = mockIO();
    await cmdRemove("remove_me", secretsDir, true, io);

    const output = getOutput(io);
    expect(output).toContain("removed");

    // Verify file deleted
    expect(existsSync(join(secretsDir, "id_remove_me.json"))).toBe(false);

    // Verify config updated
    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.wallets.remove_me).toBeUndefined();
  });

  it("remove not found", async () => {
    const io = mockIO();
    await expect(cmdRemove("nonexistent", secretsDir, true, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("not found");
  });
});

describe("TestSign", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
    // Add an EVM wallet for signing tests
    const io = mockIO([TEST_PASSWORD, "sign_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io);
  });

  it("sign message", async () => {
    const io = mockIO([TEST_PASSWORD]);
    await cmdSignMsg("sign_wallet", "hello world", secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Signature:");
  });

  it("sign message with env password", async () => {
    const oldPw = process.env.AGENT_WALLET_PASSWORD;
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD;
    try {
      const io = mockIO();
      await cmdSignMsg("sign_wallet", "hello", secretsDir, io);

      const output = getOutput(io);
      expect(output).toContain("Signature:");
    } finally {
      if (oldPw === undefined) delete process.env.AGENT_WALLET_PASSWORD;
      else process.env.AGENT_WALLET_PASSWORD = oldPw;
    }
  });

  it("sign wallet not found", async () => {
    const oldPw = process.env.AGENT_WALLET_PASSWORD;
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD;
    try {
      const io = mockIO();
      await expect(cmdSignMsg("nonexistent", "hello", secretsDir, io)).rejects.toThrow(CliExit);
      expect(getOutput(io)).toContain("Error");
    } finally {
      if (oldPw === undefined) delete process.env.AGENT_WALLET_PASSWORD;
      else process.env.AGENT_WALLET_PASSWORD = oldPw;
    }
  });
});

describe("TestChangePassword", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
  });

  it("change password", async () => {
    // Add a wallet
    const io1 = mockIO([TEST_PASSWORD, "pw_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    // Change password: current pw, new pw, confirm new pw
    const newPw = "New-password-456!";
    const io = mockIO([TEST_PASSWORD, newPw, newPw]);
    await cmdChangePassword(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Password changed");
    expect(output).toContain("master.json");

    // Verify new password works — list still shows wallet
    const io2 = mockIO();
    await cmdList(secretsDir, io2);

    const output2 = getOutput(io2);
    expect(output2).toContain("pw_wallet");

    // Verify wallet still accessible via inspect
    const io3 = mockIO();
    await cmdInspect("pw_wallet", secretsDir, io3);

    const output3 = getOutput(io3);
    expect(output3).toContain("0x");
  });
});

describe("TestWeakPassword", () => {
  let secretsDir: string;

  beforeEach(() => {
    secretsDir = createTempDir();
  });

  it("init rejects weak password (too short)", async () => {
    const io = mockIO(["Ab1!", "Ab1!"]);
    await expect(cmdInit(secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("Password too weak");
    expect(getOutput(io)).toContain("at least 8 characters");
  });

  it("init rejects password without uppercase", async () => {
    const io = mockIO(["test-password-1!", "test-password-1!"]);
    await expect(cmdInit(secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("at least 1 uppercase letter");
  });

  it("init rejects password without special character", async () => {
    const io = mockIO(["TestPassword1", "TestPassword1"]);
    await expect(cmdInit(secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("at least 1 special character");
  });

  it("change-password rejects weak new password", async () => {
    await initDir(secretsDir);
    // Add a wallet so we have something to re-encrypt
    const ioAdd = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd);

    // old pw, weak new pw
    const io = mockIO([TEST_PASSWORD, "weak", "weak"]);
    await expect(cmdChangePassword(secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("Password too weak");
  });
});

describe("TestActiveWallet", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
    await initDir(secretsDir);
  });

  it("first add auto-sets active wallet", async () => {
    const io = mockIO([TEST_PASSWORD, "first_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Active wallet set to 'first_wallet'");

    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.active_wallet).toBe("first_wallet");
  });

  it("second add does not change active wallet", async () => {
    const io1 = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    const io2 = mockIO([TEST_PASSWORD, "w2", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io2);

    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.active_wallet).toBe("w1");
  });

  it("use command sets active wallet", async () => {
    const io1 = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);
    const io2 = mockIO([TEST_PASSWORD, "w2", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io2);

    const io = mockIO();
    await cmdUse("w2", secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Active wallet: w2");

    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.active_wallet).toBe("w2");
  });

  it("use command rejects nonexistent wallet", async () => {
    const io = mockIO();
    await expect(cmdUse("nonexistent", secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("not found");
  });

  it("list shows active wallet marker", async () => {
    const io1 = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);
    const io2 = mockIO([TEST_PASSWORD, "w2", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io2);

    const io = mockIO();
    await cmdList(secretsDir, io);

    const output = getOutput(io);
    // w1 is active, should have * marker
    expect(output).toContain("* w1");
  });

  it("remove active wallet clears active", async () => {
    const io1 = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io1);

    const io = mockIO();
    await cmdRemove("w1", secretsDir, true, io);

    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.active_wallet).toBeNull();
  });

  it("sign msg without --wallet uses active wallet", async () => {
    const ioAdd = mockIO([TEST_PASSWORD, "active_signer", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd);

    const io = mockIO([TEST_PASSWORD]);
    await cmdSignMsg(undefined, "hello active", secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Signature:");
  });

  it("sign msg without --wallet and no active errors", async () => {
    // Add a wallet then clear active
    const ioAdd = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd);

    // Clear active wallet manually
    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    config.active_wallet = null;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(secretsDir, "wallets_config.json"), JSON.stringify(config));

    const io = mockIO([TEST_PASSWORD]);
    await expect(cmdSignMsg(undefined, "hello", secretsDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("No wallet specified");
  });

  it("sign msg on uninitialized dir shows not initialized error", async () => {
    const emptyDir = createTempDir();
    const io = mockIO();
    await expect(cmdSignMsg(undefined, "hello", emptyDir, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("not initialized");
  });

  it("main use command works via argv", async () => {
    const ioAdd = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd);
    const ioAdd2 = mockIO([TEST_PASSWORD, "w2", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd2);

    const io = mockIO();
    const code = await main(["use", "w2", "--dir", secretsDir], io);
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("Active wallet: w2");
  });
});

describe("TestMain", () => {
  it("no args shows help", async () => {
    const io = mockIO();
    const code = await main([], io);
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("Usage:");
  });

  it("unknown command returns 1", async () => {
    const io = mockIO();
    const code = await main(["unknown-cmd"], io);
    expect(code).toBe(1);
  });
});
