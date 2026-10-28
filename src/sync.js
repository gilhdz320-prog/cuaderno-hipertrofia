/* ============================================================================
   cuaderno · sync.js
   Cliente mínimo de Supabase (auth + PostgREST) sin dependencias.
   Todo el estado de un perfil viaja como una fila JSON: id, nombre y data.

   Se puede probar con un `fetch` simulado (ver tests/sync.test.mjs).
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuadernoSync = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSION_KEY = 'cuaderno.session';
  const TABLE = 'profiles';

  function nowSec() { return Math.floor(Date.now() / 1000); }

  /* Acepta "xxx.supabase.co", "https://xxx.supabase.co/" o con espacios:
     deja siempre https:// + host, sin barra final. */
  function normalizeUrl(raw) {
    let u = String(raw || '').trim().replace(/\s+/g, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    u = u.replace(/\/+$/, '');
    return u;
  }

  /* Crea un cliente. opts: { url, anonKey, fetch, storage }
     storage: { get(k), set(k,v), remove(k) } — normalmente localStorage. */
  function createSync(opts) {
    opts = opts || {};
    const base = normalizeUrl(opts.url);
    const anonKey = opts.anonKey || '';
    const doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const storage = opts.storage || null;
    let session = null;

    function configured() { return !!(base && anonKey && doFetch); }

    async function health() {
      if (!configured()) throw new Error('Falta la URL del proyecto');
      const res = await doFetch(base + '/auth/v1/health', { method: 'GET', headers: { apikey: anonKey } });
      return { ok: res.ok, status: res.status, url: base };
    }

    function loadSession() {
      if (session) return session;
      if (!storage) return null;
      try {
        const raw = storage.get(SESSION_KEY);
        if (raw) session = JSON.parse(raw);
      } catch (e) { session = null; }
      return session;
    }

    function saveSession(s) {
      session = s;
      if (storage) {
        try {
          if (s) storage.set(SESSION_KEY, JSON.stringify(s));
          else storage.remove(SESSION_KEY);
        } catch (e) { /* sin almacenamiento */ }
      }
      return s;
    }

    function authHeaders(extra) {
      return Object.assign({ apikey: anonKey, 'Content-Type': 'application/json' }, extra || {});
    }

    async function parse(res) {
      let body = null;
      const text = await res.text();
      if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
      if (!res.ok) {
        const msg = (body && (body.msg || body.message || body.error_description || body.error)) || ('Error ' + res.status);
        const err = new Error(msg);
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    }

    function toSession(body) {
      if (!body || !body.access_token) throw new Error('Respuesta de sesión inválida');
      return saveSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: nowSec() + (body.expires_in || 3600),
        user: body.user || (session && session.user) || null
      });
    }

    async function signUp(email, password) {
      const res = await doFetch(base + '/auth/v1/signup', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ email: email, password: password })
      });
      const body = await parse(res);
      /* si el proyecto exige confirmar el correo, no viene access_token */
      if (body && body.access_token) return toSession(body);
      return { pending: true, user: body && body.user, session: null };
    }

    async function signIn(email, password) {
      const res = await doFetch(base + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ email: email, password: password })
      });
      return toSession(await parse(res));
    }

    async function refresh() {
      const s = loadSession();
      if (!s || !s.refresh_token) return null;
      const res = await doFetch(base + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token })
      });
      if (!res.ok) { saveSession(null); return null; }
      return toSession(await parse(res));
    }

    /* Devuelve una sesión válida o null, refrescando si hace falta. */
    async function currentSession() {
      const s = loadSession();
      if (!s) return null;
      if (!s.expires_at || s.expires_at - 90 > nowSec()) return s;
      try { return await refresh(); } catch (e) { return null; }
    }

    function signOut() {
      const s = loadSession();
      saveSession(null);
      if (!s || !configured()) return Promise.resolve(true);
      return doFetch(base + '/auth/v1/logout', {
        method: 'POST',
        headers: authHeaders({ Authorization: 'Bearer ' + s.access_token })
      }).catch(function () { return true; }).then(function () { return true; });
    }

    function rowHeaders(token, extra) {
      return Object.assign({
        apikey: anonKey,
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }, extra || {});
    }

    async function pull() {
      const s = await currentSession();
      if (!s) throw new Error('Sin sesión');
      const res = await doFetch(base + '/rest/v1/' + TABLE + '?select=id,name,data,updated_at&order=updated_at.asc', {
        method: 'GET', headers: rowHeaders(s.access_token)
      });
      return (await parse(res)) || [];
    }

    async function push(profile) {
      const s = await currentSession();
      if (!s) throw new Error('Sin sesión');
      const row = {
        id: String(profile.id),
        user_id: s.user.id,
        name: profile.name || 'Atleta',
        data: profile,
        updated_at: new Date().toISOString()
      };
      const res = await doFetch(base + '/rest/v1/' + TABLE + '?on_conflict=id', {
        method: 'POST',
        headers: rowHeaders(s.access_token, { Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify([row])
      });
      const body = await parse(res);
      return { updated_at: row.updated_at, row: body };
    }

    async function remove(id) {
      const s = await currentSession();
      if (!s) throw new Error('Sin sesión');
      const res = await doFetch(base + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE', headers: rowHeaders(s.access_token)
      });
      await parse(res);
      return true;
    }

    return {
      configured: configured, health: health, url: base,
      signUp: signUp, signIn: signIn, signOut: signOut, refresh: refresh,
      currentSession: currentSession, pull: pull, push: push, remove: remove,
      session: function () { return loadSession(); },
      userEmail: function () { const s = loadSession(); return s && s.user ? s.user.email : null; }
    };
  }

  /* Reconciliación local ↔ nube. Pura para poder probarla.
     Devuelve { toLocal: [perfiles remotos más nuevos], toRemote: [perfiles locales] }. */
  function reconcile(localProfiles, remoteRows) {
    const locals = localProfiles || [];
    const rows = remoteRows || [];
    const byId = {};
    locals.forEach(function (p) { byId[p.id] = p; });

    const toLocal = [];
    const seen = {};
    rows.forEach(function (row) {
      seen[row.id] = true;
      const local = byId[row.id];
      const remoteTime = Date.parse(row.updated_at || 0) || 0;
      const localTime = Date.parse((local && local.updatedAt) || 0) || 0;
      if (!local || remoteTime > localTime + 1000) {
        const data = Object.assign({}, row.data || {});
        data.id = row.id;
        data.name = row.name || data.name;
        data.updatedAt = row.updated_at;
        toLocal.push(data);
      }
    });

    const toRemote = locals.filter(function (p) { return !seen[p.id]; });
    return { toLocal: toLocal, toRemote: toRemote };
  }

  return { createSync: createSync, reconcile: reconcile, normalizeUrl: normalizeUrl, SESSION_KEY: SESSION_KEY };
});
