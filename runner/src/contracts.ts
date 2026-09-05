// Contract handles for the runner and the web app.
//
// Every ABI comes from the Foundry artifacts, so the Solidity sources are the
// single definition of every signature. Addresses come from .env (ours) or the
// SDK address book (the venue's) — never from a literal here.
import { readFileSync } from "node:fs";
import { ARTIFACTS, join } from "./paths.js";
import { createWalletClient, http, type Abi, type Address } from "viem";
import { somniaTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { PRIVATE_KEY, RPC_URL, ADDRESSES } from "./config.js";



function abiOf(file: string, name: string): Abi {
  try {
    return JSON.parse(readFileSync(join(ARTIFACTS(), file, `${name}.json`), "utf8")).abi as Abi;
  } catch (err) {
    throw new Error(`Missing artifact ${file}/${name}.json — run \`pnpm build:contracts\`.\n${err}`);
  }
}

export const factoryAbi = abiOf("BicameralFactory.sol", "BicameralFactory");
export const traderAbi = abiOf("BicameralTrader.sol", "BicameralTrader");

function required(name: string): Address {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing in .env`);
  return v as Address;
}

export const FACTORY = () => required("FACTORY_ADDRESS");
export const SOMNIA_AGENTS = () => required("SOMNIA_AGENTS");

/**
 * DreamDEX core, from the SDK address book — deployed via CREATE3, so these are
 * identical on testnet (50312) and mainnet (5031). The docs call it
 * `BinaryMarketsModule`; the SDK key is `binaryModule`.
 */
export const MARKETS_MODULE = (ADDRESSES as any).binaryModule as Address;
export const OUTCOME_TOKEN_HINT = (ADDRESSES as any).binaryPoolImpl as Address;

export const DRY_RUN = process.env.DRY_RUN !== "false";

export function wallet() {
  if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env");
  return createWalletClient({
    account: privateKeyToAccount(PRIVATE_KEY),
    chain: somniaTestnet,
    transport: http(RPC_URL),
  });
}
