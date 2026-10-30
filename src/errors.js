// Browser errors: uncaught errors, unhandled rejections and React's own,
// sent to the service as they happen - POST /v1/browser-errors, a CORS-simple request that rides keepalive, so a
// report survives the page crashing or unloading. Fire and forget: it never throws and never retries.
//
// Privacy, fail closed: breadcrumbs carry paths (never queries) and pressed controls' labels; a label leaves starred
// unless the host gives `maskLabel` (keeping its own UI words readable and starring everything else, say), and inside
// `privateSelector` it always leaves starred - an aria-label built from a person's name is that person's.

import { simplePost } from './transport.js';

const MAX_BREADCRUMBS = 20;

// Noise that is not the host's to fix: extensions, cross-origin scripts, a benign Chrome layout warning.
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /chrome-extension:|moz-extension:|safari-extension:/i];

/** Every letter and digit as a star: the shape stays, the words go. */
export const star = (text) => String(text).replace(/[\p{L}\p{N}]/gu, '*');

/** The path of a URL, without its query (search terms can be names) or fragment. */
export function pathOnly(url, base = 'http://localhost') {
    try {
        return new URL(url, base).pathname;
    } catch {
        return '';
    }
}

/** "7F3A9C21" - what a person quotes; the service's reference for the same event. */
export const referenceFor = (eventId) => eventId.replace(/-/g, '').slice(-8).toUpperCase();

function toError(value) {
    if (value instanceof Error) return value;
    if (typeof value === 'string') return new Error(value);
    try {
        return new Error(JSON.stringify(value)?.slice(0, 500) ?? String(value));
    } catch {
        return new Error(String(value));
    }
}

function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return null; // the service mints one
}

/**
 * @param {ReturnType<import('./client.js').init>} client
 * @param {{
 *   window?: Window, fetch?: typeof fetch,
 *   release?: string|null, maxReports?: number, ignore?: RegExp[], privateSelector?: string,
 *   currentPage?: () => (string|null), currentRecording?: () => ({id: string, startedAt: number}|null),
 *   maskLabel?: (label: string, element: Element) => string, onReported?: (detail: object) => void,
 * }} options
 */
export function createErrorReporter(client, options = {}) {
    const win = options.window ?? globalThis.window;
    const send = options.fetch ?? ((...args) => globalThis.fetch(...args));
    const maxReports = options.maxReports ?? 10;
    const ignore = [...IGNORED, ...(options.ignore ?? [])];
    const privateSelector = options.privateSelector ?? '[data-mybeast-private]';
    const breadcrumbs = [];
    const seen = new Set();
    let sent = 0;
    let lastReference = null;

    function addBreadcrumb(category, message) {
        breadcrumbs.push({ at: new Date().toISOString().slice(11, 23), category, message: String(message).slice(0, 200) });
        if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
    }

    /** @returns {string|null} the report's reference, or null when it was not sent (ignored, a repeat, over the cap) */
    function captureException(value, { kind = 'manual', componentStack = null } = {}) {
        try {
            const error = toError(value);
            const name = error.name || 'Error';
            const message = error.message || 'Unknown error';
            const stack = error.stack || '';

            if (!client || ignore.some((re) => re.test(message) || re.test(stack))) return null;

            const key = `${name}:${message}`;
            if (seen.has(key) || sent >= maxReports) return null;
            seen.add(key);
            sent += 1;

            const eventId = uuid();
            const recording = options.currentRecording?.() ?? null;
            const body = {
                ...(eventId ? { event_id: eventId } : {}),
                name: name.slice(0, 200),
                message: message.slice(0, 2000),
                kind,
                url: win?.location?.pathname ?? '/',
                stack: stack.slice(0, 20000) || null,
                component: options.currentPage?.() ?? null,
                component_stack: componentStack ? String(componentStack).slice(0, 5000) : null,
                breadcrumbs: [...breadcrumbs],
                release: options.release ?? client.release ?? null,
                env: client.env,
                ...(recording
                    ? { recording_id: recording.id, recording_at_ms: Math.max(0, Math.round(Date.now() - recording.startedAt)) }
                    : {}),
            };

            send(client.ingestUrl('/v1/browser-errors'), simplePost(JSON.stringify(body), { keepalive: true })).catch(() => {});

            lastReference = eventId ? referenceFor(eventId) : null;
            options.onReported?.({ name, message, reference: lastReference });

            return lastReference;
        } catch {
            return null; // Reporting must never become the error.
        }
    }

    function label(element) {
        const text = element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || element.tagName.toLowerCase();
        if (element.closest(privateSelector)) return star(text);
        return options.maskLabel ? options.maskLabel(text, element) : star(text);
    }

    /** Listens on the window: call once, before the app renders. */
    function install() {
        if (!win) return;

        win.addEventListener('error', (event) => {
            // A failed <img>/<script> load fires here too, without an error object.
            if (event.error) captureException(event.error, { kind: 'error' });
            else if (event.message) captureException(new Error(event.message), { kind: 'error' });
        });

        win.addEventListener('unhandledrejection', (event) => {
            captureException(event.reason, { kind: 'unhandledrejection' });
        });

        win.addEventListener('popstate', () => addBreadcrumb('navigation', win.location.pathname));

        win.document?.addEventListener(
            'click',
            (event) => {
                const target = event.target;
                const element = target && typeof target.closest === 'function' ? target.closest('button, a, [role="button"]') : null;
                if (!element) return;
                if (element.tagName === 'A') {
                    addBreadcrumb('ui.click', `link → ${pathOnly(element.getAttribute('href') || '', win.location.href)}`);
                    return;
                }
                addBreadcrumb('ui.click', label(element));
            },
            true,
        );
    }

    return {
        install,
        captureException,
        addBreadcrumb,
        /** A page change the router made (history.pushState fires no event): its path only. */
        navigated: (url) => addBreadcrumb('navigation', pathOnly(url, win?.location?.href)),
        lastReference: () => lastReference,
        /** React 19 root options: errors React caught (boundaries) and ones it could not (the app unmounts). */
        reactRootOptions: ({ onUncaught } = {}) => ({
            onUncaughtError(error, info) {
                captureException(error, { kind: 'react', componentStack: info?.componentStack });
                onUncaught?.(error, info);
            },
            onCaughtError(error, info) {
                captureException(error, { kind: 'react', componentStack: info?.componentStack });
            },
        }),
    };
}
