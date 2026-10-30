const accounts = {
  admin: { password: 'Admin123!', device: 'device-admin-001', role: 'Administrator', nim: '' },
  dosen1: { password: 'Dosen123!', device: 'device-dosen1-001', role: 'Dosen', nim: '' },
  dosen2: { password: 'Dosen123!', device: 'device-dosen2-001', role: 'Dosen', nim: '' },
  mhs1: { password: 'Mhs123!', device: 'device-mhs1-001', role: 'Mahasiswa', nim: '247006111201' },
  mhs2: { password: 'Mhs123!', device: 'device-mhs2-001', role: 'Mahasiswa', nim: '247006111202' },
  mhs3: { password: 'Mhs123!', device: 'device-mhs3-001', role: 'Mahasiswa', nim: '247006111203' }
};

const pageTitles = {
  dashboard: 'RINGKASAN',
  grades: 'DATA NILAI',
  transcript: 'TRANSKRIP',
  playground: 'API PLAYGROUND',
  audit: 'AUDIT LOG',
  guide: 'PANDUAN LAB'
};

const presets = {
  grades: { method: 'GET', path: '/nilai', body: '' },
  update: { method: 'PUT', path: '/nilai/grade-1', body: '{\n  "nilai": 88\n}' },
  finalize: { method: 'POST', path: '/kelas/if101/finalisasi', body: '{}' },
  transcript: { method: 'GET', path: '/transkrip/247006111201', body: '' },
  forbiddenTranscript: { method: 'GET', path: '/transkrip/247006111202', body: '' },
  forbiddenSync: { method: 'POST', path: '/transkrip/sinkron', body: '{\n  "kelasId": "if101"\n}' },
  invalidService: { method: 'POST', path: '/auth/service', body: '{\n  "clientId": "browser-demo",\n  "clientSecret": "invalid-demo-secret"\n}' },
  refresh: { method: 'POST', path: '/auth/refresh', body: '' },
  logout: { method: 'POST', path: '/auth/logout', body: '' }
};

const state = {
  accessToken: '',
  refreshToken: '',
  user: null,
  activePage: 'dashboard',
  toastTimer: null
};

const $ = selector => document.querySelector(selector);
const pageContent = $('#page-content');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setBusy(element, busy) {
  element.classList.toggle('loading', busy);
  if ('disabled' in element) element.disabled = busy;
}

