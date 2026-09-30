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
import { getPublicEnemy, type PublicEnemyEntry } from "../api/public-enemy.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;
const tableFeatureSet = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columnHelper = createColumnHelper<typeof tableFeatureSet, PublicEnemyEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(left: PublicEnemyEntry, right: PublicEnemyEntry): number {
  return compareText(left.creatureName, right.creatureName) || left.creatureEntry - right.creatureEntry;
}

const columns = columnHelper.columns([
  columnHelper.accessor("creatureName", {
    header: "Creature",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.creatureName, right.original.creatureName) ||
      left.original.creatureEntry - right.original.creatureEntry
  }),
  columnHelper.accessor("kills", {
    header: "Total kills",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.kills - right.original.kills ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("directKills", {
    header: "Direct kills",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.directKills - right.original.directKills ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("petKills", {
    header: "Pet kills",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.petKills - right.original.petKills ||
      compareIdentity(left.original, right.original)
  })
]);

function sortLabel(name: string, direction: false | "asc" | "desc"): string {
  if (direction === "asc") return `Sort by ${name}, currently ascending`;
  if (direction === "desc") return `Sort by ${name}, currently descending`;
  return `Sort by ${name}, currently unsorted`;
}

function formatCoverageDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(timestamp));
}

function PublicEnemyTable({ entries }: { entries: PublicEnemyEntry[] }) {
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
  return <div className="table-container public-enemy-table-container">
    <table className="real-raid-boss-table public-enemy-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>
        {group.headers.map((header) => {
          const direction = header.column.getIsSorted();
          const name = String(header.column.columnDef.header);
          return <th key={header.id} scope="col" aria-sort={direction === false
            ? undefined : direction === "asc" ? "ascending" : "descending"}>
            <button type="button" className="sort-button"
              onClick={header.column.getToggleSortingHandler()} aria-label={sortLabel(name, direction)}>
              <span>{name}</span><span className="sort-indicator" aria-hidden="true">
                {direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}
              </span>
            </button>
          </th>;
        })}
      </tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.original.creatureEntry}>
        <td data-label="Creature" className="creature-name">{row.original.creatureName}</td>
        <td data-label="Total kills" className="deaths-total">{row.original.kills.toLocaleString()}</td>
        <td data-label="Direct kills" className="numeric-cell">{row.original.directKills.toLocaleString()}</td>
        <td data-label="Pet kills" className="numeric-cell">{row.original.petKills.toLocaleString()}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function PublicEnemyPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("public-enemy", population),
    queryFn: ({ signal }) => getPublicEnemy(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return <section className="panel public-enemy-panel"
    aria-labelledby={showHeading ? "publicEnemyHeading" : undefined}
    aria-label={showHeading ? undefined : "Public Enemy #1 statistics"}
    aria-busy={leaderboardQuery.isPending}>
    {showHeading && <h2 id="publicEnemyHeading">Public Enemy #1</h2>}
    <p className="award-detail">
      Ranks creature types by recorded direct and pet-owner killing blows.
    </p>
    {leaderboard?.coverage.firstRecordedAt && <p className="deaths-scope">
      Recorded killing blows since{" "}
      <time dateTime={leaderboard.coverage.firstRecordedAt}>
        {formatCoverageDate(leaderboard.coverage.firstRecordedAt)}
      </time>.
    </p>}
    <p className="deaths-limit">Showing up to 25 server-ranked creatures. Column sorting reorders these results.</p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">
      Loading Public Enemy statistics...
    </p>}
    {leaderboardQuery.isError && <div className="stats-error" role="status">
      <p className="players-message">Public Enemy statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
        Retry
      </button>
    </div>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No recorded creature killing blows for this population yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 && <PublicEnemyTable entries={leaderboard.entries} />}
  </section>;
}
