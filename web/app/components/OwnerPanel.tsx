"use client";

// Client-side wallet signing for an agent's owner-only functions. Mirrors the
// raw viem + window.ethereum pattern from app/deploy/DeployForm.tsx — this is
// the only other place in the app that signs a transaction, so it deliberately
// reuses the same approach rather than introducing a wallet library for one
// more form.
//
// Two actions only, on purpose: fund fuel (the thing that gets an out-of-fuel
// agent unstuck) and withdraw collateral (the thing that gets profit out).
// fundCollateral needs an approve-then-call round trip — two transactions, one
// of which can leave a dangling allowance if the second is never sent — and
// withdrawFuel/a free-text destination address are both rarer than the two
// kept here. Cut for a demo that has to work first time, not designed away.
import { useEffect, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  type Address,
  type Abi,
} from "viem";
import { somniaTestnet } from "viem/chains";

const RPC_URL = "https://dream-rpc.somnia.network";
const CHAIN_ID_HEX = `0x${somniaTestnet.id.toString(16)}`;
const COLLATERAL_DECIMALS = 6;
const GAS_RESERVE = parseEther("0.02"); // left in the wallet so the fund tx itself can pay gas

const erc20BalanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const pub = createPublicClient({ chain: somniaTestnet, transport: http(RPC_URL) });

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

function isPositive(s: string): boolean {
  const n = Number(s);
  return Number.isFinite(n) && n > 0;
}

