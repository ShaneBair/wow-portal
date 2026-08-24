import { useQuery } from "@tanstack/react-query";
import { getOnlinePlayers } from "../api/portal.js";

const REFRESH_INTERVAL_MS = 30_000;

export function OnlinePlayersPanel() {
  const rosterQuery = useQuery({
    queryKey: ["online-players"],
    queryFn: ({ signal }) => getOnlinePlayers(signal),
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false
  });

  const roster = rosterQuery.data;
  const showRoster = !rosterQuery.isError && roster !== undefined && roster.players.length > 0;
  let message = "Checking who is online...";
  let count: number | undefined;

  if (rosterQuery.isError) {
    message = "The online roster is temporarily unavailable.";
  } else if (roster && roster.players.length === 0) {
    message = "No real players are online.";
    count = 0;
  } else if (roster) {
    count = roster.count;
  }

  return (
    <section className="panel players-panel" aria-labelledby="playersHeading">
      <div className="players-heading">
        <h2 id="playersHeading">Players Online</h2>
        {count !== undefined && (
          <span className="count-badge" aria-label={`${count} real players online`}>
            {count}
          </span>
        )}
      </div>

      {!showRoster && (
        <p className="players-message" role="status" aria-live="polite">{message}</p>
      )}

      {showRoster && (
        <div className="table-container">
          <table className="roster-table">
            <caption className="visually-hidden">Currently online human-controlled characters</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Character</th>
                <th scope="col">Race</th>
                <th scope="col">Class</th>
                <th scope="col">Level</th>
                <th scope="col">Location</th>
              </tr>
            </thead>
            <tbody>
              {roster.players.map((player) => (
                <tr key={`${player.accountLogin}:${player.characterName}`}>
                  <td data-label="Account" className="account-name">{player.accountLogin}</td>
                  <td data-label="Character" className="character-name">{player.characterName}</td>
                  <td data-label="Race">{player.race}</td>
                  <td data-label="Class">{player.class}</td>
                  <td data-label="Level" className="numeric-cell">{player.level}</td>
                  <td data-label="Location">{player.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
