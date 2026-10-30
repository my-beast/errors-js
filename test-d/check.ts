// The README's example, type-checked against types/ through the package's own name (npm run test:types; outside test/, which node --test would run).
import { createErrorReporter, init, type ErrorsConfig } from '@mybeast/errors';

declare const config: ErrorsConfig;
declare const currentComponentName: string | null;
declare function keepOurWords(text: string): string;
declare function createRoot(element: Element, options: object): void;

const client = init(config, { getToken: async () => null });
const errors = createErrorReporter(client, {
    currentPage: () => currentComponentName,
    maskLabel: (text, element) => (element.tagName === 'BUTTON' ? keepOurWords(text) : text),
    privateSelector: '[data-mybeast-private]',
    currentRecording: () => null,
    onReported: ({ reference }) => reference?.toLowerCase(),
});
errors.install();
createRoot(document.body, errors.reactRootOptions({ onUncaught: () => undefined }));
errors.navigated(location.href);
client?.setToken('a.b.c');
const reference: string | null = errors.captureException(new Error('x'), { kind: 'manual' });
void reference;
