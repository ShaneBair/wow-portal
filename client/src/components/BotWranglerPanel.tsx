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
import { getBotWrangler, type BotWranglerEntry } from "../api/bot-wrangler.js";

const STALE_TIME_MS = 60_000;
const QUERY_KEY = ["account-visible", "stats", "bot-wrangler"] as const;
const tableFeatureSet = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const columnHelper = createColumnHelper<typeof tableFeatureSet, BotWranglerEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(left: BotWranglerEntry, right: BotWranglerEntry): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) || left.botKills - right.botKills ||
    left.uniqueBotVictims - right.uniqueBotVictims || compareText(left.lastBotKillAt, right.lastBotKillAt);
}

const columns = columnHelper.columns([
  columnHelper.accessor("characterName", {
    header: "Killer",
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
  columnHelper.accessor("botKills", {
    header: "Bot kills",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.botKills - right.original.botKills ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("uniqueBotVictims", {
    header: "Distinct bot victims",
    cell: (context) => context.getValue().toLocaleString(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.uniqueBotVictims - right.original.uniqueBotVictims ||
      compareIdentity(left.original, right.original)
  }),
  columnHelper.accessor("lastBotKillAt", {
    header: "Latest kill",
    cell: (context) => context.getValue(),
    sortDescFirst: true,
    sortFn: (left, right) => compareText(left.original.lastBotKillAt, right.original.lastBotKillAt) ||
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

function BotWranglerTable({ entries }: { entries: BotWranglerEntry[] }) {
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
  return <div className="table-container bot-wrangler-table-container">
    <table className="touching-grass-table bot-wrangler-table">
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
        <td data-label="Killer" className="character-name">{row.original.characterName}</td>
        <td data-label="Race">{row.original.race}</td>
        <td data-label="Class">{row.original.class}</td>
        <td data-label="Level" className="numeric-cell">{row.original.level}</td>
        <td data-label="Account" className="account-name">{row.original.accountLogin}</td>
        <td data-label="Bot kills" className="deaths-total">{row.original.botKills.toLocaleString()}</td>
        <td data-label="Distinct bot victims" className="numeric-cell">
          {row.original.uniqueBotVictims.toLocaleString()}
        </td>
        <td data-label="Latest kill">
          <time dateTime={row.original.lastBotKillAt}>{formatTimestamp(row.original.lastBotKillAt)}</time>
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function BotWranglerPanel({ showHeading = true }: { showHeading?: boolean } = {}) {
  const leaderboardQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) => getBotWrangler(signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return <section className="panel bot-wrangler-panel"
    aria-labelledby={showHeading ? "botWranglerHeading" : undefined}
    aria-label={showHeading ? undefined : "Bot Wrangler statistics"}
    aria-busy={leaderboardQuery.isPending}>
    {showHeading && <h2 id="botWranglerHeading">Bot Wrangler</h2>}
    <p className="award-detail"><strong>Human killers • Bot victims.</strong></p>
    <p className="award-detail">
      Bot status is the module&apos;s authoritative session flag, so a victim counts only when
      bot-controlled for that recorded PvP death.
    </p>
    {leaderboard?.coverage.firstRecordedAt && <p className="deaths-scope">
      Recorded PvP kills since{" "}
      <time dateTime={leaderboard.coverage.firstRecordedAt}>
        {formatTimestamp(leaderboard.coverage.firstRecordedAt)}
      </time>.
    </p>}
    <p className="deaths-limit">
      Fixed matchup; the Players/All selector does not change this board. Showing up to 25 results.
    </p>
    {leaderboardQuery.isPending && <p className="players-message" role="status">
      Loading Bot Wrangler statistics...
    </p>}
    {leaderboardQuery.isError && <div className="stats-error" role="status">
      <p className="players-message">Bot Wrangler statistics are temporarily unavailable.</p>
      <button type="button" className="stats-retry" onClick={() => void leaderboardQuery.refetch()}>
        Retry
      </button>
    </div>}
    {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
      No recorded human-versus-bot PvP kills yet.
    </p>}
    {leaderboard && leaderboard.entries.length > 0 && <BotWranglerTable entries={leaderboard.entries} />}
  </section>;
}
