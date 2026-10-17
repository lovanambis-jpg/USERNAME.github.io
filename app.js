(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const content = $('#content');
  const modal = $('#modal');
  const modalTitle = $('#modal-title');
  const modalBody = $('#modal-body');
  const currency = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'short' });
  const fullDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const pageTitles = {
    dashboard: ['RUANG KENDALI', 'Ringkasan'], accounts: ['INVENTARIS', 'Akun digital'], rentals: ['TRANSAKSI', 'Rental'],
    customers: ['PENGELOLAAN DATA', 'Pelanggan'], reports: ['ANALISIS USAHA', 'Laporan'], settings: ['PREFERENSI', 'Cadangan & pengaturan']
  };
  let view = 'dashboard';
  let searchTerm = '';
  let reportMonth = '';
  let deferredInstall = null;
  let toastTimer;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (value) => currency.format(Number(value) || 0);
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const dateFromYmd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T00:00:00`) : null;
  const dateText = (value) => { const date = dateFromYmd(value); return date && !Number.isNaN(date.valueOf()) ? fullDate.format(date) : '—'; };
  const ymdOffset = (dateString, days) => {
    const date = dateFromYmd(dateString);
    if (!date || !Number.isFinite(Number(days))) return '';
    date.setDate(date.getDate() + Number(days));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const daysUntil = (dateString) => {
    const target = dateFromYmd(dateString), base = dateFromYmd(today());
    return target && base ? Math.round((target - base) / 86400000) : null;
  };
  const makeId = (table) => `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  const showToast = (message, error = false) => {
    const region = $('#toast-region');
    const toast = document.createElement('div');
    toast.className = `toast${error ? ' error' : ''}`;
    toast.textContent = message;
    region.append(toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.remove(), 3500);
  };
  const loadData = async () => {
    const [accounts, customers, rentals] = await Promise.all([
      LocalDB.all('accounts'), LocalDB.all('customers'), LocalDB.all('rentals')
    ]);
    return { accounts, customers, rentals };
  };
  const sortedNewest = (items, field = 'createdAt') => [...items].sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')));
  const rentalState = (rental) => {
    if (rental.status === 'dibatalkan') return 'Dibatalkan';
    if (rental.status === 'selesai') return 'Selesai';
    const now = today();
    if (rental.tanggal_mulai > now) return 'Terjadwal';
    return rental.tanggal_berakhir > now ? 'Aktif' : 'Expired';
  };
  const accountState = (account, rentals) => {
    if (account.status === 'maintenance') return 'Maintenance';
    const active = rentals.some((r) => r.account_id === account.id && r.status === 'aktif' && r.tanggal_mulai <= today() && r.tanggal_berakhir > today());
    return active ? 'Disewa' : 'Tersedia';
  };
  const activeOverlapCount = (rentals, accountId, start, end, exceptId = null) => rentals.filter((r) =>
    r.account_id === Number(accountId) && r.status === 'aktif' && r.id !== exceptId && r.tanggal_mulai < end && r.tanggal_berakhir > start
  ).length;
  const accountCapacity = (account) => account.tipe_akun === 'sharing' ? Math.max(1, Number(account.kapasitas) || 1) : 1;
  const statusClass = (label) => ({ Tersedia: 'available', 'Disewa': 'rented', Aktif: 'active', Terjadwal: 'warning', Expired: 'expired', Selesai: 'expired', Dibatalkan: 'cancelled', Maintenance: 'maintenance' }[label] || '');
  const statusTag = (label) => `<span class="status-tag ${statusClass(label)}">${esc(label)}</span>`;
  const openModal = (title, html) => {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    if (!modal.open) modal.showModal();
  };
  const closeModal = () => { if (modal.open) modal.close(); };
  const isRelated = (data, table, id) => table === 'accounts' ? data.rentals.some((r) => r.account_id === id) : data.rentals.some((r) => r.customer_id === id);
  const go = async (nextView) => {
    view = nextView;
    searchTerm = '';
    $('#sidebar').classList.remove('open');
    await render();
  };

  function svgRevenueChart(rentals) {
    const now = new Date();
    const months = [];
    for (let offset = 5; offset >= 0; offset--) {
      const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({ year: month.getFullYear(), month: month.getMonth(), label: monthName.format(month), value: 0 });
    }
    for (const rental of rentals) {
      if (rental.status === 'dibatalkan') continue;
      const date = dateFromYmd(rental.tanggal_mulai);
      if (!date) continue;
      const point = months.find((m) => m.year === date.getFullYear() && m.month === date.getMonth());
      if (point) point.value += Number(rental.harga) || 0;
    }
    const max = Math.max(...months.map((m) => m.value), 1);
    const width = 620, height = 170, left = 25, right = 14, top = 13, bottom = 25;
    const x = (index) => left + index * ((width - left - right) / (months.length - 1));
    const y = (value) => top + (height - top - bottom) * (1 - value / max);
    const points = months.map((m, i) => `${x(i)},${y(m.value)}`).join(' ');
    const area = `${left},${height - bottom} ${points} ${width - right},${height - bottom}`;
    const grid = [0, .5, 1].map((ratio) => `<line class="chart-grid" x1="${left}" y1="${top + (height - top - bottom) * ratio}" x2="${width - right}" y2="${top + (height - top - bottom) * ratio}" />`).join('');
    const labels = months.map((m, i) => `<text class="chart-label" x="${x(i)}" y="${height - 5}" text-anchor="middle">${esc(m.label)}</text>`).join('');
    const circles = months.map((m, i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(m.value)}" r="4"><title>${esc(m.label)}: ${esc(money(m.value))}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik pendapatan enam bulan terakhir"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b58d43" stop-opacity=".2"/><stop offset="100%" stop-color="#b58d43" stop-opacity="0"/></linearGradient></defs>${grid}<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${points}"/>${circles}${labels}</svg>`;
  }

  function dashboardView(data) {
    const rented = data.accounts.filter((a) => accountState(a, data.rentals) === 'Disewa').length;
    const available = data.accounts.filter((a) => accountState(a, data.rentals) === 'Tersedia').length;
    const monthKey = today().slice(0, 7);
    const monthTotal = data.rentals.filter((r) => r.status !== 'dibatalkan' && String(r.tanggal_mulai).startsWith(monthKey)).reduce((sum, r) => sum + (Number(r.harga) || 0), 0);
    const endingSoon = data.rentals.filter((r) => r.status === 'aktif' && daysUntil(r.tanggal_berakhir) !== null && daysUntil(r.tanggal_berakhir) >= 0 && daysUntil(r.tanggal_berakhir) <= 7).sort((a, b) => a.tanggal_berakhir.localeCompare(b.tanggal_berakhir));
    const recent = sortedNewest(data.rentals).slice(0, 5);
    const customerById = new Map(data.customers.map((c) => [c.id, c]));
    const accountById = new Map(data.accounts.map((a) => [a.id, a]));
    return `<div class="welcome-row"><div><h2>Selamat bekerja,</h2><p>Pantau operasional rental Anda dari satu tempat.</p></div><button class="button button-primary" data-action="new-rental">＋ Buat rental</button></div>
      <div class="stats-grid">
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Total akun</span><span class="stat-mark">▣</span></div><div class="stat-value">${data.accounts.length}</div><div class="stat-foot">akun dalam inventaris</div></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Tersedia / disewa</span><span class="stat-mark">◉</span></div><div class="stat-value">${available} <span style="font-size:13px;color:#9b9e9b">/ ${rented}</span></div><div class="stat-foot">siap digunakan / sedang berjalan</div></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Pelanggan</span><span class="stat-mark">♙</span></div><div class="stat-value">${data.customers.length}</div><div class="stat-foot">tersimpan secara lokal</div></article>
        <article class="stat-card"><div class="stat-top"><span class="stat-label">Omzet bulan ini</span><span class="stat-mark">↗</span></div><div class="stat-value" style="font-size:19px">${esc(money(monthTotal))}</div><div class="stat-foot">dari transaksi yang dimulai bulan ini</div></article>
      </div>
      <div class="quick-actions"><button class="quick-action" data-action="new-account"><span class="quick-action-icon">＋</span><span><strong>Tambah akun</strong><small>Perbarui inventaris</small></span></button><button class="quick-action" data-action="new-customer"><span class="quick-action-icon">♙</span><span><strong>Tambah pelanggan</strong><small>Catat pelanggan baru</small></span></button><button class="quick-action" data-action="backup-export"><span class="quick-action-icon">↓</span><span><strong>Cadangkan data</strong><small>Simpan salinan lokal</small></span></button></div>
      <div class="dashboard-grid"><article class="panel"><div class="panel-heading"><div><h3>Tren pendapatan</h3><p>Enam bulan terakhir · berdasarkan tanggal mulai rental</p></div><button class="panel-link" data-view="reports">Lihat laporan →</button></div><div class="chart-wrap">${data.rentals.length ? svgRevenueChart(data.rentals) : `<div class="empty-chart"><div><strong>Grafik akan muncul setelah transaksi pertama</strong>Data Anda tetap privat dan tersimpan di perangkat ini.</div></div>`}</div></article>
        <article class="panel"><div class="panel-heading"><div><h3>Segera berakhir</h3><p>Rental aktif dalam 7 hari ke depan</p></div><span class="status-tag warning">${endingSoon.length} akun</span></div><div class="alert-list">${endingSoon.length ? endingSoon.slice(0, 4).map((r) => { const c = customerById.get(r.customer_id), a = accountById.get(r.account_id); const n = daysUntil(r.tanggal_berakhir); return `<div class="alert-row"><div class="alert-date">${n === 0 ? 'HARI INI' : `H-${n}`}</div><div class="alert-copy"><strong>${esc(c?.nama || 'Pelanggan')}</strong><small>${esc(a?.nama_platform || 'Akun')} · ${dateText(r.tanggal_berakhir)}</small></div><button class="button button-soft" data-action="remind" data-id="${r.id}" title="Buka WhatsApp">WA</button></div>`; }).join('') : `<div class="empty-state"><div class="empty-icon">◷</div><strong>Belum ada yang mendekati akhir</strong>Pengingat WA dibuat manual dan memerlukan koneksi internet.</div>`}</div></article></div>
      <article class="panel"><div class="panel-heading"><div><h3>Rental terbaru</h3><p>Aktivitas transaksi terakhir</p></div><button class="panel-link" data-view="rentals">Lihat semua →</button></div>${recent.length ? `<div class="mini-list">${recent.map((r) => { const c = customerById.get(r.customer_id), a = accountById.get(r.account_id); return `<div class="mini-row"><div class="mini-avatar">${esc(initials(c?.nama || '?'))}</div><div class="mini-main"><strong>${esc(c?.nama || 'Pelanggan dihapus')}</strong><small>${esc(a?.nama_platform || 'Akun')} · ${dateText(r.tanggal_mulai)}</small></div><div class="mini-side">${esc(money(r.harga))}<small>${statusTag(rentalState(r))}</small></div></div>`; }).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">↗</div><strong>Belum ada transaksi</strong>Tambahkan akun dan pelanggan, lalu buat rental pertama Anda.</div>`}</article>`;
  }

  function accountsView(data) {
    const query = searchTerm.toLocaleLowerCase('id');
    const filtered = data.accounts.filter((a) => [a.kode_akun, a.nama_platform, a.username, a.paket].some((v) => String(v || '').toLocaleLowerCase('id').includes(query)));
    return `<div class="welcome-row"><div><h2>Inventaris akun</h2><p>Kelola akun Private dan slot Sharing dalam satu daftar.</p></div><button class="button button-primary" data-action="new-account">＋ Tambah akun</button></div><div class="page-toolbar"><label class="search-box"><span>⌕</span><input data-search="accounts" type="search" placeholder="Cari kode, platform, atau username…" value="${esc(searchTerm)}" /></label><div class="toolbar-actions"><button class="button button-line button-sm" data-action="csv-template">Unduh template CSV</button><button class="button button-soft button-sm" data-action="csv-import">↑ Impor CSV</button><input id="csv-file" class="hidden" type="file" accept=".csv,text/csv" /></div></div>
      ${filtered.length ? `<div class="accounts-grid">${filtered.map((a) => { const capacity = accountCapacity(a); const overlap = activeOverlapCount(data.rentals, a.id, today(), ymdOffset(today(), 1)); const state = accountState(a, data.rentals); return `<article class="account-card"><div class="account-card-top"><div class="platform-logo">${esc(initials(a.nama_platform))}</div><span class="account-code">${esc(a.kode_akun)}</span></div><h3>${esc(a.nama_platform)}${a.paket ? ` · ${esc(a.paket)}` : ''}</h3><div class="account-email">${esc(a.username)} <span aria-label="kredensial disembunyikan">· sandi tersimpan</span></div><div class="account-meta"><span class="type-tag ${a.tipe_akun === 'sharing' ? 'sharing' : ''}">${a.tipe_akun === 'sharing' ? 'Sharing' : 'Private'}</span><span class="capacity-note">${state === 'Maintenance' ? 'perlu pemeriksaan' : `${Math.max(0, capacity - overlap)} / ${capacity} slot tersedia`}</span>${statusTag(state)}</div><div class="account-card-actions" style="display:flex;gap:7px;margin-top:13px"><button class="button button-line button-sm" data-action="account-detail" data-id="${a.id}">Detail</button><button class="button button-soft button-sm" data-action="edit-account" data-id="${a.id}">Ubah</button></div></article>`; }).join('')}</div>` : `<div class="panel empty-state"><div class="empty-icon">▣</div><strong>${data.accounts.length ? 'Akun tidak ditemukan' : 'Inventaris masih kosong'}</strong>${data.accounts.length ? 'Coba kata pencarian lain.' : 'Tambahkan akun atau impor daftar akun dari CSV untuk memulai.'}${!data.accounts.length ? '<div style="margin-top:12px"><button class="button button-primary" data-action="new-account">＋ Tambah akun pertama</button></div>' : ''}</div>`}`;
  }

  function customersView(data) {
    const query = searchTerm.toLocaleLowerCase('id');
    const filtered = sortedNewest(data.customers).filter((c) => [c.nama, c.nomor_hp, c.catatan].some((v) => String(v || '').toLocaleLowerCase('id').includes(query)));
    return `<div class="welcome-row"><div><h2>Daftar pelanggan</h2><p>Catatan pelanggan disimpan hanya pada perangkat ini.</p></div><button class="button button-primary" data-action="new-customer">＋ Pelanggan baru</button></div><div class="page-toolbar"><label class="search-box"><span>⌕</span><input data-search="customers" type="search" placeholder="Cari nama atau nomor WhatsApp…" value="${esc(searchTerm)}" /></label><div class="toolbar-actions"><span class="status-tag available">${data.customers.length} tersimpan</span></div></div>${filtered.length ? `<div class="customer-grid">${filtered.map((c) => `<article class="customer-card"><div class="customer-avatar">${esc(initials(c.nama))}</div><div class="customer-main"><strong>${esc(c.nama)}</strong><small>${esc(c.nomor_hp || 'Nomor belum diisi')}</small></div><div class="customer-actions"><button class="tiny-icon" title="Ubah" data-action="edit-customer" data-id="${c.id}">✎</button><button class="tiny-icon" title="Hapus" data-action="delete-customer" data-id="${c.id}">×</button></div></article>`).join('')}</div>` : `<div class="panel empty-state"><div class="empty-icon">♙</div><strong>${data.customers.length ? 'Pelanggan tidak ditemukan' : 'Belum ada data pelanggan'}</strong>${data.customers.length ? 'Ubah kata pencarian Anda.' : 'Simpan data pelanggan sebelum membuat transaksi rental.'}<div style="margin-top:12px"><button class="button button-primary" data-action="new-customer">＋ Tambah pelanggan</button></div></div>`}`;
  }

  function rentalsView(data) {
    const query = searchTerm.toLocaleLowerCase('id');
    const customers = new Map(data.customers.map((c) => [c.id, c]));
    const accounts = new Map(data.accounts.map((a) => [a.id, a]));
    const filtered = sortedNewest(data.rentals, 'tanggal_mulai').filter((r) => [customers.get(r.customer_id)?.nama, accounts.get(r.account_id)?.nama_platform, r.tanggal_mulai, r.tanggal_berakhir].some((v) => String(v || '').toLocaleLowerCase('id').includes(query)));
    return `<div class="welcome-row"><div><h2>Semua rental</h2><p>Periode rental memakai aturan tanggal mulai inklusif dan tanggal berakhir eksklusif.</p></div><button class="button button-primary" data-action="new-rental">＋ Buat rental</button></div><div class="page-toolbar"><label class="search-box"><span>⌕</span><input data-search="rentals" type="search" placeholder="Cari pelanggan, akun, atau tanggal…" value="${esc(searchTerm)}" /></label><div class="toolbar-actions"><span class="status-tag active">${data.rentals.filter((r) => rentalState(r) === 'Aktif').length} aktif</span></div></div>${filtered.length ? `<div class="table-wrap"><table><thead><tr><th>PELANGGAN</th><th>AKUN</th><th>PERIODE</th><th>HARGA</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${filtered.map((r) => { const customer = customers.get(r.customer_id), account = accounts.get(r.account_id); return `<tr><td><div class="table-primary">${esc(customer?.nama || 'Pelanggan dihapus')}</div><div class="table-sub">${esc(customer?.nomor_hp || '—')}</div></td><td><div class="table-primary">${esc(account?.nama_platform || 'Akun dihapus')}</div><div class="table-sub">${esc(account?.kode_akun || '')}</div></td><td>${dateText(r.tanggal_mulai)}<div class="table-sub">s.d. ${dateText(r.tanggal_berakhir)} · ${r.durasi_hari === 36500 ? 'Lifetime' : `${r.durasi_hari} hari`}</div></td><td>${esc(money(r.harga))}${r.garansi_hari ? `<div class="table-sub">Garansi ${r.garansi_hari} hari</div>` : ''}</td><td>${statusTag(rentalState(r))}</td><td><div class="table-actions"><button class="button button-line button-sm" data-action="rental-detail" data-id="${r.id}">Detail</button><button class="button button-soft button-sm" data-action="renew-rental" data-id="${r.id}" title="Perpanjang">↻</button></div></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="panel empty-state"><div class="empty-icon">↗</div><strong>${data.rentals.length ? 'Transaksi tidak ditemukan' : 'Belum ada transaksi rental'}</strong>${data.rentals.length ? 'Coba pencarian yang berbeda.' : 'Rental baru akan otomatis memeriksa kapasitas akun pada periode tersebut.'}${!data.rentals.length && data.accounts.length && data.customers.length ? '<div style="margin-top:12px"><button class="button button-primary" data-action="new-rental">＋ Buat rental pertama</button></div>' : ''}</div>`}`;
  }

  function reportsView(data) {
    const month = reportMonth || today().slice(0, 7);
    const filtered = data.rentals.filter((r) => String(r.tanggal_mulai || '').startsWith(month) && r.status !== 'dibatalkan');
    const revenue = filtered.reduce((sum, r) => sum + (Number(r.harga) || 0), 0);
    const active = filtered.filter((r) => rentalState(r) === 'Aktif').length;
    const average = filtered.length ? revenue / filtered.length : 0;
    const customers = new Map(data.customers.map((c) => [c.id, c]));
    const accounts = new Map(data.accounts.map((a) => [a.id, a]));
    return `<div class="welcome-row"><div><h2>Laporan transaksi</h2><p>Ringkasan omzet dihitung dari tanggal mulai rental; transaksi batal tidak dihitung.</p></div><button class="button button-line" data-action="backup-export">↓ Ekspor cadangan</button></div><div class="page-toolbar"><div class="field" style="margin:0;width:190px"><label for="report-month" style="display:none">Pilih bulan</label><input class="field-input" id="report-month" type="month" value="${esc(month)}" /></div><span class="status-tag">${filtered.length} transaksi pada periode</span></div><div class="report-summary"><div class="report-tile"><small>Omzet bulan terpilih</small><strong>${esc(money(revenue))}</strong></div><div class="report-tile"><small>Jumlah transaksi</small><strong>${filtered.length}</strong></div><div class="report-tile"><small>Rata-rata transaksi</small><strong>${esc(money(average))}</strong></div></div><article class="panel"><div class="panel-heading"><div><h3>Rincian transaksi</h3><p>${active} rental masih berjalan pada periode terpilih</p></div></div>${filtered.length ? `<div class="table-wrap" style="border:0"><table><thead><tr><th>TANGGAL MULAI</th><th>PELANGGAN</th><th>AKUN</th><th>GARANSI</th><th>NILAI</th><th>STATUS</th></tr></thead><tbody>${sortedNewest(filtered, 'tanggal_mulai').map((r) => `<tr><td>${dateText(r.tanggal_mulai)}</td><td>${esc(customers.get(r.customer_id)?.nama || '—')}</td><td>${esc(accounts.get(r.account_id)?.nama_platform || '—')}</td><td>${r.garansi_hari ? `${r.garansi_hari} hari` : '—'}</td><td class="metric-accent">${esc(money(r.harga))}</td><td>${statusTag(rentalState(r))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state"><strong>Belum ada transaksi di bulan ini</strong>Pilih bulan lain atau catat rental baru.</div>`}</article><div class="preview-strip" style="margin-top:14px">Laporan menggunakan data yang saat ini ada di perangkat. Data dari perangkat lain tidak otomatis digabungkan.</div>`;
  }

  function settingsView(data) {
    const total = data.accounts.length + data.customers.length + data.rentals.length;
    return `<div class="welcome-row"><div><h2>Data Anda, kendali Anda</h2><p>Kelola penyimpanan offline dan salinan data dengan aman.</p></div></div><div class="settings-grid"><div><article class="settings-card"><h3>Cadangan dan pemulihan</h3><p>Ekspor seluruh akun, kredensial, pelanggan, serta riwayat rental sebagai satu file JSON. Impor cadangan akan menggantikan data pada perangkat ini.</p><div class="warning-note">File cadangan memuat kredensial akun dalam bentuk yang dapat dibaca. Simpan di lokasi aman dan jangan bagikan sembarangan.</div><div class="toolbar-actions"><button class="button button-primary" data-action="backup-export">↓ Unduh cadangan</button><button class="button button-line" data-action="backup-import">↑ Pulihkan cadangan</button><input id="backup-file" class="hidden" type="file" accept=".json,application/json" /></div></article><article class="settings-card"><h3>Impor inventaris CSV</h3><p>Tambahkan atau perbarui akun secara massal. Gunakan header: kode_akun, nama_platform, username, credential, paket, tipe_akun, kapasitas, status, catatan.</p><div class="toolbar-actions"><button class="button button-soft" data-action="csv-template">↓ Unduh template</button><button class="button button-line" data-action="csv-import">↑ Pilih file CSV</button><input id="csv-file" class="hidden" type="file" accept=".csv,text/csv" /></div></article></div><div><article class="settings-card"><h3>Status perangkat</h3><div class="settings-row"><div><strong>Penyimpanan</strong><small>IndexedDB lokal · perangkat ini</small></div><span class="settings-badge">Lokal</span></div><div class="settings-row"><div><strong>Total catatan</strong><small>${data.accounts.length} akun · ${data.customers.length} pelanggan · ${data.rentals.length} rental</small></div><strong>${total}</strong></div><div class="settings-row"><div><strong>Aset aplikasi</strong><small>Service worker untuk penggunaan offline</small></div><span class="settings-badge">Aktif</span></div><div class="settings-row"><div><strong>Sinkronisasi perangkat</strong><small>Tidak tersedia tanpa layanan daring</small></div><span class="status-tag warning">Manual</span></div>${deferredInstall ? '<div style="margin-top:14px"><button class="button button-gold button-block" data-action="install-pwa">＋ Pasang aplikasi ini</button></div>' : ''}</article><article class="settings-card"><h3>Integrasi</h3><p>Struk dan pengingat WhatsApp disusun pada perangkat ini. Membuka WhatsApp membutuhkan aplikasi atau koneksi internet. Otomatisasi Cron Job dan Fonnte adalah rencana lanjutan berbasis layanan online.</p><div class="settings-row"><div><strong>Struk & pengingat WhatsApp</strong><small>Tautan dibuka manual setelah ditinjau</small></div><span class="status-tag">Manual</span></div></article></div></div>`;
  }

  async function render() {
    try {
      const data = await loadData();
      const [eyebrow, title] = pageTitles[view] || pageTitles.dashboard;
      $('#page-eyebrow').textContent = eyebrow;
      $('#page-title').textContent = title;
      document.title = `Ronasentra — ${title}`;
      document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
      content.innerHTML = ({ dashboard: dashboardView, accounts: accountsView, rentals: rentalsView, customers: customersView, reports: reportsView, settings: settingsView }[view] || dashboardView)(data);
      const connection = $('#connection-pill');
      connection.classList.toggle('offline', !navigator.onLine);
      $('#connection-label').textContent = navigator.onLine ? 'Mode lokal' : 'Offline';
    } catch (error) {
      content.innerHTML = `<div class="panel empty-page"><div class="empty-icon">!</div><h2>Data lokal belum dapat dibuka</h2><p>${esc(error.message || 'Periksa dukungan penyimpanan browser dan muat ulang halaman.')}</p></div>`;
    }
  }

  function field(label, name, value = '', opts = {}) {
    const required = opts.required ? 'required' : '';
    const hint = opts.hint ? `<div class="field-hint">${esc(opts.hint)}</div>` : '';
    const cls = opts.full ? 'field full' : 'field';
    if (opts.select) return `<div class="${cls}"><label for="${esc(name)}">${esc(label)}${opts.required ? ' *' : ''}</label><select class="field-select" id="${esc(name)}" name="${esc(name)}" ${required}>${opts.select.map(([v, text]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>${hint}</div>`;
    const area = opts.textarea ? `<textarea class="field-textarea" id="${esc(name)}" name="${esc(name)}" maxlength="${opts.max || 2000}" ${required}>${esc(value)}</textarea>` : `<input class="field-input" id="${esc(name)}" name="${esc(name)}" type="${esc(opts.type || 'text')}" value="${esc(value)}" maxlength="${opts.max || 255}" ${opts.step ? `step="${esc(opts.step)}"` : ''} ${opts.min !== undefined ? `min="${esc(opts.min)}"` : ''} ${opts.maxValue !== undefined ? `max="${esc(opts.maxValue)}"` : ''} ${required} ${opts.autocomplete ? `autocomplete="${esc(opts.autocomplete)}"` : ''} />`;
    return `<div class="${cls}"><label for="${esc(name)}">${esc(label)}${opts.required ? ' *' : ''}</label>${area}${hint}</div>`;
  }
  const footerButtons = (submitText = 'Simpan') => `<div class="form-footer"><button type="button" class="button button-line" data-action="close-modal">Batal</button><button type="submit" class="button button-primary">${esc(submitText)}</button></div>`;

  async function openAccountForm(id = null) {
    const data = await loadData();
    const current = id ? data.accounts.find((a) => a.id === Number(id)) : null;
    if (id && !current) return showToast('Akun tidak ditemukan.', true);
    openModal(current ? 'Ubah akun' : 'Tambah akun', `<form id="account-form"><div class="field-grid">${field('Kode akun', 'kode_akun', current?.kode_akun || '', { required: true, max: 30 })}${field('Platform', 'nama_platform', current?.nama_platform || '', { required: true, max: 100 })}${field('Username / email', 'username', current?.username || '', { required: true, max: 150, autocomplete: 'username' })}${field('Credential / sandi', 'credential', '', { required: !current, type: 'password', hint: current ? 'Kosongkan untuk mempertahankan sandi tersimpan.' : 'Hanya ditampilkan pada detail akun dan struk.' })}${field('Paket', 'paket', current?.paket || '', { max: 100 })}${field('Tipe akun', 'tipe_akun', current?.tipe_akun || 'private', { select: [['private', 'Private · 1 pengguna'], ['sharing', 'Sharing · beberapa slot']] })}<div id="capacity-wrap" class="${current?.tipe_akun === 'sharing' ? '' : 'hidden'}">${field('Kapasitas slot', 'kapasitas', current?.kapasitas || 5, { type: 'number', min: 2, maxValue: 255, required: true, hint: 'Akun sharing minimal 2 slot, maksimal 255.' })}</div>${field('Status manual', 'status', current?.status || 'tersedia', { select: [['tersedia', 'Tersedia'], ['maintenance', 'Maintenance']] })}${field('Catatan', 'catatan', current?.catatan || '', { textarea: true, full: true, max: 2000 })}</div>${footerButtons(current ? 'Simpan perubahan' : 'Simpan akun')}</form>`);
    const form = $('#account-form');
    const typeSelect = form.elements.tipe_akun;
    typeSelect.addEventListener('change', () => { $('#capacity-wrap').classList.toggle('hidden', typeSelect.value !== 'sharing'); form.elements.kapasitas.value = typeSelect.value === 'private' ? '1' : (form.elements.kapasitas.value || '5'); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      values.kode_akun = values.kode_akun.trim(); values.nama_platform = values.nama_platform.trim(); values.username = values.username.trim();
      values.credential = values.credential || current?.credential || '';
      values.tipe_akun = values.tipe_akun === 'sharing' ? 'sharing' : 'private';
      values.kapasitas = values.tipe_akun === 'private' ? 1 : Number(values.kapasitas);
      if (!values.kode_akun || !values.nama_platform || !values.username || !values.credential) return showToast('Lengkapi kode, platform, username, dan credential.', true);
      if (values.tipe_akun === 'sharing' && (!Number.isInteger(values.kapasitas) || values.kapasitas < 2 || values.kapasitas > 255)) return showToast('Kapasitas sharing harus 2–255 slot.', true);
      if (data.accounts.some((a) => a.kode_akun.toLowerCase() === values.kode_akun.toLowerCase() && a.id !== current?.id)) return showToast('Kode akun sudah dipakai. Gunakan kode lain.', true);
      if (current && values.kapasitas < activeOverlapCount(data.rentals, current.id, today(), '9999-12-31')) return showToast('Kapasitas lebih kecil dari rental aktif yang sudah ada.', true);
      const record = { ...current, ...values, updatedAt: new Date().toISOString(), createdAt: current?.createdAt || new Date().toISOString() };
      try { await LocalDB.save('accounts', record); closeModal(); showToast(current ? 'Akun diperbarui.' : 'Akun tersimpan di perangkat ini.'); await render(); }
      catch (error) { showToast(error.message, true); }
    });
  }

  async function showAccountDetail(id) {
    const data = await loadData();
    const a = data.accounts.find((x) => x.id === Number(id));
    if (!a) return showToast('Akun tidak ditemukan.', true);
    const status = accountState(a, data.rentals);
    const hasRentalHistory = data.rentals.some((r) => r.account_id === a.id);
    openModal('Detail akun', `<div class="detail-list"><div class="detail-cell"><small>Platform</small><strong>${esc(a.nama_platform)}</strong></div><div class="detail-cell"><small>Kode akun</small><strong>${esc(a.kode_akun)}</strong></div><div class="detail-cell"><small>Tipe</small><strong>${a.tipe_akun === 'sharing' ? `Sharing · ${accountCapacity(a)} slot` : 'Private · 1 pengguna'}</strong></div><div class="detail-cell"><small>Status</small><strong>${statusTag(status)}</strong></div><div class="detail-cell"><small>Username</small><strong>${esc(a.username)}</strong></div><div class="detail-cell"><small>Paket</small><strong>${esc(a.paket || '—')}</strong></div><div class="detail-cell" style="grid-column:1/-1"><small>Credential</small><strong id="secret-value">••••••••••••</strong><button type="button" class="panel-link" data-action="toggle-secret" data-id="${a.id}" style="display:block;margin-top:7px">Tampilkan sandi</button></div>${a.catatan ? `<div class="detail-cell" style="grid-column:1/-1"><small>Catatan</small><strong>${esc(a.catatan)}</strong></div>` : ''}</div><div class="warning-note" style="margin-top:13px">Credential disimpan lokal di browser ini. Lindungi perangkat dan file cadangan Anda.</div><div class="form-footer"><button class="button button-line" data-action="close-modal">Tutup</button><button class="button button-soft" data-action="edit-account" data-id="${a.id}">Ubah akun</button>${hasRentalHistory ? '' : `<button class="button button-danger" data-action="delete-account" data-id="${a.id}">Hapus akun</button>`}</div>`);
  }

  async function openCustomerForm(id = null) {
    const data = await loadData();
    const current = id ? data.customers.find((c) => c.id === Number(id)) : null;
    if (id && !current) return showToast('Pelanggan tidak ditemukan.', true);
    openModal(current ? 'Ubah pelanggan' : 'Pelanggan baru', `<form id="customer-form"><div class="field-grid">${field('Nama pelanggan', 'nama', current?.nama || '', { required: true, max: 100 })}${field('Nomor WhatsApp', 'nomor_hp', current?.nomor_hp || '', { max: 20, hint: 'Gunakan kode negara agar tautan WhatsApp lebih akurat.' })}${field('Catatan', 'catatan', current?.catatan || '', { textarea: true, full: true, max: 2000 })}</div>${footerButtons(current ? 'Simpan perubahan' : 'Simpan pelanggan')}</form>`);
    $('#customer-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      values.nama = values.nama.trim(); values.nomor_hp = values.nomor_hp.trim();
      if (!values.nama) return showToast('Nama pelanggan wajib diisi.', true);
      try { await LocalDB.save('customers', { ...current, ...values, createdAt: current?.createdAt || new Date().toISOString() }); closeModal(); showToast(current ? 'Data pelanggan diperbarui.' : 'Pelanggan tersimpan.'); await render(); }
      catch (error) { showToast(error.message, true); }
    });
  }

  async function openRentalForm(renewFrom = null) {
    const data = await loadData();
    if (!data.accounts.length) return showToast('Tambahkan akun sebelum membuat rental.', true);
    if (!data.customers.length) return showToast('Tambahkan pelanggan sebelum membuat rental.', true);
    const old = renewFrom ? data.rentals.find((r) => r.id === Number(renewFrom)) : null;
    const start = old ? old.tanggal_berakhir : today();
    const currentDuration = old?.durasi_hari || 30;
    const preset = [7, 30, 90, 365, 36500].includes(currentDuration) ? String(currentDuration) : 'custom';
    const accountOpts = data.accounts.map((a) => [`${a.id}`, `${a.nama_platform} · ${a.kode_akun} · ${a.tipe_akun === 'sharing' ? `Sharing ${accountCapacity(a)} slot` : 'Private'}${a.status === 'maintenance' ? ' · Maintenance' : ''}`]);
    const customerOpts = data.customers.map((c) => [`${c.id}`, `${c.nama}${c.nomor_hp ? ` · ${c.nomor_hp}` : ''}`]);
    openModal(old ? 'Perpanjang rental' : 'Rental baru', `<form id="rental-form"><div class="preview-strip">${old ? `Perpanjangan dimulai otomatis pada ${dateText(old.tanggal_berakhir)}, tanggal akhir rental sebelumnya.` : 'Tanggal berakhir dihitung otomatis. Kapasitas akun diperiksa untuk periode rental yang dipilih.'}</div><div class="field-grid">${field('Akun digital', 'account_id', old ? old.account_id : '', { select: accountOpts, required: true, full: true })}${field('Pelanggan', 'customer_id', old ? old.customer_id : '', { select: customerOpts, required: true, full: true })}${field('Tanggal mulai', 'tanggal_mulai', start, { type: 'date', required: true })}${field('Durasi', 'duration_choice', preset, { select: [['7','7 hari'],['30','30 hari'],['90','90 hari'],['365','1 tahun (365 hari)'],['36500','Lifetime (36.500 hari)'],['custom','Durasi khusus']], required: true })}<div id="custom-duration-wrap" class="${preset === 'custom' ? '' : 'hidden'}">${field('Durasi khusus (hari)', 'durasi_hari', currentDuration, { type: 'number', min: 1, maxValue: 65535, required: true })}</div>${field('Masa garansi (hari)', 'garansi_hari', old?.garansi_hari || 0, { type: 'number', min: 0, maxValue: 65535, hint: 'Isi 0 jika tanpa garansi.' })}${field('Harga rental (Rp)', 'harga', old?.harga || '', { type: 'number', min: 0, step: '1000', required: true })}${field('Catatan', 'catatan', '', { textarea: true, full: true, max: 2000 })}</div><div id="rental-preview" class="preview-strip"></div>${footerButtons(old ? 'Simpan perpanjangan' : 'Simpan rental')}</form>`);
    const form = $('#rental-form');
    const choice = form.elements.duration_choice;
    const customWrap = $('#custom-duration-wrap');
    const durationInput = form.elements.durasi_hari;
    const updatePreview = () => {
      const duration = choice.value === 'custom' ? Number(durationInput.value) : Number(choice.value);
      if (choice.value !== 'custom') durationInput.value = choice.value;
      customWrap.classList.toggle('hidden', choice.value !== 'custom');
      const end = form.elements.tanggal_mulai.value && duration > 0 ? ymdOffset(form.elements.tanggal_mulai.value, duration) : '';
      const warrantyDays = Number(form.elements.garansi_hari.value) || 0;
      const warrantyEnd = warrantyDays > 0 ? ymdOffset(form.elements.tanggal_mulai.value, warrantyDays) : '';
      $('#rental-preview').innerHTML = end ? `<strong>Perkiraan akhir:</strong> ${dateText(end)} (${duration === 36500 ? 'Lifetime · 36.500 hari' : `${duration} hari`})${warrantyEnd ? `<br><strong>Batas garansi:</strong> ${dateText(warrantyEnd)}` : ''}` : 'Masukkan tanggal mulai dan durasi yang valid.';
    };
    form.addEventListener('change', updatePreview); form.addEventListener('input', updatePreview); updatePreview();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const account = data.accounts.find((a) => a.id === Number(form.elements.account_id.value));
      const customer = data.customers.find((c) => c.id === Number(form.elements.customer_id.value));
      const startDate = form.elements.tanggal_mulai.value;
      const duration = choice.value === 'custom' ? Number(durationInput.value) : Number(choice.value);
      const guarantee = Number(form.elements.garansi_hari.value || 0);
      const price = Number(form.elements.harga.value);
      if (!account || !customer || !dateFromYmd(startDate) || !Number.isInteger(duration) || duration < 1 || duration > 65535 || !Number.isInteger(guarantee) || guarantee < 0 || guarantee > 65535 || !Number.isFinite(price) || price < 0) return showToast('Periksa kembali semua kolom rental.', true);
      if (account.status === 'maintenance') return showToast('Akun sedang Maintenance dan tidak dapat disewakan.', true);
      const endDate = ymdOffset(startDate, duration);
      if (!endDate) return showToast('Tanggal akhir tidak valid.', true);
      const overlapping = activeOverlapCount(data.rentals, account.id, startDate, endDate);
      if (overlapping >= accountCapacity(account)) return showToast(`Kapasitas tidak cukup: ${overlapping}/${accountCapacity(account)} slot sedang terpakai pada periode ini.`, true);
      const values = Object.fromEntries(new FormData(form).entries());
      const record = { account_id: account.id, customer_id: customer.id, tanggal_mulai: startDate, durasi_hari: duration, tanggal_berakhir: endDate, garansi_hari: guarantee, batas_garansi: guarantee ? ymdOffset(startDate, guarantee) : null, harga: price, status: 'aktif', catatan: values.catatan.trim(), previousRentalId: old?.id || null, createdAt: new Date().toISOString() };
      try { await LocalDB.save('rentals', record); closeModal(); showToast(old ? 'Perpanjangan tersimpan.' : 'Rental tersimpan.'); await render(); }
      catch (error) { showToast(error.message, true); }
    });
  }

  async function showRentalDetail(id) {
    const data = await loadData();
    const r = data.rentals.find((x) => x.id === Number(id));
    if (!r) return showToast('Rental tidak ditemukan.', true);
    const customer = data.customers.find((c) => c.id === r.customer_id), account = data.accounts.find((a) => a.id === r.account_id);
    const status = rentalState(r);
    openModal('Detail rental', `<div class="detail-list"><div class="detail-cell"><small>Pelanggan</small><strong>${esc(customer?.nama || 'Data tidak tersedia')}</strong></div><div class="detail-cell"><small>Nomor WhatsApp</small><strong>${esc(customer?.nomor_hp || '—')}</strong></div><div class="detail-cell"><small>Akun / platform</small><strong>${esc(account?.nama_platform || 'Data tidak tersedia')} · ${esc(account?.kode_akun || '')}</strong></div><div class="detail-cell"><small>Status</small><strong>${statusTag(status)}</strong></div><div class="detail-cell"><small>Tanggal mulai</small><strong>${dateText(r.tanggal_mulai)}</strong></div><div class="detail-cell"><small>Tanggal berakhir</small><strong>${dateText(r.tanggal_berakhir)}</strong></div><div class="detail-cell"><small>Durasi & harga</small><strong>${r.durasi_hari === 36500 ? 'Lifetime' : `${r.durasi_hari} hari`} · ${esc(money(r.harga))}</strong></div><div class="detail-cell"><small>Masa garansi</small><strong>${r.garansi_hari ? `${r.garansi_hari} hari · s.d. ${dateText(r.batas_garansi)}` : 'Tidak ada'}</strong></div>${r.catatan ? `<div class="detail-cell" style="grid-column:1/-1"><small>Catatan</small><strong>${esc(r.catatan)}</strong></div>` : ''}</div><div class="form-footer" style="flex-wrap:wrap"><button class="button button-line" data-action="close-modal">Tutup</button><button class="button button-soft" data-action="receipt" data-id="${r.id}">Lihat struk</button>${r.status === 'aktif' ? `<button class="button button-line" data-action="renew-rental" data-id="${r.id}">↻ Perpanjang</button><button class="button button-danger" data-action="finish-rental" data-id="${r.id}">Tandai selesai</button>` : ''}</div>`);
  }

  async function showReceipt(id) {
    const data = await loadData();
    const r = data.rentals.find((x) => x.id === Number(id));
    if (!r) return showToast('Rental tidak ditemukan.', true);
    const customer = data.customers.find((c) => c.id === r.customer_id), account = data.accounts.find((a) => a.id === r.account_id);
    const receipt = [
      'RONASENTRA · STRUK RENTAL', '────────────────────',
      `Pelanggan: ${customer?.nama || '—'}`, `Platform: ${account?.nama_platform || '—'}${account?.paket ? ` · ${account.paket}` : ''}`,
      `Username: ${account?.username || '—'}`, `Password: ${account?.credential || '—'}`,
      `Periode: ${dateText(r.tanggal_mulai)} s.d. ${dateText(r.tanggal_berakhir)}`,
      `Durasi: ${r.durasi_hari === 36500 ? 'Lifetime (36.500 hari)' : `${r.durasi_hari} hari`}`,
      `Garansi: ${r.garansi_hari ? `${r.garansi_hari} hari${r.batas_garansi ? ` (s.d. ${dateText(r.batas_garansi)})` : ''}` : 'Tidak ada'}`,
      `Total: ${money(r.harga)}`, '────────────────────', 'Terima kasih telah menggunakan layanan Ronasentra.'
    ].join('\n');
    openModal('Struk transaksi', `<div class="warning-note">Struk berisi credential akun. Tinjau penerima dan isi pesan sebelum mengirim. Membuka WhatsApp memerlukan koneksi internet.</div><div class="receipt-preview" id="receipt-text">${esc(receipt)}</div><div class="form-footer" style="flex-wrap:wrap"><button class="button button-line" data-action="close-modal">Tutup</button><button class="button button-soft" data-action="copy-receipt">Salin struk</button>${customer?.nomor_hp ? `<button class="button button-primary" data-action="send-receipt" data-id="${r.id}">Buka WhatsApp</button>` : ''}<button class="button button-line" data-action="share-receipt">Bagikan</button></div>`);
  }

  async function confirmAction(title, message, actionLabel, callback, dangerous = false) {
    openModal(title, `<p style="font-size:11px;line-height:1.7;color:#687277">${esc(message)}</p><div class="form-footer"><button class="button button-line" data-action="close-modal">Batal</button><button class="button ${dangerous ? 'button-danger' : 'button-primary'}" id="confirm-action">${esc(actionLabel)}</button></div>`);
    $('#confirm-action').addEventListener('click', async () => { closeModal(); await callback(); });
  }

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i++) {
      const ch = input[i], next = input[i + 1];
      if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) { if (ch === '\r' && next === '\n') i++; row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map((v) => v.trim().toLocaleLowerCase('id'));
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
  }
  const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  function download(name, type, content) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBackup() {
    try {
      const data = await loadData();
      const snapshot = { format: 'ronasentra-backup', version: 1, exportedAt: new Date().toISOString(), data };
      download(`ronasentra-cadangan-${today()}.json`, 'application/json;charset=utf-8', JSON.stringify(snapshot, null, 2));
      showToast('Cadangan tersimpan. Simpan file secara aman.');
    } catch (error) { showToast(error.message, true); }
  }
  function validSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== 'ronasentra-backup' || snapshot.version !== 1 || !snapshot.data) return 'Format cadangan tidak valid.';
    const { accounts, customers, rentals } = snapshot.data;
    if (!Array.isArray(accounts) || !Array.isArray(customers) || !Array.isArray(rentals)) return 'Struktur data cadangan tidak lengkap.';
    const accountIds = new Set(accounts.map((a) => Number(a.id)));
    const customerIds = new Set(customers.map((c) => Number(c.id)));
    for (const r of rentals) if (!accountIds.has(Number(r.account_id)) || !customerIds.has(Number(r.customer_id))) return 'Ada rental yang tidak terhubung dengan akun dan pelanggan pada cadangan.';
    return '';
  }

  async function processCsv(file) {
    try {
      const records = parseCsv(await file.text());
      const required = ['kode_akun', 'nama_platform', 'username', 'credential'];
      if (!records.length || required.some((h) => !(h in records[0]))) return showToast('Header wajib: kode_akun, nama_platform, username, credential.', true);
      const data = await loadData(); let added = 0, updated = 0, skipped = 0;
      for (const row of records) {
        if (!row.kode_akun || !row.nama_platform || !row.username || !row.credential) { skipped++; continue; }
        const type = row.tipe_akun?.toLowerCase() === 'sharing' ? 'sharing' : 'private';
        const capacity = type === 'sharing' ? Number(row.kapasitas) : 1;
        if (type === 'sharing' && (!Number.isInteger(capacity) || capacity < 2 || capacity > 255)) { skipped++; continue; }
        const match = data.accounts.find((a) => a.kode_akun.toLowerCase() === row.kode_akun.toLowerCase());
        const current = match ? { ...match } : {};
        const record = { ...current, kode_akun: row.kode_akun, nama_platform: row.nama_platform, username: row.username, credential: row.credential, paket: row.paket || '', tipe_akun: type, kapasitas: capacity, status: row.status?.toLowerCase() === 'maintenance' ? 'maintenance' : 'tersedia', catatan: row.catatan || '', createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
        try { await LocalDB.save('accounts', record); match ? updated++ : added++; }
        catch { skipped++; }
      }
      showToast(`CSV selesai · ${added} akun baru, ${updated} diperbarui, ${skipped} dilewati.`); await render();
    } catch (error) { showToast(`Tidak dapat membaca CSV: ${error.message}`, true); }
  }

  async function doAction(action, id) {
    const numericId = Number(id);
    switch (action) {
      case 'new-account': return openAccountForm();
      case 'edit-account': closeModal(); return openAccountForm(numericId);
      case 'account-detail': return showAccountDetail(numericId);
      case 'new-customer': return openCustomerForm();
      case 'edit-customer': return openCustomerForm(numericId);
      case 'new-rental': return openRentalForm();
      case 'renew-rental': closeModal(); return openRentalForm(numericId);
      case 'rental-detail': return showRentalDetail(numericId);
      case 'receipt': return showReceipt(numericId);
      case 'close-modal': return closeModal();
      case 'go-settings': return go('settings');
      case 'dismiss-notice': $('#storage-notice').classList.add('hidden'); return;
      case 'backup-export': return exportBackup();
      case 'backup-import': $('#backup-file').click(); return;
      case 'csv-import': $('#csv-file').click(); return;
      case 'toggle-secret': {
        const data = await LocalDB.all('accounts'); const account = data.find((a) => a.id === numericId); const out = $('#secret-value');
        if (account && out) { const reveal = out.dataset.revealed !== 'true'; out.textContent = reveal ? account.credential : '••••••••••••'; out.dataset.revealed = String(reveal); const button = out.nextElementSibling; if (button) button.textContent = reveal ? 'Sembunyikan sandi' : 'Tampilkan sandi'; }
        return;
      }
      case 'delete-customer': {
        const data = await loadData(); if (isRelated(data, 'customers', numericId)) return showToast('Pelanggan memiliki riwayat rental. Data dipertahankan agar riwayat tetap utuh.', true);
        return confirmAction('Hapus pelanggan?', 'Data pelanggan ini akan dihapus dari penyimpanan lokal.', 'Hapus', async () => { await LocalDB.remove('customers', numericId); showToast('Pelanggan dihapus.'); await render(); }, true);
      }
      case 'delete-account': {
        const data = await loadData(); if (isRelated(data, 'accounts', numericId)) return showToast('Akun memiliki riwayat rental. Data dipertahankan agar riwayat tetap utuh.', true);
        return confirmAction('Hapus akun?', 'Akun ini akan dihapus dari penyimpanan lokal.', 'Hapus', async () => { await LocalDB.remove('accounts', numericId); showToast('Akun dihapus.'); await render(); }, true);
      }
      case 'finish-rental': return confirmAction('Tandai rental selesai?', 'Status rental akan berubah menjadi selesai. Catatan riwayat tetap disimpan.', 'Tandai selesai', async () => { const data = await LocalDB.all('rentals'); const item = data.find((r) => r.id === numericId); if (item) await LocalDB.save('rentals', { ...item, status: 'selesai' }); showToast('Rental ditandai selesai.'); await render(); });
      case 'cancel-rental': return confirmAction('Batalkan rental?', 'Transaksi tetap tersimpan pada riwayat dengan status Dibatalkan.', 'Batalkan rental', async () => { const data = await LocalDB.all('rentals'); const item = data.find((r) => r.id === numericId); if (item) await LocalDB.save('rentals', { ...item, status: 'dibatalkan' }); showToast('Rental dibatalkan.'); await render(); }, true);
      case 'copy-receipt': {
        const text = $('#receipt-text')?.textContent || '';
        try { await navigator.clipboard.writeText(text); showToast('Struk disalin ke clipboard.'); }
        catch { showToast('Clipboard tidak tersedia. Pilih dan salin teks struk secara manual.', true); }
        return;
      }
      case 'send-receipt': {
        const data = await loadData(); const r = data.rentals.find((x) => x.id === numericId); const c = data.customers.find((x) => x.id === r?.customer_id);
        const message = $('#receipt-text')?.textContent || '';
        if (!c?.nomor_hp) return showToast('Nomor WhatsApp pelanggan belum diisi.', true);
        window.open(`https://wa.me/${c.nomor_hp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer'); return;
      }
      case 'share-receipt': {
        const text = $('#receipt-text')?.textContent || '';
        if (navigator.share) { try { await navigator.share({ title: 'Struk rental Ronasentra', text }); } catch (error) { if (error.name !== 'AbortError') showToast('Tidak dapat membuka menu bagikan.', true); } }
        else { try { await navigator.clipboard.writeText(text); showToast('Menu bagikan tidak tersedia; struk disalin.'); } catch { showToast('Fitur berbagi tidak tersedia pada browser ini.', true); } }
        return;
      }
      case 'remind': {
        const data = await loadData(); const r = data.rentals.find((x) => x.id === numericId); const c = data.customers.find((x) => x.id === r?.customer_id); const a = data.accounts.find((x) => x.id === r?.account_id);
        if (!c?.nomor_hp) return showToast('Nomor WhatsApp pelanggan belum diisi.', true);
        const message = `Halo ${c.nama}, masa sewa ${a?.nama_platform || 'akun Anda'} akan berakhir pada ${dateText(r.tanggal_berakhir)}. Ingin memperpanjang? Balas pesan ini untuk informasi paket. Terima kasih, Ronasentra.`;
        window.open(`https://wa.me/${c.nomor_hp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer'); return;
      }
      case 'csv-template': {
        const headers = ['kode_akun','nama_platform','username','credential','paket','tipe_akun','kapasitas','status','catatan'];
        download('template-akun-ronasentra.csv', 'text/csv;charset=utf-8', `\uFEFF${headers.join(',')}\r\n${['RN-001','Netflix','email@example.com','ganti-sandi','Premium','private','1','tersedia',''].map(csvEscape).join(',')}\r\n`); return;
      }
      case 'install-pwa': {
        if (deferredInstall) { deferredInstall.prompt(); const outcome = await deferredInstall.userChoice; if (outcome?.outcome === 'accepted') showToast('Aplikasi ditambahkan ke perangkat.'); deferredInstall = null; await render(); }
        return;
      }
      default: return;
    }
  }

  document.body.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { event.preventDefault(); return go(viewButton.dataset.view); }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) { event.preventDefault(); return doAction(actionButton.dataset.action, actionButton.dataset.id); }
  });
  document.body.addEventListener('input', async (event) => {
    if (event.target.matches('[data-search]')) {
      searchTerm = event.target.value;
      const selection = event.target.selectionStart;
      await render();
      const next = $('[data-search]'); if (next) { next.focus(); if (selection !== null) next.setSelectionRange(selection, selection); }
    }
  });
  document.body.addEventListener('change', async (event) => {
    if (event.target.id === 'report-month') { reportMonth = event.target.value; await render(); }
    if (event.target.id === 'csv-file' && event.target.files?.[0]) await processCsv(event.target.files[0]);
    if (event.target.id === 'backup-file' && event.target.files?.[0]) {
      const file = event.target.files[0];
      try {
        const snapshot = JSON.parse(await file.text()); const error = validSnapshot(snapshot);
        if (error) return showToast(error, true);
        await confirmAction('Pulihkan cadangan?', 'Semua data akun, pelanggan, kredensial, dan rental pada perangkat ini akan diganti dengan isi file cadangan. Tindakan ini tidak dapat dibatalkan.', 'Ganti dan pulihkan', async () => {
          try { await LocalDB.replaceAll(snapshot); showToast('Cadangan berhasil dipulihkan.'); await render(); }
          catch (restoreError) { showToast(restoreError.message, true); }
        }, true);
      } catch { showToast('File cadangan tidak dapat dibaca.', true); }
      event.target.value = '';
    }
  });
  $('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  window.addEventListener('online', render); window.addEventListener('offline', render);
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstall = event; if (view === 'settings') render(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; showToast('Ronasentra berhasil dipasang.'); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => showToast('Cache offline belum aktif. Buka aplikasi kembali saat terhubung internet.', true)));
  }
  render();
})();
    openModal('Detail rental', `<div class="detail-list"><div class="detail-cell"><small>Pelanggan</small><strong>${esc(customer?.nama || 'Data tidak tersedia')}</strong></div><div class="detail-cell"><small>Nomor WhatsApp</small><strong>${esc(customer?.nomor_hp || '—')}</strong></div><div class="detail-cell"><small>Akun / platform</small><strong>${esc(account?.nama_platform || 'Data tidak tersedia')} · ${esc(account?.kode_akun || '')}</strong></div><div class="detail-cell"><small>Status</small><strong>${statusTag(status)}</strong></div><div class="detail-cell"><small>Tanggal mulai</small><strong>${dateText(r.tanggal_mulai)}</strong></div><div class="detail-cell"><small>Tanggal berakhir</small><strong>${dateText(r.tanggal_berakhir)}</strong></div><div class="detail-cell"><small>Durasi & harga</small><strong>${r.durasi_hari === 36500 ? 'Lifetime' : `${r.durasi_hari} hari`} · ${esc(money(r.harga))}</strong></div><div class="detail-cell"><small>Masa garansi</small><strong>${r.garansi_hari ? `${r.garansi_hari} hari · s.d. ${dateText(r.batas_garansi)}` : 'Tidak ada'}</strong></div>${r.catatan ? `<div class="detail-cell" style="grid-column:1/-1"><small>Catatan</small><strong>${esc(r.catatan)}</strong></div>` : ''}</div><div class="form-footer" style="flex-wrap:wrap"><button class="button button-line" data-action="close-modal">Tutup</button><button class="button button-soft" data-action="receipt" data-id="${r.id}">Lihat struk</button>${r.status === 'aktif' ? `<button class="button button-line" data-action="renew-rental" data-id="${r.id}">↻ Perpanjang</button><button class="button button-danger" data-action="finish-rental" data-id="${r.id}">Tandai selesai</button><button class="button button-line" data-action="cancel-rental" data-id="${r.id}">Batalkan</button>` : ''}</div>`);