async function requestApi(route, { method = 'GET', body, useAuth = true, device = state.user?.device } = {}) {
  const headers = {};
  if (useAuth && state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  if (device) headers['X-Device-ID'] = device;
  const options = { method, headers };
  if (body !== undefined && body !== '') {
    headers['Content-Type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(route, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { response: text };
  }
  return { status: response.status, ok: response.ok, data };
}

function setUserSession(username, profile, tokens) {
  state.user = { username, ...profile };
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken || '';
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  $('#profile-name').textContent = username;
  $('#profile-role').textContent = profile.role;
  $('#profile-avatar').textContent = username.slice(0, 1).toUpperCase();
  document.querySelectorAll('.admin-only').forEach(element => {
    element.classList.toggle('hidden', profile.role !== 'Administrator');
  });
  navigate('dashboard');
}

function clearSession() {
  state.accessToken = '';
  state.refreshToken = '';
  state.user = null;
  $('#app-shell').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

function navigate(page) {
  state.activePage = page;
  document.querySelectorAll('.nav-item[data-page]').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });
  $('#breadcrumb-current').textContent = pageTitles[page] || 'RINGKASAN';
  renderPage(page);
}

function heading(eyebrow, title, description, actions = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function statusChip(status) {
  const value = String(status || '—').toLowerCase();
  return `<span class="status-chip ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function renderEmpty(message, icon = '▤') {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span>${escapeHtml(message)}</div>`;
}

function renderPage(page) {
  pageContent.innerHTML = '';
  if (page === 'dashboard') return renderDashboard();
  if (page === 'grades') return renderGrades();
  if (page === 'transcript') return renderTranscript();
  if (page === 'playground') return renderPlayground();
  if (page === 'audit') return renderAudit();
  if (page === 'guide') return renderGuide();
}

async function renderDashboard() {
  const user = state.user;
  pageContent.innerHTML = `
    ${heading('OVERVIEW', 'Ringkasan praktikum', 'Satu ruang untuk memahami akses, policy, dan alur data Zero Trust.')}
    <section class="welcome-card">
      <div class="welcome-copy"><span class="eyebrow">ZERO TRUST GRADE SYSTEM</span><h2>Halo, ${escapeHtml(user.username)} 👋</h2><p>Setiap request diperiksa berdasarkan identitas, device, role, dan policy.</p></div>
      <div class="welcome-badge"><span class="pulse-dot"></span> Sesi terautentikasi · ${escapeHtml(user.role)}</div>
    </section>
    <section class="stat-grid">
      <article class="card stat-card"><div><div class="stat-label">STATUS GATEWAY</div><div class="stat-value">Aktif</div><div class="stat-note">PEP · http://127.0.0.1:3000</div></div><span class="stat-icon mint">↗</span></article>
      <article class="card stat-card"><div><div class="stat-label">IDENTITAS AKTIF</div><div class="stat-value">${escapeHtml(user.role)}</div><div class="stat-note">Terverifikasi oleh access token</div></div><span class="stat-icon">◎</span></article>
      <article class="card stat-card"><div><div class="stat-label">DEVICE TRUST</div><div class="stat-value">Terdaftar</div><div class="stat-note">X-Device-ID tervalidasi</div></div><span class="stat-icon amber">⌑</span></article>
    </section>
    <section class="content-grid">
      <article class="card table-card"><div class="card-head"><div><h3>Nilai yang dapat diakses</h3><p>Data dibatasi sesuai role dan policy</p></div><button class="text-button" data-page="grades">Lihat data →</button></div><div id="dashboard-grades">${renderEmpty(user.role === 'Administrator' ? 'Admin tidak mengakses daftar nilai melalui endpoint ini.' : 'Memuat data nilai…')}</div></article>
      <article class="card session-card"><h3>Konteks sesi</h3><p>Informasi yang disertakan pada request API</p>
        <div class="session-row"><span>Pengguna</span><strong>${escapeHtml(user.username)}</strong></div>
        <div class="session-row"><span>Role</span><strong>${escapeHtml(user.role)}</strong></div>
        <div class="session-row"><span>Device ID</span><strong>${escapeHtml(user.device)}</strong></div>
        <div class="session-row"><span>Validasi</span><strong class="trust-label"><span class="pulse-dot"></span> Gateway trusted</strong></div>
      </article>
    </section>`;
  const gradeContainer = $('#dashboard-grades');
  if (user.role === 'Administrator') return;
  try {
    const result = await requestApi('/nilai');
    if (!result.ok) throw new Error(result.data?.error || `HTTP ${result.status}`);
    const rows = result.data.data || [];
    gradeContainer.innerHTML = rows.length ? gradeTable(rows.slice(0, 4), user.role === 'Dosen') : renderEmpty('Belum ada data nilai.');
  } catch (error) {
    gradeContainer.innerHTML = renderEmpty(`Gagal memuat nilai: ${error.message}`);
  }
}

function gradeTable(rows, isLecturer) {
  const nameHeader = isLecturer ? '<th>MAHASISWA</th>' : '';
  const body = rows.map(row => `<tr><td><strong>${escapeHtml(row.kelas)}</strong><div class="muted">${escapeHtml(row.kelasId)}</div></td>${isLecturer ? `<td>${escapeHtml(row.mahasiswa || row.nim || '—')}</td>` : ''}<td>${escapeHtml(row.nilai)}</td><td>${statusChip(row.status)}</td></tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>MATA KULIAH</th>${nameHeader}<th>NILAI</th><th>STATUS</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

async function renderGrades() {
  pageContent.innerHTML = `${heading('DATA AKADEMIK', 'Data nilai', 'Gateway hanya meneruskan baris yang diizinkan oleh policy Anda.')}<section class="card table-card"><div class="card-head"><div><h3>Daftar nilai</h3><p>Diambil langsung dari API Gateway</p></div><div class="table-tools"><span id="grade-count" class="count-pill">— data</span><button id="reload-grades" class="button button-secondary">Muat ulang</button></div></div><div id="grades-table" class="table-scroll">${renderEmpty('Memuat nilai…')}</div></section><div class="notice"><strong>Policy enforcement:</strong> mahasiswa hanya melihat nilainya sendiri; dosen hanya melihat kelas yang diampu.</div>`;
  const load = async () => {
    const target = $('#grades-table');
    target.innerHTML = renderEmpty('Memuat nilai…');
    try {
      const result = await requestApi('/nilai');
      if (!result.ok) throw new Error(result.data?.error || `HTTP ${result.status}`);
      const rows = result.data.data || [];
      $('#grade-count').textContent = `${rows.length} data`;
      target.innerHTML = rows.length ? gradeTable(rows, state.user.role === 'Dosen') : renderEmpty('Belum ada data nilai.');
    } catch (error) {
      target.innerHTML = renderEmpty(`Gagal memuat data: ${error.message}`, '!');
    }
  };
  $('#reload-grades').addEventListener('click', load);
  await load();
}

function renderTranscript() {
  const defaultNim = state.user.nim || '247006111201';
  pageContent.innerHTML = `
    ${heading('DATA AKADEMIK', 'Transkrip nilai', 'Lihat hasil sinkronisasi nilai yang telah difinalisasi.')}
    <section class="card playground-card">
      <h3>Cari transkrip</h3><p>Policy memeriksa kepemilikan NIM sebelum data diteruskan ke Service Transkrip.</p>
      <form id="transcript-form" class="transcript-form">
        <label class="field-label" for="transcript-nim">NIM mahasiswa</label>
        <div class="request-options"><input id="transcript-nim" class="input" value="${escapeHtml(defaultNim)}" inputmode="numeric" required><button class="button button-primary" type="submit">Lihat transkrip →</button></div>
      </form>
    </section>
    <section id="transcript-result" class="card table-card" style="margin-top:15px"><div class="card-head"><div><h3>Hasil transkrip</h3><p>Nilai final tersimpan di service transkrip</p></div></div>${renderEmpty('Masukkan NIM untuk memuat transkrip.', '▧')}</section>`;
  $('#transcript-form').addEventListener('submit', async event => {
    event.preventDefault();
    const nim = $('#transcript-nim').value.trim();
    const target = $('#transcript-result');
    target.innerHTML = `<div class="card-head"><div><h3>Hasil transkrip</h3></div></div>${renderEmpty('Memuat transkrip…')}`;
    try {
      const result = await requestApi(`/transkrip/${encodeURIComponent(nim)}`);
      if (!result.ok) throw new Error(result.data?.error || `HTTP ${result.status}`);
      const rows = result.data.data || [];
      const table = rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>MATA KULIAH</th><th>ID KELAS</th><th>NILAI FINAL</th><th>WAKTU FINALISASI</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.kelas)}</td><td>${escapeHtml(row.kelasId)}</td><td><strong>${escapeHtml(row.nilai)}</strong></td><td>${escapeHtml(new Date(row.finalisasi).toLocaleString('id-ID'))}</td></tr>`).join('')}</tbody></table></div>`
        : renderEmpty('Belum ada nilai final untuk NIM tersebut.', '▧');
      target.innerHTML = `<div class="card-head"><div><h3>Hasil transkrip</h3><p>NIM ${escapeHtml(result.data.nim)}</p></div><span class="count-pill">${rows.length} mata kuliah</span></div>${table}`;
    } catch (error) {
      target.innerHTML = `<div class="card-head"><div><h3>Hasil transkrip</h3></div></div><div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  });
}

