import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../src/client.js';
import { clientTokenFixture } from './fixtures.js';

const { token, claims, public_key: key } = clientTokenFixture();

test('a page with the host config gets a client', () => {
    const client = init({ url: 'https://rec.example.com/', key, env: 'production', token });

    assert.equal(client.url, 'https://rec.example.com');
    assert.equal(client.subject, claims.sub);
    assert.equal(
        client.ingestUrl('/v1/browser-errors'),
        `https://rec.example.com/v1/browser-errors?key=${key}&t=${encodeURIComponent(token)}`,
    );
});

test('anything malformed switches the SDK off', () => {
    for (const config of [
        null,
        {},
        { url: 'not a url', key },
        { url: 'http://rec.example.com', key },
        { url: 'https://rec.example.com', key: 'pk_short' },
        { url: 'ftp://rec.example.com', key },
    ]) {
        assert.equal(init(config), null, JSON.stringify(config));
    }
});

test('plain http is fine on this machine', () => {
    assert.ok(init({ url: 'http://localhost:8004', key }));
    assert.ok(init({ url: 'http://recorder.test', key }));
});

test('a token of another project is ignored: the page reports as a guest', () => {
    const client = init({ url: 'https://rec.example.com', key: 'pk_' + 'b'.repeat(24), token });

    assert.equal(client.token, null);
    assert.equal(client.subject, null);
});


// A readable token (the browser never checks a signature: the service does).
const tokenFor = (sub, exp) =>
    ['{"alg":"HS256"}', JSON.stringify({ iss: key, sub, exp })].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.sig';

function clock(startMs) {
    const timers = [];
    return {
        now: () => startMs,
        setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
        clearTimeout: (id) => {
            timers[id] = null;
        },
        pending: () => timers.filter(Boolean),
        fire: async () => {
            const next = timers.findLastIndex(Boolean);
            const { fn } = timers[next];
            timers[next] = null;
            await fn();
        },
    };
}

test('a page left open renews its token two minutes before it runs out', async () => {
    const t = clock(1_800_000_000_000);
    const exp = 1_800_000_000 + 1800;
    const fresh = tokenFor('u-1', exp + 1800);
    const asked = [];
    const client = init(
        { url: 'https://rec.example.com', key, token: tokenFor('u-1', exp), token_url: '/mybeast/errors/token' },
        {
            ...t,
            fetch: async (url, init) => {
                asked.push([url, init.credentials]);
                return { status: 200, ok: true, json: async () => ({ token: fresh }) };
            },
        },
    );

    assert.deepEqual(t.pending().map((timer) => timer.ms), [(1800 - 120) * 1000]);
    await t.fire();

    assert.deepEqual(asked, [['/mybeast/errors/token', 'same-origin']]);
    assert.equal(client.token, fresh);
    assert.equal(t.pending().length, 1, 'and the next one is planned');
});

test('signed out on the host: the page goes on as a guest; a failure tries again in a minute', async () => {
    const t = clock(1_800_000_000_000);
    const answers = [Promise.reject(new Error('offline')), Promise.resolve(null)];
    const client = init({ url: 'https://rec.example.com', key, token: tokenFor('u-1', 1_800_000_000 + 60) }, { ...t, getToken: () => answers.shift() });

    assert.deepEqual(t.pending().map((timer) => timer.ms), [5000], 'little left: soon');
    await t.fire();
    assert.equal(client.subject, 'u-1', 'kept while it could not ask');
    assert.deepEqual(t.pending().map((timer) => timer.ms), [60_000]);

    await t.fire();
    assert.equal(client.token, null);
    assert.equal(client.subject, null);
});

test('a token address on another origin is never asked: the session cookie would go with it', () => {
    for (const token_url of ['https://evil.example/token', '//evil.example/token', '/\\evil.example']) {
        const t = clock(1_800_000_000_000);
        init({ url: 'https://rec.example.com', key, token: tokenFor('u-1', 1_800_001_800), token_url }, t);
        assert.equal(t.pending().length, 0, token_url);
    }
});
