/**
 * AgentWallet CLI — key management and signing operations.
 */

import { existsSync, mkdirSync, chmodSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

import { privateKeyToAccount } from "viem/accounts";
import bs58check from "bs58check";

import { WalletType, type Eip712Capable } from "../core/base.js";
import { type WalletConfig, type WalletsTopology, loadConfig, saveConfig } from "../storage/config.js";
import { SecureKVStore } from "../secret/kv-store.js";
import { DecryptionError, WalletError } from "../core/errors.js";
import { WalletFactory } from "../core/provider.js";

// --- Helpers ---

const DEFAULT_DIR = process.env.AGENT_WALLET_DIR ?? join(homedir(), ".agent-wallet");

export interface CliIO {
  print(msg: string): void;
  prompt(question: string, opts?: { password?: boolean; choices?: string[]; defaultValue?: string }): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  /** Arrow-key select menu. Returns null if unavailable (non-TTY). */
  select?(promptText: string, choices: string[]): Promise<string | null>;
}

/**
 * Try to load @inquirer/prompts for interactive TTY menus.
 * Returns null if not in a TTY or the package is unavailable.
 */
async function loadInquirer() {
  if (!process.stdin.isTTY) return null;
  try {
    return await import("@inquirer/prompts");
  } catch {
    return null;
  }
}

async function interactiveSelect(promptText: string, choices: string[]): Promise<string | null> {
  const inquirer = await loadInquirer();
  if (!inquirer) return null;
  return inquirer.select({
    message: promptText,
    choices: choices.map((c) => ({ name: c, value: c })),
  });
}

function createConsoleIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): CliIO {
  return {
    print(msg: string) {
      output.write(msg + "\n");
    },

    async prompt(question, opts) {
      if (opts?.choices && !opts.password) {
        const selected = await interactiveSelect(question, opts.choices);
        if (selected !== null) return selected;
      }
      if (opts?.password) {
        const inquirer = await loadInquirer();
        if (inquirer) {
          const val = await inquirer.password({ message: question });
          return val || opts.defaultValue || "";
        }
      }
      const rl = createInterface({ input, output, terminal: false });
      return new Promise<string>((resolve) => {
        const suffix = opts?.choices ? ` [${opts.choices.join("/")}]` : "";
        const def = opts?.defaultValue ? ` (${opts.defaultValue})` : "";
        rl.question(`${question}${suffix}${def}: `, (answer) => {
          rl.close();
          resolve(answer.trim() || opts?.defaultValue || "");
        });
      });
    },

    async confirm(question, defaultValue = false) {
      const inquirer = await loadInquirer();
      if (inquirer) {
        return inquirer.confirm({ message: question, default: defaultValue });
      }
      const rl = createInterface({ input, output, terminal: false });
      return new Promise<boolean>((resolve) => {
        const hint = defaultValue ? "[Y/n]" : "[y/N]";
        rl.question(`${question} ${hint}: `, (answer) => {
          rl.close();
          const a = answer.trim().toLowerCase();
          if (!a) resolve(defaultValue);
          else resolve(a === "y" || a === "yes");
        });
      });
    },

    select: interactiveSelect,
  };
}

async function getPassword(io: CliIO, opts?: { confirm?: boolean }): Promise<string> {
  const envPw = process.env.AGENT_WALLET_PASSWORD;
  if (envPw) return envPw;
  const pw = await io.prompt("Master password", { password: true });
  if (opts?.confirm) {
    const pw2 = await io.prompt("Confirm password", { password: true });
    if (pw !== pw2) {
      io.print("Passwords do not match.");
      throw new CliExit(1);
    }
  }
  return pw;
}

function loadConfigSafe(secretsDir: string): WalletsTopology {
  try {
    return loadConfig(secretsDir);
  } catch {
    return { config_version: 1, wallets: {} };
  }
}

function deriveAddress(walletType: string, privateKey: Buffer): string {
  const hex = `0x${privateKey.toString("hex")}` as `0x${string}`;
  const account = privateKeyToAccount(hex);

  if (walletType === WalletType.EVM_LOCAL) {
    return account.address;
  }
  if (walletType === WalletType.TRON_LOCAL) {
    const ethAddrBytes = Buffer.from(account.address.slice(2), "hex");
    const tronAddrBytes = Buffer.concat([Buffer.from([0x41]), ethAddrBytes]);
    return bs58check.encode(tronAddrBytes);
  }
  return "";
}

// --- Exit signal ---
export class CliExit extends Error {
  constructor(public code: number) {
    super(`Exit ${code}`);
    this.name = "CliExit";
  }
}

