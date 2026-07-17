import { useState } from "react";
import { store, useStore, COPY_FLASH_MS } from "../store/store";
import {
  absUtc,
  ago,
  explorerTx,
  famLabel,
  fixtureLabel,
  odds4,
  pct,
  pp,
  shortHash,
  signedUsd,
  strategyColor,
  strategyLabel,
  usd,
} from "../lib/format";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FLASH_MS);
      }}
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}

export function DecisionDetail({ hash }: { hash: string }) {
  const state = useStore();
  const d = state.decisions.get(hash);

  if (!d) {
    return (
      <div className="not-found">
        Decision not found.{" "}
        <button className="link-btn" onClick={() => store.navigate({ name: "ledger" })}>
          Back to the ledger
        </button>
      </div>
    );
  }

  const s = state.settlements.get(d.hash);
  const shadow = d.stakeUsdc === 0;
  const stratColor = strategyColor(d.strategy);
  const oddsAgeSec = Math.round((d.decidedAtTs - d.inputs.oddsTs) / 1000);

  return (
    <div>
      <button
        className="link-btn back-link"
        onClick={() => store.navigate({ name: "ledger" })}
      >
        ← track record
      </button>

      <div className="detail-head">
        <span className="strat-chip" style={{ color: stratColor, borderColor: stratColor }}>
          {strategyLabel(d.strategy)}
        </span>
        <h1 className="page-title">{famLabel(d)}</h1>
        {shadow ? <span className="shadow-badge">SHADOW · stake 0</span> : null}
        <span className="detail-when">
          {absUtc(d.decidedAtTs)} · {ago(d.decidedAtTs)}
        </span>
      </div>
      <div className="detail-meta">
        fixture{" "}
        <button
          className="link-btn"
          onClick={() => store.navigate({ name: "fixture", id: d.fixtureId })}
        >
          {fixtureLabel(d.fixtureId)}
        </button>{" "}
        · {d.marketKey} · mode {d.mode}
      </div>

      <blockquote className="reason-quote" style={{ borderLeftColor: stratColor }}>
        {d.reason}
        <div className="reason-attrib">— written by the agent at decision time</div>
      </blockquote>

      <div className="detail-cards">
        <section className="panel">
          <h2 className="panel-label mb12">Why it acted — model vs market</h2>
          <div className="prob-row">
            <span className="lbl">model probability</span>
            <span className="val">{pct(d.modelProb)}</span>
          </div>
          <div className="prob-track">
            <div
              className="prob-fill model"
              style={{ width: `${(d.modelProb * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="prob-row">
            <span className="lbl">market-implied</span>
            <span className="val">{pct(d.marketProb)}</span>
          </div>
          <div className="prob-track market">
            <div
              className="prob-fill market"
              style={{ width: `${(d.marketProb * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="edge-line">
            edge <span className="val">{pp(d.edge)}</span>{" "}
            <span className="hint">(probability points, model − market)</span>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-label mb12">Position &amp; sizing internals</h2>
          <div className="detail-kv">
            <div>
              <div className="k">stake</div>
              <div className="strong">{usd(d.stakeUsdc)} USDC</div>
            </div>
            <div>
              <div className="k">decimal price</div>
              <div className="strong">{odds4(d.priceDecimal)}</div>
            </div>
            <div>
              <div className="k">Kelly fraction</div>
              <div>{d.sizing.kellyFraction.toFixed(3)}</div>
            </div>
            <div>
              <div className="k">calibration factor</div>
              <div>×{d.sizing.calibrationFactor.toFixed(2)}</div>
            </div>
            <div>
              <div className="k">allocation weight</div>
              <div>{pct(d.sizing.allocationWeight)}</div>
            </div>
            <div>
              <div className="k">bankroll at decision</div>
              <div>{usd(d.sizing.bankrollUsdc)} USDC</div>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel-label mb12">Input provenance</h2>
          <div className="detail-kv">
            <div>
              <div className="k">score seq</div>
              <div>{d.inputs.scoreSeq ?? "—"}</div>
            </div>
            <div>
              <div className="k">score ts</div>
              <div className="small">
                {d.inputs.scoreTs !== undefined ? absUtc(d.inputs.scoreTs) : "—"}
              </div>
            </div>
            <div>
              <div className="k">odds message</div>
              <div className="small">{d.inputs.oddsMessageId}</div>
            </div>
            <div>
              <div className="k">odds age at decision</div>
              <div>{oddsAgeSec}s</div>
            </div>
            <div>
              <div className="k">λ home</div>
              <div>{d.inputs.lambdaHome.toFixed(2)}</div>
            </div>
            <div>
              <div className="k">λ away</div>
              <div>{d.inputs.lambdaAway.toFixed(2)}</div>
            </div>
          </div>
          <div className="determinism-note">
            Same inputs → same decision → same hash, bit-for-bit. Deterministic and
            recomputable.
          </div>
        </section>
      </div>

      <section className="panel verify-panel">
        <h2 className="panel-label mb12">Verification — the evidence chain</h2>
        <div className="verify-rows">
          <div className="verify-row">
            <span className="k">record hash</span>
            <span className="hash">{d.hash}</span>
            <CopyButton text={d.hash} />
          </div>
          <div className="verify-row">
            <span className="k">commitment</span>
            {d.commitTxSig ? (
              <>
                <span className="confirmed">CONFIRMED ✓</span>
                <span className="sig">{shortHash(d.commitTxSig)}</span>
                <a
                  className="ext"
                  href={explorerTx(d.commitTxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  open on Solana Explorer (devnet) ↗
                </a>
              </>
            ) : d.mode === "chain" ? (
              <>
                <span className="pending">PENDING…</span>
                <span className="note">
                  hash written to Solana within seconds — before the outcome exists
                </span>
              </>
            ) : (
              <>
                <span className="paper">PAPER MODE</span>
                <span className="note">
                  no on-chain commitment in paper exec — the hash above is still the
                  canonical, recomputable record
                </span>
              </>
            )}
          </div>
          <div className="verify-row top">
            <span className="k">verify yourself</span>
            <code className="code-chip">npx tsx tools/verify-proof.ts</code>
            <span className="note small">
              recomputes the hash and checks the Merkle proof against the on-chain root
            </span>
          </div>
        </div>
      </section>

      {s ? (
        <section
          className="settle-panel"
          style={{
            borderColor: s.won ? "rgba(67,217,138,.4)" : "rgba(255,122,118,.4)",
          }}
        >
          <h2 className="panel-label mb12">Settlement</h2>
          <div className="settle-line">
            <span
              className="outcome"
              style={{ color: s.won ? "var(--green)" : "var(--red)" }}
            >
              {shadow ? (s.won ? "SHADOW WIN" : "SHADOW LOSS") : s.won ? "WON" : "LOST"}
            </span>
            <span
              className="pnl"
              style={{
                color: shadow ? "#8A93A5" : s.won ? "var(--green)" : "var(--red)",
              }}
            >
              {shadow ? "0.00" : signedUsd(s.pnlUsdc)} USDC
            </span>
            <span className="score">
              final score {s.finalP1Goals}–{s.finalP2Goals}
            </span>
            <span className="when">{absUtc(s.settledAtTs)}</span>
          </div>
          <div className="settle-verif">
            {s.verification ? (
              <>
                <span
                  className="tag"
                  style={{
                    color: s.verification.verified ? "var(--green)" : "var(--red)",
                  }}
                >
                  {s.verification.verified ? "VERIFIED ✓" : "PROOF FAILED — RETRYING"}
                </span>
                <span className="detail">
                  {s.verification.method} · statKeys [{s.verification.statKeys.join(", ")}] ·
                  seq {s.verification.seq} — outcome checked against the data root TxODDS
                  anchored on Solana
                </span>
              </>
            ) : (
              <>
                <span className="tag" style={{ color: "var(--amber)" }}>
                  PAPER SETTLE
                </span>
                <span className="detail">
                  settled without an on-chain validator — honest, lesser guarantee
                </span>
              </>
            )}
          </div>
        </section>
      ) : (
        <section className="open-panel">
          <div className="tag">POSITION OPEN</div>
          <div className="note">
            Stake {shadow ? "0 (shadow)" : `${usd(d.stakeUsdc)} USDC`} escrowed until the
            match finalises and its Merkle proof verifies on-chain. If a proof fails, the
            position stays open and retries — money never moves on unverified data.
          </div>
        </section>
      )}

      <div className="detail-footer">
        <button
          className="btn btn-body"
          onClick={() => store.navigate({ name: "fixture", id: d.fixtureId })}
        >
          Fixture story →
        </button>
        <button
          className="btn btn-body"
          onClick={() => store.goLedgerFiltered(d.strategy, "all")}
        >
          {strategyLabel(d.strategy)} history →
        </button>
      </div>
    </div>
  );
}