function renderPlayground() {
  const path = location.pathname;
  pageContent.innerHTML = `
    ${heading('REQUEST WORKBENCH', 'API playground', 'Jalankan pengujian endpoint Zero Trust langsung dari browser lokal.')}
    <div class="playground-grid">
      <section class="card playground-card">
        <h3>Susun request</h3><p>Request hanya dikirim ke API Gateway pada origin lokal ini.</p>
        <label class="field-label" for="preset-select">Skenario siap pakai</label>
        <select id="preset-select" class="input">
          <option value="grades">Ambil daftar nilai</option><option value="update">Ubah nilai grade-1</option>
          <option value="finalize">Finalisasi kelas IF101</option><option value="transcript">Lihat transkrip sendiri</option>
          <option value="forbiddenTranscript">Uji penolakan NIM mahasiswa lain</option><option value="forbiddenSync">Uji sinkronisasi dengan token user (harus ditolak)</option>
          <option value="invalidService">Uji kredensial service tidak valid</option>
          <option value="refresh">Rotasi refresh token</option><option value="logout">Logout / cabut refresh token</option>
        </select>
        <label class="field-label" for="request-method">Metode</label>
        <select id="request-method" class="input"><option>GET</option><option>POST</option><option>PUT</option></select>
        <label class="field-label" for="request-path">Path Gateway</label>
        <input id="request-path" class="input api-path" value="/nilai" spellcheck="false">
        <label class="field-label" for="request-body">Body JSON</label>
        <textarea id="request-body" class="code-editor" spellcheck="false" aria-label="Body request JSON"></textarea>
        <div class="request-options"><label class="check-label"><input id="include-auth" type="checkbox" checked> Sertakan access token</label><button id="send-request" class="button button-primary">Kirim request <span>→</span></button></div>
        <div class="notice"><strong>Catatan:</strong> service token tidak diberikan ke browser. Skenario sinkronisasi memakai token user agar gateway menunjukkan penolakannya.</div>
      </section>
      <section class="card playground-card">
        <h3>Respons</h3><p>Lihat status HTTP dan payload aktual dari API.</p>
        <div class="response-panel"><div class="response-head"><span>RESPONSE BODY</span><span id="response-status" class="response-status">Belum ada request</span></div><pre id="response-body" class="response-body">Pilih skenario lalu tekan “Kirim request”.</pre></div>
        <div class="notice">Header device aktif: <strong>${escapeHtml(state.user.device)}</strong>. Device ini ikut diperiksa oleh Gateway/PEP.</div>
        <div class="response-panel"><div class="response-head"><span>ALUR REQUEST</span><span>ZERO TRUST</span></div><pre class="response-body">Browser → API Gateway → Policy Engine → Service
      ↳ identity + device + policy decision
      ↳ audit log untuk keputusan akses</pre></div>
      </section>
    </div>`;
  const select = $('#preset-select');
  const loadPreset = () => {
    const value = select.value;
    const preset = presets[value];
    $('#request-method').value = preset.method;
    $('#request-path').value = value === 'transcript' && state.user.nim
      ? `/transkrip/${state.user.nim}` : preset.path;
    $('#request-body').value = value === 'refresh' || value === 'logout'
      ? JSON.stringify({ refreshToken: state.refreshToken }, null, 2) : preset.body;
    $('#include-auth').checked = value !== 'login';
  };
  select.addEventListener('change', loadPreset);
  loadPreset();
  $('#send-request').addEventListener('click', sendPlaygroundRequest);
}

