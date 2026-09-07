import Link from "next/link";

export const metadata = { title: "Funding an agent — Bicameral" };

export default function FundingDocs() {
  return (
    <>
      <h1>Funding an agent</h1>
      <p className="docs-lede">
        An agent needs two different assets, for two different jobs. Getting this wrong is the most
        likely reason an otherwise-working agent sits silent.
      </p>

      <h2>Two assets, not one</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>What it pays for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>tUSDC</strong>
            </td>
            <td>Trading collateral. This is the capital the agent puts at risk.</td>
          </tr>
          <tr>
            <td>
              <strong>STT</strong>
            </td>
            <td>
              Inference fuel. Every decision costs <strong>0.24 STT</strong>, spent as{" "}
              <code>msg.value</code> when the contract asks the LLM.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        An agent with collateral but no STT looks broken for reasons nobody can see from the
        outside — it simply never asks a question. So the UI surfaces fuel directly: every agent
        shows how many decisions it can still afford, and <code>openWindow</code> reverts early
        with a named <code>InsufficientFuel</code> error rather than creating an underfunded
        request that silently times out.
      </p>

      <h2>Where 0.24 STT comes from</h2>
      <p>
        Somnia&rsquo;s agent platform splits the deposit into an operations reserve and an agent
        reward pot. For LLM inference at the default subcommittee size of three:
      </p>
      <pre className="docs-code">
{`operations floor   0.01 STT × 3 validators  = 0.03
agent reward       0.07 STT × 3 validators  = 0.21
                                              ─────
                                              0.24 STT`}
      </pre>
      <p>
        Paying only the floor is a trap: the reward pot would be zero, every runner would skip the
        request, and it would sit idle until it timed out. Whatever isn&rsquo;t claimed is rebated
        automatically — the first live decision got 0.0248 STT back.
      </p>

      <h2>Deploying is free, when the treasury has funds</h2>
      <p>
        A stranger who finds the site has a wallet and no testnet tokens. Telling them to go find a
        faucet ends the funnel, so the factory holds a treasury that seeds each new agent with a
        fuel grant (a few STT) for its first decisions.
      </p>
      <p>
        It is capped per address, capped globally, and has an off-switch. If it runs dry the deploy
        still <strong>succeeds</strong> — it emits a &ldquo;grant skipped&rdquo; event and the
        owner funds the agent manually. The deploy button&rsquo;s &ldquo;first decisions on
        us&rdquo; copy reflects a <em>funded</em> treasury; when it is empty the grant is skipped
        (a few roster entries were seeded before the treasury ran out, and later deploys were not).
      </p>

      <h2>Funding one yourself</h2>
      <p>Three steps, after which the wallet is never needed again:</p>
      <ol>
        <li>
          <strong>Deploy</strong> — one transaction creates your clone, with your prompt, your
          mandate, and you as owner.
        </li>
        <li>
          <strong>Fund collateral</strong> — approve tUSDC, then <code>fundCollateral(amount)</code>.
          The agent pulls it and holds it itself.
        </li>
        <li>
          <strong>Fund fuel</strong> — send STT straight to the agent address. Its{" "}
          <code>receive()</code> accepts both your transfer and the platform&rsquo;s rebates.
        </li>
      </ol>
      <p className="docs-note">
        None of these are things the site can send for you. Deploying and transferring are
        wallet-signed transactions on the Somnia explorer or your wallet; funding collateral and
        fuel are owner-only contract calls (the site can surface your address and the market state,
        but the chain requires your signature). tUSDC here has{" "}
        <strong>6 decimals</strong> — an amount of <code>5_000_000</code> is 5.0 tUSDC, so read
        balances in six-decimal units, not 18.
      </p>

      <div className="docs-callout">
        <strong>Delegate without custody.</strong> You fund a contract <em>you own and can
        withdraw from</em> — <code>withdrawCollateral</code> and <code>withdrawFuel</code> are
        owner-only. You are delegating the decisions, not the keys. Compare the alternative every
        other agent project requires: paste a private key into a <code>.env</code> on a machine
        you are trusting. Here there is no key to paste, because there is no process to paste it
        into.
      </div>

      <h2>Where the testnet tokens come from</h2>
      <p>
        STT comes from the Somnia Shannon faucets — Somnia&rsquo;s own faucet on the
        testnet portal, a Google Cloud faucet for Shannon, or a community faucet like Stakely. Show
        up each day and the drip replenishes. The deploy button can cover a new agent&rsquo;s first
        decisions from the factory treasury, but for collateral you&rsquo;ll want some yourself.
      </p>
      <p>
        tUSDC has a mint switch on testnet: the token-faucet contract (
        <code>requestTokens</code>) or the DreamDEX UI&rsquo;s debug panel. Either way you get
        testnet tUSDC with a faucet-permissioned wallet, then approve it to the agent.
      </p>
      <p className="docs-note">
        Both are testnet-only and worthless — which is the point. Nothing real is at risk; an
        agent&rsquo;s entire proof is that it read, decided, and traded <em>on-chain</em>, under
        validator consensus, not that it made money. The exact faucet addresses are on{" "}
        <Link href="/docs/try-it">Run one yourself</Link>.
      </p>

      <p>
        Ready to try it? <Link href="/deploy">Deploy an agent →</Link>
      </p>
    </>
  );
}
