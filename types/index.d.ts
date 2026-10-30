// Types of @mybeast/errors. The code is plain ES modules (src/); this file only describes it.

/** What the host's server hands the page: mybeast/errors-laravel's Errors::clientConfig() or guestConfig(). */
export interface ErrorsConfig {
    url: string;
    key: string;
    env?: string;
    release?: string | null;
    token?: string | null;
    /** A path on the page's own origin that answers `{ token }`, or 204 when nobody is signed in. */
    token_url?: string | null;
}

export interface InitOptions {
    /** A fresh token, or null once nobody is signed in. Default: the config's `token_url`. */
    getToken?: () => Promise<string | null>;
    fetch?: typeof fetch;
    setTimeout?: (callback: () => void, ms: number) => unknown;
    clearTimeout?: (id: unknown) => void;
    document?: Document;
    now?: () => number;
}

export interface ErrorsClient {
    url: string;
    key: string;
    env: string;
    release: string | null;
    token: string | null;
    subject: string | null;
    tokenUrl: string | null;
    ingestUrl(path: string): string;
    /** A token for another project is ignored. */
    setToken(token: string): void;
    /** Asks for a fresh token now (once at a time); never throws. */
    renew(): Promise<void>;
    stop(): void;
}

/** The client, or null when anything in the config is malformed: the page goes on without it. */
export function init(config: ErrorsConfig | null | undefined, options?: InitOptions): ErrorsClient | null;

export interface ReportedDetail {
    name: string;
    message: string;
    /** "7F3A9C21": what a person quotes. Null when the browser cannot make an id. */
    reference: string | null;
}

export interface ErrorReporterOptions {
    window?: Window;
    fetch?: typeof fetch;
    release?: string | null;
    /** At most this many reports per page load. Default 10. */
    maxReports?: number;
    /** Messages or stacks to drop, besides the known noise. */
    ignore?: RegExp[];
    /** Labels inside are always starred. Default `[data-mybeast-private]`. */
    privateSelector?: string;
    /** What is on screen, e.g. 'Invoices/Show'. */
    currentPage?: () => string | null;
    /** @mybeast/sessions' current recording, when the page uses both. */
    currentRecording?: () => { id: string; startedAt: number } | null;
    /** Which pressed labels may stay readable. Default: every one starred. */
    maskLabel?: (label: string, element: Element) => string;
    onReported?: (detail: ReportedDetail) => void;
}

export type ErrorKind = 'manual' | 'error' | 'unhandledrejection' | 'react';

export interface ReactErrorInfo {
    componentStack?: string | null;
}

export interface ErrorReporter {
    /** Listens on the window: call once, before the app renders. */
    install(): void;
    /** The report's reference, or null when it was not sent (ignored, a repeat, over the cap). */
    captureException(value: unknown, options?: { kind?: ErrorKind; componentStack?: string | null }): string | null;
    addBreadcrumb(category: string, message: string): void;
    /** A page change the router made (history.pushState fires no event): its path only. */
    navigated(url: string): void;
    lastReference(): string | null;
    /** React 19's createRoot options: errors React caught, and ones it could not. */
    reactRootOptions(options?: { onUncaught?: (error: unknown, info: ReactErrorInfo) => void }): {
        onUncaughtError(error: unknown, info: ReactErrorInfo): void;
        onCaughtError(error: unknown, info: ReactErrorInfo): void;
    };
}

export function createErrorReporter(client: ErrorsClient | null, options?: ErrorReporterOptions): ErrorReporter;

/** Every letter and digit as a star: the shape stays, the words go. */
export function star(text: unknown): string;
/** The path of a URL, without its query or fragment. */
export function pathOnly(url: string, base?: string): string;
/** "7F3A9C21": the service's reference for an event id. */
export function referenceFor(eventId: string): string;

/** The claims of a token, or null when it is not a readable JWT. Nothing is verified. */
export function readClaims(token: unknown): Record<string, unknown> | null;
/** Seconds until the token runs out (negative once it has), or null for an unreadable token. */
export function secondsLeft(token: string, nowMs?: number): number | null;

/** The address of an ingest path (`/v1/…`) with the public key and, when there is one, the token. */
export function ingestUrl(base: string, path: string, credentials: { key: string; token?: string | null }): string;
/** The fetch options of a CORS-simple POST: no custom header, a safelisted content type. */
export function simplePost(body: string, options?: { keepalive?: boolean }): RequestInit;
