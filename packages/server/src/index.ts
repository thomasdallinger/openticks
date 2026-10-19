import { loadConfig } from './config.ts';
import { startServer } from './server.ts';

const config = loadConfig();
const { url, stop } = startServer(config);

console.log(`
  OpenTicks server running on ${url}

  Access key (paste into the extension): ${config.accessKey}

  The extension also needs this server's public HTTPS URL, so that
  recipients' mail apps can load the tracking pixel.
`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
}
