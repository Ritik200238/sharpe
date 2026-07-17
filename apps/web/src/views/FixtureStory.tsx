import { store, useStore, type FeedItem } from "../store/store";
import { buildEventVm } from "../lib/vm";
import { EventCard } from "../components/EventCard";

export function FixtureStory({ id }: { id: number }) {
  const state = useStore();

  const decisions = [...state.decisions.values()].filter((d) => d.fixtureId === id);
  const settlements = [...state.settlements.values()].filter((s) => s.fixtureId === id);
  const reviews = state.reviews.filter((r) => r.fixtureId === id);

  const items: FeedItem[] = [];
  for (const d of decisions) {
    items.push({ key: `fd:${d.hash}`, type: "decision", ts: d.decidedAtTs, hash: d.hash });
  }
  for (const s of settlements) {
    items.push({
      key: `fs:${s.decisionHash}`,
      type: "settlement",
      ts: s.settledAtTs,
      hash: s.decisionHash,
    });
  }
  for (const r of reviews) {
    items.push({ key: `fr:${r.hash}`, type: "review", ts: r.generatedAtTs, payload: r });
  }
  items.sort((a, b) => a.ts - b.ts);

  const vms = items
    .map((item) => buildEventVm(item, state, true))
    .filter((vm): vm is NonNullable<typeof vm> => vm !== null);

  const done = settlements.length > 0;
  const final = done ? settlements[settlements.length - 1] : null;
  const hasOpen = decisions.some((d) => !state.settlements.has(d.hash));
  const score = final
    ? `final ${final.finalP1Goals}–${final.finalP2Goals}`
    : hasOpen
      ? "IN PLAY"
      : "awaiting";

  return (
    <div>
      <button
        className="link-btn back-link"
        onClick={() => store.navigate({ name: "ledger" })}
      >
        ← track record
      </button>
      <div className="fixture-head">
        <h1 className="page-title">Fixture {id}</h1>
        <span
          className="fixture-score"
          style={{ color: done ? "var(--text)" : "var(--lime)" }}
        >
          {score}
        </span>
      </div>
      <div className="fixture-sub">
        participant ids as delivered by the feed — name mapping may come later · everything
        the agent did on this match, in order
      </div>
      <div className="fixture-list">
        {vms.length === 0 ? (
          <div className="empty-note">No recorded activity for this fixture.</div>
        ) : (
          vms.map((vm) => <EventCard key={vm.key} vm={vm} />)
        )}
      </div>
    </div>
  );
}
