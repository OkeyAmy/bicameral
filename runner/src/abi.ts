// ABIs are loaded from the Foundry build artifacts, so the vendored
// `contracts/src/IEventContracts.sol` (verbatim from the official DreamDEX
// hackathon template) is the single source of truth for every signature.
//
// Nothing in this repo restates a venue ABI by hand.
import { readFileSync } from "node:fs";
import { ARTIFACTS, join } from "./paths.js";
import type { Abi } from "viem";



function artifact(file: string, name: string): Abi {
  try {
    const json = JSON.parse(readFileSync(join(ARTIFACTS(), file, `${name}.json`), "utf8"));
    return json.abi as Abi;
  } catch (err) {
    throw new Error(
      `Missing Foundry artifact ${file}/${name}.json — run \`pnpm build:contracts\` first.\n${err}`,
    );
  }
}

export const binaryPoolAbi = artifact("IEventContracts.sol", "IBinaryPool");
export const binaryMarketAbi = artifact("IEventContracts.sol", "IBinaryMarket");
export const binaryMarketsModuleAbi = artifact("IEventContracts.sol", "IBinaryMarketsModule");
export const outcomeToken6909Abi = artifact("IEventContracts.sol", "IOutcomeToken6909");
export const erc20LikeAbi = artifact("IEventContracts.sol", "IERC20Like");

/** Order encoding, from the interface's own NatSpec. */
export const Kind = { BUY_YES: 0, SELL_YES: 1, BUY_NO: 2, SELL_NO: 3 } as const;
export const OrderType = { LIMIT: 0, FOK: 1, IOC: 2, POST_ONLY: 3 } as const;
