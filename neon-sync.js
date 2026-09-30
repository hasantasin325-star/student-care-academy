const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Database = require('better-sqlite3');

const mode = process.argv[2] || '';
const dbFile = path.resolve(process.argv[3] || path.join(__dirname, 'academy.db'));
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) process.exit(0);

function fileHasAdmin(file) {
  if (!fs.existsSync(file)) return false;

  let db = null;

  try {
    db = new Database(file, {
      readonly: true,
      fileMustExist: true
    });

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

async function restore() {
  const client = await getClient();
  const tmpFile = dbFile + '.restore';

  try {
    const result = await client.query(
      'SELECT db FROM app_sqlite_snapshot WHERE id=1'
    );

    if (!result.rows.length) {
      console.log('[Neon] No snapshot found; starting new SQLite database.');
      return;
    }

    try { fs.rmSync(tmpFile, { force: true }); } catch (e) {}
    fs.writeFileSync(tmpFile, result.rows[0].db);

    /*
      Critical protection:
      Never restore a snapshot unless that snapshot actually contains
      at least one admin account.
    */
    if (!fileHasAdmin(tmpFile)) {
      console.log('[Neon] Snapshot contains no admin; restore skipped.');
      return;
    }

    const walFile = dbFile + '-wal';
    const shmFile = dbFile + '-shm';

    try { fs.rmSync(walFile, { force: true }); } catch (e) {}
    try { fs.rmSync(shmFile, { force: true }); } catch (e) {}
    try { fs.rmSync(dbFile, { force: true }); } catch (e) {}

    fs.renameSync(tmpFile, dbFile);

    console.log('[Neon] Valid admin snapshot restored.');
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch (e) {}
    await client.end();
  }
}

async function sync() {
  /*
    Critical protection:
    An empty/uninitialized SQLite database must never overwrite
    a valid Neon snapshot.
  */
  if (!fs.existsSync(dbFile)) {
    console.log('[Neon] Local database not found; sync skipped.');
    return;
  }

  if (!fileHasAdmin(dbFile)) {
    console.log('[Neon] Local database has no admin; snapshot sync skipped.');
    return;
  }

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

    /*
      Verify the backup itself before uploading it.
    */
    if (!fileHasAdmin(tempFile)) {
      console.log('[Neon] Backup validation failed; sync skipped.');
      return;
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

    console.log('[Neon] Valid admin SQLite snapshot synced.');
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
