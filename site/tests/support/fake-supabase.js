import assert from 'node:assert/strict';

export const USER = { id: 'user-1' };

/**
 * A fake Supabase client for the four tables a sync touches, applying the
 * calls it records to in-memory tables: `.select()`, `.in()`, `.order()` (any
 * number), `.range()`, `.upsert(rows, options)`, `.insert(rows).select(cols)`,
 * `.update(values).eq().eq()` and `.delete().eq().lt()` / `.delete().eq().in()`,
 * each awaitable to `{ data, error }`.
 *  - hold: a promise the next select waits on after reading, i.e. a slow network
 *  - failOn: 'select' | 'insert' | 'upsert' | 'update' | 'delete' returns an
 *    error for that call on any table; 'upsert:bookmarks' names one table
 *  - maxRows: the server's row cap per request
 *  - user: whose account this is. Row-level security shows each account only
 *    its own rows, so two accounts are two clients, and every write must name
 *    this one as the owner.
 *  - bookmark_sets enforces unique(user_id, name), case-sensitively, on insert
 *    and on update (a refused rename is { error: { code: '23505' } }), and a
 *    bookmark needs its set; deleting a set deletes its bookmarks, as the
 *    database's cascade does
 *  - every update and delete must name this user as the owner
 *  - attempts: the account's test_attempts rows to start with. `client.attempts`
 *    is that table, keyed by id. An upsert there must match on the id
 *    (`onConflict: 'id'`), and a delete is refused with the database's
 *    { code: '42501' }, since nobody is granted delete on it
 *  - foreignAttempts: test_attempts rows another account owns. The id is made
 *    on a device, so one table holds every account's attempts, and row-level
 *    security keeps them apart: these rows are in `client.attempts` but no
 *    select here returns them, and an upsert naming one of their ids is
 *    refused, the whole request, with { code: '42501', message: 'new row
 *    violates row-level security policy' }, as the database refuses it
 */
