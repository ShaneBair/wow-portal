import { useQuery } from "@tanstack/react-query";
import {
  getBadNeighborhood,
  type BadNeighborhoodEntry
} from "../api/bad-neighborhood.js";
import {
  statsPopulationQueryKey,
  useStatsPopulationContext
} from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;

function formatCoverageDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

function BadNeighborhoodTable({ entries }: { entries: BadNeighborhoodEntry[] }) {
  return (
    <div className="table-container bad-neighborhood-table-container">
      <table className="bad-neighborhood-table">
        <thead><tr>
          <th scope="col">Zone</th>
          <th scope="col">Deaths</th>
          <th scope="col">Unique victims</th>
        </tr></thead>
        <tbody>{entries.map((entry) => (
          <tr key={entry.zoneId}>
            <td data-label="Zone" className="zone-name">{entry.zoneName}</td>
            <td data-label="Deaths" className="deaths-total">{entry.deaths.toLocaleString()}</td>
            <td data-label="Unique victims" className="numeric-cell">
              {entry.uniqueVictims.toLocaleString()}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function BadNeighborhoodPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("bad-neighborhood", population),
    queryFn: ({ signal }) => getBadNeighborhood(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return (
    <section className="panel bad-neighborhood-panel"
      aria-labelledby={showHeading ? "badNeighborhoodHeading" : undefined}
      aria-label={showHeading ? undefined : "Bad Neighborhood statistics"}
      aria-busy={leaderboardQuery.isPending}>
      {showHeading && <h2 id="badNeighborhoodHeading">Bad Neighborhood</h2>}
      {leaderboard && <p className="deaths-scope">
        Complete locations since{" "}
        <time dateTime={leaderboard.coverage.comprehensiveSince}>
          {formatCoverageDate(leaderboard.coverage.comprehensiveSince)}
        </time>.
      </p>}
      <p className="deaths-limit">Showing the 25 zones with the most recorded deaths.</p>
      {leaderboardQuery.isPending && <p className="players-message" role="status">
        Loading Bad Neighborhood statistics...
      </p>}
      {leaderboardQuery.isError && <div className="stats-error" role="status">
        <p className="players-message">Bad Neighborhood statistics are temporarily unavailable.</p>
        <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
          Retry
        </button>
      </div>}
      {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
        No recorded deaths with known locations for this population yet.
      </p>}
      {leaderboard && leaderboard.omittedUnknownZoneDeaths > 0 && <p className="zone-omissions">
        {leaderboard.omittedUnknownZoneDeaths.toLocaleString()} recorded {leaderboard.omittedUnknownZoneDeaths === 1
          ? "death has" : "deaths have"} no known zone and {leaderboard.omittedUnknownZoneDeaths === 1
          ? "is" : "are"} omitted.
      </p>}
      {leaderboard && leaderboard.entries.length > 0 && <BadNeighborhoodTable entries={leaderboard.entries} />}
    </section>
  );
}
