const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { after, test } = require('node:test');

process.env.ACCESS_START_HOUR = '7';
process.env.ACCESS_END_HOUR = '21';
const { isWithinAccessHours } = require('../src/policy');
const { decidePolicy } = require('../src/policy');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-trust-test-'));
const testJwtSecret = 'test-jwt-secret-that-is-at-least-32-chars';
const testGatewaySecret = 'test-gateway-secret-that-is-at-least-32-chars';
const testServiceClientSecret = 'test-service-secret-that-is-at-least-32-chars';
let child;
let output = '';
let gatewayPort;
let nilaiPort;

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForGateway(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server berhenti saat startup:\n${output}`);
    try {
      const response = await fetch(`${url}/not-a-route`);
      if (response.status === 404) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Gateway tidak siap dalam 10 detik:\n${output}`);
}

async function request(base, route, { method = 'GET', token, device, body, gatewaySecret } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['X-Device-ID'] = device;
  if (gatewaySecret) headers['X-Gateway-Secret'] = gatewaySecret;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function login(username, password, device) {
  return request(`http://127.0.0.1:${gatewayPort}`, '/auth/login', {
    method: 'POST',
    device,
    body: { username, password }
  });
}

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
});

test('access window uses Asia/Jakarta time and excludes the configured end hour', () => {
  assert.equal(isWithinAccessHours(new Date('2026-10-27T00:00:00.000Z')), true);
  assert.equal(isWithinAccessHours(new Date('2026-10-27T14:00:00.000Z')), false);
});

