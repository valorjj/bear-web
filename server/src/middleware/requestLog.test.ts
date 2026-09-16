import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestLog } from './requestLog.ts';

function appWith(status: number, path = '/publish'): Hono {
  const app = new Hono();
  app.use('*', requestLog());
  app.all(path, (c) => c.body(null, status as 200));
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestLog', () => {
  it('logs a write, which is the thing that leaves no other evidence', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await appWith(200).request('/publish', { method: 'POST' });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/^POST \/publish 200 \d+ms$/);
  });

  it('logs a failed read, because that is the answer to "why did nothing happen"', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await appWith(401).request('/publish', { method: 'GET' });

    expect(log.mock.calls[0]?.[0]).toMatch(/^GET \/publish 401 \d+ms$/);
  });

  it('stays silent on a successful read, so page views do not fill the log', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await appWith(200, '/p/:id').request('/p/abc');

    expect(log).not.toHaveBeenCalled();
  });

  it('never logs the query string, which carries the note title on /publish', async () => {
    // `POST /publish?noteId=…&title=…` puts user content in the URL. A log
    // line holding it would make this middleware a worse privacy problem than
    // the blindness it was written to cure.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await appWith(200).request('/publish?noteId=n1&title=My%20secret%20note', { method: 'POST' });

    const line = String(log.mock.calls[0]?.[0]);
    expect(line).not.toContain('secret');
    expect(line).not.toContain('noteId');
    expect(line).not.toContain('?');
    expect(line).toMatch(/^POST \/publish 200 \d+ms$/);
  });

  it('logs no identity: no cookie, no session token, no ip', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await appWith(200).request('/publish', {
      method: 'POST',
      headers: {
        cookie: '__Host-session=super-secret-token',
        'cf-connecting-ip': '203.0.113.9',
      },
    });

    const line = String(log.mock.calls[0]?.[0]);
    expect(line).not.toContain('super-secret-token');
    expect(line).not.toContain('203.0.113.9');
    expect(line).not.toContain('session');
  });
});
