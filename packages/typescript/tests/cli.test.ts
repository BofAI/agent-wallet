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
  cmdStart,
  cmdReset,
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

describe("TestStart", () => {
  let secretsDir: string;

  beforeEach(() => {
    secretsDir = createTempDir();
  });

  it("start with -p creates both default wallets", async () => {
    const io = mockIO();
    await cmdStart(secretsDir, io, { password: TEST_PASSWORD });

    const output = getOutput(io);
    expect(output).toContain("Wallet initialized");
    expect(output).toContain("default_tron");
    expect(output).toContain("default_evm");
    expect(output).toContain("tron_local");
    expect(output).toContain("evm_local");
    expect(output).toContain("Active wallet: default_tron");

    // Verify config
    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.wallets.default_tron).toBeDefined();
    expect(config.wallets.default_tron.type).toBe("tron_local");
    expect(config.wallets.default_evm).toBeDefined();
    expect(config.wallets.default_evm.type).toBe("evm_local");
    expect(config.active_wallet).toBe("default_tron");
  });

  it("start without -p auto-generates password", async () => {
    const io = mockIO();
    await cmdStart(secretsDir, io);

    const output = getOutput(io);
    expect(output).toContain("Your master password:");
    expect(output).toContain("Save this password");
    expect(output).toContain("default_tron");
    expect(output).toContain("default_evm");
  });

  it("start -i tron imports wallet", async () => {
    const testKey = "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b";
    const io = mockIO([testKey]);
    await cmdStart(secretsDir, io, { password: TEST_PASSWORD, importType: "tron" });

    const output = getOutput(io);
    expect(output).toContain("Imported wallet");
    expect(output).toContain("default_tron");
    expect(output).toContain("tron_local");

    const config = JSON.parse(readFileSync(join(secretsDir, "wallets_config.json"), "utf-8"));
    expect(config.wallets.default_tron).toBeDefined();
    expect(config.wallets.default_evm).toBeUndefined();
    expect(config.active_wallet).toBe("default_tron");
  });

  it("start -i evm imports wallet", async () => {
    const testKey = "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b";
    const io = mockIO([testKey]);
    await cmdStart(secretsDir, io, { password: TEST_PASSWORD, importType: "evm" });

    const output = getOutput(io);
    expect(output).toContain("Imported wallet");
    expect(output).toContain("default_evm");
    expect(output).toContain("evm_local");
    expect(output).toContain("0x");
  });

  it("start twice returns existing wallets", async () => {
    const io1 = mockIO();
    await cmdStart(secretsDir, io1, { password: TEST_PASSWORD });
    expect(getOutput(io1)).toContain("Wallet initialized!");

    // Second run — should not error, shows existing wallets
    const io2 = mockIO();
    await cmdStart(secretsDir, io2, { password: TEST_PASSWORD });
    const output = getOutput(io2);
    expect(output).toContain("already initialized");
    expect(output).toContain("default_tron");
    expect(output).toContain("default_evm");
  });

  it("start -i tron twice returns existing wallet", async () => {
    const testKey = "4c0883a69102937d6231471b5dbb6204fe512961708279f3e27e8e4ce3e66c3b";
    const io1 = mockIO([testKey]);
    await cmdStart(secretsDir, io1, { password: TEST_PASSWORD, importType: "tron" });

    // Second run — no key prompt, just shows existing
    const io2 = mockIO(); // no answers needed
    await cmdStart(secretsDir, io2, { password: TEST_PASSWORD, importType: "tron" });
    const output = getOutput(io2);
    expect(output).toContain("already exists");
    expect(output).toContain("default_tron");
  });

  it("start then start -i creates missing wallet", async () => {
    // First: default setup creates both wallets
    const io1 = mockIO();
    await cmdStart(secretsDir, io1, { password: TEST_PASSWORD });

    // Second: -i tron should see it already exists
    const io2 = mockIO();
    await cmdStart(secretsDir, io2, { password: TEST_PASSWORD, importType: "tron" });
    expect(getOutput(io2)).toContain("already exists");
  });

  it("start with AGENT_WALLET_PASSWORD env var", async () => {
    const oldPw = process.env.AGENT_WALLET_PASSWORD;
    process.env.AGENT_WALLET_PASSWORD = TEST_PASSWORD;
    try {
      const io = mockIO();
      await cmdStart(secretsDir, io); // no explicit password
      const output = getOutput(io);
      expect(output).toContain("Wallet initialized!");
      expect(output).toContain("default_tron");
      expect(output).toContain("default_evm");
      // Should NOT show auto-generated password message
      expect(output).not.toContain("Your master password:");
    } finally {
      if (oldPw === undefined) delete process.env.AGENT_WALLET_PASSWORD;
      else process.env.AGENT_WALLET_PASSWORD = oldPw;
    }
  });

  it("start idempotent with wrong password fails", async () => {
    const io1 = mockIO();
    await cmdStart(secretsDir, io1, { password: TEST_PASSWORD });
    expect(getOutput(io1)).toContain("Wallet initialized!");

    // Second run with wrong password
    const io2 = mockIO();
    await expect(cmdStart(secretsDir, io2, { password: "Wrong-password-1!" })).rejects.toThrow(CliExit);
    expect(getOutput(io2)).toContain("Wrong password");
  });

  it("start rejects weak password", async () => {
    const io = mockIO();
    await expect(cmdStart(secretsDir, io, { password: "weak" })).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("Password too weak");
  });

  it("start rejects unknown import type", async () => {
    const io = mockIO();
    await expect(cmdStart(secretsDir, io, { password: TEST_PASSWORD, importType: "unknown" })).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("Unknown wallet type");
  });

  it("start shows quick guide", async () => {
    const io = mockIO();
    await cmdStart(secretsDir, io, { password: TEST_PASSWORD });

    const output = getOutput(io);
    expect(output).toContain("Quick guide");
    expect(output).toContain("agent-wallet list");
  });
});

