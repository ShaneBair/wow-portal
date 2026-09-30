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
import { getPetKills, type PetKillEntry } from "../api/pet-kills.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;
const tableFeatureSet = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columnHelper = createColumnHelper<typeof tableFeatureSet, PetKillEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(left: PetKillEntry, right: PetKillEntry): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) || compareText(left.type, right.type) ||
    left.petKills - right.petKills || left.totalKills - right.totalKills;
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
  columnHelper.accessor("type", {
    header: "Type",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.type, right.original.type) ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("petKills", {
    header: "Pet kills",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.petKills - right.original.petKills ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("directKills", {
    header: "Direct kills",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.directKills - right.original.directKills ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("petKillPercent", {
    header: "Pet share",
    cell: (context) => `${context.getValue().toFixed(1)}%`,
    sortDescFirst: true,
    sortFn: (left, right) => left.original.petKillPercent - right.original.petKillPercent ||
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

function PetKillsTable({ entries }: { entries: PetKillEntry[] }) {
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
  return <div className="table-container pet-kills-table-container">
    <table className="touching-grass-table pet-kills-table">
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
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>
        <td data-label="Character" className="character-name">{row.original.characterName}</td>
        <td data-label="Race">{row.original.race}</td>
        <td data-label="Class">{row.original.class}</td>
        <td data-label="Level" className="numeric-cell">{row.original.level}</td>
        <td data-label="Account" className="account-name">{row.original.accountLogin}</td>
        <td data-label="Type"><span className={`population-type ${row.original.type.toLowerCase()}`}>
          {row.original.type}
        </span></td>
        <td data-label="Pet kills" className="deaths-total">{row.original.petKills.toLocaleString()}</td>
        <td data-label="Direct kills" className="numeric-cell">{row.original.directKills.toLocaleString()}</td>
        <td data-label="Pet share" className="numeric-cell">{row.original.petKillPercent.toFixed(1)}%</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function PetKillsPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("pet-kills", population),
    queryFn: ({ signal }) => getPetKills(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return <section className="panel pet-kills-panel"
    aria-labelledby={showHeading ? "petKillsHeading" : undefined}
    aria-label={showHeading ? undefined : "Let the Pet Cook statistics"}
    aria-busy={leaderboardQuery.isPending}>
    {showHeading && <h2 id="petKillsHeading">Let the Pet Cook</h2>}
    <p className="award-detail">
      Ranks owners by creature killing blows credited to their pets by the statistics module.
      It does not measure pet damage or assists.
    </p>
    {leaderboard?.coverage.firstRecordedAt && <p className="deaths-scope">
      Recorded creature kills since{" "}
      <time dateTime={leaderboard.coverage.firstRecordedAt}>
        {formatCoverageDate(leaderboard.coverage.firstRecordedAt)}
      </time>.
    </p>}
    <p className="deaths-limit">Showing up to 25 server-ranked results. Column sorting reorders these results.</p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">
      Loading pet kill statistics...
    </p>}
    {leaderboardQuery.isError && <div className="stats-error" role="status">
      <p className="players-message">Pet kill statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
        Retry
      </button>
    </div>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No recorded pet killing blows for this population yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 && <PetKillsTable entries={leaderboard.entries} />}
  </section>;
}
