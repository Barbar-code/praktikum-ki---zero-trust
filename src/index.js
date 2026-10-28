const config = require('./config');
const { openDatabase } = require('./db');
const { createGatewayApp } = require('./gateway');
const { createNilaiApp, createTranskripApp } = require('./services');

const db = openDatabase();
const servers = [
  createNilaiApp(db).listen(config.nilaiPort, '127.0.0.1', () =>
    console.log(`Service Nilai berjalan di http://127.0.0.1:${config.nilaiPort}`)),
  createTranskripApp(db).listen(config.transkripPort, '127.0.0.1', () =>
    console.log(`Service Transkrip berjalan di http://127.0.0.1:${config.transkripPort}`)),
  createGatewayApp(db).listen(config.gatewayPort, '127.0.0.1', () =>
    console.log(`API Gateway (PEP) berjalan di http://127.0.0.1:${config.gatewayPort}`))
];

function shutdown() {
  for (const server of servers) server.close();
  db.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
