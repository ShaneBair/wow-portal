import "dotenv/config";
import { createApp } from "./app.js";
import { closePortalDatabasePool } from "./services/portal-database.js";
import { closeStatsDatabasePool } from "./services/stats-database.js";

const app = createApp();
const port = Number(process.env.PORT ?? 8090);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`WoW Portal listening on port ${port}`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  server.close(async (error) => {
    const [statsResult, portalResult] = await Promise.allSettled([
      closeStatsDatabasePool(),
      closePortalDatabasePool()
    ]);
    if (statsResult.status === "rejected") {
      console.error("Failed to close the statistics database pool cleanly.");
    }
    if (portalResult.status === "rejected") {
      console.error("Failed to close the portal database pool cleanly.");
    }

    process.exitCode = error ? 1 : 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
