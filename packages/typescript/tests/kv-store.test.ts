import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecureKVStore, encryptBytes, decryptBytes } from "../src/local/kv-store.js";
import { DecryptionError } from "../src/core/errors.js";

let secretsDir: string;

beforeEach(() => {
  secretsDir = mkdtempSync(join(tmpdir(), "agent-wallet-test-"));
});

afterEach(() => {
  rmSync(secretsDir, { recursive: true, force: true });
});

function createStore(password = "test-password-123"): SecureKVStore {
  const store = new SecureKVStore(secretsDir, password);
  store.initMaster();
  return store;
}

describe("MasterPassword", () => {
  it("should init and verify", () => {
    const store = createStore();
    expect(store.verifyPassword()).toBe(true);
  });

  it("should reject wrong password", () => {
    createStore("correct-password");
    const wrongStore = new SecureKVStore(secretsDir, "wrong-password");
    expect(() => wrongStore.verifyPassword()).toThrow(DecryptionError);
  });

  it("should throw on missing master.json", () => {
    const store = new SecureKVStore(secretsDir, "any-password");
    // Don't call initMaster
    expect(() => store.verifyPassword()).toThrow(/master\.json/);
  });
});

describe("PrivateKey", () => {
  it("should save and load roundtrip", () => {
    const store = createStore();
    const key = randomBytes(32);
    store.savePrivateKey("test_wallet", key);
    const loaded = store.loadPrivateKey("test_wallet");
    expect(Buffer.from(loaded).equals(key)).toBe(true);
  });

  it("should generate key", () => {
    const store = createStore();
    const key = store.generateKey("gen_wallet");
    expect(key.length).toBe(32);
    const loaded = store.loadPrivateKey("gen_wallet");
    expect(Buffer.from(loaded).equals(key)).toBe(true);
  });

  it("should reject invalid key length", () => {
    const store = createStore();
    expect(() => store.savePrivateKey("bad", Buffer.from("too-short"))).toThrow(
      /32 bytes/,
    );
  });

  it("should throw on load nonexistent", () => {
    const store = createStore();
    expect(() => store.loadPrivateKey("nonexistent")).toThrow();
  });
});

describe("Credential", () => {
  it("should roundtrip string", () => {
    const store = createStore();
    store.saveCredential("api_key", "my-secret-api-key-12345");
    const loaded = store.loadCredential("api_key");
    expect(loaded).toBe("my-secret-api-key-12345");
  });

  it("should roundtrip dict", () => {
    const store = createStore();
    const cred = { api_key: "abc123", api_secret: "xyz789", extra: true };
    store.saveCredential("complex", cred);
    const loaded = store.loadCredential("complex");
    expect(loaded).toEqual(cred);
  });

  it("should throw on load nonexistent", () => {
    const store = createStore();
    expect(() => store.loadCredential("nonexistent")).toThrow();
  });
});

describe("EncryptDecrypt", () => {
  it("should encrypt and decrypt roundtrip", () => {
    const plaintext = Buffer.from("hello world");
    const keystore = encryptBytes(plaintext, "password");
    const decrypted = decryptBytes(keystore, "password");
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("should reject wrong password on decrypt", () => {
    const plaintext = Buffer.from("secret");
    const keystore = encryptBytes(plaintext, "correct");
    expect(() => decryptBytes(keystore, "wrong")).toThrow(DecryptionError);
  });

  it("should produce Keystore V3 structure", () => {
    const keystore = encryptBytes(Buffer.from("test"), "pw");
    expect(keystore.version).toBe(3);
    expect(keystore.crypto.cipher).toBe("aes-128-ctr");
    expect(keystore.crypto.kdf).toBe("scrypt");
    expect(keystore.crypto.kdfparams.n).toBe(262144);
    expect(keystore.crypto.kdfparams.r).toBe(8);
    expect(keystore.crypto.kdfparams.p).toBe(1);
    expect(keystore.crypto.kdfparams.dklen).toBe(32);
  });
});

describe("CrossPassword", () => {
  it("should fail to load private key with wrong password", () => {
    const storeA = createStore("password-A");
    storeA.savePrivateKey("test", randomBytes(32));
    const storeB = new SecureKVStore(secretsDir, "password-B");
    expect(() => storeB.loadPrivateKey("test")).toThrow();
  });

  it("should fail to load credential with wrong password", () => {
    const storeA = createStore("password-A");
    storeA.saveCredential("test", "secret-value");
    const storeB = new SecureKVStore(secretsDir, "password-B");
    expect(() => storeB.loadCredential("test")).toThrow();
  });
});
