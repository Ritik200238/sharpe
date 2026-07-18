import type { ReactElement } from "react";
import { useStore } from "./store/store";
import { DEMO_MODE } from "./api/client";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Command } from "./views/Command";
import { MarketMaking } from "./views/MarketMaking";
import { Ledger } from "./views/Ledger";
import { Performance } from "./views/Performance";
import { DecisionDetail } from "./views/DecisionDetail";
import { FixtureStory } from "./views/FixtureStory";
import { About } from "./views/About";
import { System } from "./views/System";

export function App() {
  const state = useStore();

  let view: ReactElement;
  switch (state.route.name) {
    case "market":
      view = <MarketMaking />;
      break;
    case "ledger":
      view = <Ledger />;
      break;
    case "performance":
      view = <Performance />;
      break;
    case "detail":
      view = <DecisionDetail hash={state.route.hash} />;
      break;
    case "fixture":
      view = <FixtureStory id={state.route.id} />;
      break;
    case "about":
      view = <About />;
      break;
    case "system":
      view = <System />;
      break;
    default:
      view = <Command />;
  }

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {state.announce}
      </div>
      <Header />
      <main className="main">
        {DEMO_MODE ? (
          <div className="demo-banner" role="status">
            <strong>Live demo</strong> — a demonstration match played through the real agent
            pipeline (the exact code that runs on live TxLINE data). The on-chain proofs — the
            agent's real quote-book commits and the <code>validateStatV2</code> settlement proof —
            are linked on the About page and reproducible with{" "}
            <code>tools/verify-proof.ts</code>. Point this at a live agent with{" "}
            <code>?api=&lt;url&gt;</code>.
          </div>
        ) : null}
        {state.connection === "dead" && !DEMO_MODE ? (
          <div className="dead-banner" role="status">
            agent API unreachable — the process may be restarting · retrying automatically
          </div>
        ) : null}
        {view}
      </main>
      <Footer />
    </>
  );
}
