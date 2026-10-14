import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures,
  useTable, type SortingState
} from "@tanstack/react-table";
import { useState } from "react";
import {
  getProfessionalProcrastinator,
  type ProfessionalProcrastinatorEntry
} from "../api/professional-procrastinator.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";
import { CharacterArmoryLink } from "./CharacterArmoryLink.js";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, ProfessionalProcrastinatorEntry>();

export interface FormattedDuration { compact: string; exact: string }

export function formatProcrastinationDuration(totalMilliseconds: number): FormattedDuration {
  if (!Number.isSafeInteger(totalMilliseconds) || totalMilliseconds < 0) throw new Error("Duration is invalid.");
  let remainder = totalMilliseconds;
  const days = Math.floor(remainder / 86_400_000); remainder %= 86_400_000;
  const hours = Math.floor(remainder / 3_600_000); remainder %= 3_600_000;
  const minutes = Math.floor(remainder / 60_000); remainder %= 60_000;
  const seconds = Math.floor(remainder / 1_000);
  const milliseconds = remainder % 1_000;
  const compactParts: string[] = [];
  if (days) compactParts.push(`${days}d`);
  if (hours || days) compactParts.push(`${hours}h`);
  if (minutes || hours || days) compactParts.push(`${minutes}m`);
  compactParts.push(milliseconds ? `${seconds}.${String(milliseconds).padStart(3, "0")}s` : `${seconds}s`);
  const exactParts = [
    [days, "day"], [hours, "hour"], [minutes, "minute"], [seconds, "second"], [milliseconds, "millisecond"]
  ] as const;
  const spoken = exactParts.filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount} ${unit}${amount === 1 ? "" : "s"}`);
  return { compact: compactParts.join(" "), exact: spoken.length ? spoken.join(", ") : "0 milliseconds" };
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function identity(left: ProfessionalProcrastinatorEntry, right: ProfessionalProcrastinatorEntry) {
  return compareText(left.characterName, right.characterName) || compareText(left.type, right.type) ||
    compareText(left.endedAt, right.endedAt);
}

function formatDate(value: string) {
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
  helper.accessor("fromLevel", {
    header: "Level span", cell: (context) => `${context.getValue()} → ${context.row.original.toLevel}`,
    sortFn: (left, right) => left.original.fromLevel - right.original.fromLevel || identity(left.original, right.original)
  }),
  helper.accessor("durationMilliseconds", {
    header: "Wait", cell: (context) => formatProcrastinationDuration(context.getValue()).compact,
    sortDescFirst: true,
    sortFn: (left, right) => left.original.durationMilliseconds - right.original.durationMilliseconds || identity(left.original, right.original)
  }),
  helper.accessor("endedAt", {
    header: "Completed", cell: (context) => formatDate(context.getValue()),
    sortFn: (left, right) => compareText(left.original.endedAt, right.original.endedAt) || identity(left.original, right.original)
  })
]);

function sortLabel(name: string, direction: false | "asc" | "desc") {
  return `Sort by ${name}, currently ${direction === false ? "unsorted" : direction === "asc" ? "ascending" : "descending"}`;
}

function Table({ entries }: { entries: ProfessionalProcrastinatorEntry[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useTable({ features, columns, data: entries, state: { sorting }, onSortingChange: setSorting,
    enableMultiSort: false, enableSortingRemoval: true });
  return <div className="table-container">
    <table className="touching-grass-table professional-procrastinator-table">
      <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
        const direction = header.column.getIsSorted(); const name = String(header.column.columnDef.header);
        return <th key={header.id} scope="col" aria-sort={direction === false ? undefined : direction === "asc" ? "ascending" : "descending"}>
          <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()} aria-label={sortLabel(name, direction)}>
            <span>{name}</span><span className="sort-indicator" aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
          </button>
        </th>;
      })}</tr>)}</thead>
      <tbody>{table.getRowModel().rows.map((row) => {
        const duration = formatProcrastinationDuration(row.original.durationMilliseconds);
        return <tr key={row.id}>
          <td data-label="Character" className="character-name">
            <CharacterArmoryLink characterName={row.original.characterName} isBot={row.original.type === "Bot"}>
              <strong>{row.original.characterName}</strong>
            </CharacterArmoryLink>
            <span className="character-detail">{row.original.race} {row.original.class} · Level {row.original.level}</span></td>
          <td data-label="Type"><span className={`population-type ${row.original.type.toLowerCase()}`}>{row.original.type}</span></td>
          <td data-label="Level span" className="numeric-cell">{row.original.fromLevel} → {row.original.toLevel}</td>
          <td data-label="Wait" className="deaths-total"><span aria-label={duration.exact}>{duration.compact}</span></td>
          <td data-label="Completed"><time dateTime={row.original.endedAt}>{formatDate(row.original.endedAt)}</time></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function ProfessionalProcrastinatorPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const query = useQuery({
    queryKey: statsPopulationQueryKey("professional-procrastinator", population),
    queryFn: ({ signal }) => getProfessionalProcrastinator(population, signal),
    staleTime: 60_000, retry: false, refetchInterval: false
  });
  return <section className="panel professional-procrastinator-panel"
    aria-labelledby={showHeading ? "professionalProcrastinatorHeading" : undefined}
    aria-label={showHeading ? undefined : "Professional Procrastinator statistics"} aria-busy={query.isPending}>
    {showHeading && <h2 id="professionalProcrastinatorHeading">Professional Procrastinator</h2>}
    <p className="award-detail">Longest wall-clock wait between consecutive recorded one-level gains. Logged-out time counts; boosts and time after the latest ding do not.</p>
    {query.data?.coverage.firstRecordedAt && <p className="deaths-scope">Recorded level changes since <time dateTime={query.data.coverage.firstRecordedAt}>{formatDate(query.data.coverage.firstRecordedAt)}</time>.</p>}
    <p className="deaths-limit">Showing up to 25 server-ranked completed intervals. Column sorting reorders these results.</p>
    {query.isPending && <p className="players-message" role="status">Loading Professional Procrastinator statistics...</p>}
    {query.isError && <div className="stats-error" role="status"><p className="players-message">Professional Procrastinator statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.data && query.data.entries.length === 0 && <p className="players-message" role="status">No completed normal leveling intervals for this population yet.</p>}
    {query.data && query.data.entries.length > 0 && <Table entries={query.data.entries} />}
  </section>;
}
