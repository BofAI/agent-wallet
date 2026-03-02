import { TronProvider } from "../src/wallet/tron_provider";
import { TronWeb } from "tronweb";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Keystore } from "../src/keystore";

// Mock TronWeb class
jest.mock("tronweb");

describe("TronProvider", () => {
  let provider: TronProvider;
  let mockGetBalance: jest.Mock;
  let mockSendRawTransaction: jest.Mock;
  let mockSign: jest.Mock;
  let mockSignMessageV2: jest.Mock;
  let mockContract: jest.Mock;
  let mockFromPrivateKey: jest.Mock;
  let mockSendTrx: jest.Mock;
  let tmpDir: string;
  let ksPath: string;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockGetBalance = jest.fn();
    mockSign = jest.fn();
    mockSignMessageV2 = jest.fn();
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
          signMessageV2: mockSignMessageV2,
          sendRawTransaction: mockSendRawTransaction,
        },
        address: {
          fromPrivateKey: mockFromPrivateKey,
        },
        contract: () => ({
          at: mockContract,
        }),
        transactionBuilder: {
          sendTrx: mockSendTrx,
        },
      };
    });

    mockFromPrivateKey.mockReturnValue("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb");
    mockSendTrx.mockResolvedValue({});

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tron-provider-test-"));
    ksPath = path.join(tmpDir, "Keystore");
    await Keystore.toFile(ksPath, { privateKey: "privatekey" });

    provider = new TronProvider({
      keystore: { filePath: ksPath },
    });
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize correctly", () => {
    expect(TronWeb).toHaveBeenCalledTimes(1);
    expect(mockFromPrivateKey).toHaveBeenCalledWith("privatekey");
  });

  it("should initialize with API key from keystore", async () => {
    jest.clearAllMocks();
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tron-provider-test-ak-"));
    const fp = path.join(d, "Keystore");
    await Keystore.toFile(fp, { privateKey: "privatekey" });
    new TronProvider({
      keystore: { filePath: fp },
    });
    expect(TronWeb).toHaveBeenCalledWith(expect.not.objectContaining({ headers: expect.anything() }));
    fs.rmSync(d, { recursive: true, force: true });
  });

  it("should get balance", async () => {
    mockGetBalance.mockResolvedValue(1000000);
    const balance = await provider.getBalance();
    expect(balance).toBe(1000000);
    expect(mockGetBalance).toHaveBeenCalledWith(
      "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    );
  });

  it("should get trc20 balance", async () => {
    const mockBalanceOf = jest
      .fn()
      .mockResolvedValue({ toString: () => "500" });
    // contract().at() returns contract object with balanceOf method
    mockContract.mockResolvedValue({
      balanceOf: () => ({
        call: mockBalanceOf,
      }),
    });

    const balance = await provider.getTrc20Balance(
      "walletAddr",
      "contractAddr",
    );
    expect(balance).toBe("500");
    expect(mockContract).toHaveBeenCalledWith("contractAddr");
    // Wait for promise resolution chain
    // expect(mockBalanceOf).toHaveBeenCalled(); // Should work
  });

  it("should send transaction", async () => {
    mockSign.mockResolvedValue({ signed: true });
    mockSendRawTransaction.mockResolvedValue({ result: true, txid: "123" });

    const result = await provider.sendTransaction("recipient", 100);

    expect(result).toEqual({ result: true, txid: "123" });
    expect(mockSign).toHaveBeenCalled();
    expect(mockSendRawTransaction).toHaveBeenCalledWith({ signed: true });
  });

  it("should getAccountInfo return wallet address", async () => {
    const info = await provider.getAccountInfo();
    expect(info).toEqual({ address: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb" });
  });

  it("should signTx sign and return signed result", async () => {
    const unsignedTx = { txID: "abc" };
    mockSign.mockResolvedValue({ ...unsignedTx, signature: ["sig-hex"] });
    const result = await provider.signTx(unsignedTx);
    expect(mockSign).toHaveBeenCalledWith(unsignedTx);
    expect(result.signedTx).toEqual({ txID: "abc", signature: ["sig-hex"] });
    expect(result.signature).toBe("sig-hex");
  });

  it("should signMessage return signature", async () => {
    mockSignMessageV2.mockReturnValue("msg-sig");
    const sig = await provider.signMessage(Buffer.from("hello", "utf8"));
    expect(sig).toBe("msg-sig");
  });
});
