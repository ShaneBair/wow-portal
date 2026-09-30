import type { ReactNode } from "react";
import { useParams } from "react-router";
import { DocumentTitle } from "../components/DocumentTitle.js";
import { ServerStatus } from "../components/ServerStatus.js";
import { StatsPopulationFilter } from "../components/StatsPopulationFilter.js";
import { StatsPopulationProvider } from "../stats/stats-population.js";
import { StatisticDetailPage } from "./StatisticDetailPage.js";
import { StatsHub } from "./StatsHub.js";

function StatsRoute({ children }: { children?: ReactNode }) {
  const { statSlug } = useParams();

  // This child form is a focused harness for existing panel tests. Production routes use the
  // hub/detail split below, so no hidden copy of the full leaderboard catalog is mounted.
  if (children) {
    return <main>
      <DocumentTitle>Stats | DaBoysZeroth</DocumentTitle>
      <header className="hero">
        <div>
          <p className="eyebrow">SERVER STATISTICS</p>
          <h1>Stats</h1>
          <p className="lede">Server activity and trends will have a dedicated home here.</p>
        </div>
        <ServerStatus />
      </header>
      <StatsPopulationFilter />
      {children}
    </main>;
  }

  return statSlug === undefined ? <StatsHub /> : <StatisticDetailPage />;
}

export function StatsPage({ children }: { children?: ReactNode }) {
  return <StatsPopulationProvider><StatsRoute>{children}</StatsRoute></StatsPopulationProvider>;
}
