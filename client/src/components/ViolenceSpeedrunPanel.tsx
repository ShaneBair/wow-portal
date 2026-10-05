import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures,
  useTable, type SortingState
} from "@tanstack/react-table";
import { useState } from "react";
import { getViolenceSpeedrun, type ViolenceSpeedrunEntry } from "../api/violence-speedrun.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, ViolenceSpeedrunEntry>();

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function identity(left: ViolenceSpeedrunEntry, right: ViolenceSpeedrunEntry) {
  return compareText(left.characterName, right.characterName) || compareText(left.type, right.type) ||
    compareText(left.bucketStart, right.bucketStart);
}

function formatHour(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short", timeZone: "UTC", timeZoneName: undefined
  }).format(new Date(value));
}

const columns = helper.columns([
  helper.accessor("characterName", {
    header: "Character",
    cell: (context) => <><strong>{context.getValue()}</strong><span className="character-detail">
      {context.row.original.race} {context.row.original.class} · Level {context.row.original.level}
    </span></>,
    sortFn: (left, right) => compareText(left.original.characterName, right.original.characterName) || identity(left.original, right.original)
  }),
  helper.accessor("type", {
    header: "Type",
    cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.type, right.original.type) || identity(left.original, right.original)
  }),
  helper.accessor("kills", {
    header: "Kills",
    cell: (context) => context.getValue().toLocaleString(), sortDescFirst: true,
    sortFn: (left, right) => left.original.kills - right.original.kills || identity(left.original, right.original)
  }),
  helper.accessor("bucketStart", {
    header: "UTC clock hour",
    cell: (context) => <time dateTime={context.getValue()}>{formatHour(context.getValue())} UTC</time>,
    sortFn: (left, right) => compareText(left.original.bucketStart, right.original.bucketStart) || identity(left.original, right.original)
  }),
  helper.accessor("directKills", {
    header: "Direct",
    cell: (context) => context.getValue().toLocaleString(), sortDescFirst: true,
    sortFn: (left, right) => left.original.directKills - right.original.directKills || identity(left.original, right.original)
  }),
  helper.accessor("petKills", {
    header: "Pet",
    cell: (context) => context.getValue().toLocaleString(), sortDescFirst: true,
    sortFn: (left, right) => left.original.petKills - right.original.petKills || identity(left.original, right.original)
  })
]);

function label(name: string, direction: false | "asc" | "desc") {
  return `Sort by ${name}, currently ${direction === false ? "unsorted" : direction === "asc" ? "ascending" : "descending"}`;
}

function Table({ entries }: { entries: ViolenceSpeedrunEntry[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useTable({ features, columns, data: entries, state: { sorting }, onSortingChange: setSorting,
    enableMultiSort: false, enableSortingRemoval: true });
  return <div className="table-container">
    <table className="touching-grass-table violence-speedrun-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
        const direction = header.column.getIsSorted();
        const name = String(header.column.columnDef.header);
        return <th key={header.id} scope="col" aria-sort={direction === false ? undefined : direction === "asc" ? "ascending" : "descending"}>
          <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()} aria-label={label(name, direction)}>
            <span>{name}</span><span className="sort-indicator" aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
          </button>
        </th>;
      })}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>
        <td data-label="Character" className="character-name"><strong>{row.original.characterName}</strong>
          <span className="character-detail">{row.original.race} {row.original.class} · Level {row.original.level}</span>
        </td>
        <td data-label="Type"><span className={`population-type ${row.original.type.toLowerCase()}`}>{row.original.type}</span></td>
        <td data-label="Kills" className="deaths-total">{row.original.kills.toLocaleString()}</td>
        <td data-label="UTC clock hour"><time dateTime={row.original.bucketStart}>{formatHour(row.original.bucketStart)} UTC</time></td>
        <td data-label="Direct" className="numeric-cell">{row.original.directKills.toLocaleString()}</td>
        <td data-label="Pet" className="numeric-cell">{row.original.petKills.toLocaleString()}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function ViolenceSpeedrunPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const query = useQuery({
    queryKey: statsPopulationQueryKey("violence-speedrun", population),
    queryFn: ({ signal }) => getViolenceSpeedrun(population, signal),
    staleTime: 60_000, retry: false, refetchInterval: false
  });
  return <section className="panel violence-speedrun-panel" aria-labelledby={showHeading ? "violenceSpeedrunHeading" : undefined}
    aria-label={showHeading ? undefined : "Violence Speedrun statistics"} aria-busy={query.isPending}>
    {showHeading && <h2 id="violenceSpeedrunHeading">Violence Speedrun</h2>}
    <p className="award-detail">Ranks each character’s best completed UTC clock hour by recorded direct and pet creature killing blows. This is not a rolling 60-minute window and does not include damage or assists.</p>
    {query.data?.coverage.firstRecordedAt && <p className="deaths-scope">Recorded creature kills since <time dateTime={query.data.coverage.firstRecordedAt}>{new Date(query.data.coverage.firstRecordedAt).toLocaleString()}</time>.</p>}
    <p className="deaths-limit">Showing up to 25 server-ranked personal records. Column sorting reorders these results.</p>
    {query.isPending && <p className="players-message" role="status">Loading Violence Speedrun statistics...</p>}
    {query.isError && <div className="stats-error" role="status"><p className="players-message">Violence Speedrun statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.data && query.data.entries.length === 0 && <p className="players-message" role="status">No completed UTC clock-hour records for this population yet.</p>}
    {query.data && query.data.entries.length > 0 && <Table entries={query.data.entries} />}
  </section>;
}
