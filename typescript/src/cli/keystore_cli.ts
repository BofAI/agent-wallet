#!/usr/bin/env node
/**
 * Keystore CLI: read/write keystore storage.
 *
 * Usage:
 *   npx ts-node src/cli/keystore_cli.ts read [key]     # read one key or all
 *   npx ts-node src/cli/keystore_cli.ts write <key> <value>  # write one key
 *   npx ts-node src/cli/keystore_cli.ts delete <key>   # remove one key
 *   npx ts-node src/cli/keystore_cli.ts init           # create empty keystore
 *
 * Options:
 *   --path <file>    Keystore file path (default: ./.keystore.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Keystore } from '../keystore';

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i >= process.argv.length - 1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const filePath = getArg('--path') ?? process.env.KEYSTORE_PATH ?? path.join(require('os').homedir(), '.agent_wallet', 'Keystore');

  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--path') {
      i++;
      continue;
    }
    if (!argv[i].startsWith('--')) args.push(argv[i]);
  }
  const cmd = args[0]?.toLowerCase();

  const keystore = new Keystore({ filePath });

  if (!cmd || cmd === 'help' || hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Keystore CLI - read/write keystore storage

  read [key]              Read one key or all keys
  write <key> <value>     Write one key (value can be quoted)
  delete <key>            Delete one key
  init                    Create empty keystore file

Options:
  --path <file>           Keystore file (default: ./.keystore.json)
`);
    return;
  }

  try {
    if (cmd === 'read') {
      const key = args[1];
      await keystore.read();
      if (key) {
        const value = await keystore.get(key);
        if (value === undefined) {
          console.error(`Key not found: ${key}`);
          process.exit(1);
        }
        console.log(value);
      } else {
        const all = await keystore.getAll();
        if (Object.keys(all).length === 0) {
          console.log('{}');
        } else {
          console.log(JSON.stringify(all, null, 2));
        }
      }
      return;
    }

    if (cmd === 'write') {
      const key = args[1];
      const value = args.slice(2).join(' ').replace(/^["']|["']$/g, '');
      if (!key || args.length < 3) {
        console.error('Usage: write <key> <value>');
        process.exit(1);
      }
      await keystore.read();
      await keystore.set(key, value);
      await keystore.write();
      console.log(`Written: ${key}`);
      return;
    }

    if (cmd === 'delete') {
      const key = args[1];
      if (!key) {
        console.error('Usage: delete <key>');
        process.exit(1);
      }
      await keystore.read();
      const all = await keystore.getAll();
      if (!(key in all)) {
        console.error(`Key not found: ${key}`);
        process.exit(1);
      }
      delete all[key];
      await Keystore.toFile(filePath, all);
      console.log(`Deleted: ${key}`);
      return;
    }

    if (cmd === 'init') {
      if (fs.existsSync(filePath)) {
        console.error(`File already exists: ${filePath}`);
        process.exit(1);
      }
      await Keystore.toFile(filePath, {});
      console.log(`Created: ${filePath}`);
      return;
    }

    console.error(`Unknown command: ${cmd}. Use read, write, delete, init.`);
    process.exit(1);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
