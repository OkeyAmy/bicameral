import Link from "next/link";

export const metadata = { title: "Run one yourself — Bicameral" };

const EXPLORER = "https://shannon-explorer.somnia.network";

export default function TryIt() {
  return (
    <>
      <h1>Run one yourself</h1>
      <p className="docs-lede">
        Everything here is on Somnia Shannon testnet (chain <code>50312</code>) with play money.
        You need two different test assets to make an agent act, and then something has to call it.
        This page assumes you start from nothing.
      </p>

      <h2>The two assets, again</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Job</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>STT</strong>
            </td>
            <td>Gas, and the fuel every decision spends. You need a little just to send any transaction.</td>
          </tr>
          <tr>
            <td>
              <strong>tUSDC</strong>
            </td>
            <td>Trading collateral — the capital an agent puts at risk on a market.</td>
          </tr>
        </tbody>
      </table>

      <h2>Get tokens</h2>
      <h3>STT (gas + fuel)</h3>
      <ul>
        <li>
          Google Cloud Web3 faucet —{" "}
          <a
            href="https://cloud.google.com/application/web3/faucet/somnia/shannon"
            target="_blank"
            rel="noreferrer"
          >
            cloud.google.com/application/web3/faucet/somnia/shannon
          </a>
        </li>
        <li>
          Stakely —{" "}
          <a href="https://stakely.io/faucet/somnia-testnet-stt" target="_blank" rel="noreferrer">
            stakely.io/faucet/somnia-testnet-stt
          </a>
        </li>
        <li>
          Somnia Testnet Hub faucet —{" "}
          <a href="https://testnet.somnia.network/" target="_blank" rel="noreferrer">
            testnet.somnia.network
          </a>
        </li>
        <li>
          DreamDEX&#39;s own <code>/simple/debug</code> faucet (mints the test trading tokens — see
          below).
        </li>
      </ul>
      <p className="docs-note">
        Public STT faucets are rate-limited and small (0.001&ndash;0.1 STT a claim), and a single
        decision costs 0.24 STT. If you need a meaningful balance, the fastest path is to ask a
        friend on the network, or the venue&#39;s own community channels.
      </p>

      <h3>tUSDC (trading collateral)</h3>
      <p>
        Testnet tUSDC is a faucet-enabled token, not something you buy. Mint it from the testnet
        token-faucet contract at{" "}
        <a
          className="addr"
          href={`${EXPLORER}/address/0x89Ebc05dE83aB9752B95030218BB10A542b96B7C`}
          target="_blank"
          rel="noreferrer"
        >
          0x89Ebc05dE83aB9752B95030218BB10A542b96B7C
        </a>{" "}
        (call <code>requestTokens(tokens, amounts)</code>), or through DreamDEX&#39;s in-app faucet
        at <code>/simple/debug</code>. The collateral token this project uses is tUSDC at{" "}
        <a
          className="addr"
          href={`${EXPLORER}/address/0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E`}
          target="_blank"
          rel="noreferrer"
        >
          0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E
        </a>{" "}
        (6 decimals).
      </p>

      <h2>Deploy — the UI route</h2>
      <p>
        On <Link href="/deploy">Deploy</Link>, connect a wallet, name the agent, write (or pick) a
        strategy, keep or scope the mandate, and confirm. The clone is an EIP-1167 minimal proxy
        of one immutable implementation, so the prompt is the only thing that differs between
        agents. The deploy button advertises &ldquo;first decisions on us&rdquo; when the
        factory treasury has fuel to grant (a few STT, roughly a dozen decisions at the default
        subcommittee size); it still succeeds (and refunds its grant) when the
        treasury is dry — you then fund fuel manually as below.
      </p>
      <p className="docs-note">
        Deploying only <em>creates</em> the agent. It grants fuel in the best case, but it cannot
        grant collateral (the factory cannot give away other people&rsquo;s tUSDC), so a fresh
        agent still needs the funding steps below to be tradable.
      </p>

      <h2>Fund collateral</h2>
      <p>
        Collateral is pulled, not pushed: approve tUSDC to the agent address, then call
        <code>fundCollateral(amount, to)</code> (amount in 6-decimal units) with the wallet that
        owns the agent. These are owner-only actions, so you do them once from your wallet; after
        that the contract holds its own capital and no key is needed again.
      </p>

      <h2>Fund fuel</h2>
      <p>
        Send STT straight to the agent&rsquo;s address. Its <code>receive()</code> accepts both
        your transfer and the platform&rsquo;s rebates. A decision costs 0.24 STT, so each STT buys
        roughly four decisions — send a few STT for a meaningful run, more for a full-day one.
      </p>

      <h2>Something has to call it</h2>
      <p>
        Opening a window is permissionless, but it has to happen. Two options:
      </p>
      <ol>
        <li>
          <strong>Run the keeper.</strong> From a checkout of this repo:
        </li>
      </ol>
      <pre className="docs-code">
{`pnpm install
pnpm build:contracts
# set FACTORY_ADDRESS, PRIVATE_KEY and RPC in .env (see .env.example)
pnpm keeper`}
      </pre>
      <p>
        The keeper scans the factory&rsquo;s registered markets, and for each live window calls{" "}
        <code>openWindow</code> on every agent whose mandate covers it. It holds no authority —
        it cannot trade, move collateral, or edit a strategy — so it is safe to run polling on a
        schedule or in a loop.
      </p>
      <p>
        Watch it in dry-run first: the repo ships <code>DRY_RUN=true</code> by default, which
        simulates every call against the live chain and reports what it <em>would</em> have done
        without sending a transaction. Flip <code>DRY_RUN=false</code> only when you are ready to
        send live ones.
      </p>
      <h3>The full command set</h3>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Command</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>pnpm discover</code>
            </td>
            <td>Every live DreamDEX window, straight from chain logs — no key, no indexer.</td>
          </tr>
          <tr>
            <td>
              <code>pnpm preflight</code>
            </td>
            <td>Verifies every on-chain read the agent makes (book layout, grid, decimals).</td>
          </tr>
          <tr>
            <td>
              <code>pnpm seed</code>
            </td>
            <td>Once-only deploy of the reference agent roster to the factory.</td>
          </tr>
          <tr>
            <td>
              <code>pnpm keeper</code>
            </td>
            <td>The cycle runner — pokes every eligible window (dry-run by default).</td>
          </tr>
          <tr>
            <td>
              <code>pnpm index</code>
            </td>
            <td>Chain logs &rarr; <code>results/receipts.jsonl</code>, the evidence corpus.</td>
          </tr>
          <tr>
            <td>
              <code>pnpm verify</code>
            </td>
            <td>Re-derives every published number from a public RPC; writes <code>RESULTS.md</code>.</td>
          </tr>
          <tr>
            <td>
              <code>pnpm web</code>
            </td>
            <td>This site locally (stdout gives you the port).</td>
          </tr>
        </tbody>
      </table>

      <h2>What a live run looks like</h2>
      <p>
        With fuel, collateral, and a keeper running, an agent will, for each window its mandate
        matches: read the live book, ask the on-chain LLM (2-of-3 validators must agree), run the
        result through the deterministic risk gate, and place an IOC order in the same transaction
        — or publish the reason it refused. Every event lands in the ticker and the decision tape
        (<Link href="/docs/reading-the-board">Reading the board</Link>).
      </p>

      <p>
        Deploy in the UI: <Link href="/deploy">Deploy an agent →</Link>
      </p>
    </>
  );
}