// --- Commands ---

export async function cmdInit(dir: string, io: CliIO): Promise<void> {
  const masterPath = join(dir, "master.json");
  if (existsSync(masterPath)) {
    io.print(`Already initialized: ${dir}`);
    throw new CliExit(1);
  }

  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch { /* ignore on platforms without chmod support */ }

  const pw = await getPassword(io, { confirm: true });
  const kvStore = new SecureKVStore(dir, pw);
  kvStore.initMaster();
  saveConfig(dir, { config_version: 1, wallets: {} });

  io.print(`Initialized. Secrets directory: ${dir}`);
}

export async function cmdAdd(dir: string, io: CliIO): Promise<void> {
  const pw = await getPassword(io);
  const kvStore = new SecureKVStore(dir, pw);
  try {
    kvStore.verifyPassword();
  } catch (e) {
    if (e instanceof DecryptionError || e instanceof Error) {
      io.print(`Error: ${(e as Error).message}`);
      throw new CliExit(1);
    }
    throw e;
  }

  const config = loadConfigSafe(dir);

  const name = await io.prompt("Wallet name");
  if (config.wallets[name]) {
    io.print(`Wallet '${name}' already exists.`);
    throw new CliExit(1);
  }

  const typeChoices = Object.values(WalletType) as string[];
  const selectFn = io.select ?? (async () => null);
  let typeStr = await selectFn("Wallet type:", typeChoices);
  if (typeStr === null) {
    typeStr = await io.prompt("Wallet type", { choices: typeChoices });
  }
  if (!typeChoices.includes(typeStr)) {
    io.print(`Invalid wallet type: ${typeStr}`);
    throw new CliExit(1);
  }
  const walletType = typeStr as WalletType;

  const walletConf: Record<string, unknown> = { type: walletType };

  if (walletType === WalletType.EVM_LOCAL || walletType === WalletType.TRON_LOCAL) {
    // Private key: generate or import
    let action = await selectFn("Private key:", ["generate", "import"]);
    if (action === null) {
      action = await io.prompt("Private key", { choices: ["generate", "import"], defaultValue: "generate" });
    }

    const identityFile = name;
    let privateKey: Buffer;

    if (action === "generate") {
      privateKey = kvStore.generateKey(identityFile);
      io.print("Generated new private key.");
    } else {
      const keyHex = await io.prompt("Paste private key (hex)", { password: true });
      const cleaned = keyHex.trim().replace(/^0x/, "");
      try {
        privateKey = Buffer.from(cleaned, "hex");
      } catch {
        io.print("Invalid hex string.");
        throw new CliExit(1);
      }
      kvStore.savePrivateKey(identityFile, privateKey);
      io.print("Imported private key.");
    }

    walletConf.identity_file = identityFile;

    const address = deriveAddress(walletType, privateKey);
    walletConf.address = address;
    io.print(`  Address: ${address}`);
    io.print(`  Saved:   id_${identityFile}.json`);
  } else {
    io.print(`Wallet type '${walletType}' is not yet fully supported.`);
    throw new CliExit(1);
  }

  config.wallets[name] = walletConf as unknown as WalletConfig;
  saveConfig(dir, config);
  io.print(`Wallet '${name}' added. Config updated.`);
}

export async function cmdList(dir: string, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir);

  if (Object.keys(config.wallets).length === 0) {
    io.print("No wallets configured.");
    return;
  }

  io.print("Wallets:");
  io.print(`${"Name".padEnd(20)} ${"Type".padEnd(15)} Address`);
  io.print("-".repeat(70));

  for (const [wid, conf] of Object.entries(config.wallets)) {
    io.print(`${wid.padEnd(20)} ${conf.type.padEnd(15)} ${conf.address ?? "\u2014"}`);
  }
}

export async function cmdInspect(walletId: string, dir: string, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir);
  if (!config.wallets[walletId]) {
    io.print(`Wallet '${walletId}' not found.`);
    throw new CliExit(1);
  }

  const conf = config.wallets[walletId];
  const idStatus = conf.identity_file && existsSync(join(dir, `id_${conf.identity_file}.json`)) ? "\u2713" : "\u2014";
  const credStatus = conf.cred_file && existsSync(join(dir, `cred_${conf.cred_file}.json`)) ? "\u2713" : "\u2014";

  io.print(`Wallet      ${walletId}`);
  io.print(`Type        ${conf.type}`);
  io.print(`Address     ${conf.address ?? "\u2014"}`);
  io.print(`Identity    ${conf.identity_file ? `id_${conf.identity_file}.json ${idStatus}` : "\u2014"}`);
  io.print(`Credential  ${conf.cred_file ? `cred_${conf.cred_file}.json ${credStatus}` : "\u2014"}`);
}

