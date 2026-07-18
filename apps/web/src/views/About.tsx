export function About() {
  return (
    <div className="narrow">
      <h1 className="about-hero">A market maker whose book can't be faked.</h1>
      <p className="about-sub">
        SHARPE is an autonomous in-play market maker for World Cup odds. It quotes a price to
        buy <em>and</em> a price to sell on every live outcome, earns the spread between them,
        and defends itself from getting picked off when goals move the market — while committing
        every quote, fill, and settlement to Solana so its book is independently auditable.
      </p>

      <h2 className="about-label first">Why make markets — not predict</h2>
      <p className="about-body">
        Most "trading agents" try to beat the market. But TxLINE ships de-margined consensus
        odds — the sharpest aggregate price there is. Betting against it is a structural loser;
        we built the directional agent first and measured it at <strong>−18.6% ROI</strong>. A
        market maker never plays that game. It <strong>provides liquidity</strong> — quotes both
        sides and earns the spread — and never needs to know who wins. That's the most real,
        most valuable job on a trading desk, and it's a named Track&nbsp;2 idea.
      </p>

      <h2 className="about-label">What SHARPE does differently</h2>
      <div className="about-cards">
        <div className="panel">
          <div className="about-card-title">
            <span className="about-card-num">01</span>Quotes both sides, continuously
          </div>
          <div className="about-card-body">
            For every live outcome it posts a bid and an ask around fair value, repricing as the
            match moves and skewing its quotes to work down whatever inventory it takes on. It
            earns the half-spread on the flow it fills — the market maker's edge.
          </div>
        </div>
        <div className="panel">
          <div className="about-card-title">
            <span className="about-card-num">02</span>Defends against toxic flow
          </div>
          <div className="about-card-body">
            The whole game of in-play making is adverse selection: the instant a goal lands,
            every price jumps and faster traders pick off stale quotes. The moment TxLINE reports
            a goal or red card, SHARPE <strong>pulls its quotes, then re-quotes wide</strong>{" "}
            until the new price settles. Measured, that defence turned a −7 loss into a +16
            profit on a match.
          </div>
        </div>
        <div className="panel">
          <div className="about-card-title">
            <span className="about-card-num">03</span>Its book is provable on-chain
          </div>
          <div className="about-card-body">
            Every quote and fill is committed to Solana, and each match settles by a Merkle proof
            of the final stats verified against TxODDS' on-chain root (validateStatV2). If the
            proof doesn't verify, money does not move. A market maker you can <em>audit</em> —
            no oracle committee, no dispute window, no admin key.
          </div>
        </div>
      </div>

      <h2 className="about-label">How it quotes</h2>
      <p className="about-body mb10">
        The fair value comes from a deterministic model — Shin de-vig on the consensus odds, then
        a market-implied Poisson that reprices live as the clock and score change. Around that
        fair value the maker builds its two-sided quote:
      </p>
      <ul className="about-list">
        <li>
          <strong style={{ color: "var(--s1)" }}>SPREAD</strong> — the half-spread widens with
          uncertainty (more time left, higher outcome variance → more cushion), so it's paid for
          the risk it carries.
        </li>
        <li>
          <strong style={{ color: "var(--s2)" }}>SKEW</strong> — inventory shades the mid: long
          a share, it shades both quotes down to offload; short, it shades up. The book stays
          balanced without predicting anything.
        </li>
        <li>
          <strong style={{ color: "var(--s3)" }}>PROTECTION</strong> — on a goal or red card it
          pulls, then re-quotes wide, then normalises. Its P&amp;L decomposes into spread
          captured vs. adverse selection — and the defence keeps the first bigger than the second.
        </li>
      </ul>

      <h2 className="about-label">Check it yourself — three artifacts</h2>
      <p className="about-body mb10">
        Every claim links to its evidence: <strong>record hash</strong> (open any quote or
        settlement, copy its canonical hash) → <strong>commitment transaction</strong> (the same
        hash on Solana Explorer, timestamped before the match ended) →{" "}
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
        <div className="row2">
          quote-book commit (<code className="inline-code bare">sharpe:v1:quote_book:…</code>):{" "}
          <a
            href="https://explorer.solana.com/tx/5ba75L2uqVcvSwxomL8BfLFK46xLXXn5zY4wbNJUAwPYuf4E9qppHWK8hn7mzzfBRdCk1WcDwFpmQa25yNNCs95f?cluster=devnet"
            target="_blank"
            rel="noopener noreferrer"
          >
            5ba75L2uqVcv…Cs95f ↗
          </a>
        </div>
      </div>

      <h2 className="about-label">Honest limits</h2>
      <p className="about-body" style={{ marginBottom: 0 }}>
        This runs on Solana devnet, in paper execution unless stated otherwise. The flow that
        trades against the quotes is simulated — the standard way a quoting strategy is
        backtested — deterministically seeded from the event stream, so a replay reproduces every
        fill exactly. The claim is a provably-honest book and a positive spread net of adverse
        selection, never "it always wins." Replay mode pushes recorded real matches through the
        identical pipeline: same code, same quotes. It IS the agent, on recorded input.
      </p>
    </div>
  );
}
