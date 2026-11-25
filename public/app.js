/**
 * SIVITA — Sistem Informasi Validasi Data
 * Frontend SPA terhubung ke Vercel Serverless API (/api/sivita)
 */

const API_URL = "/api/sivita";
const STORAGE_TOKEN_KEY = "sivita_session_token";
const STORAGE_USER_KEY = "sivita_session_user";

let currentUser = null;
let allRecords = [];
let filteredRecords = [];
const expandedRows = new Set();
const zoomLevels = new Map(); // sheet_row -> zoom percent (default 100)

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getToken() {
  return localStorage.getItem(STORAGE_TOKEN_KEY) || "";
}

async function apiPost(payload, requireAuth = true) {
  const headers = { "Content-Type": "application/json" };
  if (requireAuth) {
    headers.Authorization = `Bearer ${getToken()}`;
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.status === 401 && requireAuth) {
    logout(true);
    throw new Error(data.message || "Sesi berakhir.");
  }
  if (!res.ok || data.status === "error") {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return data;
}

function showBanner(msg, isError = false) {
  const el = $("status-banner");
  el.textContent = msg;
  el.classList.remove("hidden", "error");
  if (isError) el.classList.add("error");
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add("hidden"), 5000);
}

/* ==================== AUTH / LOGIN ==================== */
function showLogin() {
  $("login-view").classList.remove("hidden");
  $("app-view").classList.add("hidden");
}

function showApp(user) {
  currentUser = user;
  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");

  const isAdmin = user.role === "admin";
  const badge = $("user-role-badge");
  badge.textContent = isAdmin ? "ADMIN" : "USER";
  badge.classList.toggle("role-admin", isAdmin);
  $("user-name-label").textContent = user.name || user.username;

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", !isAdmin);
  });

  loadData();
}

function logout(silent = false) {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_USER_KEY);
  currentUser = null;
  allRecords = [];
  filteredRecords = [];
  expandedRows.clear();
  showLogin();
  if (!silent) {
    $("login-password").value = "";
  }
}

/* ==================== DATA LOADING & FILTERING ==================== */
async function loadData() {
  const tbody = $("table-body");
  tbody.innerHTML = `<tr><td colspan="19" class="empty-cell">Memuat data Hasil Pengecekan DWH dari Google Sheets...</td></tr>`;
  try {
    const res = await apiPost({ action: "get_data" });
    allRecords = Array.isArray(res.records) ? res.records : [];
    updateKpis();
    applyFiltersAndRender();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="19" class="empty-cell">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
    showBanner(`Gagal memuat data: ${err.message}`, true);
  }
}

function updateKpis() {
  const total = allRecords.length;
  const gorontalo = allRecords.filter((r) => r.status === "Penduduk Kabupaten Gorontalo").length;
  const luar = allRecords.filter((r) => r.status === "Bukan Penduduk Kabupaten Gorontalo").length;
  const diff = allRecords.filter((r) => r.has_diff).length;

  $("kpi-total").textContent = total.toLocaleString("id-ID");
  $("kpi-gorontalo").textContent = gorontalo.toLocaleString("id-ID");
  $("kpi-luar").textContent = luar.toLocaleString("id-ID");
  $("kpi-diff").textContent = diff.toLocaleString("id-ID");
}