export async function cmdRemove(walletId: string, dir: string, yes: boolean, io: CliIO): Promise<void> {
  const config = loadConfigSafe(dir);
  if (!config.wallets[walletId]) {
    io.print(`Wallet '${walletId}' not found.`);
    throw new CliExit(1);
  }

  if (!yes) {
    const confirmed = await io.confirm(`Remove wallet '${walletId}'?`, false);
    if (!confirmed) {
      io.print("Cancelled.");
      throw new CliExit(0);
    }
  }

  const conf = config.wallets[walletId];

  if (conf.identity_file) {
    const idPath = join(dir, `id_${conf.identity_file}.json`);
    if (existsSync(idPath)) {
      unlinkSync(idPath);
      io.print(`  Deleted: id_${conf.identity_file}.json`);
    }
  }

  if (conf.cred_file) {
    const credPath = join(dir, `cred_${conf.cred_file}.json`);
    if (existsSync(credPath)) {
      unlinkSync(credPath);
      io.print(`  Deleted: cred_${conf.cred_file}.json`);
    }
  }

  delete config.wallets[walletId];
  saveConfig(dir, config);
  io.print(`Wallet '${walletId}' removed.`);
}

// --- Sign subcommands ---

export async function cmdSignTx(
  wallet: string, payload: string, dir: string, io: CliIO,
): Promise<void> {
  const pw = await getPassword(io);

  try {
    const provider = WalletFactory({ secretsDir: dir, password: pw });
    const w = await provider.getWallet(wallet);
    const txData = JSON.parse(payload);
    const signed = await w.signTransaction(txData);
    try {
      const parsed = JSON.parse(signed);
      io.print("Signed tx:");
      io.print(JSON.stringify(parsed, null, 2));
    } catch {
      io.print(`Signed tx: ${signed}`);
    }
  } catch (e) {
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print(`Error: ${(e as Error).message}`);
      throw new CliExit(1);
    }
    throw e;
  }
}

export async function cmdSignMsg(
  wallet: string, message: string, dir: string, io: CliIO,
): Promise<void> {
  const pw = await getPassword(io);

  try {
    const provider = WalletFactory({ secretsDir: dir, password: pw });
    const w = await provider.getWallet(wallet);
    const signature = await w.signMessage(Buffer.from(message, "utf-8"));
    io.print(`Signature: ${signature}`);
  } catch (e) {
    if (e instanceof WalletError) {
      io.print(`Error: ${e.message}`);
      throw new CliExit(1);
    }
    throw e;
  }
}

export async function cmdSignTypedData(
  wallet: string, data: string, dir: string, io: CliIO,
): Promise<void> {
  const pw = await getPassword(io);

  try {
    const provider = WalletFactory({ secretsDir: dir, password: pw });
    const w = await provider.getWallet(wallet);
    if (!("signTypedData" in w)) {
      io.print("This wallet does not support EIP-712 signing.");
      throw new CliExit(1);
    }
    const typedData = JSON.parse(data);
    const signature = await (w as unknown as Eip712Capable).signTypedData(typedData);
    io.print(`Signature: ${signature}`);
  } catch (e) {
    if (e instanceof WalletError || e instanceof SyntaxError) {
      io.print(`Error: ${(e as Error).message}`);
      throw new CliExit(1);
    }
    throw e;
  }
}

export async function cmdChangePassword(dir: string, io: CliIO): Promise<void> {
  const envPw = process.env.AGENT_WALLET_PASSWORD;
  const oldPw = envPw ?? await io.prompt("Current password", { password: true });

  const kvStoreOld = new SecureKVStore(dir, oldPw);
  try {
    kvStoreOld.verifyPassword();
  } catch (e) {
    if (e instanceof DecryptionError || e instanceof Error) {
      io.print(`Error: ${e.message}`);
      throw new CliExit(1);
    }
    throw e;
  }

  const newPw = await io.prompt("New password", { password: true });
  const newPw2 = await io.prompt("Confirm new password", { password: true });
  if (newPw !== newPw2) {
    io.print("Passwords do not match.");
    throw new CliExit(1);
  }

  const kvStoreNew = new SecureKVStore(dir, newPw);
  let reEncrypted = 0;

  kvStoreNew.initMaster();
  io.print("  \u2713 master.json");
  reEncrypted += 1;

  const files = readdirSync(dir).sort();
  for (const file of files) {
    if (file.startsWith("id_") && file.endsWith(".json")) {
      const name = file.slice(3, -5);
      const key = kvStoreOld.loadPrivateKey(name);
      kvStoreNew.savePrivateKey(name, key);
      io.print(`  \u2713 ${file}`);
      reEncrypted += 1;
    }
  }

  for (const file of files) {
    if (file.startsWith("cred_") && file.endsWith(".json")) {
      const name = file.slice(5, -5);
      const cred = kvStoreOld.loadCredential(name);
      kvStoreNew.saveCredential(name, cred);
      io.print(`  \u2713 ${file}`);
      reEncrypted += 1;
    }
  }

  io.print(`\nPassword changed. Re-encrypted ${reEncrypted} files.`);
}