async function sendPlaygroundRequest() {
  const button = $('#send-request');
  const status = $('#response-status');
  const output = $('#response-body');
  const route = $('#request-path').value.trim();
  const method = $('#request-method').value;
  const bodyText = $('#request-body').value.trim();
  if (!route.startsWith('/') || route.startsWith('//')) {
    status.textContent = 'Path tidak valid';
    status.className = 'response-status bad';
    output.textContent = 'Path harus berupa path relatif pada gateway, misalnya /nilai.';
    return;
  }
  let body;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch (error) {
      status.textContent = 'JSON tidak valid';
      status.className = 'response-status bad';
      output.textContent = error.message;
      return;
    }
  }
  setBusy(button, true);
  status.textContent = 'Mengirim…';
  status.className = 'response-status';
  output.textContent = '';
  try {
    const result = await requestApi(route, {
      method,
      body,
      useAuth: $('#include-auth').checked
    });
    status.textContent = `HTTP ${result.status}`;
    status.className = `response-status ${result.ok ? 'good' : 'bad'}`;
    output.textContent = JSON.stringify(result.data, null, 2) || '(empty response)';
    showToast(result.ok ? 'Request berhasil.' : `Request ditolak (HTTP ${result.status}).`, !result.ok);
    if (route === '/auth/refresh' && result.ok) {
      state.accessToken = result.data.accessToken;
      state.refreshToken = result.data.refreshToken;
      showToast('Token berhasil dirotasi.');
    }
    if (route === '/auth/logout' && result.ok) {
      state.refreshToken = '';
      $('#request-body').value = JSON.stringify({ refreshToken: '' }, null, 2);
      showToast('Refresh token dicabut. Access token masih aktif sampai kedaluwarsa.');
    }
  } catch (error) {
    status.textContent = 'Request gagal';
    status.className = 'response-status bad';
    output.textContent = error.message;
    showToast(`Request gagal: ${error.message}`, true);
  } finally {
    setBusy(button, false);
  }
}

