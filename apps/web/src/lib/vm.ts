/**
 * Feed event view-models — a straight translation of the prototype's
 * feedVm() builder, resolving records from the live store state so
 * commit upgrades and settlement joins always render current facts.
 */
import type {
  DecisionRecord,
  FeedStatusEvent,
  MatchReview,
  SettlementRecord,
  VetoRecord,
} from "../api/types";
import type { FeedItem, StoreState } from "../store/store";
import type { Route } from "./router";
import { absUtc, ago, famLabel, odds4, pct, pp, signedUsd, strategyColor, strategyLabel, usd } from "./format";

export interface ChipVM {
  t: string;
  color: string;
}

export interface EventVM {
  key: string;
  kind: string;
  kindColor: string;
  accent: string;
  strat: string;
  stratColor: string;
  title: string;
  time: string;
  showReason: boolean;
  reason: string;
  chips: ChipVM[];
  target: Route;
}

const GREEN = "#43D98A";
const RED = "#FF7A76";
const AMBER = "#F5B84B";
const LIME = "#B7F542";
const MUT = "#9AA3B5";
const TEXT = "#E7EAF0";

const chip = (t: string, color: string = MUT): ChipVM => ({ t, color });

/** The commit chip has three honest states: confirmed, pending (chain mode),
 * and paper mode — where no on-chain commitment ever exists. */
function commitChip(d: DecisionRecord): ChipVM {
  if (d.commitTxSig) return chip("committed ✓", GREEN);
  if (d.mode === "chain") return chip("commit pending…", AMBER);
  return chip("paper — no commit", "#8A93A5");
}

export function verificationChip(s: SettlementRecord): ChipVM {
  if (!s.verification) return chip("paper settle — no validator", AMBER);
  return s.verification.verified
    ? chip("VERIFIED ✓ on-chain proof", GREEN)
    : chip("PROOF FAILED — position stays open, retrying", RED);
}

export function buildEventVm(
  item: FeedItem,
  state: StoreState,
  absolute = false,
): EventVM | null {
  const time = absolute ? absUtc(item.ts) : ago(item.ts);
  const vm: EventVM = {
    key: item.key,
    kind: "STATUS",
    kindColor: "#6B7386",
    accent: "#2A3040",
    strat: "",
    stratColor: "#fff",
    title: "",
    time,
    showReason: false,
    reason: "",
    chips: [],
    target: { name: "system" },
  };

  if (item.type === "decision") {
    const d = item.hash ? state.decisions.get(item.hash) : undefined;
    if (!d) return null;
    const shadow = d.stakeUsdc === 0;
    vm.kind = shadow ? "SHADOW" : "DECISION";
    vm.kindColor = shadow ? "#8A93A5" : LIME;
    vm.accent = strategyColor(d.strategy);
    vm.strat = strategyLabel(d.strategy);
    vm.stratColor = strategyColor(d.strategy);
    vm.title = `${famLabel(d)} · fixture ${d.fixtureId}`;
    vm.reason = d.reason;
    vm.showReason = true;
    vm.chips = [
      chip(`edge ${pp(d.edge)}`, TEXT),
      chip(shadow ? "stake 0 (shadow)" : `stake ${usd(d.stakeUsdc)} USDC`),
      chip(`@ ${odds4(d.priceDecimal)}`),
      commitChip(d),
    ];
    vm.target = { name: "detail", hash: d.hash };
  } else if (item.type === "settlement") {
    const s = item.hash ? state.settlements.get(item.hash) : undefined;
    if (!s) return null;
    const d = state.decisions.get(s.decisionHash);
    vm.kind = "SETTLEMENT";
    vm.kindColor = s.won ? GREEN : RED;
    vm.accent = s.won ? GREEN : RED;
    if (d) {
      const shadow = d.stakeUsdc === 0;
      vm.strat = strategyLabel(d.strategy);
      vm.stratColor = strategyColor(d.strategy);
      vm.title = `${s.won ? "WON " : "LOST "}${shadow ? "(shadow) " : ""}${famLabel(d)} · fixture ${s.fixtureId}`;
      vm.chips = [
        chip(
          shadow ? "P&L 0.00 (shadow)" : `P&L ${signedUsd(s.pnlUsdc)} USDC`,
          s.won ? GREEN : RED,
        ),
        chip(`final ${s.finalP1Goals}–${s.finalP2Goals}`),
        verificationChip(s),
      ];
    } else {
      vm.title = `${s.won ? "WON" : "LOST"} · fixture ${s.fixtureId}`;
      vm.chips = [
        chip(`P&L ${signedUsd(s.pnlUsdc)} USDC`, s.won ? GREEN : RED),
        chip(`final ${s.finalP1Goals}–${s.finalP2Goals}`),
        verificationChip(s),
      ];
    }
    vm.target = { name: "detail", hash: s.decisionHash };
  } else if (item.type === "review") {
    const r = item.payload as MatchReview;
    vm.kind = "REVIEW";
    vm.kindColor = "#C792EA";
    vm.accent = "#C792EA";
    vm.title = `post-match self-review · fixture ${r.fixtureId}`;
    vm.reason = (r.notes ?? []).join(" ");
    vm.showReason = vm.reason.length > 0;
    vm.chips = [
      chip(`${r.decisions} decisions`),
      chip(`${r.wins}W/${r.losses}L`),
      chip(`P&L ${signedUsd(r.pnlUsdc)} USDC`, r.pnlUsdc >= 0 ? GREEN : RED),
      chip(`hit ${pct(r.realizedHitRate)}`),
    ];
    vm.target = { name: "fixture", id: r.fixtureId };
  } else if (item.type === "veto") {
    const v = item.payload as VetoRecord;
    vm.kind = "VETO";
    vm.kindColor = "#8A93A5";
    vm.accent = "#2A3040";
    vm.strat = strategyLabel(v.strategy);
    vm.stratColor = strategyColor(v.strategy);
    vm.title = "trade refused";
    vm.reason = `Risk gate: ${v.reason} — ${v.marketKey}`;
    vm.showReason = true;
    vm.target = { name: "ledger" };
  } else if (item.type === "score") {
    // The current stream contract never emits these; kept for fidelity with
    // the prototype's MATCH cards should the contract grow a score event.
    const payload = item.payload as { text?: string; fixtureId?: number };
    vm.kind = "MATCH";
    vm.kindColor = TEXT;
    vm.accent = TEXT;
    vm.title = payload?.text ?? "match event";
    vm.target =
      typeof payload?.fixtureId === "number"
        ? { name: "fixture", id: payload.fixtureId }
        : { name: "system" };
  } else {
    const payload = item.payload as FeedStatusEvent;
    vm.kind = "STATUS";
    vm.kindColor = "#6B7386";
    vm.accent = "#2A3040";
    vm.title = payload?.message ?? "feed status";
    vm.target = { name: "system" };
  }
  return vm;
}