export function fakeClient(rows = [], { maxRows = 1000, user = USER, attempts = [], foreignAttempts = [] } = {}) {
  for (const r of foreignAttempts) assert.notEqual(r.user_id, user.id, 'a foreign attempt is owned by another account');
  const tables = {
    question_progress: new Map(rows.map((r) => [r.question_key, { ...r }])),
    bookmark_sets: new Map(),
    bookmarks: new Map(),
    test_attempts: new Map([...attempts, ...foreignAttempts].map((r) => [r.id, { ...r }])),
  };
  const foreign = new Set(foreignAttempts.map((r) => r.id));
  const calls = [];
  const client = {
    calls,
    table: tables.question_progress,
    sets: tables.bookmark_sets,
    bookmarks: tables.bookmarks,
    attempts: tables.test_attempts,
    hold: null,
    failOn: null,
  };
  let serial = 0;

  const matches = (call, r) =>
    call.filters.every(([op, col, val]) => {
      if (op === 'eq') return r[col] === val;
      if (op === 'lt') return Date.parse(r[col]) < Date.parse(val);
      return val.includes(r[col]); // 'in'
    });
  const bookmarkId = (r) => `${r.set_id}|${r.question_key}`;
  const refuse = (message, code) => ({ data: null, error: { message, code } });

  const namesOwner = (call) => call.filters.some(([op, col, val]) => op === 'eq' && col === 'user_id' && val === user.id);

  async function execute(call) {
    const table = tables[call.table];
    if (client.failOn === call.kind || client.failOn === `${call.kind}:${call.table}`) {
      return refuse(`${call.kind} refused`);
    }
    if (call.kind === 'select') {
      let out = [...table.values()].filter((r) => matches(call, r) && !(call.table === 'test_attempts' && foreign.has(r.id)));
      out.sort((a, b) => {
        for (const col of call.order) if (a[col] !== b[col]) return a[col] < b[col] ? -1 : 1;
        return 0;
      });
      const [from, to] = call.range ?? [0, Infinity];
      out = out.slice(from, Math.min(to + 1, from + maxRows));
      const columns = call.columns.split(',');
      const result = { data: out.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))), error: null };
      if (client.hold) {
        const gate = client.hold;
        client.hold = null;
        await gate;
      }
      return result;
    }
    if (call.kind === 'insert') {
      const made = [];
      for (const r of call.rows) {
        assert.equal(r.user_id, user.id, 'every inserted row names its owner');
        const taken = [...table.values(), ...made].some((s) => s.name === r.name);
        if (taken) return refuse('duplicate key value violates unique constraint', '23505');
        made.push({ id: `S${++serial}`, ...r });
      }
      for (const s of made) table.set(s.id, s);
      const columns = (call.returning ?? '').split(',').filter(Boolean);
      return { data: columns.length ? made.map((s) => Object.fromEntries(columns.map((c) => [c, s[c]]))) : null, error: null };
    }
    if (call.kind === 'update') {
      assert.ok(namesOwner(call), 'every update names its owner');
      const targets = [...table.values()].filter((r) => matches(call, r));
      for (const r of targets) {
        const taken = [...table.values()].some((s) => s !== r && s.name === call.values.name);
        if (taken) return refuse('duplicate key value violates unique constraint', '23505');
        Object.assign(r, call.values);
      }
      return { data: null, error: null };
    }
    if (call.kind === 'upsert') {
      if (call.table === 'test_attempts') {
        assert.equal(call.options?.onConflict, 'id', 'an attempt is matched by its id');
        // One statement: a single refused row refuses them all, and none is written.
        if (call.rows.some((r) => foreign.has(r.id))) return refuse('new row violates row-level security policy', '42501');
      }
      for (const r of call.rows) {
        assert.equal(r.user_id, user.id, 'every uploaded row names its owner');
        if (call.table === 'bookmarks') {
          if (!tables.bookmark_sets.has(r.set_id)) return refuse('a bookmark needs one of your sets');
          if (call.options?.ignoreDuplicates && table.has(bookmarkId(r))) continue;
          table.set(bookmarkId(r), { ...r });
        } else if (call.table === 'test_attempts') {
          table.set(r.id, { ...r });
        } else {
          table.set(r.question_key, { ...r });
        }
      }
    } else {
      // No delete grant on attempts: the database refuses before looking at a row.
      if (call.table === 'test_attempts') return refuse('permission denied for table test_attempts', '42501');
      assert.ok(namesOwner(call), 'every delete names its owner');
      for (const [k, r] of table) {
        if (!matches(call, r)) continue;
        table.delete(k);
        if (call.table === 'bookmark_sets') {
          for (const [bk, b] of tables.bookmarks) if (b.set_id === r.id) tables.bookmarks.delete(bk);
        }
      }
    }
    return { data: null, error: null };
  }

  function query(kind, table, extra = {}) {
    const call = { kind, table, filters: [], order: [], ...extra };
    calls.push(call);
    const q = {
      eq: (col, val) => (call.filters.push(['eq', col, val]), q),
      lt: (col, val) => (call.filters.push(['lt', col, val]), q),
      in: (col, vals) => (call.filters.push(['in', col, vals]), q),
      order: (col) => (call.order.push(col), q),
      range: (from, to) => ((call.range = [from, to]), q),
      select: (columns) => ((call.returning = columns), q), // after an insert
      then: (resolve, reject) => execute(call).then(resolve, reject),
    };
    return q;
  }

  client.from = (name) => {
    assert.ok(name in tables, `unexpected table ${name}`);
    return {
      select: (columns) => query('select', name, { columns }),
      insert: (insRows) => query('insert', name, { rows: insRows }),
      upsert: (upRows, options) => query('upsert', name, { rows: upRows, options }),
      update: (values) => query('update', name, { values }),
      delete: () => query('delete', name),
    };
  };
  return client;
}
