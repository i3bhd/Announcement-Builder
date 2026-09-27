import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const docker = process.argv.includes('--docker');
const origin = 'http://localhost:4319';
const setupToken = randomBytes(32).toString('hex');
const password = `Test-${randomUUID()}`;
const name = `tamam-test-${randomUUID()}`;
const volume = `${name}-data`;
const directory = mkdtempSync(join(tmpdir(), 'tamam-standalone-'));
let child;
let stopped;

async function start() {
  child = docker
    ? spawn('docker', ['run', '--rm', '--init', '--name', name, '-p', '127.0.0.1:4319:3000', '-e', `APP_ORIGIN=${origin}`, '-e', 'SETUP_TOKEN', '--mount', `type=volume,src=${volume},dst=/app/data`, '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', 'tamam-announcement-builder:test'], { stdio: 'inherit', env: { ...process.env, SETUP_TOKEN: setupToken } })
    : spawn(process.execPath, ['scripts/start.mjs'], { stdio: 'inherit', env: { ...process.env, APP_ORIGIN: origin, SETUP_TOKEN: setupToken, PORT: '4319', DATA_DIR: directory } });
  stopped = once(child, 'exit');
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error('Application exited before becoming healthy');
    try { if ((await fetch(origin + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Application did not become healthy');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  if (docker) execFileSync('docker', ['stop', '--time', '10', name], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  await stopped;
}

try {
  await start();
  const loginPage = await fetch(origin + '/login').then(r => r.text());
  assert.ok(loginPage.includes('Server setup key') && loginPage.includes('technology'));
  const forged = await fetch(origin + '/api/access/setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'oai-authenticated-user-email': 'owner@example.com' }, body: JSON.stringify({ password, setupToken: 'wrong' }) });
  assert.equal(forged.status, 403);
  const smoke = spawn(process.execPath, ['scripts/access-smoke.mjs'], { stdio: 'inherit', env: { ...process.env, TEST_ORIGIN: origin, TEST_SETUP_TOKEN: setupToken, TEST_PASSWORD: password } });
  const [code] = await once(smoke, 'exit');
  assert.equal(code, 0, 'Access integration tests failed');
  await stop();
  await start();
  const login = await fetch(origin + '/api/access/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'technology', password }) });
  assert.equal(login.status, 200, 'Administrator did not persist');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const drafts = await fetch(origin + '/api/workspace/drafts', { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(drafts.drafts[0].id, 'persistence-check', 'Draft did not persist');
  assert.equal(drafts.drafts[0].generalMessage.ar, 'اختبار');
  const builder = await fetch(origin + '/', { headers: { Cookie: cookie } });
  assert.equal(builder.status, 200);
  assert.ok((await builder.text()).includes('Announcement Builder'));
  const setupAgain = await fetch(origin + '/api/access/setup', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ setupToken, password }) });
  assert.equal(setupAgain.status, 403, 'Setup reopened after restart');
  console.log('PASS: restart persistence, Arabic draft content, builder render, setup remains locked');
} finally {
  await stop();
  if (docker) execFileSync('docker', ['volume', 'rm', volume], { stdio: 'ignore' });
}
