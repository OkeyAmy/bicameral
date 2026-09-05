// Shared config for every runner script.
//
// Design rule for this whole repo: NOTHING about the market universe is hardcoded.
// No asset list, no cadence list, no pool addresses, no market ids. Assets and
// cadences are whatever the venue is currently running; we read them at runtime.
// Protocol-core addresses come from the SDK's own address book, never from a
// literal in our source.
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, type Address } from "viem";
import { somniaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config as loadEnv } from "dotenv";
import { ENV_FILE } from "./paths.js";

loadEnv({ path: ENV_FILE() });

const env = process.env;

/** Optional: scripts that only read the chain do not need a key. */
export const PRIVATE_KEY = env.PRIVATE_KEY as `0x${string}` | undefined;

export const RPC_URL = env.RPC_URL || "https://dream-rpc.somnia.network";
export const WS_RPC_URL = env.WS_RPC_URL || "wss://api.infra.testnet.somnia.network/ws";
export const INDEXER_URL = env.INDEXER_URL || "https://dev.smk.somnia.host/v1/graphql";

/** Protocol core, from the SDK address book. Do not inline these anywhere. */
export const ADDRESSES = SOMNIA_TESTNET_ADDRESSES;

/**
 * Collateral scoping, not venue scoping.
 *
 * The template's SKILL.md is explicit: `MarketCreated` carries no venueId, so the
 * on-chain discovery path has nothing to filter venues on. Filtering by collateral
 * keeps us to markets we can actually fund. On testnet every live market shares
 * this collateral, so it is sufficient today — but it is NOT a venue filter, and
 * the indexer path (which does expose venue) should be preferred when available.
 */
export const COLLATERAL = ADDRESSES.testUsdc as Address;

/** Read-only chain client. Never needs a key. */
export const pub = createPublicClient({
  chain: somniaTestnet,
  transport: http(RPC_URL),
});

/** Collateral decimals are read from the token, never assumed. */
let _collateralDecimals: number | undefined;
export async function collateralDecimals(): Promise<number> {
  if (_collateralDecimals !== undefined) return _collateralDecimals;
  _collateralDecimals = (await pub.readContract({
    address: COLLATERAL,
    abi: [
      {
        type: "function",
        name: "decimals",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint8" }],
      },
    ] as const,
    functionName: "decimals",
  })) as number;
  return _collateralDecimals;
}

/**
 * One whole contract, in collateral base units.
 *
 * Testnet tUSDC is 6 decimals; mainnet USDso is 18 — a factor of 1e12. The docs
 * warn that a literal which works on testnet misprices every order and balance on
 * mainnet and NOTHING REVERTS to tell you. So this is derived, never written down.
 */
export async function oneContract(): Promise<bigint> {
  return 10n ** BigInt(await collateralDecimals());
}

/** Probability prices are 1e6 fixed point on the venue, independent of collateral decimals. */
export const PRICE_SCALE = 1_000_000n;
export const probabilityToPrice = (p: number): bigint =>
  BigInt(Math.round(p * Number(PRICE_SCALE)));
export const priceToProbability = (price: bigint): number =>
  Number(price) / Number(PRICE_SCALE);

/** The SDK exchange object. Only built when a key is present (writes + indexer reads). */
export function exchange(): SomniaMarkets {
  if (!PRIVATE_KEY || PRIVATE_KEY === "0x...") {
    throw new Error("PRIVATE_KEY missing in .env — this script needs one.");
  }
  return new SomniaMarkets({
    chain: somniaTestnet,
    addresses: ADDRESSES,
    privateKey: PRIVATE_KEY,
    // wsRpcUrl is REQUIRED — loadMarkets() throws without it.
    wsRpcUrl: WS_RPC_URL,
    indexerUrl: INDEXER_URL,
  });
}

export const me = (): Address => {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env");
  return privateKeyToAccount(PRIVATE_KEY).address;
};

/**
 * The SDK opens a websocket that keeps node's event loop alive, so scripts hang
 * after their last line. Call this instead of falling off the end.
 */
export function done(code = 0): never {
  process.exit(code);
}
