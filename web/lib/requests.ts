// The requests board: a public "what would you like DreamDEX to list" list.
//
// Deliberately trivial, per claude.md: "Keep it off-chain or as a trivial
// signed-message contract; it is not the product." A JSON file is enough —
// this is a demand signal, not the thing being judged.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface MarketRequest {
  id: string;
  market: string;
  note?: string;
  votes: number;
  createdAt: number;
}

const DIR = join(process.cwd(), "data");
const FILE = join(DIR, "requests.json");

async function ensure(): Promise<MarketRequest[]> {
  if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
  if (!existsSync(FILE)) {
    await writeFile(FILE, "[]", "utf8");
    return [];
  }
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}

async function save(rows: MarketRequest[]) {
  await writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

export async function listRequests(): Promise<MarketRequest[]> {
  const rows = await ensure();
  return rows.sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
}

export async function addRequest(market: string, note: string): Promise<MarketRequest> {
  const rows = await ensure();
  const row: MarketRequest = {
    id: crypto.randomUUID(),
    market: market.trim().slice(0, 80),
    note: note.trim().slice(0, 200) || undefined,
    votes: 1,
    createdAt: Date.now(),
  };
  rows.push(row);
  await save(rows);
  return row;
}

export async function upvote(id: string): Promise<void> {
  const rows = await ensure();
  const row = rows.find((r) => r.id === id);
  if (row) {
    row.votes++;
    await save(rows);
  }
}
