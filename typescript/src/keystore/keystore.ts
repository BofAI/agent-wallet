import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encodeKeystoreData, decodeKeystoreData } from './keystore_proto';
import { logger } from '../logger';

/** Default keystore filename under the user's home directory */
export const DEFAULT_KEYSTORE_FILENAME = 'Keystore';

/** Account fields commonly stored (privateKey, apiKey, secretKey, address, etc.) */
export type KeystoreData = Record<string, string>;

const DEFAULT_PATH = path.join(os.homedir(), '.agent_wallet', DEFAULT_KEYSTORE_FILENAME);

export interface KeystoreOptions {
  /** Full path to keystore file. Default: ~/.agent_wallet/Keystore */
  filePath?: string;
}

/**
 * Keystore base class (abstract).
 * Providers should depend on this type, so you can inject alternative keystore
 * implementations (memory/db/etc.) without changing provider logic.
 */
export abstract class KeystoreBase {
  abstract getPath(): string;
  abstract read(): Promise<KeystoreData>;
  abstract get(key: string): Promise<string | undefined>;
  abstract set(key: string, value: string): Promise<void>;
  abstract keys(): Promise<string[]>;
  abstract getAll(): Promise<KeystoreData>;
  abstract write(): Promise<void>;

  /**
   * Optional synchronous accessors.
   * Providers may use these in constructors to read keystore-derived credentials.
   * Custom keystore implementations can omit them.
   */
  getSync?(key: string): string | undefined;
  getAllSync?(): KeystoreData;
}

/**
 * Keystore: fixed-path protobuf file storing account info.
 */
export class Keystore extends KeystoreBase {
  private filePath: string;
  private data: KeystoreData = {};
  private loaded = false;

  constructor(options: KeystoreOptions = {}) {
    super();
    this.filePath = options.filePath ?? process.env.KEYSTORE_PATH ?? DEFAULT_PATH;
  }

  getPath(): string {
    return this.filePath;
  }

  /** Read from file. Supports legacy JSON and protobuf binary format. */
  async read(): Promise<KeystoreData> {
    logger.debug({ filePath: this.filePath }, 'keystore: read start');
    if (!fs.existsSync(this.filePath)) {
      this.data = {};
      this.loaded = true;
      logger.debug({ filePath: this.filePath }, 'keystore: file missing, returning empty');
      return this.data;
    }
    const rawBuf = fs.readFileSync(this.filePath);

    // Try legacy JSON first (old plaintext format)
    let parsed: unknown;
    let parsedAsJson = false;
    try {
      const txt = rawBuf.toString('utf8');
      parsed = JSON.parse(txt) as unknown;
      parsedAsJson = true;
    } catch {
      parsedAsJson = false;
    }

    if (parsedAsJson && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      logger.debug({ filePath: this.filePath }, 'keystore: detected legacy JSON plaintext');
      this.data = parsed as KeystoreData;
    } else {
      logger.debug({ filePath: this.filePath }, 'keystore: detected protobuf binary');
      this.data = decodeKeystoreData(rawBuf);
    }
    this.loaded = true;
    logger.info({ filePath: this.filePath, keys: Object.keys(this.data).length }, 'keystore: read ok');
    return { ...this.data };
  }

  /** Synchronous accessor: get value from the loaded snapshot. */
  getSync(key: string): string | undefined {
    if (!this.loaded) {
      // `read()` performs synchronous I/O (no awaits), so this is effectively sync.
      void this.read();
    }
    return this.data[key];
  }

  /** Synchronous accessor: get all entries from the loaded snapshot. */
  getAllSync(): KeystoreData {
    if (!this.loaded) {
      void this.read();
    }
    return { ...this.data };
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.read();
    }
  }

  async get(key: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.data[key];
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureLoaded();
    this.data[key] = value;
  }

  async keys(): Promise<string[]> {
    await this.ensureLoaded();
    return Object.keys(this.data);
  }

  async getAll(): Promise<KeystoreData> {
    await this.ensureLoaded();
    return { ...this.data };
  }

  /** Write current data to file using protobuf storage. Atomic via tmp+rename. */
  async write(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = this.filePath + '.tmp';
    const protoBuf = encodeKeystoreData(this.data);
    fs.writeFileSync(tmpPath, protoBuf);
    fs.renameSync(tmpPath, this.filePath);
    logger.info({ filePath: this.filePath, keys: Object.keys(this.data).length }, 'keystore: write ok');
  }

  static async fromFile(filePath: string): Promise<KeystoreData> {
    const ks = new Keystore({ filePath });
    return ks.read();
  }

  static async toFile(filePath: string, data: KeystoreData): Promise<void> {
    const ks = new Keystore({ filePath });
    ks.data = { ...data };
    ks.loaded = true;
    await ks.write();
  }
}

