import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { join } from 'node:path';
import { init } from '../src/client.js';
import { createErrorReporter, star } from '../src/errors.js';
import { clientTokenFixture, readJson, schemaDir } from './fixtures.js';

const { token, public_key: key } = clientTokenFixture();
const schema = new Ajv({ allErrors: true, strict: false }).compile(readJson(join(schemaDir, 'browser-error.schema.json')));

/** A window and a document good enough for the reporter: listeners kept, events fired by hand. */
function fakeWindow() {
    const listeners = {};
    const docListeners = {};
    return {
        location: { pathname: '/properties/77', href: 'https://app.example.com/properties/77?q=Virtanen' },
        addEventListener: (type, fn) => (listeners[type] = fn),
        fire: (type, event) => listeners[type](event),
        document: { addEventListener: (type, fn) => (docListeners[type] = fn), click: (event) => docListeners.click(event) },
    };
}

function element(tag, text, { label = null, privateAncestor = false, href = null } = {}) {
    return {
        tagName: tag,
        textContent: text,
        getAttribute: (name) => (name === 'aria-label' ? label : name === 'href' ? href : null),
        closest: (selector) => (selector.includes('[data-mybeast-private]') ? (privateAncestor ? {} : null) : null),
    };
}

function setup(options = {}) {
    const sent = [];
    const win = fakeWindow();
    const client = init({ url: 'https://rec.example.com', key, env: 'production', release: 'r-9', token });
    const reporter = createErrorReporter(client, {
        window: win,
        fetch: async (url, init) => sent.push({ url, init, body: JSON.parse(init.body) }),
        ...options,
    });
    reporter.install();
    return { sent, win, reporter };
}

test('an uncaught error goes out as a CORS-simple keepalive POST that fits the contract', async () => {
    const { sent, win } = setup({ currentPage: () => 'Property/Show' });

    win.fire('error', { error: new TypeError('x is undefined') });

    assert.equal(sent.length, 1);
    const { url, init, body } = sent[0];
    assert.ok(url.startsWith(`https://rec.example.com/v1/browser-errors?key=${key}&t=`));
    assert.equal(init.keepalive, true);
    assert.equal(init.credentials, 'omit');
    assert.deepEqual(Object.keys(init.headers), ['Content-Type']);
    assert.equal(init.headers['Content-Type'], 'text/plain;charset=UTF-8');
    assert.equal(body.name, 'TypeError');
    assert.equal(body.url, '/properties/77');
    assert.equal(body.component, 'Property/Show');
    assert.equal(body.release, 'r-9');
    assert.ok(schema(body), JSON.stringify(schema.errors));
});

test('the reference is the event id\'s last 8 hex, for the crash screen', () => {
    const { sent, reporter } = setup();

    const reference = reporter.captureException(new Error('boom'));

    assert.match(reference, /^[0-9A-F]{8}$/);
    assert.equal(sent[0].body.event_id.replace(/-/g, '').slice(-8).toUpperCase(), reference);
    assert.equal(reporter.lastReference(), reference);
});

test('repeats, noise and a crash loop are not sent', () => {
    const { sent, reporter } = setup({ maxReports: 3 });

    reporter.captureException(new Error('same'));
    reporter.captureException(new Error('same'));
    reporter.captureException(new Error('ResizeObserver loop limit exceeded'));
    for (let i = 0; i < 10; i++) reporter.captureException(new Error(`n${i}`));

    assert.equal(sent.length, 3);
});

test('labels leave starred unless the host keeps its own words; private parts always starred', () => {
    const { sent, win, reporter } = setup({ maskLabel: (text) => (text === 'Save' ? text : star(text)) });

    win.document.click({ target: { closest: () => element('BUTTON', 'Save') } });
    win.document.click({ target: { closest: () => element('BUTTON', 'Aino Virtanen') } });
    win.document.click({ target: { closest: () => element('BUTTON', 'Save', { privateAncestor: true }) } });
    win.document.click({ target: { closest: () => element('A', 'Aino', { href: '/tenants/5?q=Aino' }) } });
    reporter.captureException(new Error('after clicks'));

    assert.deepEqual(sent[0].body.breadcrumbs.map((c) => c.message), ['Save', '**** ********', '****', 'link → /tenants/5']);
});

test('without a host masker every label is starred', () => {
    const { sent, win, reporter } = setup();

    win.document.click({ target: { closest: () => element('BUTTON', 'Delete lease', { label: 'Delete lease 12' }) } });
    reporter.captureException(new Error('x'));

    assert.equal(sent[0].body.breadcrumbs[0].message, '****** ***** **');
});

test('a recording names the moment; React errors carry their component stack', () => {
    const startedAt = Date.now() - 4000;
    const { sent, reporter } = setup({ currentRecording: () => ({ id: '01a17862-0000-7000-8000-000000000001', startedAt }) });
    let uncaught = 0;

    reporter.reactRootOptions({ onUncaught: () => uncaught++ }).onUncaughtError(new Error('render'), { componentStack: '\n    at Show' });

    assert.equal(sent[0].body.kind, 'react');
    assert.equal(sent[0].body.component_stack, '\n    at Show');
    assert.equal(sent[0].body.recording_id, '01a17862-0000-7000-8000-000000000001');
    assert.ok(sent[0].body.recording_at_ms >= 4000);
    assert.equal(uncaught, 1);
});

test('without a client (SDK off) nothing is sent and nothing throws', () => {
    const sent = [];
    const reporter = createErrorReporter(null, { window: fakeWindow(), fetch: async () => sent.push(1) });

    assert.equal(reporter.captureException(new Error('x')), null);
    assert.equal(sent.length, 0);
});
