export function About() {
  return (
    <div className="narrow">
      <h1 className="about-hero">A track record that cannot be faked.</h1>
      <p className="about-sub">
        SHARPE is an autonomous agent that trades football match outcomes in USDC — and
        publishes every decision, every loss, and every self-correction on a public,
        cryptographically anchored ledger.
      </p>

      <h2 className="about-label first">The problem</h2>
      <p className="about-body">
        Performance claims in trading are unfalsifiable. Tipsters cherry-pick screenshots;
        bots delete losing runs; "verified" records are hosted by whoever profits from them.
        One documented scam collected $3.7M in subscriptions on fabricated results. And even
        "decentralized" settlement still resolves through oracle committees, dispute windows,
        and admin keys — the referee is still a person.
      </p>

      <h2 className="about-label">What SHARPE does differently</h2>
      <div className="about-cards">
        <div className="panel">
          <div className="about-card-title">
            <span className="about-card-num">01</span>Commits before outcomes — history
            can't be faked
          </div>
          <div className="about-card-body">
            Every decision's SHA-256 hash is written to Solana before the outcome exists.
            Nothing can be backdated, edited, or quietly deleted. The bad days are as
            permanent as the good ones.
          </div>
        </div>
        <div className="panel">
          <div className="about-card-title">
            <span className="about-card-num">02</span>Settles by on-chain proof — results
            can't be faked
          </div>
          <div className="about-card-body">
            Every settlement submits a Merkle proof of the final match stats to TxLINE's
            validateStatV2 program on Solana, which checks it against the data root TxODDS
            anchored on-chain. If the proof doesn't verify, money does not move. No oracle
            committee, no dispute window, no human judgment.
          </div>
        </div>
        <div className="panel">
          <div className="about-card-title">
            <span className="about-card-num">03</span>Learns from proven facts — and benches
            itself
          </div>
          <div className="about-card-body">
            The agent recalibrates only on verified settlements. When it detects its own edge
            decaying it shrinks every stake automatically; a strategy that underperforms its
            own promises is suspended to shadow mode until it re-qualifies. Decay can't hide.
          </div>
        </div>
      </div>

      <h2 className="about-label">Check it yourself — three artifacts</h2>
      <p className="about-body mb10">
        Every claim links to its evidence: <strong>record hash</strong> (open any decision,
        copy its canonical hash) → <strong>commitment transaction</strong> (the same hash on
        Solana Explorer, timestamped before the match ended) →{" "}
        <strong>proof verification</strong> (the settlement's validateStatV2 check). Worked
        example: England 1–2 Argentina, fixture 18241006, seq 962 — a TRUE claim verifies, a
        FALSE claim is rejected. Reproduce it with{" "}
        <code className="inline-code">npx tsx tools/verify-proof.ts</code> in{" "}
        <code className="inline-code bare">services/agent/</code>.
      </p>
      <div className="about-anchors">
        <div>
          TxLINE program (devnet):{" "}
          <span className="v">6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J</span>
        </div>
        <div className="row2">
          subscription tx:{" "}
          <a
            href="https://explorer.solana.com/tx/XeNPJGSyBW9XUVXiPTqjsPMyWCBUgy3BwwNB1eRHn7bZiiviCejQLoMfFZMrgra94E5uk4PLcnBsZioeoax6Kxm?cluster=devnet"
            target="_blank"
            rel="noopener noreferrer"
          >
            XeNPJGSyBW9X…6Kxm ↗
          </a>
        </div>
      </div>

      <h2 className="about-label">How it thinks</h2>
      <p className="about-body mb10">
        SHARPE fits a joint model of each match and compares its probability for every
        outcome against the market's implied probability. When they disagree beyond a
        threshold — the <em>edge</em> — it acts, sizing with fractional Kelly scaled by its
        own calibration. Three deterministic strategies:
      </p>
      <ul className="about-list">
        <li>
          <strong style={{ color: "var(--s1)" }}>S1 COHERENCE</strong> — trades markets that
          disagree with the jointly-fitted model: pure cross-market arithmetic.
        </li>
        <li>
          <strong style={{ color: "var(--s2)" }}>S2 REACTION</strong> — after a goal or red
          card, trades quotes that lag the repricing.
        </li>
        <li>
          <strong style={{ color: "var(--s3)" }}>S3 CONVERGENCE</strong> — fades quotes that
          drifted from consensus without any match event.
        </li>
      </ul>

      <h2 className="about-label">Honest limits</h2>
      <p className="about-body" style={{ marginBottom: 0 }}>
        This runs on Solana devnet, in paper execution unless stated otherwise. Win rates
        hover near 50% by construction — the claim is provable honesty and positive expected
        value, never "it always wins." Replay mode pushes recorded real matches through the
        identical pipeline: same code, same decisions. It IS the agent, on recorded input.
      </p>
    </div>
  );
}
