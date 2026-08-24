import { ConnectionPanel } from "../components/ConnectionPanel.js";
import { DocumentTitle } from "../components/DocumentTitle.js";
import { OnlinePlayersPanel } from "../components/OnlinePlayersPanel.js";
import { RegistrationPanel } from "../components/RegistrationPanel.js";
import { ServerStatus } from "../components/ServerStatus.js";

export function HomePage() {
  return (
    <main>
      <DocumentTitle>DaBoysZeroth</DocumentTitle>
      <header className="hero">
        <div>
          <p className="eyebrow">PRIVATE WOTLK SERVER</p>
          <h1>DaBoysZeroth</h1>
          <p className="lede">Wrath of the Lich King, bots, questionable decisions, and the boys.</p>
        </div>
        <ServerStatus />
      </header>

      <section className="grid">
        <RegistrationPanel />
        <ConnectionPanel />
      </section>

      <OnlinePlayersPanel />
    </main>
  );
}
