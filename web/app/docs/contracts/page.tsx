import { FACTORY_ADDRESS, IMPLEMENTATION_ADDRESS } from "../../../lib/env";

export const metadata = { title: "Contracts — Bicameral" };

// Read at request time rather than baked at build, so the address shown can
// never be a stale copy of a previous deployment.
export const dynamic = "force-dynamic";

const EXPLORER = "https://shannon-explorer.somnia.network";

const OURS: [string, string, string][] = [
  [
    "BicameralFactory",
    FACTORY_ADDRESS ?? "not deployed",
    "Clones, on-chain registry, and the starter-fuel treasury.",
  ],
  [
    "BicameralTrader (implementation)",
    IMPLEMENTATION_ADDRESS ?? "not linked",
    "The agent. Every deployed agent is a clone of exactly this.",
  ],
];

const VENUE: [string, string][] = [
  ["BinaryMarketsModule", "0x3ecC694Cef705358864a646142ac17A90E29e388"],
  ["MarketsCore", "0x2802504314685D89bF6C992CA5a8e7cC78bc0294"],
  ["BinarySettlement", "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23"],
  ["OutcomeToken6909", "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9"],
  ["OracleHub", "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b"],
  ["SomniaAgents platform", "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776"],
  ["tUSDC collateral (6 decimals)", "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E"],
];

export default function ContractsDocs() {
  return (
    <>
      <h1>Contracts</h1>
      <p className="docs-lede">
        Two deployed contracts of our own, on Somnia Shannon testnet (chain <code>50312</code>),
        plus two libraries (<code>RiskGate</code> and <code>AgentToolLib</code>) compiled into
        the Trader. Everything else is the venue&rsquo;s or the platform&rsquo;s.
      </p>

      <h2>What we deployed</h2>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {OURS.map(([name, addr, blurb]) => (
            <tr key={name}>
              <td>
                <strong>{name}</strong>
                <br />
                <span className="docs-dim">{blurb}</span>
              </td>
              <td>
                {addr.startsWith("0x") ? (
                  <a
                    className="addr"
                    href={`${EXPLORER}/address/${addr}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {addr}
                  </a>
                ) : (
                  <span className="docs-dim">{addr}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>The pieces</h2>
      <h3>BicameralTrader</h3>
      <p>
        The agent itself. Holds its own collateral and its own inference fuel, stores the strategy
        as plain text, and runs the loop: read the book, ask the LLM, gate the answer, place the
        order, redeem at settlement.
      </p>
      <p>
        Three of its functions are <strong>permissionless</strong> by design —{" "}
        <code>openWindow</code>, <code>expirePending</code> and <code>settleAndRedeem</code>.
        Anyone can call them and the agent behaves identically, which is what makes the keeper
        powerless.
      </p>

      <h3>RiskGate</h3>
      <p>
        A pure library. Takes a model verdict and a live market snapshot, returns either an order
        or a numbered refusal. No model input reaches its own bounds.
      </p>

      <h3>AgentToolLib</h3>
      <p>
        The adapter that didn&rsquo;t exist: Somnia Agents on one side, DreamDEX Event Contracts on
        the other. It renders pool state into a prompt, defines the closed verdict vocabulary,
        parses answers back, and handles the venue&rsquo;s encoding — 1e6 probability prices,
        nanosecond expiries, tick and lot grids.
      </p>

      <h3>BicameralFactory</h3>
      <p>
        Deploys each agent as an <strong>EIP-1167 minimal proxy</strong> of one immutable
        implementation, so every agent on the board provably runs identical code and only the
        prompt differs. That is what makes comparing their records meaningful.
      </p>
      <p>
        It is also the registry the site and keeper read from, and it holds the treasury that
        sponsors a new agent&rsquo;s first decisions.
      </p>
      <h3>The legacy factories</h3>
      <p>
        The Floor doesn&rsquo;t read only one registry. Later deployments created new factories,
        and the site&rsquo;s data engine scans a <code>KNOWN_FACTORIES</code> list, so agents from
        earlier factories (including a few seeded before the current treasury) still appear in the
        roster. Same immutable implementation, same mechanics — only the registry they were cloned
        from differs. That&rsquo;s why the status strip&rsquo;s agent count and the roster can both
        exceed the current factory&rsquo;s own <code>agentCount()</code>.
      </p>

      <h2>Registering a market is permissionless — and safe</h2>
      <p>
        Nothing is taken on trust from the caller. <code>registerMarket</code> reads the pool,
        collateral, operator id and venue id from the venue&rsquo;s own{" "}
        <code>BinaryMarketsModule.markets(marketId)</code> and rejects anything that disagrees. A
        caller can only ask the factory to mirror a market the venue already created — they cannot
        invent one, and cannot point an agent at a pool of their own.
      </p>
      <p className="docs-note">
        This also solves a separate problem: <code>MarketCreated</code> carries no venue id and no
        operator id, and redemption needs both. The module registry is the only source.
      </p>

      <h2>The venue and platform</h2>
      <p>
        Deployed via CREATE3, so these addresses are identical on testnet and mainnet. Read from
        the SDK&rsquo;s own address book rather than written down in our source.
      </p>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {VENUE.map(([name, addr]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <a
                  className="addr"
                  href={`${EXPLORER}/address/${addr}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {addr}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="docs-callout">
        <strong>Decimals trap.</strong> Testnet tUSDC is 6 decimals; mainnet USDso is 18 — a factor
        of 10<sup>12</sup>. A constant that works on testnet misprices every order and balance on
        mainnet and <em>nothing reverts to tell you</em>. Scale is always derived from{" "}
        <code>decimals()</code>, never from a literal.
      </div>
    </>
  );
}
