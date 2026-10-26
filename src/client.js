// init(): reads what the host's server handed the page (mybeast/errors-laravel's Errors::clientConfig() or
// guestConfig()) and returns the client the error reporter sends with. Anything malformed switches the SDK off: init returns null and
// the page goes on as if it were not there - an SDK must never break the page it watches.

import { readClaims } from './token.js';
import { ingestUrl } from './transport.js';

const PUBLIC_KEY = /^pk_[a-z0-9]{24}$/;
const ENVIRONMENT = /^[a-z0-9_-]{1,32}$/;

/**
 * @param {{url: string, key: string, env?: string, release?: string|null, token?: string|null}} config
 * @returns {null | {url: string, key: string, env: string, release: string|null, token: string|null, subject: string|null, ingestUrl: (path: string) => string, setToken: (token: string) => void}}
 */
export function init(config) {
    const valid = normalize(config);
    if (!valid) return null;

    const client = {
        ...valid,
        ingestUrl: (path) => ingestUrl(client.url, path, { key: client.key, token: client.token }),
        setToken(token) {
            const claims = readClaims(token);
            if (claims?.iss !== client.key) return;
            client.token = token;
            client.subject = claims.sub ?? null;
        },
    };

    return client;
}

function normalize(config) {
    if (!config || typeof config !== 'object') return null;

    let url;
    try {
        url = new URL(config.url);
    } catch {
        return null;
    }

    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.test');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (!PUBLIC_KEY.test(config.key ?? '')) return null;

    const env = typeof config.env === 'string' && ENVIRONMENT.test(config.env) ? config.env : 'production';

    // A token for another project is ignored: the page reports as a guest rather than as someone it cannot prove.
    const read = config.token ? readClaims(config.token) : null;
    const claims = read?.iss === config.key ? read : null;
    const token = claims ? config.token : null;

    return {
        url: url.origin + url.pathname.replace(/\/+$/, ''),
        key: config.key,
        env,
        token,
        subject: claims?.sub ?? null,
        release: typeof config.release === 'string' ? config.release.slice(0, 64) : null,
    };
}
