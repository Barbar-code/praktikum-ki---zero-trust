# Sistem Nilai Zero Trust

Implementasi praktikum Zero Trust berbasis Node.js, Express, dan SQLite. Gateway pada port `3000` menjadi satu-satunya pintu masuk aplikasi sekaligus **Policy Enforcement Point (PEP)**. Policy Engine di gateway membuat keputusan berdasarkan role, device, kepemilikan data, status nilai, dan jam akses. Service Nilai dan Service Transkrip berjalan terpisah pada port `3001` dan `3002`.

## Prasyarat dan menjalankan

- Node.js `>=22.13` (menggunakan modul SQLite bawaan `node:sqlite`).
- npm.

Di PowerShell:

```powershell
cd "D:\Bars materi dan tugas\Semester 5\Keamanan Informasi\Tugas\tugas praktikum - zero trust"
npm install
npm start
```

Server hanya listen di `127.0.0.1`. Aplikasi ini menyediakan API, bukan halaman web; gunakan PowerShell atau Postman untuk mengirim request ke gateway di `http://127.0.0.1:3000`. Biarkan terminal server tetap berjalan dan buka terminal kedua untuk contoh request di bawah. Hentikan server dengan `Ctrl+C`.

Database dibuat otomatis di `data\zero-trust.sqlite`; data awal ditambahkan saat pertama dijalankan. Untuk mengulang data awal, hentikan server, hapus hanya file database tersebut, lalu jalankan lagi:

```powershell
Remove-Item .\data\zero-trust.sqlite
npm start
```

## Akun dan device seed

| Role | Username | Password | Device ID | NIM |
|---|---|---|---|---|
| Admin | `admin` | `Admin123!` | `device-admin-001` | — |
| Dosen | `dosen1` | `Dosen123!` | `device-dosen1-001` | — |
| Dosen | `dosen2` | `Dosen123!` | `device-dosen2-001` | — |
| Mahasiswa | `mhs1` | `Mhs123!` | `device-mhs1-001` | `247006111201` |
| Mahasiswa | `mhs2` | `Mhs123!` | `device-mhs2-001` | `247006111202` |
| Mahasiswa | `mhs3` | `Mhs123!` | `device-mhs3-001` | `247006111203` |

Dosen `dosen1` mengampu kelas `if101` (Keamanan Informasi); `dosen2` mengampu `if202` (Jaringan Komputer). Setiap mahasiswa memiliki satu nilai draft sebagai data demonstrasi.

## Contoh request di PowerShell

Login mahasiswa (device wajib terdaftar):

```powershell
$login = Invoke-RestMethod http://127.0.0.1:3000/auth/login `
  -Method Post -Headers @{"X-Device-ID"="device-mhs1-001"} `
  -ContentType "application/json" `
  -Body (@{username="mhs1"; password="Mhs123!"} | ConvertTo-Json)
$access = $login.accessToken
$headers = @{"Authorization"="Bearer $access"; "X-Device-ID"="device-mhs1-001"}
Invoke-RestMethod http://127.0.0.1:3000/nilai -Headers $headers
Invoke-RestMethod http://127.0.0.1:3000/transkrip/247006111201 -Headers $headers
```

Ubah dan finalisasi nilai menggunakan akun dosen:

```powershell
$dosen = Invoke-RestMethod http://127.0.0.1:3000/auth/login `
  -Method Post -Headers @{"X-Device-ID"="device-dosen1-001"} `
  -ContentType "application/json" `
  -Body (@{username="dosen1"; password="Dosen123!"} | ConvertTo-Json)
$dosenHeaders = @{"Authorization"="Bearer $($dosen.accessToken)"; "X-Device-ID"="device-dosen1-001"}
Invoke-RestMethod http://127.0.0.1:3000/nilai/grade-1 -Method Put `
  -Headers $dosenHeaders -ContentType "application/json" -Body (@{nilai=88} | ConvertTo-Json)
Invoke-RestMethod http://127.0.0.1:3000/kelas/if101/finalisasi -Method Post `
  -Headers $dosenHeaders -ContentType "application/json" -Body "{}"
```

Finalisasi membuat Service Nilai meminta token service ke gateway, lalu memanggil `/transkrip/sinkron` melalui gateway. Coba request tersebut dengan token user untuk menunjukkan bahwa gateway menolaknya.

## Endpoint dan kebijakan

| Endpoint | Ketentuan |
|---|---|
| `POST /auth/login` | Kredensial benar dan `X-Device-ID` terdaftar untuk user |
| `POST /auth/refresh` | Refresh token aktif, belum dicabut, belum kedaluwarsa, dan device sama; token dirotasi |
| `POST /auth/logout` | Refresh token valid dicabut |
| `POST /auth/service` | Client ID dan secret Service Nilai valid; token service berlaku 5 menit |
| `GET /nilai` | Mahasiswa hanya melihat nilainya; dosen hanya melihat kelas yang diampu |
| `PUT /nilai/:id` | Dosen pengampu, nilai belum final, nilai 0–100, dan dalam jam akses |
| `POST /kelas/:id/finalisasi` | Hanya dosen pengampu dan dalam jam akses; memicu sinkronisasi transkrip |
| `GET /transkrip/:nim` | Mahasiswa hanya melihat NIM sendiri; admin dapat melihat semua NIM |
| `POST /transkrip/sinkron` | Hanya token service dari Service Nilai; token user ditolak |

Access token default berlaku 10 menit, refresh token 1 hari, dan token service 5 menit. Setiap service memeriksa `X-Gateway-Secret` **dan** tanda tangan, tipe, serta masa berlaku JWT. Jadi secret saja tidak cukup untuk mengakses service secara langsung. Gateway menulis waktu, subjek, endpoint, device, hasil, dan alasan keputusan ke tabel `audit_logs`.

## Konfigurasi demo

Jam akses default mengikuti zona waktu Asia/Jakarta, pukul `07.00` sampai sebelum `21.00`. Rentang dapat diubah lewat environment variable, misalnya untuk membuat perubahan nilai selalu tersedia saat demo:

```powershell
$env:ACCESS_START_HOUR="0"
$env:ACCESS_END_HOUR="24"
npm start
```

Nama environment lain: `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`, `ACCESS_TOKEN_SECONDS`, `SERVICE_TOKEN_SECONDS`, `REFRESH_TOKEN_SECONDS`, `GATEWAY_PORT`, `NILAI_PORT`, `TRANSKRIP_PORT`, `GATEWAY_URL`, dan `DB_PATH`. Jika tidak disetel, secret JWT, gateway, dan client service dibuat acak saat proses dimulai dan tidak ditampilkan ke log. Ketiga aplikasi berjalan dalam satu proses sehingga berbagi konfigurasi secret yang sama. Untuk proses terpisah atau penggunaan di luar demo lokal, atur ketiga secret secara eksplisit di environment masing-masing proses dan gunakan nilai yang sama untuk komponen yang berkomunikasi.

Policy Engine memeriksa role user dari database dan menghitung ID nilai yang boleh dilihat berdasarkan mahasiswa atau kelas yang diampu dosen. Gateway/PEP membatasi respons Service Nilai ke ID hasil keputusan Policy Engine, selain service juga melakukan penyaringan berdasarkan token. Dengan demikian pembatasan kepemilikan tidak hanya diserahkan kepada service resource.

## Pengujian

```powershell
npm test
```

Tes integrasi menjalankan ketiga komponen dengan database sementara dan menguji pembatasan role/kepemilikan, device, akses langsung ke service, finalisasi dan sinkronisasi, token service, refresh, serta logout.
