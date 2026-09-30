const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Database = require('better-sqlite3');

const mode = process.argv[2] || '';
const dbFile = path.resolve(process.argv[3] || path.join(__dirname, 'academy.db'));
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) process.exit(0);

async function getClient() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS app_sqlite_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      db BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  return client;
}

function localHasAdmin() {
  if (!fs.existsSync(dbFile)) return false;

  let db = null;

  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });

    const usersTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();

    if (!usersTable) return false;

    return !!db.prepare(
      "SELECT 1 FROM users WHERE role='admin' LIMIT 1"
    ).get();
  } catch (e) {
    return false;
  } finally {
    if (db) {
      try { db.close(); } catch (e) {}
    }
  }
}

async function restore() {
  const client = await getClient();

  try {
    if (localHasAdmin()) {
      console.log('[Neon] Existing local admin found; restore skipped.');
      return;
    }

    const result = await client.query(
      'SELECT db FROM app_sqlite_snapshot WHERE id=1'
    );

    if (!result.rows.length) {
      console.log('[Neon] No snapshot found; starting new SQLite database.');
      return;
    }

    const tmpFile = dbFile + '.restore';
    const walFile = dbFile + '-wal';
    const shmFile = dbFile + '-shm';

    try { fs.rmSync(tmpFile, { force: true }); } catch (e) {}
    try { fs.rmSync(walFile, { force: true }); } catch (e) {}
    try { fs.rmSync(shmFile, { force: true }); } catch (e) {}
    try { fs.rmSync(dbFile, { force: true }); } catch (e) {}

    fs.writeFileSync(tmpFile, result.rows[0].db);
    fs.renameSync(tmpFile, dbFile);

    console.log('[Neon] SQLite snapshot restored.');
  } finally {
    await client.end();
  }
}

async function sync() {
  if (!fs.existsSync(dbFile)) return;

  const client = await getClient();
  const tempFile = dbFile + '.neon-backup';

  try {
    try { fs.rmSync(tempFile, { force: true }); } catch (e) {}

    const db = new Database(dbFile, {
      readonly: true,
      fileMustExist: true
    });

    try {
      await db.backup(tempFile);
    } finally {
      db.close();
    }

    const data = fs.readFileSync(tempFile);

    await client.query(`
      INSERT INTO app_sqlite_snapshot(id, db, updated_at)
      VALUES(1, $1, NOW())
      ON CONFLICT(id)
      DO UPDATE SET
        db=EXCLUDED.db,
        updated_at=NOW()
    `, [data]);

    console.log('[Neon] SQLite snapshot synced.');
  } finally {
    try { fs.rmSync(tempFile, { force: true }); } catch (e) {}
    await client.end();
  }
}

(async () => {
  if (mode === 'restore') {
    await restore();
  } else if (mode === 'sync') {
    await sync();
  }
})().catch(err => {
  console.error('[Neon] sync error:', err.message);
  process.exit(1);
});
