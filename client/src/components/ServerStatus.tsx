import { useQuery } from "@tanstack/react-query";
import { getServerStatus } from "../api/portal.js";

const REFRESH_INTERVAL_MS = 30_000;

export function ServerStatus() {
  const statusQuery = useQuery({
    queryKey: ["server-status"],
    queryFn: ({ signal }) => getServerStatus(signal),
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false
  });

  let dotClassName = "dot";
  let message = "Checking server...";

  if (statusQuery.isError) {
    dotClassName += " offline";
    message = "Server unavailable";
  } else if (statusQuery.data?.online === true) {
    dotClassName += " online";
    message = "Server online";
  } else if (statusQuery.data?.online === false) {
    dotClassName += " offline";
    message = "Server offline";
  }

  return (
    <div className="status-card" role="status" aria-live="polite" aria-atomic="true">
      <span className={dotClassName} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
