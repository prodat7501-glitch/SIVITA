const crypto = require("crypto");

/**
 * Vercel Serverless API Proxy untuk SIVITA (Sistem Informasi Validasi Data)
 *
 * Environment Variables di Vercel:
 * - GAS_WEBHOOK_URL        : URL Web App Google Apps Script (wajib)
 * - SIVITA_SESSION_SECRET  : Kunci rahasia penandatanganan token sesi HMAC-SHA256
 */

function getSecret() {
  return process.env.SIVITA_SESSION_SECRET || "sivita-default-change-me-in-vercel-env";
}

function signToken(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

async function callGas(webhookUrl, bodyObj) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
    redirect: "follow",
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respons Google Apps Script bukan JSON valid (HTTP ${res.status}): ${text.slice(0, 180)}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Gunakan metode POST." });
  }

  const webhookUrl = (process.env.GAS_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    return res.status(500).json({
      status: "error",
      message: "Environment variable GAS_WEBHOOK_URL belum dikonfigurasi di Vercel.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ status: "error", message: "Format JSON request tidak valid." });
    }
  }
  body = body || {};
  const action = String(body.action || "").trim();

  // 1. Login Admin / User
  if (action === "login") {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username || !password) {
      return res.status(400).json({ status: "error", message: "Username dan password wajib diisi." });
    }
    try {
      const gasRes = await callGas(webhookUrl, {
        action: "sivita_login",
        username,
        password,
      });
      if (gasRes.status !== "success" || !gasRes.user) {
        return res.status(401).json({ status: "error", message: gasRes.message || "Login gagal." });
      }
      const sessionUser = {
        username: gasRes.user.username,
        role: gasRes.user.role,
        name: gasRes.user.name,
        exp: Date.now() + 12 * 60 * 60 * 1000, // 12 jam
      };
      const token = signToken(sessionUser);
      return res.status(200).json({ status: "success", token, user: sessionUser });
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  // Semua aksi lain wajib membawa Bearer token sesi yang valid
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const session = verifyToken(token);
  if (!session) {
    return res.status(401).json({ status: "error", message: "Sesi berakhir atau tidak valid. Silakan login kembali." });
  }

  // 2. Cek Sesi Aktif
  if (action === "me") {
    return res.status(200).json({ status: "success", user: session });
  }

  // 2b. Ganti Password Mandiri (Admin & User — hanya untuk akun yang sedang login)
  if (action === "change_password") {
    const oldPassword = String(body.old_password || "");
    const newPassword = String(body.new_password || "");
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ status: "error", message: "Password lama dan password baru wajib diisi." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ status: "error", message: "Password baru minimal 6 karakter." });
    }
    if (newPassword === oldPassword) {
      return res.status(400).json({ status: "error", message: "Password baru harus berbeda dari password lama." });
    }
    try {
      const gasRes = await callGas(webhookUrl, {
        action: "sivita_change_password",
        username: session.username,
        old_password: oldPassword,
        new_password: newPassword,
      });
      if (gasRes.status !== "success") {
        return res.status(400).json({ status: "error", message: gasRes.message || "Gagal memperbarui password." });
      }
      return res.status(200).json(gasRes);
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  // 3. Ambil Data Hasil_DWH + Perbandingan Merah terhadap Sheet1
  if (action === "get_data") {
    try {
      const gasRes = await callGas(webhookUrl, { action: "sivita_get_data" });
      return res.status(200).json(gasRes);
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  // 4. Edit Data Hasil_DWH (KHUSUS ADMIN — divalidasi di server!)
  if (action === "update_record") {
    if (session.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Akses ditolak: Hanya akun Admin yang dapat mengedit data.",
      });
    }
    try {
      const gasRes = await callGas(webhookUrl, {
        action: "sivita_update_record",
        sheet_row: Number(body.sheet_row),
        record: body.record || {},
        actor: session.name || session.username,
      });
      return res.status(200).json(gasRes);
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  // 4b. Tandai / Batalkan Verifikasi Data 1-Klik (KHUSUS ADMIN)
  if (action === "toggle_verify") {
    if (session.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Akses ditolak: Hanya akun Admin yang dapat memverifikasi data.",
      });
    }
    try {
      const gasRes = await callGas(webhookUrl, {
        action: "sivita_toggle_verify",
        sheet_row: Number(body.sheet_row),
        verified: Boolean(body.verified),
        actor: session.name || session.username,
      });
      return res.status(200).json(gasRes);
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  // 4c. Tandai / Batalkan Verifikasi Massal (KHUSUS ADMIN)
  if (action === "bulk_verify") {
    if (session.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Akses ditolak: Hanya akun Admin yang dapat memverifikasi data.",
      });
    }
    const sheetRows = Array.isArray(body.sheet_rows)
      ? body.sheet_rows.map(Number).filter((n) => Number.isInteger(n) && n >= 2)
      : [];
    if (!sheetRows.length) {
      return res.status(400).json({ status: "error", message: "Pilih minimal satu baris data." });
    }
    try {
      const gasRes = await callGas(webhookUrl, {
        action: "sivita_bulk_verify",
        sheet_rows: sheetRows,
        verified: Boolean(body.verified),
        actor: session.name || session.username,
      });
      return res.status(200).json(gasRes);
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  // 5. Sinkronkan Data Sheet1 -> Hasil_DWH (KHUSUS ADMIN)
  if (action === "sync_from_sheet1") {
    if (session.role !== "admin") {
      return res.status(403).json({
        status: "error",
        message: "Akses ditolak: Hanya Admin yang dapat menjalankan sinkronisasi.",
      });
    }
    try {
      const gasRes = await callGas(webhookUrl, { action: "sync_hasil_dwh_from_sheet1" });
      return res.status(200).json(gasRes);
    } catch (err) {
      return res.status(502).json({ status: "error", message: err.message });
    }
  }

  return res.status(400).json({ status: "error", message: `Aksi tidak dikenal: ${action}` });
};
