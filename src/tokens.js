const crypto = require('node:crypto');
const config = require('./config');

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signToken(claims, lifetimeSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ ...claims, iat: now, exp: now + lifetimeSeconds }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || typeof claims.sub !== 'string' ||
        typeof claims.role !== 'string' || !Number.isInteger(claims.exp)) return null;

    const expected = crypto.createHmac('sha256', config.jwtSecret)
      .update(`${parts[0]}.${parts[1]}`).digest();
    const received = Buffer.from(parts[2], 'base64url');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

function createAccessToken(user) {
  return signToken({
    sub: user.id,
    role: user.role,
    token_type: 'access'
  }, config.accessTokenSeconds);
}

function createServiceToken() {
  return signToken({
    sub: 'service-nilai',
    role: 'service',
    token_type: 'service'
  }, config.serviceTokenSeconds);
}

function createRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match ? match[1] : null;
}

module.exports = {
  createAccessToken,
  createRefreshToken,
  createServiceToken,
  getBearerToken,
  hashRefreshToken,
  verifyToken
};
