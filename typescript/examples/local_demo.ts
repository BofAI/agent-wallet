import * as os from 'os';
import * as path from 'path';
import { Keystore } from '../src/keystore';
import { FlashProvider } from '../src/wallet';
import { TronProvider } from '../src/wallet/tron_provider';

/**
 * Local-only demo that exercises SDK methods without network calls.
 *
 * Run:
 *   cd typescript
 *   npm run example:local-demo
 */

class LocalTronProvider extends TronProvider {
  /** Local stub: sign "transaction" without Tron RPC. */
  override async sign(transaction: any): Promise<any> {
    // For demo purposes, treat tx.txID as a hex string and sign that message.
    const txID = transaction?.txID ?? '00';
    const msg = typeof txID === 'string' ? txID : JSON.stringify(txID);
    const sig = await this.signMessage(Buffer.from(msg, 'utf8'));
    return { ...transaction, signature: [sig] };
  }

  override async getBalance(_address?: string): Promise<number> {
    return 123_456_789;
  }

  override async getTrc20Balance(_walletAddress: string, _contractAddress: string): Promise<string> {
    return '1000000';
  }

  override async sendTransaction(_toAddress: string, _amount: number): Promise<any> {
    return { result: true, txid: 'LOCAL_TXID' };
  }

  override async broadcast(_signedTransaction: any): Promise<any> {
    return { result: true, txid: 'LOCAL_BROADCAST_TXID' };
  }
}

class LocalFlashProvider extends FlashProvider {
  override async sign(transaction: any): Promise<any> {
    // Keep it local even if Privy creds exist.
    return (this as any).__proto__.__proto__.sign.call(this, transaction);
  }

  override async sendTransaction(_toAddress: string, _amount: number): Promise<any> {
    return { result: true, txid: 'LOCAL_FLASH_TXID' };
  }
}

async function main(): Promise<void> {
  const tmpKeystorePath = path.join(os.tmpdir(), `agent-wallet-keystore-${Date.now()}.bin`);

  // ===== Keystore (all methods) =====
  const ks = new Keystore({ filePath: tmpKeystorePath });
  console.log('[keystore] path:', ks.getPath());

  await ks.read();
  await ks.set('privateKey', '11'.repeat(32)); // demo-only key, do not use in production
  await ks.write();

  console.log('[keystore] keys:', await ks.keys());
  console.log('[keystore] privateKey len:', (await ks.get('privateKey'))?.length);
  console.log('[keystore] all:', await ks.getAll());

  const snap = await Keystore.fromFile(tmpKeystorePath);
  console.log('[keystore] fromFile:', snap);
  await Keystore.toFile(tmpKeystorePath, { ...snap, note: 'updated by toFile' });

  // ===== TronProvider (all methods, local stubs) =====
  const tron = new LocalTronProvider({ keystore: { filePath: tmpKeystorePath } });
  await tron.init();

  console.log('[tron] account:', await tron.getAccountInfo());
  console.log('[tron] signMessage:', await tron.signMessage(Buffer.from('hello', 'utf8')));
  console.log('[tron] signTx(tx):', await tron.signTx({ txID: 'tx-demo' }));
  console.log('[tron] sign(tx):', await tron.sign({ txID: 'tx-demo-2' }));
  console.log('[tron] balance:', await tron.getBalance());
  console.log('[tron] trc20 balance:', await tron.getTrc20Balance('wallet', 'contract'));
  console.log('[tron] sendTransaction:', await tron.sendTransaction('recipient', 1));
  console.log('[tron] broadcast:', await tron.broadcast({ signature: ['x'] }));

  // ===== FlashProvider (all methods, local stubs) =====
  const flash = new LocalFlashProvider({ keystore: { filePath: tmpKeystorePath } });
  await flash.init();
  console.log('[flash] signMessage:', await flash.signMessage(Buffer.from('hello', 'utf8')));
  console.log('[flash] sign(tx):', await flash.sign({ txID: 'flash-tx' }));
  console.log('[flash] sendTransaction:', await flash.sendTransaction('recipient', 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

