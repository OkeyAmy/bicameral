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
        faucet ends the funnel, so the factory holds a treasury that seeds each new agent with
        enough STT for its first decisions.
      </p>
      <p>
        It is capped per address, capped globally, and has an off-switch. If it runs dry the deploy
        still <strong>succeeds</strong> — it emits a &ldquo;grant skipped&rdquo; event and the
        owner funds the agent manually. It degrades; it does not fail.
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

      <div className="docs-callout">
        <strong>Delegate without custody.</strong> You fund a contract <em>you own and can
        withdraw from</em> — <code>withdrawCollateral</code> and <code>withdrawFuel</code> are
        owner-only. You are delegating the decisions, not the keys. Compare the alternative every
        other agent project requires: paste a private key into a <code>.env</code> on a machine
        you are trusting. Here there is no key to paste, because there is no process to paste it
        into.
      </div>

      <p>
        Ready to try it? <Link href="/deploy">Deploy an agent →</Link>
      </p>
    </>
  );
}
