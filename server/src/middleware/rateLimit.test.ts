import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { rateLimit } from './rateLimit.ts';

function app() {
  const instance = new Hono();
  instance.use('*', rateLimit({ limit: 2, windowMs: 60_000, key: () => 'fixed' }));
  instance.get('/x', (c) => c.text('ok'));
  return instance;
}

describe('rateLimit', () => {
  it('allows requests up to the limit and then refuses', async () => {
    const instance = app();

    expect((await instance.request('/x')).status).toBe(200);
    expect((await instance.request('/x')).status).toBe(200);

    const blocked = await instance.request('/x');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('counts each key separately', async () => {
    const instance = new Hono();
    let key = 'a';
    instance.use('*', rateLimit({ limit: 1, windowMs: 60_000, key: () => key }));
    instance.get('/x', (c) => c.text('ok'));

    expect((await instance.request('/x')).status).toBe(200);
    expect((await instance.request('/x')).status).toBe(429);

    key = 'b';
    expect((await instance.request('/x')).status).toBe(200);
  });
});
