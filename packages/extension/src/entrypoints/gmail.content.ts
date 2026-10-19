import { defineContentScript } from 'wxt/utils/define-content-script';
import { gmail } from '../providers/gmail/index.ts';
import { settingsItem } from '../lib/settings.ts';

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_end',
  async main() {
    const settings = await settingsItem.getValue();
    settingsItem.watch((next) => Object.assign(settings, next));
    await gmail.start({ settings });
  },
});