function applyFiltersAndRender() {
  const q = ($("search-input").value || "").trim().toLowerCase();
  const fStatus = $("filter-status").value;

  filteredRecords = allRecords.filter((r) => {
    const ks = String(r.kesimpulan || "").toUpperCase();
    if (fStatus === "GORONTALO" && r.status !== "Penduduk Kabupaten Gorontalo") return false;
    if (fStatus === "NON_GORONTALO" && r.status !== "Bukan Penduduk Kabupaten Gorontalo") return false;
    if (fStatus === "DIFF_ONLY" && !r.has_diff) return false;
    if (fStatus === "KS_ANOMALI" && ks !== "ANOMALI") return false;
    if (fStatus === "KS_GANDA" && ks !== "GANDA") return false;
    if (fStatus === "KS_MENINGGAL" && ks !== "MENINGGAL") return false;
    if (fStatus === "KS_NON_AKTIF" && ks !== "NON AKTIF") return false;
    if (fStatus === "KS_TIDAK_ADA" && ks !== "TIDAK TERDAPAT DALAM DATABASE") return false;

    if (q) {
      const hay = [
        r.nik,
        r.nkk,
        r.nama,
        r.alamat,
        r.kelurahan,
        r.kecamatan,
        r.kab_kota,
        r.provinsi,
        r.status,
        r.kesimpulan,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  $("table-count-label").textContent = `Menampilkan ${filteredRecords.length.toLocaleString("id-ID")} dari ${allRecords.length.toLocaleString("id-ID")} data`;
  renderTable();
}

function getDiffObj(rec, fieldName) {
  if (!rec.diffs || !rec.diffs.length) return null;
  return rec.diffs.find((d) => d.field === fieldName) || null;
}

function tdCell(rec, value, fieldName) {
  const diff = fieldName ? getDiffObj(rec, fieldName) : null;
  if (diff) {
    const tip = `Berbeda dengan Basis Data (Sheet 1): ${diff.master}`;
    return `<td class="cell-diff" title="${escapeHtml(tip)}">${escapeHtml(value || "-")}</td>`;
  }
  return `<td>${escapeHtml(value || "-")}</td>`;
}

function renderStatusPill(statusText) {
  const s = String(statusText || "");
  if (s === "Penduduk Kabupaten Gorontalo") {
    return `<span class="status-pill status-gorontalo">${escapeHtml(s)}</span>`;
  }
  if (s === "Bukan Penduduk Kabupaten Gorontalo") {
    return `<span class="status-pill status-luar">${escapeHtml(s)}</span>`;
  }
  return `<span class="status-pill status-alert">${escapeHtml(s || "-")}</span>`;
}

function renderKesimpulanPill(ksText) {
  const k = String(ksText || "").toUpperCase().trim();
  if (k === "VALID") {
    return `<span class="status-pill status-gorontalo">VALID</span>`;
  }
  if (k === "ANOMALI") {
    return `<span class="status-pill status-luar">ANOMALI</span>`;
  }
  return `<span class="status-pill status-alert">${escapeHtml(k || "-")}</span>`;
}

function renderInlineScreenshotPanel(rec) {
  const fileId = rec.screenshot_file_id || "";
  const imgUrl = fileId
    ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`
    : rec.screenshot_url || "";
  const zoom = zoomLevels.get(rec.sheet_row) || 100;

  let bodyHtml = "";
  if (imgUrl) {
    bodyHtml = `
      <div class="ss-viewport">
        <img
          src="${escapeHtml(imgUrl)}"
          alt="Screenshot DWH ${escapeHtml(rec.nik)}"
          class="ss-img"
          style="width: ${zoom}%;"
          loading="lazy"
          onerror="this.outerHTML='<div class=\\'ss-empty\\'>Gambar belum dapat dimuat dari Google Drive. Pastikan folder Drive dibagikan minimal <b>Siapa saja yang memiliki link (Lihat)</b>.</div>'"
        />
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="ss-empty">
        Tangkapan layar belum tersedia untuk NIK ini.
      </div>
    `;
  }

  let diffBannerHtml = "";
  if (rec.has_diff && rec.diffs.length > 0) {
    const items = rec.diffs
      .map(
        (d) =>
          `<span class="diff-chip"><strong>${escapeHtml(d.field)}:</strong> Basis Data <b>${escapeHtml(d.master)}</b> → DWH <b>${escapeHtml(d.dwh || "-")}</b></span>`
      )
      .join("");
    diffBannerHtml = `
      <div class="ss-status-bar ss-status-diff">
        <div class="ss-status-title">Peringatan Perbedaan dengan Basis Data (Sheet 1):</div>
        <div class="ss-diff-chips">${items}</div>
      </div>
    `;
  } else {
    diffBannerHtml = `
      <div class="ss-status-bar ss-status-ok">
        <strong>Status Kesesuaian Basis Data (Sheet 1):</strong> Seluruh elemen data sesuai dengan Basis Data Sheet 1.
      </div>
    `;
  }

  return `
    <tr class="inline-panel-row">
      <td colspan="19">
        <div class="inline-panel-sticky">
          <div class="ss-box">
            <div class="ss-box-header">
              <span>Tangkapan Layar DWH — ${escapeHtml(rec.nama || "-")} (${escapeHtml(rec.nik)})</span>
              <div class="ss-controls">
                <button type="button" class="btn btn-xs btn-outline" data-zoom-out="${rec.sheet_row}" title="Perkecil">− Zoom Out</button>
                <span class="zoom-label">${zoom}%</span>
                <button type="button" class="btn btn-xs btn-outline" data-zoom-in="${rec.sheet_row}" title="Perbesar">+ Zoom In</button>
                <button type="button" class="btn btn-xs btn-outline" data-zoom-reset="${rec.sheet_row}" title="Reset 100%">Reset</button>
                <button type="button" class="btn btn-xs btn-primary" data-toggle-ss="${rec.sheet_row}">Tutup</button>
              </div>
            </div>
            ${diffBannerHtml}
            ${bodyHtml}
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderTable() {
  const tbody = $("table-body");
  if (!filteredRecords.length) {
    tbody.innerHTML = `<tr><td colspan="19" class="empty-cell">Tidak ada data yang cocok dengan filter pencarian.</td></tr>`;
    return;
  }

  const isAdmin = currentUser && currentUser.role === "admin";
  const rowsHtml = [];

  filteredRecords.forEach((rec, idx) => {
    const isOpen = expandedRows.has(rec.sheet_row);
    const namaDiff = getDiffObj(rec, "NAMA");
    const diffBadge = rec.has_diff
      ? `<span class="diff-pill" title="Terdapat ${rec.diffs.length} elemen berbeda dengan Sheet 1">! ${rec.diffs.length}</span>`
      : "";

    const editBtn = isAdmin
      ? `<button type="button" class="btn btn-xs btn-edit" data-edit-row="${rec.sheet_row}">Edit</button>`
      : "";

    rowsHtml.push(`
      <tr class="data-row ${rec.has_diff ? "row-has-diff" : ""}">
        <td class="sticky-no">${idx + 1}</td>
        <td class="sticky-nama nama-cell ${namaDiff ? "cell-diff" : ""}" title="${namaDiff ? escapeHtml("Sheet 1: " + namaDiff.master) : ""}">
          <div class="nama-text">
            <span>${escapeHtml(rec.nama || "-")}</span>
            ${diffBadge}
          </div>
        </td>
        <td>${renderKesimpulanPill(rec.kesimpulan)}</td>
        <td>${renderStatusPill(rec.status)}</td>
        <td>${escapeHtml(rec.nik)}</td>
        ${tdCell(rec, rec.nkk, "NKK")}
        ${tdCell(rec, rec.tempat_lahir, "TEMPAT_LAHIR")}
        ${tdCell(rec, rec.tanggal_lahir, "TANGGAL_LAHIR")}
        ${tdCell(rec, rec.kelamin, "KELAMIN")}
        ${tdCell(rec, rec.sts_kawin, "STS_KAWIN")}
        ${tdCell(rec, rec.alamat, "ALAMAT")}
        <td>${escapeHtml(rec.rt || "-")}</td>
        <td>${escapeHtml(rec.rw || "-")}</td>
        ${tdCell(rec, rec.kelurahan, "KELURAHAN")}
        ${tdCell(rec, rec.kecamatan, "KECAMATAN")}
        <td>${escapeHtml(rec.kab_kota || "-")}</td>
        <td>${escapeHtml(rec.provinsi || "-")}</td>
        <td>${escapeHtml(rec.updated_at || "-")}</td>
        <td class="aksi-cell">
          <div class="row-actions">
            ${editBtn}
            <button type="button" class="btn btn-xs btn-ss" data-toggle-ss="${rec.sheet_row}">
              ${isOpen ? "Tutup DWH" : "Lihat DWH"}
            </button>
          </div>
        </td>
      </tr>
    `);

    if (isOpen) {
      rowsHtml.push(renderInlineScreenshotPanel(rec));
    }
  });

  tbody.innerHTML = rowsHtml.join("");
}

/* ==================== EDIT MODAL (ADMIN ONLY) ==================== */
function openEditModal(sheetRow) {
  if (!currentUser || currentUser.role !== "admin") return;
  const rec = allRecords.find((r) => r.sheet_row === sheetRow);
  if (!rec) return;

  $("edit-sheet-row").value = rec.sheet_row;
  $("edit-nik").value = rec.nik || "";
  $("edit-nkk").value = rec.nkk || "";
  $("edit-nama").value = rec.nama || "";
  $("edit-tempat-lahir").value = rec.tempat_lahir || "";
  $("edit-tanggal-lahir").value = rec.tanggal_lahir || "";
  $("edit-kelamin").value = rec.kelamin || "-";
  $("edit-sts-kawin").value = rec.sts_kawin || "-";
  $("edit-alamat").value = rec.alamat || "";
  $("edit-rt").value = rec.rt || "-";
  $("edit-rw").value = rec.rw || "-";
  $("edit-kelurahan").value = rec.kelurahan || "";
  $("edit-kecamatan").value = rec.kecamatan || "";
  $("edit-kab-kota").value = rec.kab_kota || "";
  $("edit-provinsi").value = rec.provinsi || "";
  $("edit-kesimpulan").value = rec.kesimpulan || "VALID";
  $("edit-error").classList.add("hidden");

  $("edit-modal").classList.remove("hidden");
}

function closeEditModal() {
  $("edit-modal").classList.add("hidden");
}

/* ==================== EXPORT CSV & EXCEL ==================== */
function getExportRows() {
  return filteredRecords.map((r) => ({
    PROVINSI: r.provinsi || "",
    "KABUPATEN/KOTA": r.kab_kota || "",
    KECAMATAN: r.kecamatan || "",
    KELURAHAN: r.kelurahan || "",
    NKK: r.nkk || "",
    NIK: r.nik || "",
    NAMA: r.nama || "",
    TEMPAT_LAHIR: r.tempat_lahir || "",
    TANGGAL_LAHIR: r.tanggal_lahir || "",
    STS_KAWIN: r.sts_kawin || "",
    KELAMIN: r.kelamin || "",
    ALAMAT: r.alamat || "",
    RT: r.rt || "-",
    RW: r.rw || "-",
    UPDATED_AT: r.updated_at || "",
    STATUS: r.status || "",
    KESIMPULAN: r.kesimpulan || "",
  }));
}

function downloadCsv() {
  const rows = getExportRows();
  if (!rows.length) return showBanner("Tidak ada data untuk diunduh.", true);
  const headers = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  rows.forEach((row) => lines.push(headers.map((h) => esc(row[h])).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `SIVITA_Hasil_DWH_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function downloadExcel() {
  const rows = getExportRows();
  if (!rows.length) return showBanner("Tidak ada data untuk diunduh.", true);
  if (typeof XLSX === "undefined") {
    return showBanner("Library Excel (SheetJS) belum termuat. Silakan coba Download CSV.", true);
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hasil_DWH");
  XLSX.writeFile(wb, `SIVITA_Hasil_DWH_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ==================== EVENT LISTENERS ==================== */
document.addEventListener("DOMContentLoaded", async () => {
  // Role tab switcher pada halaman login
  const roleBtns = document.querySelectorAll("[data-fill-role]");
  roleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      roleBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $("login-username").value = btn.getAttribute("data-fill-role");
      $("login-password").focus();
    });
  });

  // Toggle tampilkan/sembunyikan password
  const togglePwdBtn = $("toggle-password");
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener("click", () => {
      const inp = $("login-password");
      inp.type = inp.type === "password" ? "text" : "password";
    });
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("login-error");
    errEl.classList.add("hidden");
    const btn = $("login-submit-btn");
    btn.disabled = true;
    btn.textContent = "Memverifikasi...";
    try {
      const res = await apiPost(
        {
          action: "login",
          username: $("login-username").value.trim(),
          password: $("login-password").value,
        },
        false
      );
      localStorage.setItem(STORAGE_TOKEN_KEY, res.token);
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(res.user));
      showApp(res.user);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>MASUK</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';
    }
  });

  $("btn-logout").addEventListener("click", () => logout(false));
  $("search-input").addEventListener("input", applyFiltersAndRender);
  $("filter-status").addEventListener("change", applyFiltersAndRender);
  $("btn-refresh").addEventListener("click", loadData);
  $("btn-export-csv").addEventListener("click", downloadCsv);
  $("btn-export-xlsx").addEventListener("click", downloadExcel);

  $("btn-sync-sheet1").addEventListener("click", async () => {
    const btn = $("btn-sync-sheet1");
    btn.disabled = true;
    btn.textContent = "Menyinkronkan...";
    try {
      const res = await apiPost({ action: "sync_from_sheet1" });
      showBanner(`Berhasil menyinkronkan ${res.synced_count || 0} baris dari Sheet 1 ke Hasil_DWH!`);
      await loadData();
    } catch (err) {
      showBanner(`Gagal sinkronisasi: ${err.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Sinkronisasi";
    }
  });

  // Delegasi klik tombol "Lihat DWH", Zoom In/Out/Reset, dan "Edit" pada tabel
  $("table-body").addEventListener("click", (e) => {
    const ssBtn = e.target.closest("[data-toggle-ss]");
    if (ssBtn) {
      const rowNum = Number(ssBtn.getAttribute("data-toggle-ss"));
      if (expandedRows.has(rowNum)) {
        expandedRows.delete(rowNum);
        zoomLevels.delete(rowNum);
      } else {
        expandedRows.add(rowNum);
        zoomLevels.set(rowNum, 100);
      }
      renderTable();
      return;
    }
    const zIn = e.target.closest("[data-zoom-in]");
    if (zIn) {
      const rowNum = Number(zIn.getAttribute("data-zoom-in"));
      const cur = zoomLevels.get(rowNum) || 100;
      zoomLevels.set(rowNum, Math.min(250, cur + 25));
      renderTable();
      return;
    }
    const zOut = e.target.closest("[data-zoom-out]");
    if (zOut) {
      const rowNum = Number(zOut.getAttribute("data-zoom-out"));
      const cur = zoomLevels.get(rowNum) || 100;
      zoomLevels.set(rowNum, Math.max(50, cur - 25));
      renderTable();
      return;
    }
    const zReset = e.target.closest("[data-zoom-reset]");
    if (zReset) {
      const rowNum = Number(zReset.getAttribute("data-zoom-reset"));
      zoomLevels.set(rowNum, 100);
      renderTable();
      return;
    }
    const editBtn = e.target.closest("[data-edit-row]");
    if (editBtn) {
      openEditModal(Number(editBtn.getAttribute("data-edit-row")));
    }
  });

  $("btn-close-modal").addEventListener("click", closeEditModal);
  $("btn-cancel-edit").addEventListener("click", closeEditModal);

  $("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("edit-error");
    errEl.classList.add("hidden");
    const saveBtn = $("btn-save-edit");
    saveBtn.disabled = true;
    saveBtn.textContent = "Menyimpan...";
    try {
      const sheetRow = Number($("edit-sheet-row").value);
      const record = {
        nik: $("edit-nik").value.trim(),
        nkk: $("edit-nkk").value.trim(),
        nama: $("edit-nama").value.trim(),
        tempat_lahir: $("edit-tempat-lahir").value.trim(),
        tanggal_lahir: $("edit-tanggal-lahir").value.trim(),
        kelamin: $("edit-kelamin").value,
        sts_kawin: $("edit-sts-kawin").value,
        alamat: $("edit-alamat").value.trim(),
        rt: $("edit-rt").value.trim() || "-",
        rw: $("edit-rw").value.trim() || "-",
        kelurahan: $("edit-kelurahan").value.trim(),
        kecamatan: $("edit-kecamatan").value.trim(),
        kab_kota: $("edit-kab-kota").value.trim(),
        provinsi: $("edit-provinsi").value.trim(),
        kesimpulan: $("edit-kesimpulan").value,
      };
      await apiPost({ action: "update_record", sheet_row: sheetRow, record });
      closeEditModal();
      showBanner("Perubahan berhasil disimpan ke sheet Hasil_DWH!");
      await loadData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Simpan Perubahan";
    }
  });

  // Auto-restore sesi jika token masih valid
  const existingToken = getToken();
  if (existingToken) {
    try {
      const me = await apiPost({ action: "me" });
      showApp(me.user);
      return;
    } catch {
      logout(true);
    }
  }
  showLogin();
});
