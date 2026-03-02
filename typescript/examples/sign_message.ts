import { TronProvider } from "../src/wallet";

function usage(): never {
  // eslint-disable-next-line no-console
  console.error(
    [
      "Usage:",
      '  TRON_PRIVATE_KEY=... npm run example:sign-message -- "hello" [utf8|hex]',
      "",
      "Notes:",
      "  - This example converts CLI input to bytes locally. The SDK signMessage API takes bytes only.",
      "  - For hex, the message must be a hex string (no 0x prefix).",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  const parseAs = (process.argv[3] ?? "utf8") as "utf8" | "hex";
  if (!raw) usage();
  if (parseAs !== "utf8" && parseAs !== "hex") usage();

  const messageBytes =
    parseAs === "hex" ? Buffer.from(raw, "hex") : Buffer.from(raw, "utf8");

  const provider = new TronProvider({
    privateKey: process.env.TRON_PRIVATE_KEY,
  });
  await provider.init();

  const sig = await provider.signMessage(messageBytes);
  // eslint-disable-next-line no-console
  console.log(sig);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e?.stack ?? String(e?.message ?? e));
  process.exit(1);
});

