import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  getDeathLeaderboard,
  type DeathLeaderboardEntry
} from "../api/death-leaderboard.js";
import {
  statsPopulationQueryKey,
  useStatsPopulationContext
} from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;
const tableFeatureSet = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel()
});
const columnHelper = createColumnHelper<typeof tableFeatureSet, DeathLeaderboardEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(left: DeathLeaderboardEntry, right: DeathLeaderboardEntry): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) ||
    Number(left.isBot) - Number(right.isBot) ||
    left.deaths - right.deaths ||
    compareText(left.race, right.race) ||
    compareText(left.class, right.class) ||
    left.level - right.level;
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
  columnHelper.accessor("deaths", {
    header: "Deaths",
    cell: (context) => context.getValue(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.deaths - right.original.deaths ||
      compareIdentity(left.original, right.original)
  })
]);

function sortLabel(columnName: string, direction: false | "asc" | "desc"): string {
  if (direction === "asc") {
    return `Sort by ${columnName}, currently ascending`;
  }

  if (direction === "desc") {
    return `Sort by ${columnName}, currently descending`;
  }

  return `Sort by ${columnName}, currently unsorted`;
}

function sortIndicator(direction: false | "asc" | "desc"): string {
  if (direction === "asc") {
    return "↑";
  }

  if (direction === "desc") {
    return "↓";
  }

  return "↕";
}

function formatCoverageTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function DeathLeaderboardTable({ entries }: { entries: DeathLeaderboardEntry[] }) {
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

  return (
    <div className="table-container deaths-table-container">
      <table className="deaths-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const direction = header.column.getIsSorted();
                const headerName = String(header.column.columnDef.header);
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={direction === false ? undefined : direction === "asc"
                      ? "ascending"
                      : "descending"}
                  >
                    <button
                      type="button"
                      className="sort-button"
                      onClick={header.column.getToggleSortingHandler()}
                      aria-label={sortLabel(headerName, direction)}
                    >
                      <span>{headerName}</span>
                      <span className="sort-indicator" aria-hidden="true">
                        {sortIndicator(direction)}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              <td data-label="Character" className="character-name">
                {row.original.characterName}
              </td>
              <td data-label="Race">{row.original.race}</td>
              <td data-label="Class">{row.original.class}</td>
              <td data-label="Level" className="numeric-cell">{row.original.level}</td>
              <td data-label="Account" className="account-name">{row.original.accountLogin}</td>
              <td data-label="Type">
                <span className={`population-type ${row.original.isBot ? "bot" : "player"}`}>
                  {row.original.isBot ? "Bot" : "Player"}
                </span>
              </td>
              <td data-label="Deaths" className="deaths-total">{row.original.deaths}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeathLeaderboardPanel() {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("deaths", population),
    queryFn: ({ signal }) => getDeathLeaderboard(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;

  return (
    <section className="panel deaths-panel" aria-labelledby="deathsHeading">
      <h2 id="deathsHeading">Most Deaths</h2>
      <p className="deaths-limit">
        Showing up to 25 highest recorded death totals. Column sorting reorders these results.
      </p>

      {leaderboardQuery.isPending && (
        <p className="players-message">Loading death statistics...</p>
      )}
      {leaderboardQuery.isError && (
        <p className="players-message">Death statistics are temporarily unavailable.</p>
      )}
      {leaderboard && leaderboard.entries.length === 0 && (
        <p className="players-message">No recorded deaths for this population yet.</p>
      )}
      {leaderboard && leaderboard.entries.length > 0 && (
        <DeathLeaderboardTable entries={leaderboard.entries} />
      )}
    </section>
  );
}
