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
  getVendorTrashMagnate,
  type VendorTrashMagnateEntry
} from "../api/vendor-trash-magnate.js";

const STALE_TIME_MS = 60_000;
const QUERY_KEY = ["account-visible", "stats", "vendor-trash-magnate"] as const;
const tableFeatureSet = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columnHelper = createColumnHelper<typeof tableFeatureSet, VendorTrashMagnateEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareCopper(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareIdentity(left: VendorTrashMagnateEntry, right: VendorTrashMagnateEntry): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) || compareCopper(left.copper, right.copper);
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
  columnHelper.accessor("copper", {
    header: "Vendor earnings",
    cell: (context) => context.row.original.displayMoney,
    sortDescFirst: true,
    sortFn: (left, right) => compareCopper(left.original.copper, right.original.copper) ||
      compareIdentity(left.original, right.original)
  })
]);

function sortLabel(name: string, direction: false | "asc" | "desc"): string {
  if (direction === "asc") return `Sort by ${name}, currently ascending`;
  if (direction === "desc") return `Sort by ${name}, currently descending`;
  return `Sort by ${name}, currently unsorted`;
}

function VendorTrashMagnateTable({ entries }: { entries: VendorTrashMagnateEntry[] }) {
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
  return <div className="table-container vendor-trash-magnate-table-container">
    <table className="touching-grass-table vendor-trash-magnate-table">
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
        <td data-label="Vendor earnings" className="deaths-total">{row.original.displayMoney}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function VendorTrashMagnatePanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const leaderboardQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getVendorTrashMagnate(signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return <section className="panel vendor-trash-magnate-panel"
    aria-labelledby={showHeading ? "vendorTrashMagnateHeading" : undefined}
    aria-label={showHeading ? undefined : "Vendor Trash Magnate statistics"}
    aria-busy={leaderboardQuery.isPending}>
    {showHeading && <h2 id="vendorTrashMagnateHeading">Vendor Trash Magnate</h2>}
    <p className="award-detail"><strong>All current characters.</strong></p>
    <p className="award-detail">
      Uses AzerothCore&apos;s cumulative vendor-sales counter. It includes all qualifying vendor sales,
      not only gray items, and may include activity from before portal event collection.
    </p>
    <p className="deaths-limit">
      Fixed lifetime counter; the Players/All selector does not change this board. Showing up to 25 results.
    </p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">
      Loading Vendor Trash Magnate statistics...
    </p>}
    {leaderboardQuery.isError && <div className="stats-error" role="status">
      <p className="players-message">Vendor Trash Magnate statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
        Retry
      </button>
    </div>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No current characters have recorded vendor earnings yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 &&
      <VendorTrashMagnateTable entries={leaderboard.entries} />}
  </section>;
}
