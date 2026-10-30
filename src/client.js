// init(): reads what the host's server handed the page (mybeast/errors-laravel's Errors::clientConfig() or
// guestConfig()) and returns the client the error reporter sends with. Anything malformed switches the SDK off: init returns null and
// the page goes on as if it were not there - an SDK must never break the page it watches.
//
// A token runs out (token_ttl, 30 minutes by default) and a page may stay open for hours: two minutes before it does,
// and whenever the tab comes back, the client asks for a fresh one - the host's own getToken(), else the config's
// token_url (mybeast/errors-laravel's GET /mybeast/errors/token, the person's own session deciding who). Nobody
// signed in any more (204, or getToken giving null): the page goes on as a guest. A failure tries again in a minute.

import { readClaims, secondsLeft } from './token.js';
import { ingestUrl } from './transport.js';

const RENEW_BEFORE_S = 120;
const RETRY_MS = 60_000;

const PUBLIC_KEY = /^pk_[a-z0-9]{24}$/;
const ENVIRONMENT = /^[a-z0-9_-]{1,32}$/;

/**
 * @param {{url: string, key: string, env?: string, release?: string|null, token?: string|null, token_url?: string|null}} config
 * @param {{getToken?: () => Promise<string|null>, fetch?: typeof fetch, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout, document?: Document, now?: () => number}} options
 * @returns {null | {url: string, key: string, env: string, release: string|null, token: string|null, subject: string|null, ingestUrl: (path: string) => string, setToken: (token: string) => void, renew: () => Promise<void>, stop: () => void}}
 */
export function init(config, options = {}) {
    const valid = normalize(config);
    if (!valid) return null;

    const later = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    const cancel = options.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
    const now = options.now ?? (() => Date.now());
    const getToken = options.getToken ?? (valid.tokenUrl ? () => fetchToken(valid.tokenUrl, options.fetch) : null);
    let timer = null;
    let renewing = null;

    const client = {
        ...valid,
        ingestUrl: (path) => ingestUrl(client.url, path, { key: client.key, token: client.token }),
        setToken(token) {
            const claims = readClaims(token);
            if (claims?.iss !== client.key) return;
            client.token = token;
            client.subject = claims.sub ?? null;
            schedule();
        },
        /** Asks for a fresh token now (once at a time); never throws. */
        renew() {
            if (!getToken || !client.token) return Promise.resolve();
            renewing ??= Promise.resolve()
                .then(() => getToken())
                .then(
                    (token) => {
                        if (token === null) {
                            client.token = null; // signed out: a guest from now on
                            client.subject = null;
                        } else client.setToken(token);
                    },
                    () => {
                        stopTimer();
                        timer = later(() => client.renew(), RETRY_MS);
                    },
                )
                .finally(() => {
                    renewing = null;
                });
            return renewing;
        },
        stop() {
            stopTimer();
        },
    };

    function stopTimer() {
        if (timer !== null) cancel(timer);
        timer = null;
    }

    function schedule() {
        stopTimer();
        const left = client.token ? secondsLeft(client.token, now()) : null;
        if (!getToken || left === null) return;
        timer = later(() => client.renew(), Math.max(5, left - RENEW_BEFORE_S) * 1000);
    }

    // A tab in the background may sleep through its timer: back in view with little left, renew at once.
    const doc = options.document ?? globalThis.document;
    doc?.addEventListener?.('visibilitychange', () => {
        const left = client.token ? secondsLeft(client.token, now()) : null;
        if (doc.visibilityState === 'visible' && left !== null && left < RENEW_BEFORE_S) client.renew();
    });

    schedule();

    return client;
}

/** The host's token address: a fresh token, or null for 204 (nobody signed in); anything else throws. */
async function fetchToken(url, fetchFn) {
    const response = await (fetchFn ?? globalThis.fetch)(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`token ${response.status}`);
    const body = await response.json();
    if (typeof body?.token !== 'string') throw new Error('no token');
    return body.token;
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
        // Only a path on the page's own origin: the person's session cookie goes with it, so never anywhere else.
        tokenUrl: typeof config.token_url === 'string' && /^\/(?![\/\\])/.test(config.token_url) ? config.token_url : null,
    };
}