export function OwnerPanel({
  agent,
  owner,
  traderAbi,
  collateral,
}: {
  agent: Address;
  owner: Address;
  traderAbi: Abi;
  collateral: Address | null;
}) {
  const [account, setAccount] = useState<Address | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "error" | "done">("idle");
  const [note, setNote] = useState("");
  const [fuelAmt, setFuelAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  // Balances are public reads — shown to every visitor, connected or not, so
  // "how much fuel does this even need" never requires opening a wallet first.
  const [agentFuel, setAgentFuel] = useState<bigint | null>(null);
  const [agentCollateral, setAgentCollateral] = useState<bigint | null>(null);
  const [walletFuel, setWalletFuel] = useState<bigint | null>(null);

  const isOwner = !!account && account.toLowerCase() === owner.toLowerCase();

  async function refreshAgentBalances() {
    const [fuel, coll] = await Promise.all([
      pub.getBalance({ address: agent }),
      collateral
        ? pub.readContract({ address: collateral, abi: erc20BalanceOfAbi, functionName: "balanceOf", args: [agent] })
        : Promise.resolve(null),
    ]);
    setAgentFuel(fuel);
    setAgentCollateral(coll as bigint | null);
  }

  useEffect(() => {
    refreshAgentBalances().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, collateral]);

  useEffect(() => {
    if (!account) return;
    pub.getBalance({ address: account }).then(setWalletFuel).catch(() => {});
  }, [account]);

  function wallet() {
    return createWalletClient({ chain: somniaTestnet, transport: custom((window as any).ethereum) });
  }

  async function connect() {
    try {
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("No wallet found. Install MetaMask or another browser wallet.");
      const [acct] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
      await ensureChain(eth);
      setAccount(acct);
    } catch (err: any) {
      setStatus("error");
      setNote(err?.shortMessage || err?.message || String(err));
    }
  }

  async function run(label: string, fn: () => Promise<`0x${string}`>) {
    setStatus("working");
    setNote(`${label}…`);
    try {
      await ensureChain((window as any).ethereum);
      const hash = await fn();
      setNote("Waiting for confirmation…");
      await pub.waitForTransactionReceipt({ hash });
      setStatus("done");
      setNote(`${label} confirmed.`);
      setFuelAmt("");
      setWithdrawAmt("");
      await refreshAgentBalances();
      if (account) pub.getBalance({ address: account }).then(setWalletFuel).catch(() => {});
    } catch (err: any) {
      setStatus("error");
      setNote(err?.shortMessage || err?.message || String(err));
    }
  }

  const fundFuel = () =>
    run("Send STT fuel", () =>
      wallet().sendTransaction({ account: account!, to: agent, value: parseEther(fuelAmt) }),
    );

  const withdrawCollateral = () =>
    run("Withdraw collateral", () =>
      wallet().writeContract({
        account: account!,
        address: agent,
        abi: traderAbi,
        functionName: "withdrawCollateral",
        args: [parseUnits(withdrawAmt, COLLATERAL_DECIMALS), account!],
      }),
    );

  const maxFundable = walletFuel !== null && walletFuel > GAS_RESERVE ? walletFuel - GAS_RESERVE : 0n;

  return (
    <section>
      <h2>Manage this agent</h2>

      <div className="owner-grid">
        <div>
          <div className="sub" style={{ marginBottom: 8 }}>
            Agent&rsquo;s fuel (STT)
          </div>
          <div className="owner-balance">{agentFuel === null ? "—" : formatEther(agentFuel)}</div>
        </div>
        <div>
          <div className="sub" style={{ marginBottom: 8 }}>
            Agent&rsquo;s collateral (tUSDC)
          </div>
          <div className="owner-balance">
            {agentCollateral === null ? "—" : formatUnits(agentCollateral, COLLATERAL_DECIMALS)}
          </div>
        </div>
      </div>

      {!account ? (
        <>
          <p className="sub" style={{ marginTop: 16 }}>
            Connect the owner&rsquo;s wallet to fund or withdraw.
          </p>
          <button type="button" className="cta" onClick={connect}>
            Connect wallet
          </button>
        </>
      ) : !isOwner ? (
        <p className="sub" style={{ marginTop: 16 }}>
          Connected as <span className="addr">{account}</span>, not this agent&rsquo;s owner (
          <span className="addr">{owner}</span>). Switch wallets to manage it.
        </p>
      ) : (
        <div className="owner-grid" style={{ marginTop: 16 }}>
          <div>
            <div className="sub" style={{ marginBottom: 8 }}>
              Fund fuel (STT) — your wallet has {walletFuel === null ? "—" : formatEther(walletFuel)}
            </div>
            <div className="owner-inline">
              <input
                value={fuelAmt}
                onChange={(e) => setFuelAmt(e.target.value)}
                className="owner-input"
                placeholder="amount"
                inputMode="decimal"
              />
              <button
                type="button"
                className="tag"
                onClick={() => setFuelAmt(formatEther(maxFundable))}
                disabled={maxFundable <= 0n}
              >
                Max
              </button>
              <button
                type="button"
                className="tag live"
                onClick={fundFuel}
                disabled={status === "working" || !isPositive(fuelAmt)}
              >
                Send
              </button>
            </div>
          </div>

          <div>
            <div className="sub" style={{ marginBottom: 8 }}>
              Withdraw collateral (tUSDC) — agent holds{" "}
              {agentCollateral === null ? "—" : formatUnits(agentCollateral, COLLATERAL_DECIMALS)}
            </div>
            <div className="owner-inline">
              <input
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                className="owner-input"
                placeholder="amount"
                inputMode="decimal"
              />
              <button
                type="button"
                className="tag"
                onClick={() => setWithdrawAmt(agentCollateral !== null ? formatUnits(agentCollateral, COLLATERAL_DECIMALS) : "")}
                disabled={!agentCollateral}
              >
                Max
              </button>
              <button
                type="button"
                className="tag warn"
                onClick={withdrawCollateral}
                disabled={status === "working" || !isPositive(withdrawAmt)}
              >
                Withdraw
              </button>
            </div>
            <div className="sub" style={{ marginTop: 6, fontSize: 12.5 }}>
              Sent to your connected wallet.
            </div>
          </div>
        </div>
      )}

      {note && (
        <p className="sub" style={{ marginTop: 14, color: status === "error" ? "var(--bad)" : "var(--dim)" }}>
          {note}
        </p>
      )}
    </section>
  );
}
