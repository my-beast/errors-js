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

