"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { addRequest, upvote } from "../../lib/requests";

const VOTED_COOKIE = "voted_requests";

async function alreadyVoted(id: string): Promise<boolean> {
  const jar = await cookies();
  return (jar.get(VOTED_COOKIE)?.value ?? "").split(",").includes(id);
}

async function markVoted(id: string) {
  const jar = await cookies();
  const existing = (jar.get(VOTED_COOKIE)?.value ?? "").split(",").filter(Boolean);
  jar.set(VOTED_COOKIE, [...existing, id].join(","), {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

export async function createRequest(formData: FormData) {
  const market = String(formData.get("market") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!market) return;
  const row = await addRequest(market, note);
  await markVoted(row.id); // your own request starts at 1 vote, from you
  revalidatePath("/requests");
}

export async function upvoteRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id || (await alreadyVoted(id))) return;
  await upvote(id);
  await markVoted(id);
  revalidatePath("/requests");
}
