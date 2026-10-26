// @mybeast/errors - a page's errors, sent to errors.my-beast.com.
export { init } from './client.js';
export { createErrorReporter, pathOnly, referenceFor, star } from './errors.js';
export { readClaims, secondsLeft } from './token.js';
export { ingestUrl, simplePost } from './transport.js';
