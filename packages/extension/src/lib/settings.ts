import { normalizeServerUrl } from '@openticks/core';
import { storage } from 'wxt/utils/storage';

export interface Settings {
  /** Public HTTPS URL of the OpenTicks server. Recipients' mail apps load the pixel from here. */
  serverUrl: string;
  accessKey: string;
}

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: { serverUrl: '', accessKey: '' },
});

export function isConfigured(settings: Settings): boolean {
  return Boolean(settings.serverUrl && settings.accessKey);
}

export function cleanSettings(settings: Settings): Settings {
  return { serverUrl: normalizeServerUrl(settings.serverUrl), accessKey: settings.accessKey.trim() };
}
