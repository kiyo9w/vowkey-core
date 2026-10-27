// Starts the relay with the settings in the environment. See README.md.
import { createRelay, loadConfig } from "./relay.mjs";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`vowkey-relay: ${error.message}`);
  process.exit(2);
}
const { server } = createRelay(config);
server.listen(config.port, config.host, () => {
  console.log(
    `vowkey-relay on http://${config.host}:${config.port}, forwarding to ${new URL(config.upstreamUrl).origin} as ${config.upstreamModel}`,
  );
});
