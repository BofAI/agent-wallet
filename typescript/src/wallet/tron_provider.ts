import { TronWeb } from 'tronweb';
import * as dotenv from 'dotenv';

dotenv.config();

export class TronProvider {
    protected tronWeb: any; // TronWeb instance (using any due to potential type issues with v6)
    protected address: string | null = null;

    /**
     * Initialize TronProvider
     * @param fullNode Full node URL (default: https://api.trongrid.io)
     * @param solidityNode Solidity node URL (default: https://api.trongrid.io)
     * @param eventServer Event server URL (default: https://api.trongrid.io)
     * @param privateKey Private key (hex) (default: process.env.TRON_PRIVATE_KEY)
     */
    constructor(
        fullNode: string = process.env.TRON_RPC_URL || 'https://api.trongrid.io',
        solidityNode: string = process.env.TRON_RPC_URL || 'https://api.trongrid.io',
        eventServer: string = process.env.TRON_RPC_URL || 'https://api.trongrid.io',
        privateKey: string = process.env.TRON_PRIVATE_KEY || '',
        apiKey: string = process.env.TRON_GRID_API_KEY || ''
    ) {
        // TronWeb 6.x signature: fullNode, solidityNode, eventServer, privateKey
        // Or object: { fullHost: '...', privateKey: '...' }
        // Let's use the object format if possible or fallback to standard constructor

        const options: any = {
            fullHost: fullNode,
            solidityNode: solidityNode,
            eventServer: eventServer,
            privateKey: privateKey || undefined
        };

        if (apiKey) {
            options.headers = { "TRON-PRO-API-KEY": apiKey };
        }

        this.tronWeb = new TronWeb(options);

        if (privateKey) {
            this.address = this.tronWeb.address.fromPrivateKey(privateKey);
        }
    }

    /**
     * Get TRX balance in SUN
     * @param address Wallet address
     * @returns Balance in SUN (number)
     */
    async getBalance(address?: string): Promise<number> {
        const addr = address || this.address;
        if (!addr) throw new Error("Address not provided");
        return await this.tronWeb.trx.getBalance(addr);
    }

    /**
     * Get TRC20 token balance
     * @param walletAddress Wallet address to check
     * @param contractAddress TRC20 contract address
     * @returns Balance as integer string to avoid precision loss
     */
    async getTrc20Balance(walletAddress: string, contractAddress: string): Promise<string> {
        const contract = await this.tronWeb.contract().at(contractAddress);
        const balance = await contract.balanceOf(walletAddress).call();
        return balance.toString();
    }

    /**
     * Send TRX transaction
     * @param toAddress Recipient address
     * @param amount Amount in SUN
     * @returns Transaction result
     */
    async sendTransaction(toAddress: string, amount: number): Promise<any> {
        if (!this.address) throw new Error("Private key not provided for signing");

        const tradeobj = await this.tronWeb.transactionBuilder.sendTrx(
            toAddress,
            amount,
            this.address
        );
        const signedtxn = await this.sign(tradeobj);
        const receipt = await this.tronWeb.trx.sendRawTransaction(signedtxn);
        return receipt;
    }

    /**
     * Sign a transaction object
     * @param transaction Transaction object
     * @returns Signed transaction
     */
    async sign(transaction: any): Promise<any> {
        if (!this.address) throw new Error("Private key not provided for signing");
        return await this.tronWeb.trx.sign(transaction);
    }

    /**
     * Broadcast a signed transaction
     * @param signedTransaction Signed transaction object
     * @returns Broadcast result
     */
    async broadcast(signedTransaction: any): Promise<any> {
        return await this.tronWeb.trx.sendRawTransaction(signedTransaction);
    }
}
