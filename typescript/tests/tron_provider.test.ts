
import { TronProvider } from '../src/wallet/tron_provider';
import { TronWeb } from 'tronweb';

// Mock TronWeb class
jest.mock('tronweb');

describe('TronProvider', () => {
  let provider: TronProvider;
  let mockGetBalance: jest.Mock;
  let mockSendRawTransaction: jest.Mock;
  let mockSign: jest.Mock;
  let mockContract: jest.Mock;
  let mockFromPrivateKey: jest.Mock;
  let mockSendTrx: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetBalance = jest.fn();
    mockSign = jest.fn();
    mockSendRawTransaction = jest.fn();
    mockContract = jest.fn(); // at
    mockFromPrivateKey = jest.fn();
    mockSendTrx = jest.fn();

    // Setup mock implementation
    (TronWeb as unknown as jest.Mock).mockImplementation(() => {
      return {
        trx: {
          getBalance: mockGetBalance,
          sign: mockSign,
          sendRawTransaction: mockSendRawTransaction
        },
        address: {
          fromPrivateKey: mockFromPrivateKey
        },
        contract: () => ({
          at: mockContract
        }),
        transactionBuilder: {
          sendTrx: mockSendTrx
        }
      };
    });

    mockFromPrivateKey.mockReturnValue('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');
    mockSendTrx.mockResolvedValue({});

    provider = new TronProvider('http://fullnode', 'http://solidity', 'http://event', 'privatekey');
  });

  it('should initialize correctly', () => {
    expect(TronWeb).toHaveBeenCalledTimes(1);
    expect(mockFromPrivateKey).toHaveBeenCalledWith('privatekey');
  });

  it('should initialize with API key', () => {
    jest.clearAllMocks();
    new TronProvider('http://fullnode', 'http://solidity', 'http://event', 'privatekey', 'my-api-key');
    expect(TronWeb).toHaveBeenCalledWith(expect.objectContaining({
      headers: { "TRON-PRO-API-KEY": 'my-api-key' }
    }));
  });

  it('should get balance', async () => {
    mockGetBalance.mockResolvedValue(1000000);
    const balance = await provider.getBalance();
    expect(balance).toBe(1000000);
    expect(mockGetBalance).toHaveBeenCalledWith('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');
  });

  it('should get trc20 balance', async () => {
    const mockBalanceOf = jest.fn().mockResolvedValue({ toString: () => '500' });
    // contract().at() returns contract object with balanceOf method
    mockContract.mockResolvedValue({
      balanceOf: () => ({
        call: mockBalanceOf
      })
    });

    const balance = await provider.getTrc20Balance('walletAddr', 'contractAddr');
    expect(balance).toBe('500');
    expect(mockContract).toHaveBeenCalledWith('contractAddr');
    // Wait for promise resolution chain
    // expect(mockBalanceOf).toHaveBeenCalled(); // Should work
  });

  it('should send transaction', async () => {
    mockSign.mockResolvedValue({ signed: true });
    mockSendRawTransaction.mockResolvedValue({ result: true, txid: '123' });

    const result = await provider.sendTransaction('recipient', 100);

    expect(result).toEqual({ result: true, txid: '123' });
    expect(mockSign).toHaveBeenCalled();
    expect(mockSendRawTransaction).toHaveBeenCalledWith({ signed: true });
  });
});

