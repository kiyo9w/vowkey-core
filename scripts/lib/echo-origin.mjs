// An HTTPS origin for the end-to-end scripts. It listens on two loopback ports and answers every
// request with the headers it received, so a script can see what a proxy attached.
//   node echo-origin.mjs KEY.pem CERT.pem PORTS_FILE
import { createServer } from "node:https";
import { readFileSync, writeFileSync } from "node:fs";

const [keyFile, certFile, portsFile] = process.argv.slice(2);
const options = { key: readFileSync(keyFile), cert: readFileSync(certFile) };
const handler = (_req, res) => {
  const body = JSON.stringify({ headers: _req.headers, url: _req.url });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(body);
};
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const ports = [await listen(createServer(options, handler)), await listen(createServer(options, handler))];
writeFileSync(portsFile, ports.join(" ") + "\n");
