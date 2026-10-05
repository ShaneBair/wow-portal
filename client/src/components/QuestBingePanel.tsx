import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures,
  useTable, type SortingState
} from "@tanstack/react-table";
import { useState } from "react";
import { getQuestBinge, type QuestBingeEntry } from "../api/quest-binge.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, QuestBingeEntry>();

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function identity(left: QuestBingeEntry, right: QuestBingeEntry) {
  return compareText(left.characterName, right.characterName) || compareText(left.type, right.type) || compareText(left.day, right.day);
}

export function formatQuestBingeDay(day: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00.000Z`));
}

function formatCoverage(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const columns = helper.columns([
  helper.accessor("characterName", {
    header: "Character", cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.characterName, right.original.characterName) || identity(left.original, right.original)
  }),
  helper.accessor("type", {
    header: "Type", cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.type, right.original.type) || identity(left.original, right.original)
  }),
  helper.accessor("questsCompleted", {
    header: "Completions", cell: (context) => context.getValue().toLocaleString(), sortDescFirst: true,
    sortFn: (left, right) => left.original.questsCompleted - right.original.questsCompleted || identity(left.original, right.original)
  }),
  helper.accessor("uniqueQuests", {
    header: "Unique quests", cell: (context) => context.getValue().toLocaleString(), sortDescFirst: true,
    sortFn: (left, right) => left.original.uniqueQuests - right.original.uniqueQuests || identity(left.original, right.original)
  }),
  helper.accessor("day", {
    header: "UTC day", cell: (context) => formatQuestBingeDay(context.getValue()),
    sortFn: (left, right) => compareText(left.original.day, right.original.day) || identity(left.original, right.original)
  })
]);

function sortLabel(name: string, direction: false | "asc" | "desc") {
  return `Sort by ${name}, currently ${direction === false ? "unsorted" : direction === "asc" ? "ascending" : "descending"}`;
}

function Table({ entries }: { entries: QuestBingeEntry[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useTable({ features, columns, data: entries, state: { sorting }, onSortingChange: setSorting,
    enableMultiSort: false, enableSortingRemoval: true });
  return <div className="table-container">
    <table className="touching-grass-table quest-binge-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
        const direction = header.column.getIsSorted(); const name = String(header.column.columnDef.header);
        return <th key={header.id} scope="col" aria-sort={direction === false ? undefined : direction === "asc" ? "ascending" : "descending"}>
          <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()} aria-label={sortLabel(name, direction)}>
            <span>{name}</span><span className="sort-indicator" aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
          </button>
        </th>;
      })}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id}>
        <td data-label="Character" className="character-name"><strong>{row.original.characterName}</strong>
          <span className="character-detail">{row.original.race} {row.original.class} · Level {row.original.level}</span></td>
        <td data-label="Type"><span className={`population-type ${row.original.type.toLowerCase()}`}>{row.original.type}</span></td>
        <td data-label="Completions" className="deaths-total">{row.original.questsCompleted.toLocaleString()}</td>
        <td data-label="Unique quests" className="numeric-cell">{row.original.uniqueQuests.toLocaleString()}</td>
        <td data-label="UTC day"><time dateTime={row.original.day}>{formatQuestBingeDay(row.original.day)} UTC</time></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function QuestBingePanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const query = useQuery({
    queryKey: statsPopulationQueryKey("quest-binge", population),
    queryFn: ({ signal }) => getQuestBinge(population, signal),
    staleTime: 60_000, retry: false, refetchInterval: false
  });
  return <section className="panel quest-binge-panel" aria-labelledby={showHeading ? "questBingeHeading" : undefined}
    aria-label={showHeading ? undefined : "Quest Binge statistics"} aria-busy={query.isPending}>
    {showHeading && <h2 id="questBingeHeading">Quest Binge</h2>}
    <p className="award-detail">Most recorded quest completions in one completed UTC calendar day. Repeatable completions count; today is withheld until the day is complete.</p>
    {query.data?.coverage.firstRecordedAt && <p className="deaths-scope">Recorded quest completions since <time dateTime={query.data.coverage.firstRecordedAt}>{formatCoverage(query.data.coverage.firstRecordedAt)}</time>.</p>}
    <p className="deaths-limit">Showing up to 25 server-ranked personal records. Column sorting reorders these results.</p>
    {query.isPending && <p className="players-message" role="status">Loading Quest Binge statistics...</p>}
    {query.isError && <div className="stats-error" role="status"><p className="players-message">Quest Binge statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.data && query.data.entries.length === 0 && <p className="players-message" role="status">No completed UTC-day quest records for this population yet.</p>}
    {query.data && query.data.entries.length > 0 && <Table entries={query.data.entries} />}
  </section>;
}
