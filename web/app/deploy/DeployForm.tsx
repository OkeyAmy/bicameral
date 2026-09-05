"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  pad,
  stringToHex,
  decodeEventLog,
  type Address,
  type Abi,
} from "viem";
import { somniaTestnet } from "viem/chains";

// Duplicated from lib/floor's cadenceLabel rather than imported: that module
// pulls in the whole server-only chain client graph, which must never reach
// this client bundle.
const cadenceLabel = (intervalSec: number): string =>
  intervalSec % 3600 === 0 ? `${intervalSec / 3600}h` : `${Math.round(intervalSec / 60)}m`;

const RPC_URL = "https://dream-rpc.somnia.network";
const CHAIN_ID_HEX = `0x${somniaTestnet.id.toString(16)}`;
const MAX_PROMPT = 500;

type Example = { label: string; risk: string; prompt: string };
type Risk = {
  minPrice: number;
  maxPrice: number;
  maxSize: number;
  minHeadroom: number;
  maxConcurrent: number;
  maxNotional: number;
};

export function DeployForm({
  factory,
  abi,
  examples,
  risk,
  assets,
  cadences,
}: {
  factory: Address;
  abi: Abi;
  examples: Example[];
  risk: Risk;
  assets: string[];
  cadences: number[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [anyMarket, setAnyMarket] = useState(true);
  const [pickedAssets, setPickedAssets] = useState<Set<string>>(new Set(assets));
  const [pickedCadences, setPickedCadences] = useState<Set<number>>(new Set(cadences));
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [note, setNote] = useState<string>("");

  function toggle<T>(set: Set<T>, setSet: (s: Set<T>) => void, v: T) {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    setSet(next);
  }

  async function ensureChain(eth: any) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (err: any) {
      if (err?.code !== 4902) throw err;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "Somnia Shannon Testnet",
            nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: ["https://shannon-explorer.somnia.network"],
          },
        ],
      });
    }
  }

  async function deploy() {
    setStatus("working");
    setNote("");
    try {
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("No wallet found. Install MetaMask or another browser wallet.");
      if (!name.trim()) throw new Error("Give the agent a name.");
      if (!prompt.trim()) throw new Error("Write a strategy, or pick an example.");
      if (prompt.length > MAX_PROMPT) throw new Error(`Strategy must be under ${MAX_PROMPT} characters.`);

      setNote("Requesting wallet access…");
      const [account] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];

      setNote("Confirming Somnia Shannon testnet…");
      await ensureChain(eth);

      const wallet = createWalletClient({ chain: somniaTestnet, transport: custom(eth) });
      const pub = createPublicClient({ chain: somniaTestnet, transport: http(RPC_URL) });

      const assetArg = anyMarket ? [] : [...pickedAssets].map((a) => pad(stringToHex(a), { size: 32 }));
      const cadenceArg = anyMarket ? [] : [...pickedCadences];

      setNote("Confirm the transaction in your wallet…");
      const hash = await wallet.writeContract({
        account,
        address: factory,
        abi,
        functionName: "deployAgent",
        args: [
          name.trim(),
          prompt.trim(),
          {
            minPrice: BigInt(risk.minPrice),
            maxPrice: BigInt(risk.maxPrice),
            maxSize: BigInt(risk.maxSize),
            minHeadroom: risk.minHeadroom,
            maxConcurrent: risk.maxConcurrent,
            maxNotional: BigInt(risk.maxNotional),
          },
          assetArg,
          cadenceArg,
          [],
          0,
        ],
      });

      setNote("Waiting for the transaction to land…");
      const receipt = await pub.waitForTransactionReceipt({ hash });

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi, data: log.data, topics: log.topics }) as any;
          if (ev.eventName === "AgentDeployed") {
            router.push(`/agents/${ev.args.agent}`);
            return;
          }
        } catch {
          /* not this log */
        }
      }
      throw new Error("Deployed, but couldn't read the agent address back. Check the Floor.");
    } catch (err: any) {
      setStatus("error");
      setNote(err?.shortMessage || err?.message || String(err));
      return;
    }
    setStatus("idle");
  }

  return (
    <>
      <section>
        <h2>Strategy</h2>
        <p className="sub">Three examples to start from, or write your own.</p>
        <div className="step-grid" style={{ marginTop: 0 }}>
          {examples.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className="step-card"
              style={{ textAlign: "left", cursor: "pointer", background: "none", font: "inherit", color: "inherit" }}
              onClick={() => {
                setName((n) => n || ex.label);
                setPrompt(ex.prompt);
              }}
            >
              <h3>{ex.label}</h3>
              <p>{ex.risk}</p>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          <label className="sub" style={{ margin: 0 }}>
            Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="fade-extremes"
            style={{
              background: "var(--raised)",
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              padding: "10px 12px",
              fontFamily: "var(--mono)",
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label className="sub" style={{ margin: 0 }}>
            Strategy, in plain English (max {MAX_PROMPT} characters)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            maxLength={MAX_PROMPT}
            style={{
              background: "var(--raised)",
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              padding: "10px 12px",
              fontSize: 14,
              lineHeight: 1.6,
              resize: "vertical",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--dimmer)" }}>
            {prompt.length}/{MAX_PROMPT} · this exact text is sent to the on-chain LLM and stored
            in the contract, public
          </span>
        </div>
      </section>

      <section>
        <h2>Markets</h2>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" checked={anyMarket} onChange={(e) => setAnyMarket(e.target.checked)} />
          Trade any market DreamDEX lists, today or later, no redeploy needed
        </label>

        {!anyMarket && (
          <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
            <div>
              <div className="sub" style={{ marginBottom: 8 }}>
                Assets
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {assets.map((a) => (
                  <label key={a} className="tag" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={pickedAssets.has(a)}
                      onChange={() => toggle(pickedAssets, setPickedAssets, a)}
                      style={{ marginRight: 6 }}
                    />
                    {a}
                  </label>
                ))}
                {assets.length === 0 && <span className="sub">No live assets to scope to right now.</span>}
              </div>
            </div>
            <div>
              <div className="sub" style={{ marginBottom: 8 }}>
                Cadences
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {cadences.map((c) => (
                  <label key={c} className="tag" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={pickedCadences.has(c)}
                      onChange={() => toggle(pickedCadences, setPickedCadences, c)}
                      style={{ marginRight: 6 }}
                    />
                    {cadenceLabel(c)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>Immutable bounds</h2>
        <p className="sub">
          Same for every agent on this board, fixed at deploy, never editable after. You&rsquo;re
          picking a strategy, not the safety rails.
        </p>
        <div className="stat-row">
          <span className="tag">price band {(risk.minPrice / 10000).toFixed(0)}%–{(risk.maxPrice / 10000).toFixed(0)}%</span>
          <span className="tag">max {risk.maxSize / 1_000_000} contracts / order</span>
          <span className="tag">expiry headroom {risk.minHeadroom}s</span>
          <span className="tag">max {risk.maxConcurrent} concurrent positions</span>
          <span className="tag">max {risk.maxNotional / 1_000_000} contracts at risk</span>
        </div>
      </section>

      <section>
        <button
          type="button"
          className="cta"
          disabled={status === "working"}
          onClick={deploy}
          style={{ border: "1.5px solid var(--signal)", color: "var(--signal)" }}
        >
          {status === "working" ? "Deploying…" : "Deploy free, first 20 decisions on us"}
        </button>
        {note && (
          <p className="sub" style={{ marginTop: 14, color: status === "error" ? "var(--bad)" : "var(--dim)" }}>
            {note}
          </p>
        )}
        <p className="sub" style={{ marginTop: 14 }}>
          Somnia Shannon testnet only. Play money, nothing real at risk.
        </p>
      </section>
    </>
  );
}
