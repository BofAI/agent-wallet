/**
 * Local signer backed by an encrypted secret file.
 */

import type { LocalSecureWalletParams } from '../config.js'
import { LocalSigner } from './local.js'

export type SecretLoaderFn = (configDir: string, password: string, secretRef: string) => Uint8Array

export class LocalSecureSigner extends LocalSigner {
  constructor(
    params: LocalSecureWalletParams,
    configDir: string,
    password: string | undefined,
    network: string,
    secretLoader: SecretLoaderFn | undefined,
  ) {
    if (!password) throw new Error('Password required for local_secure wallets')
    if (!secretLoader) throw new Error('local_secure wallets require a configured secret loader')
    const privateKey = secretLoader(configDir, password, params.secret_ref)
    super(privateKey, network)
  }
}
