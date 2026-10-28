const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { getBearerToken, verifyToken } = require('./tokens');
const { isWithinAccessHours } = require('./policy');

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serviceAuth(expectedTokenType) {
  return (req, res, next) => {
    if (!safeEqual(req.get('X-Gateway-Secret') || '', config.gatewaySecret)) {
      return res.status(403).json({ error: 'Gateway secret tidak valid.' });
    }
    const claims = verifyToken(getBearerToken(req.get('Authorization')));
    if (!claims || claims.token_type !== expectedTokenType) {
      return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa.' });
    }
    req.claims = claims;
    return next();
  };
}

function createNilaiApp(db) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use(serviceAuth('access'));

  app.get('/nilai', (req, res) => {
    const { sub, role } = req.claims;
    if (!['mahasiswa', 'dosen'].includes(role)) return res.status(403).json({ error: 'Role tidak diizinkan.' });
    let rows;
    if (role === 'mahasiswa') {
      rows = db.prepare(`
        SELECT g.id, c.id AS kelasId, c.name AS kelas, g.score AS nilai, g.status
        FROM grades g JOIN classes c ON c.id = g.class_id
        WHERE g.student_id = ? ORDER BY c.name
      `).all(sub);
    } else {
      rows = db.prepare(`
        SELECT g.id, c.id AS kelasId, c.name AS kelas, s.nim, s.full_name AS mahasiswa,
               g.score AS nilai, g.status
        FROM grades g
        JOIN classes c ON c.id = g.class_id
        JOIN users s ON s.id = g.student_id
        WHERE c.lecturer_id = ? ORDER BY c.name, s.nim
      `).all(sub);
    }
    return res.json({ data: rows });
  });

  app.put('/nilai/:id', (req, res) => {
    const { sub, role } = req.claims;
    if (role !== 'dosen') return res.status(403).json({ error: 'Hanya dosen yang dapat mengubah nilai.' });
    if (typeof req.body.nilai !== 'number' || req.body.nilai < 0 || req.body.nilai > 100) {
      return res.status(400).json({ error: 'Nilai harus berupa angka antara 0 dan 100.' });
    }
    const grade = db.prepare(`
      SELECT g.status, c.lecturer_id FROM grades g
      JOIN classes c ON c.id = g.class_id WHERE g.id = ?
    `).get(req.params.id);
    if (!grade || grade.lecturer_id !== sub) return res.status(403).json({ error: 'Nilai bukan milik kelas yang diampu.' });
    if (grade.status === 'final') return res.status(409).json({ error: 'Nilai sudah final.' });
    if (!isWithinAccessHours()) return res.status(403).json({ error: 'Di luar jam akses perubahan nilai.' });
    db.prepare('UPDATE grades SET score = ?, updated_at = ? WHERE id = ?')
      .run(req.body.nilai, new Date().toISOString(), req.params.id);
    return res.json({ message: 'Nilai berhasil diperbarui.' });
  });

  app.post('/kelas/:id/finalisasi', async (req, res) => {
    const { sub, role } = req.claims;
    if (role !== 'dosen') return res.status(403).json({ error: 'Hanya dosen yang dapat memfinalisasi nilai.' });
    const klass = db.prepare('SELECT id FROM classes WHERE id = ? AND lecturer_id = ?').get(req.params.id, sub);
    if (!klass) return res.status(403).json({ error: 'Kelas tidak diampu dosen ini.' });
    if (!isWithinAccessHours()) return res.status(403).json({ error: 'Di luar jam akses finalisasi nilai.' });

    const finalizedAt = new Date().toISOString();
    db.prepare(`UPDATE grades SET status = 'final', updated_at = ? WHERE class_id = ?`)
      .run(finalizedAt, klass.id);
    try {
      const response = await fetch(`${config.gatewayUrl}/auth/service`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: config.serviceClientId,
          clientSecret: config.serviceClientSecret
        }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        console.error(`Service Nilai gagal memperoleh token service: HTTP ${response.status}`);
        return res.status(502).json({ error: 'Nilai difinalisasi, tetapi sinkronisasi transkrip gagal memperoleh token service.' });
      }
      const { accessToken } = await response.json();
      const syncResponse = await fetch(`${config.gatewayUrl}/transkrip/sinkron`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ kelasId: klass.id }),
        signal: AbortSignal.timeout(5000)
      });
      if (!syncResponse.ok) {
        console.error(`Sinkronisasi transkrip gagal: HTTP ${syncResponse.status} ${await syncResponse.text()}`);
        return res.status(502).json({ error: 'Nilai difinalisasi, tetapi sinkronisasi transkrip gagal.' });
      }
      return res.json({ message: 'Nilai difinalisasi dan transkrip berhasil disinkronkan.' });
    } catch (error) {
      console.error('Panggilan sinkronisasi antar-service gagal:', error);
      return res.status(502).json({ error: 'Nilai difinalisasi, tetapi layanan transkrip tidak dapat dihubungi.' });
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'Endpoint Service Nilai tidak ditemukan.' }));
  return app;
}

function createTranskripApp(db) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.get('/transkrip/:nim', serviceAuth('access'), (req, res) => {
    const { sub, role } = req.claims;
    const student = db.prepare('SELECT id, nim FROM users WHERE nim = ?').get(req.params.nim);
    if (!student) return res.status(404).json({ error: 'NIM tidak ditemukan.' });
    if (role !== 'admin' && !(role === 'mahasiswa' && student.id === sub)) {
      return res.status(403).json({ error: 'Tidak diizinkan melihat transkrip ini.' });
    }
    const rows = db.prepare(`
      SELECT c.id AS kelasId, c.name AS kelas, t.score AS nilai, t.finalized_at AS finalisasi
      FROM transcripts t JOIN classes c ON c.id = t.class_id
      WHERE t.student_id = ? ORDER BY c.name
    `).all(student.id);
    return res.json({ nim: student.nim, data: rows });
  });

  app.post('/sinkron', serviceAuth('service'), (req, res) => {
    const kelasId = req.body.kelasId;
    const klass = db.prepare('SELECT id FROM classes WHERE id = ?').get(kelasId);
    if (!klass) return res.status(404).json({ error: 'Kelas tidak ditemukan.' });
    const rows = db.prepare(`
      SELECT student_id, class_id, score, updated_at
      FROM grades WHERE class_id = ? AND status = 'final'
    `).all(kelasId);
    const upsert = db.prepare(`
      INSERT INTO transcripts (student_id, class_id, score, finalized_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id, class_id)
      DO UPDATE SET score = excluded.score, finalized_at = excluded.finalized_at
    `);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) upsert.run(row.student_id, row.class_id, row.score, row.updated_at);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return res.json({ message: 'Transkrip berhasil disinkronkan.', jumlah: rows.length });
  });

  app.use((req, res) => res.status(404).json({ error: 'Endpoint Service Transkrip tidak ditemukan.' }));
  return app;
}

module.exports = { createNilaiApp, createTranskripApp };
