const config = require('./config');

function isWithinAccessHours(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(date));
  const start = config.accessStartHour;
  const end = config.accessEndHour;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function decidePolicy(db, { user, method, path, body }) {
  const storedUser = db.prepare('SELECT role FROM users WHERE id = ?').get(user.sub);
  if (!storedUser || storedUser.role !== user.role) {
    return { allow: false, reason: 'Subjek tidak ditemukan atau role token tidak sesuai dengan data user.' };
  }

  if (method === 'GET' && path === '/nilai') {
    if (!['mahasiswa', 'dosen'].includes(user.role)) return { allow: false, reason: 'Role tidak diizinkan melihat nilai.' };
    let grades;
    if (user.role === 'mahasiswa') {
      grades = db.prepare(`
        SELECT g.id FROM grades g
        JOIN users s ON s.id = g.student_id
        WHERE s.id = ? AND s.role = 'mahasiswa'
      `).all(user.sub);
    } else {
      grades = db.prepare(`
        SELECT g.id FROM grades g
        JOIN classes c ON c.id = g.class_id
        WHERE c.lecturer_id = ?
      `).all(user.sub);
    }
    return {
      allow: true,
      reason: user.role === 'mahasiswa'
        ? 'Role mahasiswa valid; Policy Engine membatasi nilai ke data milik mahasiswa.'
        : 'Role dosen valid; Policy Engine membatasi nilai ke kelas yang diampu dosen.',
      allowedGradeIds: grades.map(grade => grade.id)
    };
  }

  const updateMatch = /^\/nilai\/([^/]+)$/.exec(path);
  if (method === 'PUT' && updateMatch) {
    if (user.role !== 'dosen') return { allow: false, reason: 'Hanya dosen yang dapat mengubah nilai.' };
    const grade = db.prepare(`
      SELECT g.status, c.lecturer_id
      FROM grades g JOIN classes c ON c.id = g.class_id WHERE g.id = ?
    `).get(updateMatch[1]);
    if (!grade || grade.lecturer_id !== user.sub) return { allow: false, reason: 'Nilai bukan milik kelas yang diampu dosen.' };
    if (grade.status === 'final') return { allow: false, reason: 'Nilai sudah final dan tidak dapat diubah.' };
    if (!isWithinAccessHours()) return { allow: false, reason: 'Perubahan nilai hanya diizinkan pukul akses yang dikonfigurasi.' };
    if (typeof body.nilai !== 'number' || body.nilai < 0 || body.nilai > 100) {
      return { allow: false, reason: 'Nilai harus berupa angka antara 0 dan 100.' };
    }
    return { allow: true, reason: 'Kelas diampu, nilai belum final, nilai valid, dan jam akses sesuai.' };
  }

  const finalizeMatch = /^\/kelas\/([^/]+)\/finalisasi$/.exec(path);
  if (method === 'POST' && finalizeMatch) {
    if (user.role !== 'dosen') return { allow: false, reason: 'Hanya dosen yang dapat memfinalisasi nilai.' };
    const klass = db.prepare('SELECT lecturer_id FROM classes WHERE id = ?').get(finalizeMatch[1]);
    if (!klass || klass.lecturer_id !== user.sub) return { allow: false, reason: 'Kelas tidak diampu dosen ini.' };
    if (!isWithinAccessHours()) return { allow: false, reason: 'Finalisasi hanya diizinkan pukul akses yang dikonfigurasi.' };
    return { allow: true, reason: 'Kelas diampu dosen dan jam akses sesuai.' };
  }

  const transcriptMatch = /^\/transkrip\/([^/]+)$/.exec(path);
  if (method === 'GET' && transcriptMatch) {
    const student = db.prepare('SELECT id, role, nim FROM users WHERE nim = ?').get(transcriptMatch[1]);
    if (!student) return { allow: false, reason: 'NIM tidak ditemukan.' };
    if (user.role === 'admin') return { allow: true, reason: 'Admin diizinkan melihat semua transkrip.' };
    if (user.role === 'mahasiswa' && student.id === user.sub) {
      return { allow: true, reason: 'Mahasiswa hanya mengakses transkrip miliknya.' };
    }
    return { allow: false, reason: 'Mahasiswa hanya dapat melihat transkrip miliknya; role lain tidak diizinkan.' };
  }

  return { allow: false, reason: 'Endpoint atau metode tidak diizinkan oleh kebijakan.' };
}

module.exports = { decidePolicy, isWithinAccessHours };
