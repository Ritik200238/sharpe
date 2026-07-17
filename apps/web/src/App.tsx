import type { ReactElement } from "react";
import { useStore } from "./store/store";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Command } from "./views/Command";
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
        {state.connection === "dead" ? (
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
