import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable, type SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { getDingDongDash, type DingDongDashEntry } from "../api/ding-dong-dash.js";
import { statsPopulationQueryKey, useStatsPopulationContext } from "../stats/stats-population.js";
import { CharacterArmoryLink } from "./CharacterArmoryLink.js";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, DingDongDashEntry>();
export interface DingDuration { compact: string; exact: string }

export function formatDingDuration(totalMilliseconds: number): DingDuration {
  if (!Number.isSafeInteger(totalMilliseconds) || totalMilliseconds < 0) throw new Error("Duration is invalid.");
  let remainder = totalMilliseconds;
  const days = Math.floor(remainder / 86_400_000); remainder %= 86_400_000;
  const hours = Math.floor(remainder / 3_600_000); remainder %= 3_600_000;
  const minutes = Math.floor(remainder / 60_000); remainder %= 60_000;
  const seconds = Math.floor(remainder / 1_000); const milliseconds = remainder % 1_000;
  const compact: string[] = [];
  if (days) compact.push(`${days}d`);
  if (hours || days) compact.push(`${hours}h`);
  if (minutes || hours || days) compact.push(`${minutes}m`);
  compact.push(milliseconds ? `${seconds}.${String(milliseconds).padStart(3, "0")}s` : `${seconds}s`);
  const units = [[days, "day"], [hours, "hour"], [minutes, "minute"], [seconds, "second"], [milliseconds, "millisecond"]] as const;
  const exact = units.filter(([amount]) => amount > 0).map(([amount, unit]) => `${amount} ${unit}${amount === 1 ? "" : "s"}`);
  return { compact: compact.join(" "), exact: exact.length ? exact.join(", ") : "0 milliseconds" };
}

function compareText(left: string, right: string) { return left.localeCompare(right, undefined, { sensitivity: "base" }); }
function identity(left: DingDongDashEntry, right: DingDongDashEntry) {
  return compareText(left.characterName, right.characterName) || compareText(left.type, right.type) || compareText(left.endedAt, right.endedAt);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const columns = helper.columns([
  helper.accessor("characterName", { header: "Character", cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.characterName, right.original.characterName) || identity(left.original, right.original) }),
  helper.accessor("type", { header: "Type", cell: (context) => context.getValue(),
    sortFn: (left, right) => compareText(left.original.type, right.original.type) || identity(left.original, right.original) }),
  helper.accessor("fromLevel", { header: "Level span", cell: (context) => `${context.getValue()} → ${context.row.original.toLevel}`,
    sortFn: (left, right) => left.original.fromLevel - right.original.fromLevel || identity(left.original, right.original) }),
  helper.accessor("durationMilliseconds", { header: "Time", cell: (context) => formatDingDuration(context.getValue()).compact,
    sortDescFirst: false, sortFn: (left, right) => left.original.durationMilliseconds - right.original.durationMilliseconds || identity(left.original, right.original) }),
  helper.accessor("endedAt", { header: "Completed", cell: (context) => formatDate(context.getValue()),
    sortFn: (left, right) => compareText(left.original.endedAt, right.original.endedAt) || identity(left.original, right.original) })
]);
function sortLabel(name: string, direction: false | "asc" | "desc") {
  return `Sort by ${name}, currently ${direction === false ? "unsorted" : direction === "asc" ? "ascending" : "descending"}`;
}

function Table({ entries }: { entries: DingDongDashEntry[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useTable({ features, columns, data: entries, state: { sorting }, onSortingChange: setSorting,
    enableMultiSort: false, enableSortingRemoval: true });
  return <div className="table-container"><table className="touching-grass-table ding-dong-dash-table">
    <thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
      const direction = header.column.getIsSorted(); const name = String(header.column.columnDef.header);
      return <th key={header.id} scope="col" aria-sort={direction === false ? undefined : direction === "asc" ? "ascending" : "descending"}>
        <button type="button" className="sort-button" onClick={header.column.getToggleSortingHandler()} aria-label={sortLabel(name, direction)}>
          <span>{name}</span><span className="sort-indicator" aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
        </button></th>;
    })}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map((row) => { const duration = formatDingDuration(row.original.durationMilliseconds); return <tr key={row.id}>
      <td data-label="Character" className="character-name">
        <CharacterArmoryLink characterName={row.original.characterName} isBot={row.original.type === "Bot"}>
          <strong>{row.original.characterName}</strong>
        </CharacterArmoryLink>
        <span className="character-detail">{row.original.race} {row.original.class} · Level {row.original.level}</span>
      </td>
      <td data-label="Type"><span className={`population-type ${row.original.type.toLowerCase()}`}>{row.original.type}</span></td>
      <td data-label="Level span" className="numeric-cell">{row.original.fromLevel} → {row.original.toLevel}</td>
      <td data-label="Time" className="deaths-total"><span aria-label={duration.exact}>{duration.compact}</span></td>
      <td data-label="Completed"><time dateTime={row.original.endedAt}>{formatDate(row.original.endedAt)}</time></td>
    </tr>; })}</tbody>
  </table></div>;
}

export function DingDongDashPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { population } = useStatsPopulationContext();
  const query = useQuery({ queryKey: statsPopulationQueryKey("ding-dong-dash", population),
    queryFn: ({ signal }) => getDingDongDash(population, signal), staleTime: 60_000, retry: false, refetchInterval: false });
  return <section className="panel ding-dong-dash-panel" aria-labelledby={showHeading ? "dingDongDashHeading" : undefined}
    aria-label={showHeading ? undefined : "Ding Dong Dash statistics"} aria-busy={query.isPending}>
    {showHeading && <h2 id="dingDongDashHeading">Ding Dong Dash</h2>}
    <p className="award-detail">Fastest wall-clock time between consecutive recorded one-level gains; boosts are excluded. Logged-out time still counts.</p>
    {query.data?.coverage.firstRecordedAt && <p className="deaths-scope">Recorded level changes since <time dateTime={query.data.coverage.firstRecordedAt}>{formatDate(query.data.coverage.firstRecordedAt)}</time>.</p>}
    <p className="deaths-limit">Showing up to 25 server-ranked completed intervals. Column sorting reorders these results.</p>
    {query.isPending && <p className="players-message" role="status">Loading Ding Dong Dash statistics...</p>}
    {query.isError && <div className="stats-error" role="status"><p className="players-message">Ding Dong Dash statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void query.refetch()}>Retry</button></div>}
    {query.data && query.data.entries.length === 0 && <p className="players-message" role="status">No consecutive normal leveling intervals for this population yet.</p>}
    {query.data && query.data.entries.length > 0 && <Table entries={query.data.entries} />}
  </section>;
}
