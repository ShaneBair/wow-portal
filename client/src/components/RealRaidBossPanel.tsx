import { useQuery } from "@tanstack/react-query";
import { getRealRaidBoss } from "../api/real-raid-boss.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;

function formatCoverageDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(timestamp));
}

export function RealRaidBossPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("real-raid-boss", population),
    queryFn: ({ signal }) => getRealRaidBoss(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;

  return <section className="panel real-raid-boss-panel"
    aria-labelledby={showHeading ? "realRaidBossHeading" : undefined}
    aria-label={showHeading ? undefined : "The Real Raid Boss statistics"}
    aria-busy={leaderboardQuery.isPending}>
    {showHeading && <h2 id="realRaidBossHeading">The Real Raid Boss</h2>}
    <p className="award-detail">
      Only recorded creature killing blows are included. PvP, environmental deaths, and canonical
      total-death records do not count.
    </p>
    {leaderboard?.coverage.firstRecordedAt && <p className="deaths-scope">
      Recorded creature deaths since{" "}
      <time dateTime={leaderboard.coverage.firstRecordedAt}>
        {formatCoverageDate(leaderboard.coverage.firstRecordedAt)}
      </time>.
    </p>}
    <p className="deaths-limit">Showing up to 25 server-ranked creatures.</p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">
      Loading Real Raid Boss statistics...
    </p>}
    {leaderboardQuery.isError && <div className="stats-error" role="status">
      <p className="players-message">Real Raid Boss statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
        Retry
      </button>
    </div>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No recorded creature killing blows for this population yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 &&
      <div className="table-container real-raid-boss-table-container">
        <table className="real-raid-boss-table">
          <thead><tr>
            <th scope="col">Rank</th>
            <th scope="col">NPC</th>
            <th scope="col">Character kills</th>
            <th scope="col">Unique victims</th>
          </tr></thead>
          <tbody>{leaderboard.entries.map((entry, index) => <tr key={entry.creatureEntry}>
            <td data-label="Rank" className="raid-boss-rank">
              <span aria-label={`Rank ${index + 1}`}>#{index + 1}</span>
            </td>
            <td data-label="NPC" className="creature-name">{entry.creatureName}</td>
            <td data-label="Character kills" className="deaths-total">
              {entry.characterKills.toLocaleString()}
            </td>
            <td data-label="Unique victims" className="numeric-cell">
              {entry.uniqueVictims.toLocaleString()}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
