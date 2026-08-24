import type { ReactNode } from "react";
import { DocumentTitle } from "../components/DocumentTitle.js";
import { DeathLeaderboardPanel } from "../components/DeathLeaderboardPanel.js";
import { StatsPopulationFilter } from "../components/StatsPopulationFilter.js";
import { StatsPopulationProvider } from "../stats/stats-population.js";

export function StatsPage({ children }: { children?: ReactNode }) {
  return (
    <StatsPopulationProvider>
      <main>
        <DocumentTitle>Stats | DaBoysZeroth</DocumentTitle>
        <header className="hero">
          <div>
            <p className="eyebrow">SERVER STATISTICS</p>
            <h1>Stats</h1>
            <p className="lede">Server activity and trends will have a dedicated home here.</p>
          </div>
        </header>

        <StatsPopulationFilter />

        <section className="stats-content" aria-label="Statistics content">
          {children ?? <DeathLeaderboardPanel />}
        </section>
      </main>
    </StatsPopulationProvider>
  );
}
