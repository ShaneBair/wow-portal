import "dotenv/config";
import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.PORT ?? 8090);

app.listen(port, "0.0.0.0", () => {
  console.log(`WoW Portal listening on port ${port}`);
});
