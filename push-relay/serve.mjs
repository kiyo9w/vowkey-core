import { createRelay, loadConfig } from "./relay.mjs";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`vowkey-push: ${error.message}`);
  process.exit(2);
}
const { server } = createRelay(config);
server.listen(config.port, config.host, () => {
  console.log(`vowkey-push on http://${config.host}:${config.port}`);
});
