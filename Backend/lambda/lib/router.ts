import { respond } from './http';

type Handler = (event: any) => Promise<any>;

/**
 * One Lambda serving several API routes: picks the handler by "METHOD /resource", e.g. "POST /appointments/book"
 * (the resource path as API Gateway declares it). A route the Lambda was not wired to answers 404.
 */
export const routes =
  (table: Record<string, Handler>): Handler =>
  async (event) => {
    const handler = table[`${event.httpMethod} ${event.resource}`];
    return handler ? handler(event) : respond(404, { message: 'Not found' });
  };

/**
 * One Lambda running several scheduled jobs: each EventBridge rule passes `{ job: '<name>' }` as its input.
 */
export const jobs =
  (table: Record<string, () => Promise<unknown>>) =>
  async (event: { job?: string }) => {
    const run = event.job ? table[event.job] : undefined;
    if (!run) throw new Error(`Unknown scheduled job "${event.job}"`);
    return run();
  };
