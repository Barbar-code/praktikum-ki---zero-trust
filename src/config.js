const path = require('node:path');

function readInteger(name, defaultValue, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} harus berupa bilangan bulat ${min}-${max}.`);
  }
  return value;
}

const config = {
  gatewayPort: readInteger('GATEWAY_PORT', 3000, 1, 65535),
  nilaiPort: readInteger('NILAI_PORT', 3001, 1, 65535),
  transkripPort: readInteger('TRANSKRIP_PORT', 3002, 1, 65535),
  accessTokenSeconds: readInteger('ACCESS_TOKEN_SECONDS', 600, 1, 86400),
  serviceTokenSeconds: readInteger('SERVICE_TOKEN_SECONDS', 300, 1, 86400),
  refreshTokenSeconds: readInteger('REFRESH_TOKEN_SECONDS', 86400, 1, 604800),
  accessStartHour: readInteger('ACCESS_START_HOUR', 7, 0, 23),
  accessEndHour: readInteger('ACCESS_END_HOUR', 21, 1, 24),
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-this-to-a-long-random-value',
  gatewaySecret: process.env.GATEWAY_SECRET || 'dev-gateway-secret-change-this-too-long',
  serviceClientId: process.env.SERVICE_CLIENT_ID || 'nilai-service',
  serviceClientSecret: process.env.SERVICE_CLIENT_SECRET || 'dev-service-client-secret-change-this',
  gatewayUrl: (process.env.GATEWAY_URL || 'http://127.0.0.1:3000').replace(/\/+$/, ''),
  databasePath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'zero-trust.sqlite')
};

if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET harus memiliki minimal 32 karakter.');
if (config.gatewaySecret.length < 32) throw new Error('GATEWAY_SECRET harus memiliki minimal 32 karakter.');
if (config.serviceClientSecret.length < 16) {
  throw new Error('SERVICE_CLIENT_SECRET harus memiliki minimal 16 karakter.');
}
if (config.accessStartHour === config.accessEndHour) {
  throw new Error('ACCESS_START_HOUR dan ACCESS_END_HOUR tidak boleh sama.');
}
if (new Set([config.gatewayPort, config.nilaiPort, config.transkripPort]).size !== 3) {
  throw new Error('GATEWAY_PORT, NILAI_PORT, dan TRANSKRIP_PORT harus berbeda.');
}

module.exports = config;
