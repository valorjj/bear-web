import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { publishHostOnly } from './publishHost.ts';

const PUBLISH = 'https://pub.example.com';

function appWith(): Hono {
  const app = new Hono();
  app.use('*', publishHostOnly(PUBLISH));
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/p/:id', (c) => c.text(`page ${c.req.param('id')}`));
  app.post('/sync', (c) => c.json({ ok: true }));
  app.get('/auth/google', (c) => c.text('redirect'));
  app.post('/publish', (c) => c.json({ ok: true }));
  app.get('/files/abc', (c) => c.text('bytes'));
  return app;
}

const asPublish = { headers: { host: 'pub.example.com' } };
const asApp = { headers: { host: 'api.example.com' } };

describe('publishHostOnly', () => {
  it('serves a published page on the publish host', async () => {
    const response = await appWith().request('/p/abc', asPublish);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('page abc');
  });

  it('serves health on the publish host, so the tunnel can probe it', async () => {
    expect((await appWith().request('/health', asPublish)).status).toBe(200);
  });

  // The security boundary. Asserted PER ROUTE rather than once, because the
  // whole point is that no app route leaks onto the anonymous origin.
  it.each([
    ['POST', '/sync'],
    ['GET', '/auth/google'],
    ['POST', '/publish'],
    ['GET', '/files/abc'],
  ])('404s %s %s on the publish host', async (method, path) => {
    const response = await appWith().request(path, { method, ...asPublish });
    expect(response.status).toBe(404);
  });

  it('404s a published page on the app host', async () => {
    // /p/ exists on exactly one hostname. Serving it on the app origin would
    // put author-authored HTML back next to the app's own IndexedDB.
    expect((await appWith().request('/p/abc', asApp)).status).toBe(404);
  });

  it('leaves app routes alone on the app host', async () => {
    expect((await appWith().request('/sync', { method: 'POST', ...asApp })).status).toBe(200);
    expect((await appWith().request('/auth/google', asApp)).status).toBe(200);
  });

  it('treats a missing Host header as not-the-publish-host', async () => {
    // Fail closed: an absent header must not open the public route, and must
    // not close the app.
    const response = await appWith().request('/p/abc', { headers: {} });
    expect(response.status).toBe(404);
  });

  it('ignores a port on the Host header', async () => {
    // Local development reaches the same process on a port.
    const response = await appWith().request('/p/abc', {
      headers: { host: 'pub.example.com:8787' },
    });
    expect(response.status).toBe(200);
  });
});
