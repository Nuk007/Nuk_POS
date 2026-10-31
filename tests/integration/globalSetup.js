'use strict';
/**
 * Jest globalSetup — arranca uma PostgreSQL REAL e efémera para os testes de integração.
 *
 * Estratégia (por ordem de prioridade):
 *   1. TEST_DATABASE_URL definida → usa essa base (CI com serviço postgres, Render, etc.)
 *   2. Binários locais (initdb/pg_ctl) → cria um cluster temporário num tmpdir,
 *      arranca numa porta livre e destrói-o no globalTeardown.
 *
 * Em ambos os casos o schema é construído pelo initDB() real do server/db.js —
 * exactamente o mesmo código que corre em produção.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const net  = require('net');
const { execFileSync, spawnSync } = require('child_process');

const PG_BIN_CANDIDATES = [
  process.env.PG_BIN,
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/15/bin',
  '/usr/lib/postgresql/14/bin',
  '/usr/local/pgsql/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
].filter(Boolean);

function findPgBin() {
  for (const dir of PG_BIN_CANDIDATES) {
    if (fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl'))) return dir;
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** initdb/postgres recusam correr como root; nesse caso delega ao utilizador `postgres`. */
function runAs(bin, args, extra = {}) {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    const r = spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', [bin, ...args].map(a => `'${a}'`).join(' ')], { stdio: 'pipe', ...extra });
    if (r.status !== 0) throw new Error(`${path.basename(bin)} falhou:\n${r.stderr}\n${r.stdout}`);
    return r.stdout.toString();
  }
  return execFileSync(bin, args, { stdio: 'pipe', ...extra }).toString();
}

module.exports = async () => {
  const stateFile = path.join(os.tmpdir(), 'nukpos-integration-pg.json');

  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    fs.writeFileSync(stateFile, JSON.stringify({ external: true }));
    return;
  }

  const pgBin = findPgBin();
  if (!pgBin) {
    throw new Error(
      'Testes de integração: nem TEST_DATABASE_URL definida nem binários PostgreSQL (initdb/pg_ctl) encontrados.\n' +
      'Defina TEST_DATABASE_URL=postgres://... ou PG_BIN=/caminho/para/bin'
    );
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nukpos-pg-'));
  const isRoot  = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) execFileSync('chown', ['-R', 'postgres:postgres', dataDir]);

  const port = await freePort();
  const sockDir = dataDir; // unix socket dentro do próprio dataDir
  const logFile = path.join(dataDir, 'pg.log');

  runAs(path.join(pgBin, 'initdb'), ['-D', dataDir, '-U', 'nukpos', '--auth=trust', '-E', 'UTF8', '--no-locale']);
  runAs(path.join(pgBin, 'pg_ctl'), [
    '-D', dataDir, '-l', logFile, '-w', '-t', '30',
    '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${sockDir} -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    'start',
  ]);

  const url = `postgres://nukpos@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
  fs.writeFileSync(stateFile, JSON.stringify({ external: false, pgBin, dataDir, port }));
  // eslint-disable-next-line no-console
  console.log(`\n[integration] PostgreSQL efémera em ${url}`);
};
