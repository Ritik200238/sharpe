import { store } from "../store/store";
import type { EventVM } from "../lib/vm";

/** One feed/story card — the recurring decision-record molecule. */
export function EventCard({ vm }: { vm: EventVM }) {
  return (
    <button
      className="feed-card"
      style={{ borderLeftColor: vm.accent }}
      onClick={() => store.navigate(vm.target)}
    >
      <div className="feed-card-head">
        <span className="kind-badge" style={{ color: vm.kindColor }}>
          {vm.kind}
        </span>
        {vm.strat ? (
          <span className="strat-tag" style={{ color: vm.stratColor }}>
            {vm.strat}
          </span>
        ) : null}
        <span className="feed-card-title">{vm.title}</span>
        <span className="feed-card-time">{vm.time}</span>
      </div>
      {vm.showReason ? <div className="feed-card-reason">{vm.reason}</div> : null}
      {vm.chips.length > 0 ? (
        <div className="feed-card-chips">
          {vm.chips.map((c, i) => (
            <span key={i} className="chip" style={{ color: c.color }}>
              {c.t}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
