import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Keystore } from '../src/keystore/keystore';
import { encodeKeystoreData, decodeKeystoreData } from '../src/keystore/keystore_proto';

// ---------- helpers ----------

let tmpDir: string;

function tmpFile(name: string): string {
  return path.join(tmpDir, name);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// Protobuf encode / decode
// ============================================================

describe('keystore_proto', () => {
  it('should roundtrip encode and decode an empty map', () => {
    const buf = encodeKeystoreData({});
    expect(buf.length).toBe(0);
    expect(decodeKeystoreData(buf)).toEqual({});
  });

  it('should roundtrip encode and decode a single entry', () => {
    const data = { privateKey: 'abc123' };
    const buf = encodeKeystoreData(data);
    expect(buf.length).toBeGreaterThan(0);
    expect(decodeKeystoreData(buf)).toEqual(data);
  });

  it('should roundtrip encode and decode multiple entries', () => {
    const data = {
      privateKey: 'deadbeef',
      apiKey: 'my-api-key',
      secretKey: 'super-secret',
      address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    };
    const buf = encodeKeystoreData(data);
    expect(decodeKeystoreData(buf)).toEqual(data);
  });

  it('should handle unicode values', () => {
    const data = { note: 'hello world \u{1f600}', key: '\u00e9\u00e8\u00ea' };
    const buf = encodeKeystoreData(data);
    expect(decodeKeystoreData(buf)).toEqual(data);
  });

  it('should throw on truncated buffer', () => {
    const data = { key: 'value' };
    const buf = encodeKeystoreData(data);
    const truncated = buf.subarray(0, buf.length - 3);
    expect(() => decodeKeystoreData(truncated)).toThrow();
  });
});

// ============================================================
// Keystore class — unencrypted (protobuf)
// ============================================================

describe('Keystore (unencrypted)', () => {
  it('should read empty data when file does not exist', async () => {
    const ks = new Keystore({ filePath: tmpFile('nonexistent') });
    const data = await ks.read();
    expect(data).toEqual({});
  });

  it('should write and read back data in protobuf format', async () => {
    const fp = tmpFile('ks1');
    const ks = new Keystore({ filePath: fp });
    await ks.read();
    await ks.set('privateKey', 'abc');
    await ks.write();

    // File should be binary protobuf, not JSON
    const raw = fs.readFileSync(fp);
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow(); // not valid JSON

    // Read back with a fresh instance
    const ks2 = new Keystore({ filePath: fp });
    const data = await ks2.read();
    expect(data).toEqual({ privateKey: 'abc' });
  });

  it('should preserve existing data when set() is called without prior read()', async () => {
    const fp = tmpFile('ks-preserve');
    await Keystore.toFile(fp, { existingKey: 'existingVal' });

    // set without explicit read — should auto-load
    const ks = new Keystore({ filePath: fp });
    await ks.set('newKey', 'newVal');
    await ks.write();

    const all = await Keystore.fromFile(fp);
    expect(all).toEqual({ existingKey: 'existingVal', newKey: 'newVal' });
  });

  it('get() should return undefined for missing key', async () => {
    const fp = tmpFile('ks-get');
    await Keystore.toFile(fp, { a: '1' });
    const ks = new Keystore({ filePath: fp });
    expect(await ks.get('a')).toBe('1');
    expect(await ks.get('b')).toBeUndefined();
  });

  it('keys() should return all key names', async () => {
    const fp = tmpFile('ks-keys');
    await Keystore.toFile(fp, { x: '1', y: '2', z: '3' });
    const ks = new Keystore({ filePath: fp });
    expect((await ks.keys()).sort()).toEqual(['x', 'y', 'z']);
  });

  it('getAll() should return a copy that does not affect internal state', async () => {
    const fp = tmpFile('ks-copy');
    await Keystore.toFile(fp, { k: 'v' });
    const ks = new Keystore({ filePath: fp });
    const snapshot = await ks.getAll();
    snapshot['k'] = 'modified';
    expect(await ks.get('k')).toBe('v'); // internal state unchanged
  });

  it('read() should return a copy that does not affect internal state', async () => {
    const fp = tmpFile('ks-readcopy');
    await Keystore.toFile(fp, { k: 'v' });
    const ks = new Keystore({ filePath: fp });
    const data = await ks.read();
    data['k'] = 'modified';
    expect(await ks.get('k')).toBe('v');
  });

  it('write should be atomic (tmp + rename)', async () => {
    const fp = tmpFile('ks-atomic');
    await Keystore.toFile(fp, { a: 'b' });
    // After write, no .tmp file should remain
    expect(fs.existsSync(fp + '.tmp')).toBe(false);
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('should create parent directories on write', async () => {
    const fp = path.join(tmpDir, 'deep', 'nested', 'Keystore');
    await Keystore.toFile(fp, { k: 'v' });
    expect(fs.existsSync(fp)).toBe(true);
    expect(await Keystore.fromFile(fp)).toEqual({ k: 'v' });
  });
});

// ============================================================
// Keystore — legacy JSON backward compatibility
// ============================================================

describe('Keystore (legacy JSON compat)', () => {
  it('should read a legacy unencrypted JSON file', async () => {
    const fp = tmpFile('ks-legacy');
    fs.writeFileSync(fp, JSON.stringify({ oldKey: 'oldVal' }), 'utf8');
    const ks = new Keystore({ filePath: fp });
    const data = await ks.read();
    expect(data).toEqual({ oldKey: 'oldVal' });
  });

  it('should overwrite legacy JSON with protobuf on write', async () => {
    const fp = tmpFile('ks-legacy-overwrite');
    fs.writeFileSync(fp, JSON.stringify({ a: '1' }), 'utf8');

    const ks = new Keystore({ filePath: fp });
    await ks.read();
    await ks.set('b', '2');
    await ks.write();

    // Now the file should be protobuf (not JSON)
    const raw = fs.readFileSync(fp);
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow();

    // But data is preserved
    const result = await Keystore.fromFile(fp);
    expect(result).toEqual({ a: '1', b: '2' });
  });
});
