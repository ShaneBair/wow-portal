import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getAccountRoster, RosterApiError } from "../api/roster.js";
import { useAuth } from "../auth/auth-context.js";
import { DocumentTitle } from "../components/DocumentTitle.js";

const STALE_TIME_MS = 60_000;

export function formatPlayedDuration(totalSeconds: number): { compact: string; full: string } {
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0 || totalSeconds > 0xffff_ffff) {
    throw new Error("Played duration is invalid.");
  }
  if (totalSeconds < 60) {
    return { compact: `${totalSeconds}s`, full: `${totalSeconds} ${totalSeconds === 1 ? "second" : "seconds"}` };
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const compactParts: string[] = [];
  const fullParts: string[] = [];
  for (const [value, short, singular] of [
    [days, "d", "day"], [hours, "h", "hour"], [minutes, "m", "minute"]
  ] as const) {
    if (value > 0) {
      compactParts.push(`${value}${short}`);
      fullParts.push(`${value} ${singular}${value === 1 ? "" : "s"}`);
    }
  }
  return { compact: compactParts.join(" "), full: fullParts.join(", ") };
}

function summaryText(accounts: number, characters: number): string {
  return `${accounts} ${accounts === 1 ? "account" : "accounts"} · ${characters} ${characters === 1 ? "character" : "characters"}`;
}

export function RosterPage() {
  const auth = useAuth();
  const rosterQuery = useQuery({
    queryKey: ["account-visible", "roster"],
    queryFn: ({ signal }) => getAccountRoster(signal),
    retry: false,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (rosterQuery.error instanceof RosterApiError && rosterQuery.error.httpStatus === 401) {
      auth.setSignedOut();
    }
  }, [auth, rosterQuery.error]);

  const roster = rosterQuery.data;
  return (
    <main>
      <DocumentTitle>Roster | DaBoysZeroth</DocumentTitle>
      <header className="hero"><div>
        <p className="eyebrow">PLAYER DIRECTORY</p>
        <h1>Roster</h1>
        <p className="lede">Characters belonging to real-player accounts on DaBoysZeroth.</p>
      </div></header>

      {rosterQuery.isPending && <p className="players-message" role="status" aria-live="polite">Loading roster...</p>}
      {rosterQuery.isError && !(rosterQuery.error instanceof RosterApiError && rosterQuery.error.httpStatus === 401) &&
        <p className="message error" role="status" aria-live="polite">The roster is temporarily unavailable.</p>}
      {roster && <p className="roster-summary">{summaryText(roster.accountCount, roster.characterCount)}</p>}
      {roster && roster.accounts.length === 0 &&
        <p className="players-message" role="status">No player characters are on the roster yet.</p>}

      {roster && roster.accounts.length > 0 && <div className="account-roster-grid">
        {roster.accounts.map((account, accountIndex) => {
          const headingId = `roster-account-${accountIndex}`;
          return <section className="panel account-roster-card" aria-labelledby={headingId} key={account.accountLogin}>
            <h2 id={headingId}>{account.accountLogin}</h2>
            <div className="table-container">
              <table className="roster-table account-character-table" aria-labelledby={headingId}>
                <thead><tr>
                  <th scope="col">Character</th><th scope="col">Level</th><th scope="col">Class</th>
                  <th scope="col">Race</th><th scope="col">Time played</th>
                </tr></thead>
                <tbody>{account.characters.map((character) => {
                  const duration = formatPlayedDuration(character.totalPlayedSeconds);
                  return <tr key={character.characterName}>
                    <td data-label="Character" className="character-name">{character.characterName}</td>
                    <td data-label="Level" className="numeric-cell">{character.level}</td>
                    <td data-label="Class">{character.class}</td>
                    <td data-label="Race">{character.race}</td>
                    <td data-label="Time played"><span aria-label={duration.full}>{duration.compact}</span></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </section>;
        })}
      </div>}
    </main>
  );
}