export async function cmdServe(io: CliIO): Promise<void> {
  io.print("Server is not yet implemented.");
  throw new CliExit(1);
}

// --- CLI Entry Point ---

interface ParsedArgs {
  command: string;
  subcommand?: string;
  args: string[];
  options: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        options[key] = next;
        i += 2;
      } else {
        options[key] = true;
        i += 1;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        options[key] = next;
        i += 2;
      } else {
        options[key] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  const command = positional[0] ?? "";
  const subcommand = positional.length > 1 ? positional[1] : undefined;
  const args = positional.slice(command === "sign" ? 2 : 1);

  return { command, subcommand, args, options };
}

export async function main(argv?: string[], io?: CliIO): Promise<number> {
  const cliIO = io ?? createConsoleIO();
  const rawArgs = argv ?? process.argv.slice(2);

  if (rawArgs.length === 0) {
    cliIO.print("Usage: agent-wallet <command> [options]");
    cliIO.print("");
    cliIO.print("Commands:");
    cliIO.print("  init              Initialize secrets directory and set master password");
    cliIO.print("  add               Add a new wallet (interactive)");
    cliIO.print("  list              List all configured wallets");
    cliIO.print("  inspect <id>      Show wallet details");
    cliIO.print("  remove <id>       Remove a wallet");
    cliIO.print("  sign tx           Sign a transaction");
    cliIO.print("  sign msg          Sign a message");
    cliIO.print("  sign typed-data   Sign EIP-712 typed data");
    cliIO.print("  change-password   Change master password");
    cliIO.print("  serve             Start MCP / HTTP server");
    return 0;
  }

  const { command, subcommand, args, options } = parseArgs(rawArgs);
  const dir = (options.dir ?? options.d ?? DEFAULT_DIR) as string;

  try {
    switch (command) {
      case "init":
        await cmdInit(dir, cliIO);
        break;
      case "add":
        await cmdAdd(dir, cliIO);
        break;
      case "list":
        await cmdList(dir, cliIO);
        break;
      case "inspect":
        if (!subcommand && args.length === 0) {
          cliIO.print("Usage: agent-wallet inspect <wallet-id>");
          return 1;
        }
        await cmdInspect(subcommand ?? args[0], dir, cliIO);
        break;
      case "remove":
        if (!subcommand && args.length === 0) {
          cliIO.print("Usage: agent-wallet remove <wallet-id>");
          return 1;
        }
        await cmdRemove(
          subcommand ?? args[0],
          dir,
          options.yes === true || options.y === true,
          cliIO,
        );
        break;
      case "sign":
        if (!subcommand) {
          cliIO.print("Usage: agent-wallet sign <tx|msg|typed-data> [options]");
          return 1;
        }
        switch (subcommand) {
          case "tx":
            await cmdSignTx(
              (options.wallet ?? options.w) as string,
              (options.payload ?? options.p) as string,
              dir, cliIO,
            );
            break;
          case "msg":
            await cmdSignMsg(
              (options.wallet ?? options.w) as string,
              (options.message ?? options.m) as string,
              dir, cliIO,
            );
            break;
          case "typed-data":
            await cmdSignTypedData(
              (options.wallet ?? options.w) as string,
              options.data as string,
              dir, cliIO,
            );
            break;
          default:
            cliIO.print(`Unknown sign subcommand: ${subcommand}`);
            return 1;
        }
        break;
      case "change-password":
        await cmdChangePassword(dir, cliIO);
        break;
      case "serve":
        await cmdServe(cliIO);
        break;
      default:
        cliIO.print(`Unknown command: ${command}`);
        return 1;
    }
  } catch (e) {
    if (e instanceof CliExit) {
      return e.code;
    }
    throw e;
  }

  return 0;
}

// Run when executed directly
const isMainModule =
  typeof import.meta.url !== "undefined" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().then((code) => process.exit(code));
}
