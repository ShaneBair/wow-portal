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
  getQuestCompletionLeaderboard,
  type QuestCompletionLeaderboardEntry
} from "../api/quest-completion-leaderboard.js";
import {
  statsPopulationQueryKey,
  useStatsPopulationContext
} from "../stats/stats-population.js";

const STALE_TIME_MS = 60_000;
const tableFeatureSet = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel()
});
const columnHelper = createColumnHelper<typeof tableFeatureSet, QuestCompletionLeaderboardEntry>();

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareIdentity(
  left: QuestCompletionLeaderboardEntry,
  right: QuestCompletionLeaderboardEntry
): number {
  return compareText(left.characterName, right.characterName) ||
    compareText(left.accountLogin, right.accountLogin) ||
    Number(left.isBot) - Number(right.isBot) ||
    left.questCompletions - right.questCompletions ||
    compareText(left.race, right.race) || compareText(left.class, right.class) ||
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
  columnHelper.accessor("questCompletions", {
    header: "Quest completions",
    cell: (context) => context.getValue(),
    sortDescFirst: true,
    sortFn: (left, right) => left.original.questCompletions - right.original.questCompletions ||
      compareIdentity(left.original, right.original)
  })
]);

function sortLabel(columnName: string, direction: false | "asc" | "desc"): string {
  if (direction === "asc") return `Sort by ${columnName}, currently ascending`;
  if (direction === "desc") return `Sort by ${columnName}, currently descending`;
  return `Sort by ${columnName}, currently unsorted`;
}

function sortIndicator(direction: false | "asc" | "desc"): string {
  if (direction === "asc") return "↑";
  if (direction === "desc") return "↓";
  return "↕";
}

function formatCoverageTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function CompletionistTable({ entries }: { entries: QuestCompletionLeaderboardEntry[] }) {
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
    <div className="table-container completionist-table-container">
      <table className="completionist-table">
        <thead>
          {table.getHeaderGroups().map((group) => <tr key={group.id}>
            {group.headers.map((header) => {
              const direction = header.column.getIsSorted();
              const name = String(header.column.columnDef.header);
              return <th key={header.id} scope="col" aria-sort={direction === false
                ? undefined : direction === "asc" ? "ascending" : "descending"}>
                <button type="button" className="sort-button"
                  onClick={header.column.getToggleSortingHandler()}
                  aria-label={sortLabel(name, direction)}>
                  <span>{name}</span>
                  <span className="sort-indicator" aria-hidden="true">{sortIndicator(direction)}</span>
                </button>
              </th>;
            })}
          </tr>)}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => <tr key={row.id}>
            <td data-label="Character" className="character-name">{row.original.characterName}</td>
            <td data-label="Race">{row.original.race}</td>
            <td data-label="Class">{row.original.class}</td>
            <td data-label="Level" className="numeric-cell">{row.original.level}</td>
            <td data-label="Account" className="account-name">{row.original.accountLogin}</td>
            <td data-label="Type"><span className={`population-type ${row.original.isBot ? "bot" : "player"}`}>
              {row.original.isBot ? "Bot" : "Player"}
            </span></td>
            <td data-label="Quest completions" className="completion-total">
              {row.original.questCompletions.toLocaleString()}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function WinnerSummary({ entries }: { entries: QuestCompletionLeaderboardEntry[] }) {
  const winningTotal = entries[0]!.questCompletions;
  const winners = entries.filter((entry) => entry.questCompletions === winningTotal);
  const names = winners.map((winner) => `${winner.characterName} (${winner.isBot ? "Bot" : "Player"})`);
  return <p className="award-winner">
    <strong>{winners.length === 1 ? "Leader:" : "Co-winners:"}</strong>{" "}
    {names.join(winners.length === 2 ? " and " : ", ")} — {winningTotal.toLocaleString()}{" "}
    recorded quest {winningTotal === 1 ? "completion" : "completions"}
    {winners.length > 1 ? " each" : ""}.
  </p>;
}

export function CompletionistPanel() {
  const { population } = useStatsPopulationContext();
  const leaderboardQuery = useQuery({
    queryKey: statsPopulationQueryKey("quest-completions", population),
    queryFn: ({ signal }) => getQuestCompletionLeaderboard(population, signal),
    staleTime: STALE_TIME_MS,
    retry: false,
    refetchInterval: false
  });
  const leaderboard = leaderboardQuery.data;
  return (
    <section className="panel award-panel completionist-panel" aria-labelledby="completionistHeading"
      aria-busy={leaderboardQuery.isPending}>
      <div className="award-heading">
        <span className="award-icon" aria-hidden="true">📜</span>
        <div><h3 id="completionistHeading">Completionist</h3><p>Most quests completed</p></div>
      </div>
      <p className="deaths-limit">Showing up to 25 server-ranked results. Column sorting reorders these results.</p>
      {leaderboardQuery.isPending && <p className="players-message" role="status">
        Loading quest completion statistics...
      </p>}
      {leaderboardQuery.isError && <p className="players-message" role="status">
        Quest completion statistics are temporarily unavailable.
      </p>}
      {leaderboard && leaderboard.entries.length === 0 && <p className="players-message" role="status">
        No recorded quest completions for this population yet.
      </p>}
      {leaderboard && leaderboard.entries.length > 0 && <>
        <WinnerSummary entries={leaderboard.entries} />
        <CompletionistTable entries={leaderboard.entries} />
      </>}
    </section>
  );
}
