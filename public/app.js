/**
 * SIVITA — Sistem Informasi Validasi Data
 * Frontend SPA terhubung ke Vercel Serverless API (/api/sivita)
 */

const API_URL = "/api/sivita";
const STORAGE_TOKEN_KEY = "sivita_session_token";
const STORAGE_USER_KEY = "sivita_session_user";
const STORAGE_COLS_KEY = "sivita_visible_cols";

const TABLE_COLUMNS = [
  { key: "nkk", label: "NKK" },
  { key: "nik", label: "NIK" },
  { key: "nama", label: "NAMA" },
  { key: "tempat_lahir", label: "TEMPAT_LAHIR" },
  { key: "tanggal_lahir", label: "TANGGAL_LAHIR" },
  { key: "kelamin", label: "KELAMIN" },
  { key: "sts_kawin", label: "STS_KAWIN" },
  { key: "alamat", label: "ALAMAT" },
  { key: "rt", label: "RT" },
  { key: "rw", label: "RW" },
  { key: "kelurahan", label: "KELURAHAN" },
  { key: "kecamatan", label: "KECAMATAN" },
  { key: "kab_kota", label: "KABUPATEN/KOTA" },
  { key: "provinsi", label: "PROVINSI" },
  { key: "updated_at", label: "UPDATED_AT" },
  { key: "kategori_data", label: "KATEGORI DATA" },
  { key: "aksi", label: "AKSI" },
  { key: "kesimpulan", label: "KESIMPULAN" },
  { key: "status", label: "STATUS" },
];

let visibleCols = new Set(TABLE_COLUMNS.map((c) => c.key));

function loadVisibleCols() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_COLS_KEY) || "null");
    if (Array.isArray(saved)) {
      const validKeys = new Set(TABLE_COLUMNS.map((c) => c.key));
      const filtered = saved.filter((k) => validKeys.has(k));
      visibleCols = new Set(filtered);
      return;
    }
  } catch {}
  visibleCols = new Set(TABLE_COLUMNS.map((c) => c.key));
}

function saveVisibleCols() {
  try {
    localStorage.setItem(STORAGE_COLS_KEY, JSON.stringify(Array.from(visibleCols)));
  } catch {}
}

function getVisibleColCount() {
  return 1 + visibleCols.size; // 1 untuk kolom No
}

function applyColumnVisibility() {
  const table = $("dwh-table");
  if (!table) return;
  TABLE_COLUMNS.forEach((c) => {
    const hidden = !visibleCols.has(c.key);
    table.querySelectorAll(`[data-col="${c.key}"]`).forEach((el) => {
      el.classList.toggle("col-hidden", hidden);
    });
  });

  // Hitung ulang posisi left sticky (No -> NKK -> NIK -> NAMA) jika NKK/NIK disembunyikan
  let leftPx = 60; // Lebar kolom No
  const nkkVisible = visibleCols.has("nkk");
  const nikVisible = visibleCols.has("nik");

  table.querySelectorAll(".sticky-nkk").forEach((el) => {
    el.style.left = `${leftPx}px`;
  });
  if (nkkVisible) leftPx += 132;

  table.querySelectorAll(".sticky-nik").forEach((el) => {
    el.style.left = `${leftPx}px`;
  });
  if (nikVisible) leftPx += 132;

  table.querySelectorAll(".sticky-nama").forEach((el) => {
    el.style.left = `${leftPx}px`;
  });

  // Perbarui colspan pada panel inline screenshot / empty cell
  const span = getVisibleColCount();
  table.querySelectorAll(".inline-panel-row td, .empty-cell").forEach((td) => {
    td.setAttribute("colspan", String(span));
  });
}

function renderColumnPicker() {
  const list = $("col-picker-list");
  if (!list) return;
  list.innerHTML = TABLE_COLUMNS.map(
    (c) => `
      <label class="col-picker-item">
        <input type="checkbox" data-col-toggle="${c.key}" ${visibleCols.has(c.key) ? "checked" : ""} />
        <span>${escapeHtml(c.label)}</span>
      </label>
    `
  ).join("");
}

let currentUser = null;
let allRecords = [];
let filteredRecords = [];
const expandedRows = new Set();
const zoomLevels = new Map(); // sheet_row -> zoom percent (default 100)
const selectedRows = new Set(); // sheet_row yang dicentang admin untuk verifikasi massal

const $ = (id) => document.getElementById(id);

function shouldNormalizeRtRw(kesimpulan) {
  const k = String(kesimpulan || "").toUpperCase().trim();
  return k === "VALID" || k === "ANOMALI";
}

