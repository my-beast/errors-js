# @mybeast/errors

The browser SDK of **Errors** (services.my-beast.com/errors): uncaught errors, unhandled rejections and React's own,
with a breadcrumb trail of clicks and page changes. It is plain ES modules, with no framework and no build step.
Session recording is a separate product: `@mybeast/sessions`.

## Install

```bash
npm install @mybeast/errors
```

Its types are in the package (`types/index.d.ts`). The config comes from your server: mybeast/errors-laravel.

## Use

```js
import { init, createErrorReporter } from '@mybeast/errors';

// `config` is what your server made: mybeast/errors-laravel's Errors::clientConfig() (or guestConfig()).
const client = init(config); // null when anything is malformed: the page goes on without it

const errors = createErrorReporter(client, {
    currentPage: () => currentComponentName,          // what is on screen
    maskLabel: (text, element) => keepOurWords(text), // which button labels may stay readable; default: all starred
    privateSelector: '[data-mybeast-private]',        // labels inside are always starred
    currentRecording: () => null,                     // @mybeast/sessions' current recording, when you use both
    onReported: ({ reference }) => {},                // e.g. show the reference on a crash screen
});
errors.install();                                     // once, before the app renders

// React 19: createRoot(el, errors.reactRootOptions({ onUncaught: () => showCrashScreen() }))
// A router's page change (pushState fires no event): errors.navigated(url)
// After a new page's props: client.setToken(newToken)
```

**A page left open stays someone's.** A token lives 30 minutes (`token_ttl`). Two minutes before it runs out, and when
the tab comes back into view, the client asks for a fresh one: from `token_url` in the config (mybeast/errors-laravel
adds `GET /mybeast/errors/token`, where the person's own session decides who), or from your own
`init(config, { getToken: async () => token })`. Nobody signed in any more (204, or `null`): the page goes on as a
guest. The token address must be a path on the page's own origin, because the session cookie goes with it.

**What leaves the page:**
- **Fail closed:** a pressed control's label leaves starred unless `maskLabel` keeps it. Links leave only their
  path, never the query.
- **Who it was** comes from the token only. A token for another project is ignored, and the page reports as a guest.
- **Requests** are CORS-simple: a `text/plain` body, with the public key and the token in the query. They ride
  `fetch(…, { keepalive: true })`, so a report survives the page crashing or unloading. A preflighted request would not.
- **A crash loop** sends at most 10 reports per page load, repeats are sent once, and known noise (extensions,
  `ResizeObserver`) is dropped.

**Try it against a local Errors** (My Beast's own checkout, where Errors runs at http://localhost:8024/errors):
1. `php -S 127.0.0.1:8005` in this folder
2. List `http://localhost:8005` as an origin of the project.
3. Open `examples/demo.html?key=<public key>`.

```bash
npm install && npm test && npm run test:types   # node --test, then tsc on test-d/; schemas/ must equal services/schemas/errors (when services/ is there)
```

## Releasing

Set `version` in `package.json`, add it to `CHANGELOG.md`, then tag it: `git tag v0.2.0 && git push --tags`. The
Publish workflow checks that the tag is the version, runs the tests and stages it on npm through npm's trusted
publishing (no token stored anywhere). It goes live when a maintainer approves it with the npm organisation's
two-factor code: the package's Staged Packages tab on npmjs.com, or `npm stage approve <id>`. The first version went by
hand (`npm publish --access public`); then the package's settings on npmjs.com named this repository's `publish.yml`
as its trusted publisher, allowed to stage only.