test('Zero Trust end-to-end access controls and service synchronization', async () => {
  [gatewayPort, nilaiPort] = await Promise.all([unusedPort(), unusedPort()]);
  while (nilaiPort === gatewayPort) nilaiPort = await unusedPort();
  const transkripPort = await unusedPort();
  child = spawn(process.execPath, [path.join(root, 'src', 'index.js')], {
    cwd: root,
    env: {
      ...process.env,
      GATEWAY_PORT: String(gatewayPort),
      NILAI_PORT: String(nilaiPort),
      TRANSKRIP_PORT: String(transkripPort),
      GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
      DB_PATH: path.join(tempDir, 'test.sqlite'),
      JWT_SECRET: testJwtSecret,
      GATEWAY_SECRET: testGatewaySecret,
      SERVICE_CLIENT_SECRET: testServiceClientSecret,
      ACCESS_START_HOUR: '0',
      ACCESS_END_HOUR: '24'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const gateway = `http://127.0.0.1:${gatewayPort}`;
  await waitForGateway(gateway);

  const student = await login('mhs1', 'Mhs123!', 'device-mhs1-001');
  assert.equal(student.status, 200);
  const studentToken = student.data.accessToken;
  const ownGrades = await request(gateway, '/nilai', { token: studentToken, device: 'device-mhs1-001' });
  assert.equal(ownGrades.status, 200);
  assert.deepEqual(ownGrades.data.data.map(row => row.id), ['grade-1']);
  assert.equal((await request(gateway, '/nilai/grade-1', {
    method: 'PUT',
    token: studentToken,
    device: 'device-mhs1-001',
    body: { nilai: 99 }
  })).status, 403);
  assert.equal((await request(gateway, '/transkrip/247006111202', {
    token: studentToken,
    device: 'device-mhs1-001'
  })).status, 403);

  const invalidDevice = await login('mhs1', 'Mhs123!', 'device-tidak-terdaftar');
  assert.equal(invalidDevice.status, 401);
  assert.equal((await request(gateway, '/nilai', {
    token: studentToken,
    device: 'device-tidak-terdaftar'
  })).status, 403);

  const directNoSecret = await request(`http://127.0.0.1:${nilaiPort}`, '/nilai', { token: studentToken });
  assert.equal(directNoSecret.status, 403);
  const directNoToken = await request(`http://127.0.0.1:${nilaiPort}`, '/nilai', {
    gatewaySecret: testGatewaySecret
  });
  assert.equal(directNoToken.status, 401);

  const lecturer = await login('dosen1', 'Dosen123!', 'device-dosen1-001');
  assert.equal(lecturer.status, 200);
  const lecturerToken = lecturer.data.accessToken;
  assert.equal((await request(gateway, '/nilai/grade-3', {
    method: 'PUT',
    token: lecturerToken,
    device: 'device-dosen1-001',
    body: { nilai: 77 }
  })).status, 403);
  assert.equal((await request(gateway, '/nilai/grade-1', {
    method: 'PUT',
    token: lecturerToken,
    device: 'device-dosen1-001',
    body: { nilai: 88 }
  })).status, 200);
  const finalized = await request(gateway, '/kelas/if101/finalisasi', {
    method: 'POST',
    token: lecturerToken,
    device: 'device-dosen1-001',
    body: {}
  });
  assert.equal(finalized.status, 200, `${JSON.stringify(finalized.data)}\n${output}`);
  assert.match(finalized.data.message, /disinkronkan/);
  assert.equal((await request(gateway, '/nilai/grade-1', {
    method: 'PUT',
    token: lecturerToken,
    device: 'device-dosen1-001',
    body: { nilai: 92 }
  })).status, 403);
  const transcript = await request(gateway, '/transkrip/247006111201', {
    token: studentToken,
    device: 'device-mhs1-001'
  });
  assert.equal(transcript.status, 200);
  assert.equal(transcript.data.data[0].nilai, 88);
  assert.equal((await request(gateway, '/transkrip/sinkron', {
    method: 'POST',
    token: studentToken,
    body: { kelasId: 'if101' }
  })).status, 403);

  const admin = await login('admin', 'Admin123!', 'device-admin-001');
  assert.equal(admin.status, 200);
  assert.equal((await request(gateway, '/transkrip/247006111201', {
    token: admin.data.accessToken,
    device: 'device-admin-001'
  })).status, 200);

  const refreshed = await request(gateway, '/auth/refresh', {
    method: 'POST',
    device: 'device-mhs1-001',
    body: { refreshToken: student.data.refreshToken }
  });
  assert.equal(refreshed.status, 200);
  assert.equal((await request(gateway, '/auth/refresh', {
    method: 'POST',
    device: 'device-mhs1-001',
    body: { refreshToken: student.data.refreshToken }
  })).status, 401);
  assert.equal((await request(gateway, '/auth/logout', {
    method: 'POST',
    device: 'device-mhs1-001',
    body: { refreshToken: refreshed.data.refreshToken }
  })).status, 200);
  assert.equal((await request(gateway, '/auth/refresh', {
    method: 'POST',
    device: 'device-mhs1-001',
    body: { refreshToken: refreshed.data.refreshToken }
  })).status, 401);

  const auditDb = new DatabaseSync(path.join(tempDir, 'test.sqlite'));
  const studentScope = decidePolicy(auditDb, {
    user: { sub: 'mhs-1', role: 'mahasiswa' },
    method: 'GET',
    path: '/nilai',
    body: {}
  });
  assert.equal(studentScope.allow, true);
  assert.deepEqual(studentScope.allowedGradeIds, ['grade-1']);
  const lecturerScope = decidePolicy(auditDb, {
    user: { sub: 'dosen-1', role: 'dosen' },
    method: 'GET',
    path: '/nilai',
    body: {}
  });
  assert.equal(lecturerScope.allow, true);
  assert.deepEqual(lecturerScope.allowedGradeIds, ['grade-1', 'grade-2']);
  const mismatchedRole = decidePolicy(auditDb, {
    user: { sub: 'mhs-1', role: 'admin' },
    method: 'GET',
    path: '/nilai',
    body: {}
  });
  assert.equal(mismatchedRole.allow, false);
  const auditCount = auditDb.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count;
  const deniedDevices = auditDb.prepare(`
    SELECT COUNT(*) AS count FROM audit_logs
    WHERE decision = 'deny' AND reason = 'Device tidak terdaftar untuk user ini.'
  `).get().count;
  assert.ok(auditCount >= 15);
  assert.equal(deniedDevices, 2);
  auditDb.close();
});