async function renderAudit() {
  if (state.user.role !== 'Administrator') {
    pageContent.innerHTML = `${heading('SECURITY EVENTS', 'Audit log', 'Riwayat keputusan akses dari API Gateway.') }<section class="card">${renderEmpty('Akses audit log dibatasi untuk admin.')}</section>`;
    return;
  }
  pageContent.innerHTML = `${heading('SECURITY EVENTS', 'Audit log', 'Jejak autentikasi dan keputusan akses yang dicatat Gateway/PEP.', '<button id="reload-audit" class="button button-secondary">Muat ulang</button>')}<section class="card table-card"><div class="card-head"><div><h3>Aktivitas terbaru</h3><p>Maksimal 100 event terakhir · diurutkan dari yang terbaru</p></div><span id="audit-count" class="count-pill">Memuat…</span></div><div id="audit-table" class="table-scroll">${renderEmpty('Memuat audit log…')}</div></section>`;
  const load = async () => {
    $('#audit-table').innerHTML = renderEmpty('Memuat audit log…');
    try {
      const result = await requestApi('/audit');
      if (!result.ok) throw new Error(result.data?.error || `HTTP ${result.status}`);
      const rows = result.data.data || [];
      $('#audit-count').textContent = `${rows.length} event`;
      $('#audit-table').innerHTML = rows.length ? `<table><thead><tr><th>WAKTU</th><th>SUBJEK</th><th>ENDPOINT</th><th>DEVICE ID</th><th>KEPUTUSAN</th><th>ALASAN</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(new Date(row.timestamp).toLocaleString('id-ID'))}</td><td>${escapeHtml(row.subject)}</td><td><code>${escapeHtml(row.endpoint)}</code></td><td>${escapeHtml(row.deviceId || '—')}</td><td>${statusChip(row.decision)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('')}</tbody></table>` : renderEmpty('Belum ada aktivitas yang tercatat.', '◷');
    } catch (error) {
      $('#audit-count').textContent = 'Gagal memuat';
      $('#audit-table').innerHTML = renderEmpty(error.message, '!');
    }
  };
  $('#reload-audit').addEventListener('click', load);
  await load();
}

