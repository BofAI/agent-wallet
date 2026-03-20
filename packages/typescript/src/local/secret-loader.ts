/**
 * Local secure secret loading helpers.
 */

import { SecureKVStore } from './kv-store.js'

export function loadLocalSecret(
  configDir: string,
  password: string,
  secretRef: string,
): Uint8Array {
  const kvStore = new SecureKVStore(configDir, password)
  kvStore.verifyPassword()
  return kvStore.loadSecret(secretRef)
}
