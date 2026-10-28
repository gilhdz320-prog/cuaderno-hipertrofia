import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const SYNC = require('../src/sync.js');

function fakeFetch(responses) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    const r = responses.shift() || { ok: true, status: 200, body: {} };
    return { ok: r.ok !== false, status: r.status || 200, text: async () => JSON.stringify(r.body || {}) };
  };
  f.calls = calls;
  return f;
}

function memStorage() {
  const m = new Map();
  return { get: (k) => m.get(k) || null, set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), map: m };
}

const base = 'https://demo.supabase.co';
const anon = 'anon-key';

test('sin URL o clave no está configurado', () => {
  assert.equal(SYNC.createSync({}).configured(), false);
  assert.equal(SYNC.createSync({ url: base, anonKey: anon }).configured(), true);
});

test('signIn guarda la sesión y manda las cabeceras correctas', async () => {
  const f = fakeFetch([{ body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, user: { id: 'u1', email: 'x@y.z' } } }]);
  const s = SYNC.createSync({ url: base, anonKey: anon, fetch: f, storage: memStorage() });
  const sess = await s.signIn('x@y.z', 'secreta');
  assert.equal(sess.access_token, 'a1');
  assert.equal(s.userEmail(), 'x@y.z');
  assert.equal(f.calls[0].url, base + '/auth/v1/token?grant_type=password');
  assert.equal(f.calls[0].opts.headers.apikey, anon);
  assert.deepEqual(f.calls[0].body, { email: 'x@y.z', password: 'secreta' });
});

test('refresca el token cuando caduca', async () => {
  const storage = memStorage();
  storage.set('cuaderno.session', JSON.stringify({ access_token: 'viejo', refresh_token: 'r1', expires_at: 1, user: { id: 'u1' } }));
  const f = fakeFetch([{ body: { access_token: 'nuevo', refresh_token: 'r2', expires_in: 3600 } }]);
  const s = SYNC.createSync({ url: base, anonKey: anon, fetch: f, storage });
  const sess = await s.currentSession();
  assert.equal(sess.access_token, 'nuevo');
  assert.equal(f.calls[0].url, base + '/auth/v1/token?grant_type=refresh_token');
});

test('push manda el perfil como jsonb con on_conflict', async () => {
  const f = fakeFetch([
    { body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, user: { id: 'u1' } } },
    { body: [{ id: 'p_1' }] }
  ]);
  const s = SYNC.createSync({ url: base, anonKey: anon, fetch: f, storage: memStorage() });
  await s.signIn('x@y.z', 'pw');
  await s.push({ id: 'p_1', name: 'Ana', logs: {} });
  const call = f.calls[1];
  assert.match(call.url, /\/rest\/v1\/profiles\?on_conflict=id/);
  assert.match(call.opts.headers.Prefer, /merge-duplicates/);
  assert.equal(call.body[0].user_id, 'u1');
  assert.equal(call.body[0].id, 'p_1');
  assert.equal(call.body[0].data.name, 'Ana');
});

test('pull devuelve las filas', async () => {
  const f = fakeFetch([
    { body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, user: { id: 'u1' } } },
    { body: [{ id: 'p_1', name: 'Ana', data: { id: 'p_1' }, updated_at: '2026-10-01T00:00:00Z' }] }
  ]);
  const s = SYNC.createSync({ url: base, anonKey: anon, fetch: f, storage: memStorage() });
  await s.signIn('x@y.z', 'pw');
  const rows = await s.pull();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ana');
});

test('reconcile: gana lo más reciente por perfil', () => {
  const local = [
    { id: 'p_1', updatedAt: '2026-10-10T00:00:00Z', name: 'Local viejo' },
    { id: 'p_2', updatedAt: '2026-10-20T00:00:00Z', name: 'Solo local' }
  ];
  const remote = [
    { id: 'p_1', name: 'Nube nueva', data: { id: 'p_1' }, updated_at: '2026-10-15T00:00:00Z' },
    { id: 'p_3', name: 'Solo nube', data: { id: 'p_3' }, updated_at: '2026-10-01T00:00:00Z' }
  ];
  const r = SYNC.reconcile(local, remote);
  assert.deepEqual(r.toLocal.map((p) => p.id).sort(), ['p_1', 'p_3']);
  assert.equal(r.toLocal.find((p) => p.id === 'p_1').name, 'Nube nueva');
  assert.deepEqual(r.toRemote.map((p) => p.id), ['p_2']);
});

test('reconcile: local más nuevo no se pisa', () => {
  const r = SYNC.reconcile(
    [{ id: 'p_1', updatedAt: '2026-10-20T00:00:00Z' }],
    [{ id: 'p_1', data: {}, updated_at: '2026-10-10T00:00:00Z' }]
  );
  assert.equal(r.toLocal.length, 0);
  assert.equal(r.toRemote.length, 0);
});

test('normalizeUrl arregla lo que se pega mal', () => {
  assert.equal(SYNC.normalizeUrl('abc.supabase.co'), 'https://abc.supabase.co');
  assert.equal(SYNC.normalizeUrl('https://abc.supabase.co/'), 'https://abc.supabase.co');
  assert.equal(SYNC.normalizeUrl('  https://abc.supabase.co// '), 'https://abc.supabase.co');
  assert.equal(SYNC.normalizeUrl(''), '');
});

test('health falla claro si el dominio no responde', async () => {
  const f = async () => { throw new TypeError('Failed to fetch'); };
  const s = SYNC.createSync({ url: 'malo.supabase.co', anonKey: 'k', fetch: f, storage: memStorage() });
  await assert.rejects(() => s.health(), /Failed to fetch/);
});

test('lee la sesión del hash de confirmación de Supabase', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'u-123', email: 'a@b.c' })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.firma';
  const hash = '#access_token=' + token + '&refresh_token=r-9&expires_in=3600&token_type=bearer&type=signup';
  const s = SYNC.sessionFromHash(hash);
  assert.equal(s.access_token, token);
  assert.equal(s.refresh_token, 'r-9');
  assert.equal(s.user.id, 'u-123');
  assert.equal(s.user.email, 'a@b.c');
  assert.equal(SYNC.sessionFromHash('#hoy'), null);
  assert.equal(SYNC.sessionFromHash(''), null);
});

test('adoptUrl guarda la sesión del enlace', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'u-1', email: 'x@y.z' })).toString('base64').replace(/=+$/, '');
  const hash = '#access_token=aaa.' + payload + '.bbb&refresh_token=r&expires_in=100';
  const storage = memStorage();
  const s = SYNC.createSync({ url: base, anonKey: anon, fetch: fakeFetch([]), storage });
  assert.equal(s.adoptUrl(hash), true);
  assert.ok(storage.get('cuaderno.session'));
  assert.equal(s.userEmail(), 'x@y.z');
});
