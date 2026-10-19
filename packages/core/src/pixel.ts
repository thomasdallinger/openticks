/** Path prefix of the tracking pixel endpoint: `<server>/o/<id>.gif`. */
export const PIXEL_PATH = '/o/';

const ID_PATTERN = '[A-Za-z0-9_-]{22}';
const ID_REGEX = new RegExp(`^${ID_PATTERN}$`);

/** 128-bit random, URL-safe id. Used both as message id and pixel token, so it must be unguessable. */
export function newTrackingId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isTrackingId(value: string): boolean {
  return ID_REGEX.test(value);
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function pixelUrl(serverUrl: string, id: string): string {
  return `${normalizeServerUrl(serverUrl)}${PIXEL_PATH}${id}.gif`;
}

export function pixelHtml(serverUrl: string, id: string): string {
  return `<img src="${pixelUrl(serverUrl, id)}" width="1" height="1" alt="" style="width:1px;height:1px;border:0">`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pixelPattern(serverUrl: string): string {
  const host = new URL(normalizeServerUrl(serverUrl)).host;
  return `${escapeRegex(host)}${escapeRegex(PIXEL_PATH)}(${ID_PATTERN})\\.gif`;
}

/**
 * Finds OpenTicks pixel ids in image URLs. Works with mail-provider proxy URLs that
 * embed the original URL, e.g. Gmail's `https://ci3.googleusercontent.com/...#https://host/o/<id>.gif`.
 */
export function findPixelIds(urls: Iterable<string>, serverUrl: string): string[] {
  const regex = new RegExp(pixelPattern(serverUrl));
  const ids = new Set<string>();
  for (const url of urls) {
    let decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      // keep the raw value
    }
    const match = regex.exec(decoded);
    if (match?.[1]) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * Removes OpenTicks pixels from outgoing HTML. Replies quote earlier messages; without this,
 * opening a reply would also count as opening every quoted message.
 */
export function stripPixels(html: string, serverUrl: string): string {
  const regex = new RegExp(`<img\\b[^>]*${pixelPattern(serverUrl)}[^>]*>`, 'gi');
  return html.replace(regex, '');
}