function formatRtRw3Digit(val, kesimpulan) {
  const s = String(val ?? "").trim();
  if (!shouldNormalizeRtRw(kesimpulan)) {
    return !s || s === "-" || s === "000" ? "-" : s;
  }
  if (!s || s === "-") return "000";
  const digits = s.replace(/\D/g, "");
  if (!digits) return "000";
  return digits.padStart(3, "0");
}

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
  selectedRows.clear();
  updateBulkBar();
  showLogin();
  if (!silent) {
    $("login-password").value = "";
  }
}

function normCmp(val) {
  return String(val ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function enrichKabProvDiffs(records) {
  return records.map((rec) => {
    const ks = String(rec.kesimpulan || "").toUpperCase().trim();
    if (ks !== "VALID" && ks !== "ANOMALI") return rec;

    const diffs = Array.isArray(rec.diffs) ? [...rec.diffs] : [];
    const hasField = (name) => diffs.some((d) => d.field === name);

    const expectedKab = String(rec.master?.kab_kota || "").trim() || "GORONTALO";
    const expectedProv = String(rec.master?.provinsi || "").trim() || "GORONTALO";

    if (!hasField("KABUPATEN/KOTA") && normCmp(rec.kab_kota) !== normCmp(expectedKab)) {
      diffs.push({ field: "KABUPATEN/KOTA", master: expectedKab, dwh: String(rec.kab_kota || "").trim() });
    }
    if (!hasField("PROVINSI") && normCmp(rec.provinsi) !== normCmp(expectedProv)) {
      diffs.push({ field: "PROVINSI", master: expectedProv, dwh: String(rec.provinsi || "").trim() });
    }

    const hasDiff = diffs.length > 0;
    return { ...rec, diffs, has_diff: hasDiff, kesimpulan: hasDiff ? "ANOMALI" : "VALID" };
  });
}

/* ==================== DATA LOADING & FILTERING ==================== */
async function loadData() {
  const tbody = $("table-body");
  tbody.innerHTML = `<tr><td colspan="20" class="empty-cell">Sedang Memuat Data...</td></tr>`;
  try {
    const res = await apiPost({ action: "get_data" });
    allRecords = enrichKabProvDiffs(Array.isArray(res.records) ? res.records : []);
    populateWilayahFilters();
    updateKpis();
    applyFiltersAndRender();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="20" class="empty-cell">Gagal memuat data: ${escapeHtml(err.message)}</td></tr>`;
    showBanner(`Gagal memuat data: ${err.message}`, true);
  }
}

function getRecapScopeRecords() {
  const fKategori = $("filter-kategori") ? $("filter-kategori").value : "ALL";
  const fKecamatan = $("filter-kecamatan") ? $("filter-kecamatan").value : "ALL";
  const fKelurahan = $("filter-kelurahan") ? $("filter-kelurahan").value : "ALL";
  return allRecords.filter((r) => {
    if (fKategori !== "ALL" && String(r.kategori_data || "").trim() !== fKategori) return false;
    if (fKecamatan !== "ALL" && String(r.kecamatan || "").trim().toUpperCase() !== fKecamatan) return false;
    if (fKelurahan !== "ALL" && String(r.kelurahan || "").trim().toUpperCase() !== fKelurahan) return false;
    return true;
  });
}

function updateKpis() {
  const scope = getRecapScopeRecords();
  const total = scope.length;
  const gorontalo = scope.filter((r) => r.status === "Penduduk Kabupaten Gorontalo").length;
  const luar = scope.filter((r) => r.status === "Bukan Penduduk Kabupaten Gorontalo").length;
  const diffAll = scope.filter((r) => r.has_diff);
  const diff = diffAll.length;
  const diffUnverified = diffAll.filter((r) => !r.verified).length;
  const diffVerified = diff - diffUnverified;
  const verifiedTotal = scope.filter((r) => r.verified).length;

  const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  $("kpi-total").textContent = total.toLocaleString("id-ID");
  $("kpi-gorontalo").textContent = gorontalo.toLocaleString("id-ID");
  $("kpi-luar").textContent = luar.toLocaleString("id-ID");
  $("kpi-diff").textContent = diff.toLocaleString("id-ID");

  $("kpi-total-sub").textContent = `${verifiedTotal.toLocaleString("id-ID")} dari ${total.toLocaleString("id-ID")} data terverifikasi`;
  $("kpi-total-bar").style.width = `${pct(verifiedTotal)}%`;

  const pGor = pct(gorontalo);
  $("kpi-gorontalo-sub").textContent = `${pGor.toLocaleString("id-ID")}% dari total data`;
  $("kpi-gorontalo-bar").style.width = `${pGor}%`;

  const pLuar = pct(luar);
  $("kpi-luar-sub").textContent = `${pLuar.toLocaleString("id-ID")}% dari total data`;
  $("kpi-luar-bar").style.width = `${pLuar}%`;

  $("kpi-diff-sub").textContent = `${diffUnverified.toLocaleString("id-ID")} belum dicek • ${diffVerified.toLocaleString("id-ID")} sudah dicek`;
  $("kpi-diff-bar").style.width = `${pct(diff)}%`;

  // Update 6 Kartu Rekap Kesimpulan (VALID, ANOMALI, GANDA, MENINGGAL, NON AKTIF, TIDAK TERDAPAT DALAM DATABASE)
  const ksCounts = {
    VALID: 0,
    ANOMALI: 0,
    GANDA: 0,
    MENINGGAL: 0,
    "NON AKTIF": 0,
    "TIDAK TERDAPAT DALAM DATABASE": 0,
  };
  scope.forEach((r) => {
    const k = String(r.kesimpulan || "").toUpperCase().trim();
    if (Object.prototype.hasOwnProperty.call(ksCounts, k)) {
      ksCounts[k]++;
    }
  });

  const ksMap = [
    ["VALID", "ks-count-valid", "ks-pct-valid"],
    ["ANOMALI", "ks-count-anomali", "ks-pct-anomali"],
    ["GANDA", "ks-count-ganda", "ks-pct-ganda"],
    ["MENINGGAL", "ks-count-meninggal", "ks-pct-meninggal"],
    ["NON AKTIF", "ks-count-nonaktif", "ks-pct-nonaktif"],
    ["TIDAK TERDAPAT DALAM DATABASE", "ks-count-tidakada", "ks-pct-tidakada"],
  ];
  ksMap.forEach(([key, countId, pctId]) => {
    const c = ksCounts[key];
    const cEl = $(countId);
    const pEl = $(pctId);
    if (cEl) cEl.textContent = c.toLocaleString("id-ID");
    if (pEl) pEl.textContent = `${pct(c).toLocaleString("id-ID")}%`;
  });
}

function populateKelurahanFilter() {
  const kecSel = $("filter-kecamatan");
  const kelSel = $("filter-kelurahan");
  if (!kecSel || !kelSel) return;
  const selectedKec = kecSel.value;
  const prevKel = kelSel.value;

  const kelSet = new Set();
  allRecords.forEach((r) => {
    const k = String(r.kecamatan || "").trim().toUpperCase();
    const kel = String(r.kelurahan || "").trim().toUpperCase();
    if (!kel) return;
    if (selectedKec !== "ALL" && k !== selectedKec) return;
    kelSet.add(kel);
  });

  const sortedKel = Array.from(kelSet).sort((a, b) => a.localeCompare(b, "id"));
  kelSel.innerHTML =
    `<option value="ALL">Semua Desa/Kelurahan</option>` +
    sortedKel.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

  kelSel.value = kelSet.has(prevKel) ? prevKel : "ALL";
}

function populateWilayahFilters() {
  const katSel = $("filter-kategori");
  if (katSel) {
    const prevKat = katSel.value;
    const katSet = new Set();
    allRecords.forEach((r) => {
      const k = String(r.kategori_data || "").trim();
      if (k) katSet.add(k);
    });
    const sortedKat = Array.from(katSet).sort((a, b) => a.localeCompare(b, "id"));
    katSel.innerHTML =
      `<option value="ALL">Semua Kategori Data</option>` +
      sortedKat.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
    katSel.value = katSet.has(prevKat) ? prevKat : "ALL";
  }

  const kecSel = $("filter-kecamatan");
  if (!kecSel) return;
  const prevKec = kecSel.value;

  const kecSet = new Set();
  allRecords.forEach((r) => {
    const k = String(r.kecamatan || "").trim().toUpperCase();
    if (k) kecSet.add(k);
  });

  const sortedKec = Array.from(kecSet).sort((a, b) => a.localeCompare(b, "id"));
  kecSel.innerHTML =
    `<option value="ALL">Semua Kecamatan</option>` +
    sortedKec.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

  kecSel.value = kecSet.has(prevKec) ? prevKec : "ALL";
  populateKelurahanFilter();
}

function syncActiveFilterStyles() {
  ["filter-kategori", "filter-kecamatan", "filter-kelurahan", "filter-kesimpulan", "filter-status", "filter-verifikasi"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.toggle("filter-active", el.value !== "ALL");
  });
  const curKs = $("filter-kesimpulan") ? $("filter-kesimpulan").value : "ALL";
  document.querySelectorAll("[data-ks-filter]").forEach((card) => {
    card.classList.toggle("ks-card-active", card.getAttribute("data-ks-filter") === curKs);
  });
}

function applyFiltersAndRender() {
  syncActiveFilterStyles();
  updateKpis();
  const q = ($("search-input").value || "").trim().toLowerCase();
  const fKategori = $("filter-kategori") ? $("filter-kategori").value : "ALL";
  const fKecamatan = $("filter-kecamatan").value;
  const fKelurahan = $("filter-kelurahan").value;
  const fKesimpulan = $("filter-kesimpulan").value;
  const fStatus = $("filter-status").value;
  const fVerifikasi = $("filter-verifikasi").value;

  filteredRecords = allRecords.filter((r) => {
    if (fKategori !== "ALL" && String(r.kategori_data || "").trim() !== fKategori) return false;
    const rKec = String(r.kecamatan || "").trim().toUpperCase();
    const rKel = String(r.kelurahan || "").trim().toUpperCase();
    if (fKecamatan !== "ALL" && rKec !== fKecamatan) return false;
    if (fKelurahan !== "ALL" && rKel !== fKelurahan) return false;

    const ks = String(r.kesimpulan || "").toUpperCase().trim();
    if (fKesimpulan !== "ALL" && ks !== fKesimpulan) return false;

    if (fStatus === "GORONTALO" && r.status !== "Penduduk Kabupaten Gorontalo") return false;
    if (fStatus === "NON_GORONTALO" && r.status !== "Bukan Penduduk Kabupaten Gorontalo") return false;

    if (fVerifikasi === "DIFF_UNVERIFIED" && (!r.has_diff || r.verified)) return false;
    if (fVerifikasi === "DIFF_ONLY" && !r.has_diff) return false;
    if (fVerifikasi === "UNVERIFIED" && r.verified) return false;
    if (fVerifikasi === "VERIFIED" && !r.verified) return false;

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
        r.kategori_data,
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

function tdCell(rec, value, fieldName, extraClass = "", colKey = "") {
  const diff = fieldName ? getDiffObj(rec, fieldName) : null;
  const colAttr = colKey ? ` data-col="${colKey}"` : "";
  if (diff) {
    const tip = `Berbeda dengan Basis Data: ${diff.master}`;
    const cls = extraClass ? `${extraClass} cell-diff` : "cell-diff";
    return `<td class="${cls}"${colAttr} title="${escapeHtml(tip)}">${escapeHtml(value || "-")}</td>`;
  }
  return extraClass ? `<td class="${extraClass}"${colAttr}>${escapeHtml(value || "-")}</td>` : `<td${colAttr}>${escapeHtml(value || "-")}</td>`;
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
        <div class="ss-status-title">Peringatan Perbedaan dengan Basis Data:</div>
        <div class="ss-diff-chips">${items}</div>
      </div>
    `;
  } else {
    diffBannerHtml = `
      <div class="ss-status-bar ss-status-ok">
        <strong>Status Kesesuaian Basis Data:</strong> Seluruh elemen data sesuai dengan Basis Data.
      </div>
    `;
  }

  const isAdmin = currentUser && currentUser.role === "admin";
  const verifyBtnHtml = isAdmin
    ? rec.verified
      ? `<button type="button" class="btn btn-xs btn-verified-done" data-toggle-verify="${rec.sheet_row}" data-next-verify="0" title="${escapeHtml(rec.verified_info || "Sudah dicek — klik untuk batalkan")}">✓ Sudah Dicek</button>`
      : `<button type="button" class="btn btn-xs btn-verify" data-toggle-verify="${rec.sheet_row}" data-next-verify="1" title="Tandai data ini sudah diverifikasi sesuai tangkapan layar DWH">✓ Tandai Sudah Dicek</button>`
    : "";

  return `
    <tr class="inline-panel-row">
      <td colspan="20">
        <div class="inline-panel-sticky">
          <div class="ss-box">
            <div class="ss-box-header">
              <span>Tangkapan Layar DWH — ${escapeHtml(rec.nama || "-")} (${escapeHtml(rec.nik)})</span>
              <div class="ss-controls">
                ${verifyBtnHtml}
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

function updateBulkBar() {
  const bar = $("bulk-action-bar");
  const selectAll = $("select-all-rows");
  if (!bar) return;
  const isAdmin = currentUser && currentUser.role === "admin";
  if (!isAdmin || selectedRows.size === 0) {
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    $("bulk-count-label").textContent = `${selectedRows.size.toLocaleString("id-ID")} data dipilih`;
  }
  if (selectAll && isAdmin) {
    const visibleSelectable = filteredRecords.length;
    const checkedVisible = filteredRecords.filter((r) => selectedRows.has(r.sheet_row)).length;
    selectAll.checked = visibleSelectable > 0 && checkedVisible === visibleSelectable;
    selectAll.indeterminate = checkedVisible > 0 && checkedVisible < visibleSelectable;
  }
}

async function runBulkVerify(verifiedFlag) {
  const rows = Array.from(selectedRows);
  if (!rows.length) return;
  const btnV = $("btn-bulk-verify");
  const btnU = $("btn-bulk-unverify");
  const btnC = $("btn-bulk-clear");
  btnV.disabled = true;
  btnU.disabled = true;
  btnC.disabled = true;
  const activeBtn = verifiedFlag ? btnV : btnU;
  const prevText = activeBtn.textContent;
  activeBtn.textContent = "Menyimpan...";
  try {
    const res = await apiPost({
      action: "bulk_verify",
      sheet_rows: rows,
      verified: verifiedFlag,
    });
    const updatedSet = new Set(res.sheet_rows || rows);
    allRecords.forEach((r) => {
      if (updatedSet.has(r.sheet_row)) {
        r.verified = Boolean(res.verified);
        r.verified_info = res.verified_info || "";
      }
    });
    selectedRows.clear();
    updateKpis();
    applyFiltersAndRender();
    showBanner(
      verifiedFlag
        ? `Berhasil menandai ${res.updated_count || updatedSet.size} data sebagai Sudah Dicek!`
        : `Berhasil membatalkan tanda verifikasi pada ${res.updated_count || updatedSet.size} data.`
    );
  } catch (err) {
    showBanner(`Gagal verifikasi massal: ${err.message}`, true);
  } finally {
    btnV.disabled = false;
    btnU.disabled = false;
    btnC.disabled = false;
    activeBtn.textContent = prevText;
  }
}

function renderTable() {
  const tbody = $("table-body");
  if (!filteredRecords.length) {
    tbody.innerHTML = `<tr><td colspan="20" class="empty-cell">Tidak ada data yang cocok dengan filter pencarian.</td></tr>`;
    updateBulkBar();
    return;
  }

  const isAdmin = currentUser && currentUser.role === "admin";
  const rowsHtml = [];

  filteredRecords.forEach((rec, idx) => {
    const isOpen = expandedRows.has(rec.sheet_row);
    const isSelected = isAdmin && selectedRows.has(rec.sheet_row);
    const namaDiff = getDiffObj(rec, "NAMA");
    const diffBadge = rec.has_diff
      ? `<span class="diff-pill" title="Terdapat ${rec.diffs.length} elemen berbeda dengan Basis Data">! ${rec.diffs.length}</span>`
      : "";
    const verifiedBadge = rec.verified
      ? `<span class="verified-pill" title="${escapeHtml(rec.verified_info || "Sudah diverifikasi")}">✓ Dicek</span>`
      : "";

    const editBtn = isAdmin
      ? `<button type="button" class="btn btn-xs btn-edit" data-edit-row="${rec.sheet_row}" title="Edit data ini"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg><span>Edit</span></button>`
      : "";
    const checkHtml = isAdmin
      ? `<input type="checkbox" class="row-check" data-select-row="${rec.sheet_row}" ${isSelected ? "checked" : ""} aria-label="Pilih baris ${idx + 1}" />`
      : "";
    const kelVal = String(rec.kelamin || "-").toUpperCase();
    const kelDiff = getDiffObj(rec, "KELAMIN");
    const kelTagCls = kelVal === "L" ? "mini-tag mini-tag-l" : kelVal === "P" ? "mini-tag mini-tag-p" : "mini-tag";
    const kelCellHtml = kelDiff
      ? tdCell(rec, rec.kelamin, "KELAMIN", "", "kelamin")
      : `<td data-col="kelamin"><span class="${kelTagCls}">${escapeHtml(kelVal)}</span></td>`;

    const kawinVal = String(rec.sts_kawin || "-").toUpperCase();
    const kawinDiff = getDiffObj(rec, "STS_KAWIN");
    const kawinCellHtml = kawinDiff
      ? tdCell(rec, rec.sts_kawin, "STS_KAWIN", "", "sts_kawin")
      : `<td data-col="sts_kawin"><span class="mini-tag">${escapeHtml(kawinVal)}</span></td>`;

    rowsHtml.push(`
      <tr class="data-row ${rec.has_diff ? "row-has-diff" : ""} ${isSelected ? "row-selected" : ""}">
        <td class="sticky-no num-cell" data-col="no">
          <label class="no-check-wrap">${checkHtml}<span>${idx + 1}</span></label>
        </td>
        ${tdCell(rec, rec.nkk, "NKK", "sticky-nkk num-cell", "nkk")}
        <td class="sticky-nik num-cell" data-col="nik">${escapeHtml(rec.nik)}</td>
        <td class="sticky-nama nama-cell ${namaDiff ? "cell-diff" : ""}" data-col="nama" title="${namaDiff ? escapeHtml("Basis Data: " + namaDiff.master) : ""}">
          <div class="nama-text">
            <span>${escapeHtml(rec.nama || "-")}</span>
            ${diffBadge}
            ${verifiedBadge}
          </div>
        </td>
        ${tdCell(rec, rec.tempat_lahir, "TEMPAT_LAHIR", "", "tempat_lahir")}
        ${tdCell(rec, rec.tanggal_lahir, "TANGGAL_LAHIR", "num-cell", "tanggal_lahir")}
        ${kelCellHtml}
        ${kawinCellHtml}
        ${tdCell(rec, rec.alamat, "ALAMAT", "", "alamat")}
        <td class="num-cell" data-col="rt">${escapeHtml(formatRtRw3Digit(rec.rt, rec.kesimpulan))}</td>
        <td class="num-cell" data-col="rw">${escapeHtml(formatRtRw3Digit(rec.rw, rec.kesimpulan))}</td>
        ${tdCell(rec, rec.kelurahan, "KELURAHAN", "", "kelurahan")}
        ${tdCell(rec, rec.kecamatan, "KECAMATAN", "", "kecamatan")}
        ${tdCell(rec, rec.kab_kota, "KABUPATEN/KOTA", "", "kab_kota")}
        ${tdCell(rec, rec.provinsi, "PROVINSI", "", "provinsi")}
        <td class="num-cell" data-col="updated_at">${escapeHtml(rec.updated_at || "-")}</td>
        <td data-col="kategori_data">${escapeHtml(rec.kategori_data || "-")}</td>
        <td class="aksi-cell" data-col="aksi">
          <div class="row-actions">
            ${editBtn}
            <button type="button" class="btn btn-xs btn-ss ${isOpen ? "btn-ss-open" : ""}" data-toggle-ss="${rec.sheet_row}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <span>${isOpen ? "Tutup DWH" : "Lihat DWH"}</span>
            </button>
          </div>
        </td>
        <td data-col="kesimpulan">${renderKesimpulanPill(rec.kesimpulan)}</td>
        <td data-col="status">${renderStatusPill(rec.status)}</td>
      </tr>
    `);

    if (isOpen) {
      rowsHtml.push(renderInlineScreenshotPanel(rec));
    }
  });

  tbody.innerHTML = rowsHtml.join("");
  applyColumnVisibility();
  updateBulkBar();
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
  $("edit-rt").value = formatRtRw3Digit(rec.rt, rec.kesimpulan);
  $("edit-rw").value = formatRtRw3Digit(rec.rw, rec.kesimpulan);
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

/* ==================== PROFIL & GANTI PASSWORD MANDIRI ==================== */
function openProfileModal() {
  if (!currentUser) return;
  const isAdmin = currentUser.role === "admin";
  const displayName = currentUser.name || currentUser.username || "-";
  $("profile-display-name").textContent = displayName;
  $("profile-username").textContent = currentUser.username || "-";
  $("profile-avatar").textContent = displayName.trim().charAt(0).toUpperCase() || "U";
  const rolePill = $("profile-role-pill");
  rolePill.textContent = isAdmin ? "ADMIN" : "USER";
  rolePill.classList.toggle("role-admin", isAdmin);

  $("profile-old-password").value = "";
  $("profile-new-password").value = "";
  $("profile-confirm-password").value = "";
  $("profile-show-pwd").checked = false;
  ["profile-old-password", "profile-new-password", "profile-confirm-password"].forEach((id) => {
    $(id).type = "password";
  });
  $("profile-error").classList.add("hidden");
  $("profile-modal").classList.remove("hidden");
  $("profile-old-password").focus();
}

function closeProfileModal() {
  $("profile-modal").classList.add("hidden");
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
    RT: formatRtRw3Digit(r.rt, r.kesimpulan),
    RW: formatRtRw3Digit(r.rw, r.kesimpulan),
    UPDATED_AT: r.updated_at || "",
    KATEGORI_DATA: r.kategori_data || "",
    STATUS: r.status || "",
    KESIMPULAN: r.kesimpulan || "",
    VERIFIKASI: r.verified_info || "",
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
  $("btn-open-profile").addEventListener("click", openProfileModal);
  $("btn-close-profile").addEventListener("click", closeProfileModal);
  $("btn-cancel-profile").addEventListener("click", closeProfileModal);
  $("profile-modal").addEventListener("click", (e) => {
    if (e.target === $("profile-modal")) closeProfileModal();
  });
  $("profile-show-pwd").addEventListener("change", (e) => {
    const t = e.target.checked ? "text" : "password";
    $("profile-old-password").type = t;
    $("profile-new-password").type = t;
    $("profile-confirm-password").type = t;
  });
  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("profile-error");
    errEl.classList.add("hidden");
    const oldPassword = $("profile-old-password").value;
    const newPassword = $("profile-new-password").value;
    const confirmPassword = $("profile-confirm-password").value;

    if (newPassword.length < 6) {
      errEl.textContent = "Password baru minimal 6 karakter.";
      errEl.classList.remove("hidden");
      return;
    }
    if (newPassword !== confirmPassword) {
      errEl.textContent = "Konfirmasi password baru tidak cocok.";
      errEl.classList.remove("hidden");
      return;
    }
    if (newPassword === oldPassword) {
      errEl.textContent = "Password baru harus berbeda dari password lama.";
      errEl.classList.remove("hidden");
      return;
    }

    const saveBtn = $("btn-save-profile");
    saveBtn.disabled = true;
    saveBtn.textContent = "Menyimpan...";
    try {
      await apiPost({
        action: "change_password",
        old_password: oldPassword,
        new_password: newPassword,
      });
      closeProfileModal();
      showBanner("Password berhasil diperbarui! Gunakan password baru pada login berikutnya.");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Simpan Password";
    }
  });
  $("search-input").addEventListener("input", applyFiltersAndRender);
  $("filter-kategori").addEventListener("change", applyFiltersAndRender);
  $("filter-kecamatan").addEventListener("change", () => {
    populateKelurahanFilter();
    applyFiltersAndRender();
  });
  $("filter-kelurahan").addEventListener("change", applyFiltersAndRender);
  $("filter-kesimpulan").addEventListener("change", applyFiltersAndRender);
  $("filter-status").addEventListener("change", applyFiltersAndRender);
  $("filter-verifikasi").addEventListener("change", applyFiltersAndRender);
  $("btn-reset-filters").addEventListener("click", () => {
    $("search-input").value = "";
    $("filter-kategori").value = "ALL";
    $("filter-kecamatan").value = "ALL";
    populateKelurahanFilter();
    $("filter-kelurahan").value = "ALL";
    $("filter-kesimpulan").value = "ALL";
    $("filter-status").value = "ALL";
    $("filter-verifikasi").value = "ALL";
    applyFiltersAndRender();
  });

  // Klik Kartu KPI untuk filter cepat (tetap mempertahankan Kategori Data & Wilayah yang sedang dipilih!)
  document.querySelectorAll("[data-kpi-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      const mode = card.getAttribute("data-kpi-filter");
      $("filter-kesimpulan").value = "ALL";
      $("filter-status").value = mode === "GORONTALO" || mode === "NON_GORONTALO" ? mode : "ALL";
      $("filter-verifikasi").value = mode === "DIFF_UNVERIFIED" ? "DIFF_UNVERIFIED" : "ALL";
      applyFiltersAndRender();
    });
  });

  // Klik Kartu Rekap Kesimpulan untuk filter cepat (klik ulang untuk reset ke Semua Kesimpulan)
  document.querySelectorAll("[data-ks-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      const targetKs = card.getAttribute("data-ks-filter");
      const sel = $("filter-kesimpulan");
      sel.value = sel.value === targetKs ? "ALL" : targetKs;
      applyFiltersAndRender();
    });
  });
  $("btn-refresh").addEventListener("click", loadData);
  $("btn-export-csv").addEventListener("click", downloadCsv);
  $("btn-export-xlsx").addEventListener("click", downloadExcel);

  // Event Verifikasi Massal (Khusus Admin)
  $("select-all-rows").addEventListener("change", (e) => {
    const checked = e.target.checked;
    filteredRecords.forEach((r) => {
      if (checked) selectedRows.add(r.sheet_row);
      else selectedRows.delete(r.sheet_row);
    });
    renderTable();
  });
  $("btn-bulk-verify").addEventListener("click", () => runBulkVerify(true));
  $("btn-bulk-unverify").addEventListener("click", () => runBulkVerify(false));
  $("btn-bulk-clear").addEventListener("click", () => {
    selectedRows.clear();
    renderTable();
  });
  $("table-body").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-select-row]");
    if (!cb) return;
    const rowNum = Number(cb.getAttribute("data-select-row"));
    if (cb.checked) selectedRows.add(rowNum);
    else selectedRows.delete(rowNum);
    const tr = cb.closest("tr");
    if (tr) tr.classList.toggle("row-selected", cb.checked);
    updateBulkBar();
  });

  // Inisialisasi & event tombol Atur Kolom
  loadVisibleCols();
  renderColumnPicker();
  applyColumnVisibility();

  const colPickerBtn = $("btn-col-picker");
  const colPickerMenu = $("col-picker-menu");
  if (colPickerBtn && colPickerMenu) {
    colPickerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      colPickerMenu.classList.toggle("hidden");
    });
    colPickerMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => colPickerMenu.classList.add("hidden"));

    $("col-picker-list").addEventListener("change", (e) => {
      const cb = e.target.closest("[data-col-toggle]");
      if (!cb) return;
      const key = cb.getAttribute("data-col-toggle");
      if (cb.checked) {
        visibleCols.add(key);
      } else {
        visibleCols.delete(key);
      }
      saveVisibleCols();
      applyColumnVisibility();
    });

    $("btn-cols-all").addEventListener("click", () => {
      visibleCols = new Set(TABLE_COLUMNS.map((c) => c.key));
      saveVisibleCols();
      renderColumnPicker();
      applyColumnVisibility();
    });

    $("btn-cols-none").addEventListener("click", () => {
      visibleCols = new Set();
      saveVisibleCols();
      renderColumnPicker();
      applyColumnVisibility();
    });
  }

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
    const verifyBtn = e.target.closest("[data-toggle-verify]");
    if (verifyBtn) {
      const rowNum = Number(verifyBtn.getAttribute("data-toggle-verify"));
      const nextVal = verifyBtn.getAttribute("data-next-verify") === "1";
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Menyimpan...";
      apiPost({ action: "toggle_verify", sheet_row: rowNum, verified: nextVal })
        .then((res) => {
          const targetRec = allRecords.find((r) => r.sheet_row === rowNum);
          if (targetRec) {
            targetRec.verified = Boolean(res.verified);
            targetRec.verified_info = res.verified_info || "";
          }
          const curVerFilter = $("filter-verifikasi").value;
          if (nextVal && (curVerFilter === "DIFF_UNVERIFIED" || curVerFilter === "UNVERIFIED")) {
            expandedRows.delete(rowNum);
            zoomLevels.delete(rowNum);
          }
          updateKpis();
          applyFiltersAndRender();
          showBanner(
            nextVal
              ? "Data berhasil ditandai Sudah Dicek (Terverifikasi)."
              : "Tanda verifikasi pada data ini telah dibatalkan."
          );
        })
        .catch((err) => {
          verifyBtn.disabled = false;
          verifyBtn.textContent = nextVal ? "✓ Tandai Sudah Dicek" : "✓ Sudah Dicek";
          showBanner(`Gagal memperbarui status verifikasi: ${err.message}`, true);
        });
      return;
    }
    const editBtn = e.target.closest("[data-edit-row]");
    if (editBtn) {
      openEditModal(Number(editBtn.getAttribute("data-edit-row")));
    }
  });

  $("btn-close-modal").addEventListener("click", closeEditModal);
  $("btn-cancel-edit").addEventListener("click", closeEditModal);

  // Fitur geser (drag & drop) jendela Edit Data agar tidak menghalangi tangkapan layar DWH
  const modalCard = $("edit-modal-card");
  const modalHeader = $("edit-modal-header");
  if (modalCard && modalHeader) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    modalHeader.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      isDragging = true;
      const rect = modalCard.getBoundingClientRect();
      modalCard.style.right = "auto";
      modalCard.style.left = `${rect.left}px`;
      modalCard.style.top = `${rect.top}px`;
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      modalHeader.setPointerCapture(e.pointerId);
    });

    modalHeader.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const maxLeft = Math.max(0, window.innerWidth - 120);
      const maxTop = Math.max(0, window.innerHeight - 60);
      const nextLeft = Math.min(maxLeft, Math.max(-modalCard.offsetWidth + 120, e.clientX - offsetX));
      const nextTop = Math.min(maxTop, Math.max(0, e.clientY - offsetY));
      modalCard.style.left = `${nextLeft}px`;
      modalCard.style.top = `${nextTop}px`;
    });

    const stopDrag = () => {
      isDragging = false;
    };
    modalHeader.addEventListener("pointerup", stopDrag);
    modalHeader.addEventListener("pointercancel", stopDrag);
  }

  $("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("edit-error");
    errEl.classList.add("hidden");
    const saveBtn = $("btn-save-edit");
    saveBtn.disabled = true;
    saveBtn.textContent = "Menyimpan...";
    try {
      const sheetRow = Number($("edit-sheet-row").value);
      const ksEdit = $("edit-kesimpulan").value;
      const record = {
        nik: $("edit-nik").value.trim(),
        nkk: $("edit-nkk").value.trim(),
        nama: $("edit-nama").value.trim(),
        tempat_lahir: $("edit-tempat-lahir").value.trim(),
        tanggal_lahir: $("edit-tanggal-lahir").value.trim(),
        kelamin: $("edit-kelamin").value,
        sts_kawin: $("edit-sts-kawin").value,
        alamat: $("edit-alamat").value.trim(),
        rt: formatRtRw3Digit($("edit-rt").value, ksEdit),
        rw: formatRtRw3Digit($("edit-rw").value, ksEdit),
        kelurahan: $("edit-kelurahan").value.trim(),
        kecamatan: $("edit-kecamatan").value.trim(),
        kab_kota: $("edit-kab-kota").value.trim(),
        provinsi: $("edit-provinsi").value.trim(),
        kesimpulan: ksEdit,
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