function renderGuide() {
  pageContent.innerHTML = `
    ${heading('LEARNING CENTER', 'Panduan praktikum', 'Kenali komponen sistem, jalankan skenario, dan amati keputusan policy.')}
    <section class="guide-grid">
      <article class="card guide-card"><span class="guide-number">01</span><h3>Gateway sebagai PEP</h3><p>Gateway adalah satu-satunya jalur masuk dari browser. Setiap request user membutuhkan access token dan device ID yang terdaftar. Policy Engine memutuskan akses sebelum request diteruskan ke service.</p></article>
      <article class="card guide-card"><span class="guide-number">02</span><h3>Policy berbasis konteks</h3><p>Akses ditentukan dari role, device, kepemilikan data, status nilai, dan jam akses. Dosen hanya mengubah nilai kelas yang diampu, sedangkan mahasiswa hanya melihat data miliknya.</p></article>
      <article class="card guide-card"><span class="guide-number">03</span><h3>Service & token</h3><p>Service Nilai dan Transkrip berjalan terpisah. Keduanya memeriksa gateway secret dan JWT. Finalisasi meminta token service dari gateway untuk sinkronisasi transkrip; token user tidak dapat menggantikannya.</p></article>
      <article class="card guide-card"><span class="guide-number">04</span><h3>Audit log</h3><p>Gateway mencatat waktu, subjek, endpoint, device, keputusan, dan alasan. Login sebagai admin lalu buka menu Audit log untuk melihat event tersebut.</p></article>
      <article class="card guide-card"><span class="guide-number">05</span><h3>Urutan demo</h3><ul><li>Masuk sebagai mahasiswa, lihat nilai sendiri.</li><li>Uji akses NIM lain di Transkrip atau API playground.</li><li>Masuk sebagai dosen untuk ubah dan finalisasi nilai.</li><li>Masuk sebagai admin untuk melihat audit log.</li></ul></article>
      <article class="card guide-card"><span class="guide-number">06</span><h3>Endpoint utama</h3><div class="endpoint-list"><div class="endpoint-row"><span class="method">POST</span><span>/auth/login</span></div><div class="endpoint-row"><span class="method">GET</span><span>/nilai</span></div><div class="endpoint-row"><span class="method">PUT</span><span>/nilai/:id</span></div><div class="endpoint-row"><span class="method">POST</span><span>/kelas/:id/finalisasi</span></div><div class="endpoint-row"><span class="method">GET</span><span>/transkrip/:nim</span></div><div class="endpoint-row"><span class="method">GET</span><span>/audit (admin)</span></div></div></article>
    </section>
    <div class="notice"><strong>Menjalankan aplikasi:</strong> di PowerShell jalankan <code>npm install</code>, lalu <code>npm start</code>. Buka <code>http://127.0.0.1:3000</code> di browser. Tes integrasi backend dapat dijalankan terpisah dengan <code>npm test</code>.</div>`;
}

$('#login-user').addEventListener('change', () => {
  const account = accounts[$('#login-user').value];
  $('#login-password').value = account.password;
  $('#login-device').value = account.device;
});

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const username = $('#login-user').value;
  const password = $('#login-password').value;
  const device = $('#login-device').value.trim();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const errorElement = $('#login-error');
  errorElement.textContent = '';
  setBusy(button, true);
  try {
    const result = await requestApi('/auth/login', {
      method: 'POST',
      body: { username, password },
      useAuth: false,
      device
    });
    if (!result.ok) throw new Error(result.data?.error || `HTTP ${result.status}`);
    setUserSession(username, {
      role: accounts[username].role,
      nim: accounts[username].nim,
      device
    }, result.data);
    showToast(`Berhasil masuk sebagai ${username}.`);
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    setBusy(button, false);
  }
});

document.querySelectorAll('[data-page]').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    if (button.dataset.page) navigate(button.dataset.page);
  });
});

$('#logout-button').addEventListener('click', async () => {
  if (state.refreshToken) {
    try {
      const result = await requestApi('/auth/logout', {
        method: 'POST',
        body: { refreshToken: state.refreshToken }
      });
      if (!result.ok) throw new Error(result.data?.error || `HTTP ${result.status}`);
    } catch (error) {
      showToast(`Logout lokal berhasil; pencabutan token gagal: ${error.message}`, true);
    }
  }
  clearSession();
  showToast('Sesi dashboard ditutup.');
});

$('#profile-button').addEventListener('click', () => {
  showToast(`${state.user.username} · ${state.user.role} · ${state.user.device}`);
});

$('#login-user').dispatchEvent(new Event('change'));
