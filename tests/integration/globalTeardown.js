'use strict';
/** Pára e destrói a PostgreSQL efémera criada no globalSetup (se aplicável). */
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

module.exports = async () => {
  const stateFile = path.join(os.tmpdir(), 'nukpos-integration-pg.json');
  if (!fs.existsSync(stateFile)) return;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  fs.unlinkSync(stateFile);
  if (state.external) return;

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const pgCtl  = path.join(state.pgBin, 'pg_ctl');
  const args   = ['-D', state.dataDir, '-m', 'immediate', '-w', 'stop'];
  if (isRoot) spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', `'${pgCtl}' ${args.map(a => `'${a}'`).join(' ')}`], { stdio: 'ignore' });
  else        spawnSync(pgCtl, args, { stdio: 'ignore' });

  try { fs.rmSync(state.dataDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
};
