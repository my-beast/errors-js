// How the browser reaches the service. Every request is CORS-simple - a POST with a text/plain body, the public key
// and the token in the query - because the last chunk of a page rides fetch(..., { keepalive: true }), and a request
// that needs a CORS preflight does not survive the page unloading. The service checks Origin itself and keeps the
// query out of its logs.

/** The address of an ingest path (`/v1/…`) with the project's public key and, when there is one, the token. */
export function ingestUrl(base, path, { key, token = null }) {
    const url = new URL(path.replace(/^\/+/, ''), base.endsWith('/') ? base : `${base}/`);
    url.searchParams.set('key', key);
    if (token) url.searchParams.set('t', token);
    return url.toString();
}

/** The fetch options of a CORS-simple POST: no custom header, a safelisted content type. */
export function simplePost(body, { keepalive = false } = {}) {
    return {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        keepalive,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
    };
}
