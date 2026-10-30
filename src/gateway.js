const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { logDecision, verifyPassword } = require('./db');
const { decidePolicy } = require('./policy');
const {
  createAccessToken,
  createRefreshToken,
  createServiceToken,
  getBearerToken,
  hashRefreshToken,
  verifyToken
} = require('./tokens');

function createGatewayApp(db) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.disable('x-powered-by');

  function audit(req, subject, decision, reason, deviceId = req.get('X-Device-ID') || null) {
    logDecision(db, {
      subject,
      endpoint: `${req.method} ${req.path}`,
      deviceId,
      decision,
      reason
    });
  }

  function denied(req, res, { subject = 'unknown', status = 403, reason, deviceId }) {
    audit(req, subject, 'deny', reason, deviceId);
    return res.status(status).json({ error: reason });
  }

  function matchesSecret(actual, expected) {
    if (typeof actual !== 'string' || actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }

  function userAuth(req, res, next) {
    const claims = verifyToken(getBearerToken(req.get('Authorization')));
    if (!claims || claims.token_type !== 'access' || !['admin', 'dosen', 'mahasiswa'].includes(claims.role)) {
      return denied(req, res, { status: 401, reason: 'Access token tidak valid atau kedaluwarsa.' });
    }
    const deviceId = req.get('X-Device-ID');
    const registered = typeof deviceId === 'string' &&
      db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(claims.sub, deviceId);
    if (!registered) {
      return denied(req, res, {
        subject: claims.sub,
        status: 403,
        reason: 'Device tidak terdaftar untuk user ini.',
        deviceId: deviceId || null
      });
    }
    req.claims = claims;
    return next();
  }

  function policyAuth(req, res, next) {
    const decision = decidePolicy(db, {
      user: req.claims,
      method: req.method,
      path: req.path,
      body: req.body || {}
    });
    if (!decision.allow) {
      return denied(req, res, { subject: req.claims.sub, reason: decision.reason });
    }
    req.policyDecision = decision;
    audit(req, req.claims.sub, 'allow', decision.reason);
    return next();
  }

  function serviceTokenAuth(req, res, next) {
    const claims = verifyToken(getBearerToken(req.get('Authorization')));
    if (!claims || claims.token_type !== 'service' || claims.role !== 'service' || claims.sub !== 'service-nilai') {
      return denied(req, res, {
        status: 403,
        reason: 'Endpoint sinkronisasi hanya menerima token service Service Nilai.'
      });
    }
    req.claims = claims;
    audit(req, claims.sub, 'allow', 'Token service valid untuk sinkronisasi antar-service.', null);
    return next();
  }

  async function forward(req, res, target, path, allowedGradeIds) {
    const headers = {
      authorization: req.get('Authorization'),
      'X-Gateway-Secret': config.gatewaySecret
    };
    const options = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(10000)
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      headers['content-type'] = 'application/json';
      options.body = JSON.stringify(req.body || {});
    }
    try {
      const response = await fetch(`${target}${path}`, options);
      let text = await response.text();
      if (response.ok && allowedGradeIds) {
        let payload;
        try {
          payload = JSON.parse(text);
        } catch (error) {
          console.error('Service Nilai mengembalikan JSON tidak valid:', error);
          return res.status(502).json({ error: 'Respons Service Nilai tidak dapat diverifikasi oleh Policy Enforcement Point.' });
        }
        if (!payload || !Array.isArray(payload.data)) {
          console.error('Respons Service Nilai tidak memiliki daftar data yang diharapkan.');
          return res.status(502).json({ error: 'Respons Service Nilai tidak dapat diverifikasi oleh Policy Enforcement Point.' });
        }
        const allowed = new Set(allowedGradeIds);
        payload.data = payload.data.filter(grade => allowed.has(grade.id));
        text = JSON.stringify(payload);
      }
      res.status(response.status);
      if (response.headers.get('content-type')) res.set('content-type', response.headers.get('content-type'));
      return res.send(text);
    } catch (error) {
      console.error(`Gateway gagal meneruskan ${req.method} ${req.path}:`, error);
      return res.status(502).json({ error: 'Service tujuan tidak dapat dihubungi.' });
    }
  }

  function issueUserTokens(user, deviceId) {
    const refreshToken = createRefreshToken();
    const expiresAt = Date.now() + config.refreshTokenSeconds * 1000;
    db.prepare(`
      INSERT INTO refresh_tokens (token_hash, user_id, device_id, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(hashRefreshToken(refreshToken), user.id, deviceId, expiresAt);
    return {
      accessToken: createAccessToken(user),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: config.accessTokenSeconds
    };
  }

  app.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const deviceId = req.get('X-Device-ID');
    const user = typeof username === 'string'
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      : null;
    const validPassword = user && typeof password === 'string' && verifyPassword(password, user.password_hash);
    const validDevice = user && typeof deviceId === 'string' &&
      db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
    if (!validPassword || !validDevice) {
      const reason = !user || !validPassword ? 'Kredensial tidak valid.' : 'Device tidak terdaftar untuk user ini.';
      return denied(req, res, { subject: user ? user.id : username || 'unknown', status: 401, reason, deviceId: deviceId || null });
    }
    audit(req, user.id, 'allow', 'Kredensial valid dan device terdaftar.', deviceId);
    return res.json(issueUserTokens(user, deviceId));
  });

  app.post('/auth/refresh', (req, res) => {
    const refreshToken = req.body && req.body.refreshToken;
    const deviceId = req.get('X-Device-ID');
    const row = typeof refreshToken === 'string'
      ? db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hashRefreshToken(refreshToken))
      : null;
    const valid = row && !row.revoked_at && row.expires_at > Date.now() &&
      row.device_id === deviceId &&
      db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(row.user_id, deviceId);
    if (!valid) {
      return denied(req, res, { status: 401, reason: 'Refresh token tidak valid, kedaluwarsa, dicabut, atau device tidak sesuai.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), row.token_hash);
    audit(req, user.id, 'allow', 'Refresh token valid dan dirotasi.', deviceId);
    return res.json(issueUserTokens(user, deviceId));
  });

  app.post('/auth/logout', (req, res) => {
    const refreshToken = req.body && req.body.refreshToken;
    const deviceId = req.get('X-Device-ID');
    const row = typeof refreshToken === 'string'
      ? db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hashRefreshToken(refreshToken))
      : null;
    const valid = row && !row.revoked_at && row.expires_at > Date.now() &&
      row.device_id === deviceId &&
      db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(row.user_id, deviceId);
    if (!valid) {
      return denied(req, res, { status: 401, reason: 'Refresh token tidak valid, kedaluwarsa, dicabut, atau device tidak sesuai.' });
    }
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), row.token_hash);
    audit(req, row.user_id, 'allow', 'Logout berhasil; refresh token dicabut.', deviceId);
    return res.json({ message: 'Logout berhasil.' });
  });

  app.post('/auth/service', (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    if (clientId !== config.serviceClientId ||
        !matchesSecret(clientSecret, config.serviceClientSecret)) {
      return denied(req, res, { status: 401, subject: clientId || 'unknown', reason: 'Client ID atau secret service tidak valid.', deviceId: null });
    }
    audit(req, 'service-nilai', 'allow', 'Client ID dan secret service valid.', null);
    return res.json({
      accessToken: createServiceToken(),
      tokenType: 'Bearer',
      expiresIn: config.serviceTokenSeconds
    });
  });

  app.get('/nilai', userAuth, policyAuth, (req, res) =>
    forward(req, res, `http://127.0.0.1:${config.nilaiPort}`, '/nilai', req.policyDecision.allowedGradeIds));
  app.put('/nilai/:id', userAuth, policyAuth, (req, res) =>
    forward(req, res, `http://127.0.0.1:${config.nilaiPort}`, `/nilai/${encodeURIComponent(req.params.id)}`));
  app.post('/kelas/:id/finalisasi', userAuth, policyAuth, (req, res) =>
    forward(req, res, `http://127.0.0.1:${config.nilaiPort}`, `/kelas/${encodeURIComponent(req.params.id)}/finalisasi`));
  app.get('/transkrip/:nim', userAuth, policyAuth, (req, res) =>
    forward(req, res, `http://127.0.0.1:${config.transkripPort}`, `/transkrip/${encodeURIComponent(req.params.nim)}`));
  app.post('/transkrip/sinkron', serviceTokenAuth, (req, res) =>
    forward(req, res, `http://127.0.0.1:${config.transkripPort}`, '/sinkron'));

  app.use((req, res) => denied(req, res, {
    status: 404,
    reason: 'Endpoint atau metode tidak ditemukan.'
  }));
  app.use((error, req, res, next) => {
    console.error('Kesalahan gateway:', error);
    audit(req, 'unknown', 'deny', 'Request tidak dapat diproses oleh gateway.');
    if (res.headersSent) return next(error);
    return res.status(400).json({ error: 'Request tidak dapat diproses.' });
  });
  return app;
}

module.exports = { createGatewayApp };
