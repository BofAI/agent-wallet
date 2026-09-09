const assert = require('node:assert/strict')

const root = require('../dist/index.cjs')
const advanced = require('../dist/advanced.cjs')
const integration = require('../dist/integrations/wallet-cli.cjs')

const SOURCE_ADDRESS = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH'
const SOURCE_HEX = '41c8599111f29c1e1e061265b4af93ea1f274ad78a'
const unsigned = {
  txID: 'known-build-id',
  raw_data: {
    contract: [{ parameter: { value: { owner_address: SOURCE_HEX } } }],
  },
}

let networkError
try {
  advanced.parseWalletCliNetwork('tron:nile')
} catch (error) {
  networkError = error
}
assert(networkError instanceof root.WalletError)
assert(networkError instanceof root.NetworkError)

const wallet = {
  async getAddress() {
    return SOURCE_ADDRESS
  },
  async signTransaction(transaction) {
    return { family: 'tron', transaction: { ...transaction, signature: ['fixture'] } }
  },
}
const responses = [
  {
    schema: 'wallet-cli.result.v1',
    success: true,
    command: 'tx.send',
    data: {
      kind: 'send',
      mode: 'dry-run',
      tx: unsigned,
      fee: {},
      rawAmount: '1',
      to: SOURCE_ADDRESS,
    },
    meta: { durationMs: 1, warnings: [] },
  },
]
const client = {
  async ensureCompatible(target) {
    return {
      version: '4.13.0',
      catalog: { tool: 'wallet-cli', version: '4.13.0', globalFlags: [], commands: [] },
      networks: [],
      network: {
        id: target.cliNetwork,
        family: target.family,
        chainId: target.requestedChainId,
      },
    }
  },
  async run() {
    if (responses.length > 0) return responses.shift()
    throw new root.WalletCliExecutionError('broadcast timed out', 'timeout')
  },
}

integration
  .signAndBroadcast(wallet, client, {
    to: SOURCE_ADDRESS,
    rawAmount: '1',
    network: 'tron:3448148188',
  })
  .then((result) => {
    assert.deepEqual(result, { txId: 'known-build-id', stage: 'timeout' })
  })
  .catch((error) => {
    process.nextTick(() => {
      throw error
    })
    process.exitCode = 1
  })
