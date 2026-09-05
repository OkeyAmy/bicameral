// Repo-root .env access, without dragging in the chain client.
//
// Next only auto-loads `.env` from the app directory (`web/`), but this repo
// keeps a single `.env` at the root so the contracts, the runner and the site
// all read the same file. Most pages get it transitively, because importing
// `lib/floor` pulls in the runner's config which loads it — but a page that
// only needs one address shouldn't have to import viem and the markets SDK to
// see it.
import { config as loadEnv } from "dotenv";
import { ENV_FILE } from "@bicameral/runner/src/paths.js";

loadEnv({ path: ENV_FILE() });

export const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || null;
export const IMPLEMENTATION_ADDRESS = process.env.IMPLEMENTATION_ADDRESS || null;
