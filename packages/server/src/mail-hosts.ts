import { resolveMx } from 'node:dns/promises';

/** Who hosts a recipient's mailbox. Used to guess which recipient opened a shared email. */
export type MailHost = 'google' | 'yahoo' | 'microsoft' | 'apple' | 'other';

/** How a pixel request reached us. Proxies tell us which mail host the reader uses. */
export type OpenClient = 'google-proxy' | 'yahoo-proxy' | 'direct';

export const PROXY_HOST: Partial<Record<OpenClient, MailHost>> = {
  'google-proxy': 'google',
  'yahoo-proxy': 'yahoo',
};

export function classifyOpenClient(userAgent: string | null | undefined): OpenClient {
  if (!userAgent) return 'direct';
  if (userAgent.includes('GoogleImageProxy')) return 'google-proxy';
  if (userAgent.includes('YahooMailProxy')) return 'yahoo-proxy';
  return 'direct';
}

const MX_SUFFIXES: [string, MailHost][] = [
  ['google.com', 'google'],
  ['googlemail.com', 'google'],
  ['yahoodns.net', 'yahoo'],
  ['outlook.com', 'microsoft'],
  ['icloud.com', 'apple'],
  ['me.com', 'apple'],
];

export function mailHostFromMx(exchanges: string[]): MailHost {
  for (const exchange of exchanges) {
    const host = exchange.toLowerCase().replace(/\.$/, '');
    for (const [suffix, mailHost] of MX_SUFFIXES) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return mailHost;
    }
  }
  return 'other';
}

export type MailHostResolver = (domain: string) => Promise<MailHost>;

/** DNS-backed resolver with an in-memory cache. Lookup failures resolve to `other`. */
export function createMailHostResolver(): MailHostResolver {
  const cache = new Map<string, Promise<MailHost>>();
  return (domain) => {
    const key = domain.toLowerCase();
    let pending = cache.get(key);
    if (!pending) {
      pending = resolveMx(key)
        .then((records) => mailHostFromMx(records.map((r) => r.exchange)))
        .catch(() => 'other' as const);
      cache.set(key, pending);
    }
    return pending;
  };
}
