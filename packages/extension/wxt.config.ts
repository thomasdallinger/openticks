import { createRequire } from 'node:module';
import { defineConfig } from 'wxt';

const require = createRequire(import.meta.url);

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'OpenTicks',
    description: 'WhatsApp-style read receipts for your emails. Open source and self-hosted.',
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://mail.google.com/'],
  },
  zip: {
    artifactTemplate: 'openticks-{{version}}-{{browser}}.zip',
  },
  hooks: {
    // InboxSDK injects this file into Gmail's page context at runtime.
    'build:publicAssets': (_wxt, files) => {
      files.push({
        absoluteSrc: require.resolve('@inboxsdk/core/pageWorld.js'),
        relativeDest: 'pageWorld.js',
      });
    },
  },
});
