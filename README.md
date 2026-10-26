# @mybeast/errors

The browser SDK of **errors.my-beast.com**: uncaught errors, unhandled rejections and React's own, with a breadcrumb
trail of clicks and page changes. It is plain ES modules, with no framework and no build step. Session recording is a
separate product: `@mybeast/sessions`.

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

**What leaves the page:**
- **Fail closed:** a pressed control's label leaves starred unless `maskLabel` keeps it. Links leave only their
  path, never the query.
- **Who it was** comes from the token only. A token for another project is ignored, and the page reports as a guest.
- **Requests** are CORS-simple: a `text/plain` body, with the public key and the token in the query. They ride
  `fetch(…, { keepalive: true })`, so a report survives the page crashing or unloading. A preflighted request would not.
- **A crash loop** sends at most 10 reports per page load, repeats are sent once, and known noise (extensions,
  `ResizeObserver`) is dropped.

**Try it against a local service:**
1. `php -S 127.0.0.1:8005 -t js`
2. List `http://localhost:8005` as an origin of the project.
3. Open `examples/demo.html?key=<public key>`.

```bash
npm install && npm test   # node --test; schemas/ must equal the service's (when it sits beside this)
```
