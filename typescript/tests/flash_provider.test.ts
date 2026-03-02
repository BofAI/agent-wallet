import { FlashProvider } from "../src/wallet/flash_provider";
import { TronWeb } from "tronweb";
import fetchMock from "jest-fetch-mock";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Keystore } from "../src/keystore";

jest.setMock("node-fetch", fetchMock);
fetchMock.enableMocks();

jest.mock("tronweb");

describe("FlashProvider", () => {
  let provider: FlashProvider;
  let mockSign: jest.Mock;
  let mockSendRawTransaction: jest.Mock;
  let mockSendTrx: jest.Mock;
  let tmpDir: string;
  let ksPath: string;

  beforeEach(async () => {
    fetchMock.resetMocks();
    jest.clearAllMocks();
    mockSign = jest.fn();
    mockSendRawTransaction = jest.fn();
    mockSendTrx = jest.fn();

    (TronWeb as unknown as jest.Mock).mockImplementation(() => {
      return {
        trx: {
          sign: mockSign,
          sendRawTransaction: mockSendRawTransaction,
        },
        transactionBuilder: {
          sendTrx: mockSendTrx,
        },
        address: {
          fromPrivateKey: jest.fn(),
        },
      };
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flash-provider-test-"));
    ksPath = path.join(tmpDir, "Keystore");
    await Keystore.toFile(ksPath, {
      privyAppId: "privy_app_id",
      privyAppSecret: "privy_app_secret",
      walletId: "privy_wallet_id",
    });

    provider = new FlashProvider({
      fullNode: "http://fullnode",
      flashNode: "http://fullnode",
      keystore: { filePath: ksPath },
    });
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should sign transaction with Privy", async () => {
    const mockTxn = { txID: "deadbeef", signature: [] };

    fetchMock.mockResponseOnce(JSON.stringify({ signature: "somesig" }));

    const signedTxn = await provider.sign(mockTxn);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.privy.io/api/v1/wallets/privy_wallet_id/sign",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "privy-app-id": "privy_app_id",
        }),
      }),
    );
    expect(signedTxn.signature).toContain("somesig");
  });

  it("should send flash transaction using Privy signer", async () => {
    const mockTxn = { txID: "deadbeef" };
    mockSendTrx.mockResolvedValue(mockTxn);
    mockSendRawTransaction.mockResolvedValue({ result: true });

    fetchMock.mockResponseOnce(JSON.stringify({ signature: "somesig" }));

    const result = await provider.sendTransaction("recipient", 100);

    expect(result.result).toBe(true);
    expect(mockSendTrx).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(mockSendRawTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: expect.arrayContaining(["somesig"]),
      }),
    );
  });

  it("should signMessage with Privy", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ signature: "msgsig" }));
    const sig = await provider.signMessage(Buffer.from("hello", "utf8"));
    expect(sig).toBe("msgsig");
  });
});
