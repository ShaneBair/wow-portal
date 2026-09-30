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
import { getPunchingUp, type PunchingUpEntry } from "../api/punching-up.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;
const tableFeatureSet = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columnHelper = createColumnHelper<typeof tableFeatureSet, PunchingUpEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(left: PunchingUpEntry, right: PunchingUpEntry): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) || compareText(left.type, right.type) ||
    left.levelDelta - right.levelDelta || compareText(left.occurredAt, right.occurredAt);
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
    header: "Current level",
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
  columnHelper.accessor("type", {
    header: "Type",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.type, right.original.type) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("levelDelta", {
    header: "Personal record",
    cell: (context) => {
      const entry = context.row.original;
      return `Level ${entry.actorLevelAtKill} defeated Level ${entry.creatureLevel} ${entry.creatureName} (+${entry.levelDelta})`;
    },
    sortDescFirst: true,
    sortFn: (left, right) => left.original.levelDelta - right.original.levelDelta ||
      left.original.creatureLevel - right.original.creatureLevel ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("killMethod", {
    header: "Method",
    cell: (context) => context.getValue() === "pet" ? "Pet" : "Direct",
    sortFn: (left, right) => compareText(left.original.killMethod, right.original.killMethod) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("occurredAt", {
    header: "Date",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.occurredAt, right.original.occurredAt) ||
      compareIdentity(left.original, right.original)
  })
]);

function sortLabel(name: string, direction: false | "asc" | "desc"): string {
  if (direction === "asc") return `Sort by ${name}, currently ascending`;
  if (direction === "desc") return `Sort by ${name}, currently descending`;
  return `Sort by ${name}, currently unsorted`;
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

function formatCoverageDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(timestamp));
}

function PunchingUpTable({ entries }: { entries: PunchingUpEntry[] }) {
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
  return <div className="table-container punching-up-table-container">
    <table className="touching-grass-table punching-up-table">
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
      <tbody>{table.getRowModel().rows.map((row) => {
        const entry = row.original;
        return <tr key={row.id}>
          <td data-label="Character" className="character-name">{entry.characterName}</td>
          <td data-label="Race">{entry.race}</td>
          <td data-label="Class">{entry.class}</td>
          <td data-label="Current level" className="numeric-cell">{entry.level}</td>
          <td data-label="Account" className="account-name">{entry.accountLogin}</td>
          <td data-label="Type"><span className={`population-type ${entry.type.toLowerCase()}`}>
            {entry.type}
          </span></td>
          <td data-label="Personal record" className="punching-up-record">
            Level {entry.actorLevelAtKill} defeated Level {entry.creatureLevel} {entry.creatureName}{" "}
            <strong>(+{entry.levelDelta})</strong>
          </td>
          <td data-label="Method">{entry.killMethod === "pet" ? "Pet" : "Direct"}</td>
          <td data-label="Date"><time dateTime={entry.occurredAt}>{formatDate(entry.occurredAt)}</time></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function PunchingUpPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("punching-up", population),
    queryFn: ({ signal }) => getPunchingUp(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return <section className="panel punching-up-panel"
    aria-labelledby={showHeading ? "punchingUpHeading" : undefined}
    aria-label={showHeading ? undefined : "Punching Up statistics"}
    aria-busy={leaderboardQuery.isPending}>
    {showHeading && <h2 id="punchingUpHeading">Punching Up</h2>}
    <p className="award-detail">
      Largest recorded positive level gap overcome in a creature killing blow, including pet kills
      credited to their owner. A killing blow does not prove the fight was solo.
    </p>
    {leaderboard?.coverage.firstRecordedAt && <p className="deaths-scope">
      Recorded creature kills since{" "}
      <time dateTime={leaderboard.coverage.firstRecordedAt}>
        {formatCoverageDate(leaderboard.coverage.firstRecordedAt)}
      </time>.
    </p>}
    <p className="deaths-limit">Showing up to 25 personal records. Column sorting reorders these results.</p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">
      Loading Punching Up statistics...
    </p>}
    {leaderboardQuery.isError && <div className="stats-error" role="status">
      <p className="players-message">Punching Up statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
        Retry
      </button>
    </div>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No qualifying higher-level creature kills for this population yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 && <PunchingUpTable entries={leaderboard.entries} />}
  </section>;
}