describe("TestPasswordFlag", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
  });

  it("init with -p flag skips prompt", async () => {
    const io = mockIO(); // no answers needed
    await cmdInit(secretsDir, io, { password: TEST_PASSWORD });
    expect(getOutput(io)).toContain("Initialized");
    expect(existsSync(join(secretsDir, "master.json"))).toBe(true);
  });

  it("add with -p flag skips password prompt", async () => {
    await initDir(secretsDir);
    // Only need wallet name, type, action (no password prompt)
    const io = mockIO(["pw_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, io, { password: TEST_PASSWORD });
    expect(getOutput(io)).toContain("added");
  });

  it("sign msg with -p flag via main", async () => {
    await initDir(secretsDir);
    const ioAdd = mockIO([TEST_PASSWORD, "sig_wallet", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd);

    const io = mockIO();
    const code = await main(
      ["sign", "msg", "hello", "--wallet", "sig_wallet", "-p", TEST_PASSWORD, "--dir", secretsDir],
      io
    );
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("Signature:");
  });

  it("start via main with -p flag", async () => {
    const io = mockIO();
    const code = await main(["start", "-p", TEST_PASSWORD, "--dir", secretsDir], io);
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("default_tron");
    expect(getOutput(io)).toContain("default_evm");
  });
});

describe("TestMain", () => {
  it("no args shows help", async () => {
    const io = mockIO();
    const code = await main([], io);
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("Usage:");
  });

  it("help shows start command", async () => {
    const io = mockIO();
    const code = await main(["--help"], io);
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("start");
    expect(getOutput(io)).toContain("--password");
  });

  it("start --help shows command-specific options", async () => {
    const io = mockIO();
    const code = await main(["start", "--help"], io);
    expect(code).toBe(0);
    const output = getOutput(io);
    expect(output).toContain("--import, -i");
    expect(output).toContain("--password, -p");
    expect(output).toContain("Quick setup");
  });

  it("sign --help shows subcommands", async () => {
    const io = mockIO();
    const code = await main(["sign", "--help"], io);
    expect(code).toBe(0);
    const output = getOutput(io);
    expect(output).toContain("tx");
    expect(output).toContain("msg");
    expect(output).toContain("typed-data");
  });

  it("sign msg --help shows options", async () => {
    const io = mockIO();
    const code = await main(["sign", "msg", "--help"], io);
    expect(code).toBe(0);
    const output = getOutput(io);
    expect(output).toContain("--wallet, -w");
    expect(output).toContain("--password, -p");
    expect(output).toContain("Sign a message");
  });

  it("unknown command returns 1", async () => {
    const io = mockIO();
    const code = await main(["unknown-cmd"], io);
    expect(code).toBe(1);
  });

  it("reset --help shows options", async () => {
    const io = mockIO();
    const code = await main(["reset", "--help"], io);
    expect(code).toBe(0);
    const output = getOutput(io);
    expect(output).toContain("--yes, -y");
    expect(output).toContain("Delete all wallet data");
  });
});

describe("TestReset", () => {
  let secretsDir: string;

  beforeEach(async () => {
    secretsDir = createTempDir();
  });

  it("reset with --yes deletes all files", async () => {
    await initDir(secretsDir);
    const ioAdd = mockIO([TEST_PASSWORD, "w1", "evm_local", "generate"]);
    await cmdAdd(secretsDir, ioAdd);

    expect(existsSync(join(secretsDir, "master.json"))).toBe(true);
    expect(existsSync(join(secretsDir, "wallets_config.json"))).toBe(true);
    expect(existsSync(join(secretsDir, "id_w1.json"))).toBe(true);

    const io = mockIO();
    await cmdReset(secretsDir, true, io);

    const output = getOutput(io);
    expect(output).toContain("reset complete");
    expect(existsSync(join(secretsDir, "master.json"))).toBe(false);
    expect(existsSync(join(secretsDir, "wallets_config.json"))).toBe(false);
    expect(existsSync(join(secretsDir, "id_w1.json"))).toBe(false);
  });

  it("reset cancelled keeps files", async () => {
    await initDir(secretsDir);

    const io = mockIO(["n"]); // first confirm returns false
    await expect(cmdReset(secretsDir, false, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("Cancelled");
    expect(existsSync(join(secretsDir, "master.json"))).toBe(true);
  });

  it("reset no data throws", async () => {
    const io = mockIO();
    await expect(cmdReset(secretsDir, true, io)).rejects.toThrow(CliExit);
    expect(getOutput(io)).toContain("No wallet data");
  });

  it("reset via main with --yes", async () => {
    await initDir(secretsDir);

    const io = mockIO();
    const code = await main(["reset", "--yes", "--dir", secretsDir], io);
    expect(code).toBe(0);
    expect(getOutput(io)).toContain("reset complete");
    expect(existsSync(join(secretsDir, "master.json"))).toBe(false);
  });
});
