import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState
} from "@tanstack/react-table";
import { useState } from "react";
import {
  getBossKillLeaderboard,
  type BossKillLeaderboardEntry
} from "../api/boss-kill-leaderboard.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;
const tableFeatureSet = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columnHelper = createColumnHelper<typeof tableFeatureSet, BossKillLeaderboardEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(left: BossKillLeaderboardEntry, right: BossKillLeaderboardEntry): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) || Number(left.isBot) - Number(right.isBot) ||
    left.bossKills - right.bossKills || compareText(left.race, right.race) ||
    compareText(left.class, right.class) || left.level - right.level;
}

const columns = columnHelper.columns([
  columnHelper.accessor("characterName", {
    header: "Character",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.characterName, right.original.characterName) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("race", {
    header: "Race",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.race, right.original.race) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("class", {
    header: "Class",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.class, right.original.class) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("level", {
    header: "Level",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => left.original.level - right.original.level ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("accountLogin", {
    header: "Account",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.accountLogin, right.original.accountLogin) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("isBot", {
    header: "Type",
    cell: (context) => context.getValue() ? "Bot" : "Player",
    sortFn: (left, right) => Number(left.original.isBot) - Number(right.original.isBot) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("bossKills", {
    header: "Boss kills",
    cell: (context) => context.getValue(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.bossKills - right.original.bossKills ||
      compareIdentity(left.original, right.original)
  })
]);

function sortLabel(name: string, direction: false | "asc" | "desc"): string {
  if (direction === "asc") return `Sort by ${name}, currently ascending`;
  if (direction === "desc") return `Sort by ${name}, currently descending`;
  return `Sort by ${name}, currently unsorted`;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(timestamp));
}

function ServerMvpTable({ entries }: { entries: BossKillLeaderboardEntry[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useTable({
    features: tableFeatureSet,
    columns,
    data: entries,
    state: { sorting },
    onSortingChange: setSorting,
    enableMultiSort: false,
    enableSortingRemoval: true
  });
  return <div className="table-container boss-kill-table-container">
    <table className="boss-kill-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>
        {group.headers.map((header) => {
          const direction = header.column.getIsSorted();
          const name = String(header.column.columnDef.header);
          return <th key={header.id} scope="col" aria-sort={direction === false
            ? undefined : direction === "asc" ? "ascending" : "descending"}>
            <button type="button" className="sort-button"
              onClick={header.column.getToggleSortingHandler()}
              aria-label={sortLabel(name, direction)}>
              <span>{name}</span><span className="sort-indicator" aria-hidden="true">
                {direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}
              </span>
            </button>
          </th>;
        })}
      </tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>
        <td data-label="Character" className="character-name">{row.original.characterName}</td>
        <td data-label="Race">{row.original.race}</td>
        <td data-label="Class">{row.original.class}</td>
        <td data-label="Level" className="numeric-cell">{row.original.level}</td>
        <td data-label="Account" className="account-name">{row.original.accountLogin}</td>
        <td data-label="Type"><span className={`population-type ${row.original.isBot ? "bot" : "player"}`}>
          {row.original.isBot ? "Bot" : "Player"}
        </span></td>
        <td data-label="Boss kills" className="boss-kill-total">{row.original.bossKills.toLocaleString()}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function WinnerSummary({ entries }: { entries: BossKillLeaderboardEntry[] }) {
  const total = entries[0]!.bossKills;
  const winners = entries.filter((entry) => entry.bossKills === total);
  const names = winners.map((winner) => `${winner.characterName} (${winner.isBot ? "Bot" : "Player"})`);
  return <p className="award-winner">
    <strong>{winners.length === 1 ? "Leader:" : "Co-winners:"}</strong>{" "}
    {names.join(winners.length === 2 ? " and " : ", ")} — {total.toLocaleString()} recorded boss
    {total === 1 ? " killing blow" : " killing blows"}{winners.length > 1 ? " each" : ""}.
  </p>;
}

export function ServerMvpPanel() {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("boss-kills", population),
    queryFn: ({ signal }) => getBossKillLeaderboard(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return <section className="panel award-panel server-mvp-panel" aria-labelledby="serverMvpHeading"
    aria-busy={leaderboardQuery.isPending}>
    <div className="award-heading">
      <span className="award-icon" aria-hidden="true">🏆</span>
      <div><h3 id="serverMvpHeading">Server MVP</h3><p>Most boss kills</p></div>
    </div>
    <p className="award-detail boss-kill-coverage">
      {leaderboard?.coverage.firstRecordedAt
        ? <>
            Recorded boss killing blows from{" "}
            <time dateTime={leaderboard.coverage.firstRecordedAt}>
              {formatTimestamp(leaderboard.coverage.firstRecordedAt)}
            </time>{" "}
            onward. Pet kills credit the owner.
          </>
        : leaderboard
          ? "No creature-kill coverage date is available. Pet kills credit the owner."
          : "Recorded boss killing blows since creature tracking began. Pet kills credit the owner."}
    </p>
    <p className="award-detail">
      Covers recognized creature-credit and world-boss entries. Spell-credit-only encounters are
      excluded unless independently boss-marked; this is killing-blow credit, not group participation.
    </p>
    <p className="deaths-limit">Showing up to 25 server-ranked results. Column sorting reorders these results.</p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">Loading boss kill statistics...</p>}
    {leaderboardQuery.isError && <p className="players-message" role="status">Boss kill statistics are temporarily unavailable.</p>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No recorded boss kills for this population yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 && <>
      <WinnerSummary entries={leaderboard.entries} />
      <ServerMvpTable entries={leaderboard.entries} />
    </>}
  </section>;
}
