/**
 * APP MODULE — Main controller for TankLog
 */

const App = (() => {

  // ── State ────────────────────────────────────────────────────
  let _vehicles = [];
  let _currentVehicleId = null;
  let _currentView = 'home';
  let _currentListTab = 'fuel';
  let _analysePeriod = 'all';
  let _charts = {};
  let _settings = {};
  let _session = null;
  let _pendingFuelListFocusId = null;

  // State for edit forms
  let _editFuelId = null;
  let _editMaintId = null;
  let _editCostId = null;

  // ── Init ─────────────────────────────────────────────────────

  async function init() {
    API.onUnauthorized(() => {
      _session = null;
      _showAuthScreen('Sitzung abgelaufen. Bitte erneut anmelden.');
    });

    _session = API.session() || await API.restoreSession();
    if (!_session) {
      _showAuthScreen();
      return;
    }

    _showAppShell();
    _renderBuildInfo();

    // Load settings
    _settings = await DB.getSettings();

    // Load vehicles
    await refreshVehicles();

    // Restore last selected vehicle
    const saved = localStorage.getItem('tanklog_vehicle');
    if (saved && _vehicles.find(v => v._id === saved)) {
      _currentVehicleId = saved;
    } else if (_vehicles.length > 0) {
      _currentVehicleId = _vehicles[0]._id;
    }
    updateVehicleSelect();

    // Init fuel form date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tf-date').value = today;

    // Populate dropdowns
    _populateFuelTypeDropdown('vf-fueltype');
    _populateCostCategoryDropdown('cf-category');
    _renderGarageBadge();
    _setServerModeStatus();

    // Settings form
    document.getElementById('set-warn-consumption').value = _settings.warnConsumption || 25;
    document.getElementById('set-remind-days').value = _settings.remindDays || 14;

    // Render initial view
    await refreshCurrentView();
  }

  function _showAuthScreen(message = 'Melde dich an, um die Garage zu laden.') {
    const authEl = document.getElementById('auth-screen');
    const appEl = document.getElementById('app');
    const msgEl = document.getElementById('auth-error');
    const subEl = document.getElementById('auth-subtitle');
    if (authEl) authEl.style.display = 'flex';
    if (appEl) appEl.style.display = 'none';
    if (subEl) subEl.textContent = message;
    if (msgEl) {
      msgEl.style.display = 'none';
      msgEl.textContent = '';
    }
  }

  function _showAppShell() {
    const authEl = document.getElementById('auth-screen');
    const appEl = document.getElementById('app');
    if (authEl) authEl.style.display = 'none';
    if (appEl) appEl.style.display = 'flex';
  }

  function _renderGarageBadge() {
    // Garage name not shown in header — it's displayed in the sync bar
  }

  function _setServerModeStatus() {
    const bar = document.getElementById('sync-bar');
    const label = document.getElementById('sync-label');
    const dot = document.getElementById('sync-dot');
    const buildShort = window.__BUILD_META__?.short;
    const suffix = buildShort ? ` (Build ${buildShort})` : '';
    if (bar) bar.className = 'sync-bar sync-online';
    if (label) label.textContent = (_session?.garage?.name || 'Online') + suffix;
    if (dot) dot.style.background = 'currentColor';
  }

  function _renderBuildInfo() {
    const el = document.getElementById('build-info');
    if (!el) return;

    const assets = [];
    document.querySelectorAll('link[rel="stylesheet"][href], script[src]').forEach((node) => {
      const src = node.getAttribute('href') || node.getAttribute('src');
      if (!src) return;
      let url;
      try { url = new URL(src, location.href); } catch (_) { return; }
      const path = (url.pathname || '').split('/').pop();
      if (!path) return;
      if (!/^(style\.css|api\.js|db\.js|calc\.js|vehicles\.js|ocr\.js|app\.js)$/i.test(path)) return;
      assets.push({ path, v: url.searchParams.get('v') || '-' });
    });

    assets.sort((a, b) => a.path.localeCompare(b.path));
    const loadedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
    const lines = assets.map(a => `${a.path} v=${a.v}`);
    const bm = window.__BUILD_META__;
    const buildLine = bm
      ? `Build: ${bm.full}  (short: ${bm.short})\nSource: ${bm.source}\nSource-Date: ${bm.date}`
      : 'Build: n/a';
    el.textContent = `${buildLine}\nLoaded: ${loadedAt}\n${lines.join('\n')}`;
  }

  // ── Vehicle management ───────────────────────────────────────

  async function refreshVehicles() {
    _vehicles = await DB.getVehicles();
  }

  function updateVehicleSelect() {
    const sel = document.getElementById('vehicle-select');
    sel.innerHTML = _vehicles.length === 0
      ? '<option value="">— Keine Fahrzeuge —</option>'
      : _vehicles.map(v =>
          `<option value="${v._id}" ${v._id === _currentVehicleId ? 'selected' : ''}>${v.name}</option>`
        ).join('');
    _renderHeaderPlate();
  }

  function selectVehicle(id) {
    _currentVehicleId = id;
    localStorage.setItem('tanklog_vehicle', id);
    _renderHeaderPlate();
    refreshCurrentView();
  }

  function currentVehicle() {
    return _vehicles.find(v => v._id === _currentVehicleId) || null;
  }

  function _renderHeaderPlate() {
    const el = document.getElementById('vehicle-select-plate');
    if (!el) return;
    const vehicle = currentVehicle();
    if (!vehicle) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    el.innerHTML = _renderMiniPlate(vehicle.plate);
    el.style.display = '';
  }

  // ── Navigation ───────────────────────────────────────────────

  async function go(view) {
    if (_currentView === view) {
      // Scroll to top on double tap
      document.getElementById('view-' + view)?.querySelector('.view-scroll')?.scrollTo(0, 0);
      return;
    }
    document.querySelector('.view.active')?.classList.remove('active');
    document.getElementById('view-' + view)?.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('nb-' + view)?.classList.add('active');

    _currentView = view;
    await refreshCurrentView();
  }

  async function refreshCurrentView() {
    switch (_currentView) {
      case 'home':    await renderHome(); break;
      case 'list':    await renderList(); break;
      case 'analyse': await renderAnalyse(); break;
      case 'sync':    /* static */ break;
      case 'tank':    /* form — no re-render */ break;
    }
  }

  // ── HOME VIEW ───────────────────────────────────────────────

  async function renderHome() {
    const noVehicleEl = document.getElementById('home-no-vehicle');
    const contentEl = document.getElementById('home-content');

    if (!_currentVehicleId || _vehicles.length === 0) {
      noVehicleEl.style.display = 'flex';
      contentEl.style.display = 'none';
      return;
    }
    noVehicleEl.style.display = 'none';
    contentEl.style.display = 'block';

    const entries = await DB.getFuelEntries(_currentVehicleId);
    const enriched = Calc.enrichFuel(entries);
    const summary = Calc.summary(enriched);
    const sumLast30 = Calc.summary(enriched, 30);

    // Stats grid
    const statsEl = document.getElementById('home-stats');
    statsEl.innerHTML = [
      _statCard('Ø Verbrauch', Calc.fmtNum(summary.avgCons), 'L/100km', true),
      _statCard('Ø €/Liter', Calc.fmtNum(summary.avgPpl, 3), '€/L'),
      _statCard('Gesamtkosten', Calc.fmtNum(summary.totalCost, 2), '€ gesamt'),
      _statCard('Kosten/100km', Calc.fmtNum(summary.avgCostPer100, 2), '€/100km'),
    ].join('');

    // Last fuel
    const lastEl = document.getElementById('home-last-fuel');
    const last = enriched[enriched.length - 1];
    if (last) {
      const warn = last.consumption && last.consumption > (_settings.warnConsumption || 25);
      const lastKm = _formatOdometerLabel(last, false);
      lastEl.innerHTML = `
        <div class="last-fuel-date">${Calc.fmtDate(last.date)} · ${lastKm || '—'}</div>
        <div class="last-fuel-grid">
          <div class="last-fuel-item">
            <div class="last-fuel-val">${Calc.fmtNum(last.totalCost, 2)}</div>
            <div class="last-fuel-lbl">€ gesamt</div>
          </div>
          <div class="last-fuel-item">
            <div class="last-fuel-val">${Calc.fmtNum(last.liters, 2)}</div>
            <div class="last-fuel-lbl">Liter</div>
          </div>
          <div class="last-fuel-item">
            <div class="last-fuel-val" style="${warn ? 'color:var(--orange)' : ''}">${last.consumption ? Calc.fmtNum(last.consumption, 1) : '—'}</div>
            <div class="last-fuel-lbl">L/100km</div>
          </div>
        </div>
        ${warn ? '<div class="list-item-warn">⚠ Verbrauch über Grenzwert</div>' : ''}
      `;
    } else {
      lastEl.innerHTML = '<div style="color:var(--t3);font-family:var(--font-mono);font-size:12px;text-align:center;padding:12px 0">Noch kein Tankvorgang erfasst</div>';
    }

    // Upcoming maintenance
    await _renderUpcoming();

    // Recent fuel entries (last 5)
    const recentEl = document.getElementById('home-recent-list');
    const recent = enriched.slice(-5).reverse();
    if (recent.length) {
      recentEl.innerHTML = recent.map(e => _fuelListItem(e, false)).join('');
    } else {
      recentEl.innerHTML = '<div style="padding:14px;color:var(--t3);font-family:var(--font-mono);font-size:12px;text-align:center">Keine Einträge</div>';
    }
  }

  async function _renderUpcoming() {
    const el = document.getElementById('home-upcoming');
    const allMaints = await DB.getAllMaintenances();
    const today = new Date().toISOString().split('T')[0];
    const remindDays = _settings.remindDays || 14;

    const upcoming = allMaints
      .filter(m => m.dueDate)
      .map(m => ({
        ...m,
        days: Calc.daysUntil(m.dueDate),
        vehicle: _vehicles.find(v => v._id === m.vehicleId)
      }))
      .filter(m => m.days !== null && m.days <= remindDays * 3)
      .sort((a, b) => a.days - b.days)
      .slice(0, 4);

    if (!upcoming.length) {
      el.innerHTML = '<div style="color:var(--t3);font-family:var(--font-mono);font-size:12px;padding:4px 4px 8px">Keine bald fälligen Wartungen</div>';
      return;
    }

    el.innerHTML = upcoming.map(m => {
      const cls = m.days < 0 ? 'overdue' : m.days <= remindDays ? 'due-soon' : '';
      const daysLabel = m.days < 0
        ? `${Math.abs(m.days)} Tage überfällig`
        : m.days === 0 ? 'Heute!'
        : `in ${m.days} Tagen`;
      return `
        <div class="upcoming-item ${cls}">
          <div class="upcoming-left">
            <div class="upcoming-title">${esc(m.title)}</div>
            <div class="upcoming-vehicle">${esc(m.vehicle?.name || '—')}</div>
          </div>
          <div class="upcoming-right">
            <div class="upcoming-date" style="color:${m.days < 0 ? 'var(--red)' : m.days <= remindDays ? 'var(--orange)' : 'var(--t2)'}">${Calc.fmtDate(m.dueDate)}</div>
            <div class="upcoming-days" style="color:${m.days < 0 ? 'var(--red)' : m.days <= remindDays ? 'var(--orange)' : 'var(--t3)'}">${daysLabel}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function _statCard(label, val, unit, accent = false) {
    return `<div class="stat-card ${accent ? 'accent' : ''}">
      <div class="stat-label">${label}</div>
      <div class="stat-val ${accent ? 'amber' : ''}">${val}</div>
      <div class="stat-unit">${unit}</div>
    </div>`;
  }

  function _formatOdometerLabel(entry, withDotPrefix = true) {
    const km = entry.odometer || entry.odometerEffective;
    if (!km) return '';
    const prefix = withDotPrefix ? ' · ' : '';
    const estimated = entry.odometerIsEstimated
      ? ' <span class="km-estimate" title="km-Stand geschätzt">geschätzt</span>'
      : '';
    return `${prefix}${km.toLocaleString('de')} km${estimated}`;
  }

  // ── LIST VIEW ───────────────────────────────────────────────

  async function renderList() {
    if (!_currentVehicleId) {
      document.getElementById('list-content').innerHTML =
        '<div style="padding:24px;color:var(--t3);text-align:center;font-family:var(--font-mono);font-size:12px">Kein Fahrzeug ausgewählt</div>';
      return;
    }

    const addBtn = document.getElementById('list-add-btn');
    if (addBtn) addBtn.style.display = 'flex';

    switch (_currentListTab) {
      case 'fuel':        await _renderFuelList(); break;
      case 'maintenance': await _renderMaintList(); break;
      case 'costs':       await _renderCostList(); break;
    }
  }

  async function _renderFuelList() {
    const entries = await DB.getFuelEntries(_currentVehicleId);
    const enriched = Calc.enrichFuel(entries).reverse();
    const el = document.getElementById('list-content');

    if (!enriched.length) {
      el.innerHTML = _emptyState('⛽', 'Keine Tankungen', 'Ersten Tankvorgang erfassen');
      return;
    }
    el.innerHTML = enriched.map(e => _fuelListItem(e, true)).join('');
    _focusSavedFuelEntry();
  }

  function _focusSavedFuelEntry() {
    if (!_pendingFuelListFocusId) return;
    const id = String(_pendingFuelListFocusId);
    _pendingFuelListFocusId = null;
    const row = document.querySelector(`.list-item[data-fuel-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('list-item-flash');
    window.setTimeout(() => row.classList.remove('list-item-flash'), 1800);
  }

  function _fuelListItem(e, clickable) {
    const warn = e.consumption && e.consumption > (_settings.warnConsumption || 25);
    const onclick = clickable ? `onclick="App.openFuelEdit('${e._id}')"` : '';
    const fuelIdAttr = e?._id ? ` data-fuel-id="${String(e._id).replace(/"/g, '&quot;')}"` : '';
    return `
      <div class="list-item"${fuelIdAttr} ${onclick}>
        <div class="list-item-head">
          <div class="list-item-date">${Calc.fmtDate(e.date)}${_formatOdometerLabel(e, true)}</div>
          <div class="list-item-cost">${Calc.fmtNum(e.totalCost, 2)} €</div>
        </div>
        <div class="list-item-sub">
          <span class="list-item-chip">${Calc.fmtNum(e.liters, 2)} <span>L</span></span>
          ${e.pricePerLiter ? `<span class="list-item-chip">${Calc.fmtNum(e.pricePerLiter, 3)} <span>€/L</span></span>` : ''}
          ${e.drivenKm ? `<span class="list-item-chip">${e.drivenKm} <span>km</span></span>` : ''}
          ${e.consumption ? `<span class="list-item-chip" style="${warn ? 'color:var(--orange)' : ''}">${Calc.fmtNum(e.consumption, 1)} <span>L/100km</span></span>` : ''}
          ${e.partialFill ? '<span class="partial-flag">Teilfüllung</span>' : ''}
        </div>
        ${e.note ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--t3);margin-top:4px">${esc(e.note)}</div>` : ''}
        ${warn ? '<div class="list-item-warn">⚠ Verbrauch über Grenzwert</div>' : ''}
      </div>`;
  }

  async function _renderMaintList() {
    const maints = await DB.getMaintenances(_currentVehicleId);
    const el = document.getElementById('list-content');

    if (!maints.length) {
      el.innerHTML = _emptyState('🔧', 'Keine Wartungen', 'Wartung oder TÜV anlegen');
      return;
    }

    el.innerHTML = maints.map(m => {
      const days = m.dueDate ? Calc.daysUntil(m.dueDate) : null;
      const dueCls = days === null ? '' : days < 0 ? 'overdue' : days <= (_settings.remindDays || 14) ? 'due-soon' : 'ok';
      const dueLabel = days === null ? (m.dueKm ? `fällig bei ${m.dueKm.toLocaleString('de')} km` : '')
                     : days < 0 ? `${Math.abs(days)} Tage überfällig`
                     : days === 0 ? 'Heute fällig!'
                     : `fällig in ${days} Tagen (${Calc.fmtDate(m.dueDate)})`;
      return `
        <div class="maint-item" onclick="App.openMaintForm('${m._id}')">
          <div class="maint-item-head">
            <span class="maint-title">${esc(m.title)}</span>
            ${dueLabel ? `<span class="maint-due ${dueCls}">${dueLabel}</span>` : ''}
          </div>
          <div class="maint-sub">
            ${m.date ? Calc.fmtDate(m.date) : '—'}
            ${m.odometer ? ' · ' + m.odometer.toLocaleString('de') + ' km' : ''}
            ${m.cost ? ' · ' + Calc.fmtNum(m.cost, 2) + ' €' : ''}
            ${m.note ? ' · ' + esc(m.note) : ''}
          </div>
        </div>`;
    }).join('');
  }

  async function _renderCostList() {
    const costs = await DB.getCosts(_currentVehicleId);
    const el = document.getElementById('list-content');

    if (!costs.length) {
      el.innerHTML = _emptyState('💰', 'Keine Kosten', 'Versicherung, Steuer, Reparaturen…');
      return;
    }

    const total = costs.reduce((s, c) => s + (c.amount || 0), 0);
    const header = `<div style="padding:12px 14px 8px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:12px">
      <span style="color:var(--t3)">${costs.length} Einträge</span>
      <span style="color:var(--amber);font-weight:700">${Calc.fmtNum(total, 2)} € gesamt</span>
    </div>`;

    el.innerHTML = header + costs.map(c => `
      <div class="cost-item" onclick="App.openCostForm('${c._id}')">
        <div class="cost-item-head">
          <div>
            <span style="font-family:var(--font-head);font-size:14px;font-weight:700">${esc(c.category || 'Sonstiges')}</span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--t3);margin-left:8px">${Calc.fmtDate(c.date)}</span>
          </div>
          <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--amber)">${Calc.fmtNum(c.amount, 2)} €</span>
        </div>
        ${c.note ? `<div style="font-family:var(--font-mono);font-size:10px;color:var(--t3)">${esc(c.note)}</div>` : ''}
      </div>`).join('');
  }

  function switchListTab(tab, btn) {
    _currentListTab = tab;
    document.querySelectorAll('.list-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  }

  function addFromList() {
    switch (_currentListTab) {
      case 'fuel':        go('tank'); break;
      case 'maintenance': openMaintForm(); break;
      case 'costs':       openCostForm(); break;
    }
  }

  // ── TANK VIEW (new fuel entry) ───────────────────────────────

  function updateFuelPreview() {
    const liters = parseFloat(document.getElementById('tf-liters').value);
    const total  = parseFloat(document.getElementById('tf-total').value);
    const km     = parseFloat(document.getElementById('tf-odometer').value);
    const prev = null; // we don't have previous here easily

    const preview = document.getElementById('calc-preview');
    if (liters > 0 && total > 0) {
      preview.style.display = 'flex';
      document.getElementById('cp-ppl').textContent = (total / liters).toFixed(3);
      // We'll calculate km/cons when we have previous odometer from DB
      _updateKmPreview(liters, km);
    } else {
      preview.style.display = 'none';
    }
  }

  async function _updateKmPreview(liters, km) {
    if (!_currentVehicleId || !km) {
      document.getElementById('cp-km').textContent = '—';
      document.getElementById('cp-cons').textContent = '—';
      return;
    }
    const entries = await DB.getFuelEntries(_currentVehicleId);
    const enriched = Calc.enrichFuel(entries);
    const prev = enriched.filter(e => (e.odometerEffective || e.odometer) && (e.odometerEffective || e.odometer) < km).pop();
    if (prev) {
      const prevKm = prev.odometerEffective || prev.odometer;
      const driven = km - prevKm;
      document.getElementById('cp-km').textContent = driven + ' km';
      if (liters > 0) {
        document.getElementById('cp-cons').textContent = (liters / driven * 100).toFixed(1);
      }
    } else {
      document.getElementById('cp-km').textContent = km ? '(kein Vorwert)' : '—';
      document.getElementById('cp-cons').textContent = '—';
    }
  }

  function _findFuelDuplicate(entries, candidate, excludeId = null) {
    const TOLERANCE = 0.05;
    return entries.find((e) => {
      if (excludeId && e._id === excludeId) return false;
      if (e.date !== candidate.date) return false;
      if (!!e.partialFill !== !!candidate.partialFill) return false;

      const odoA = e.odometer ?? null;
      const odoB = candidate.odometer ?? null;
      if (odoA !== odoB) return false;

      const litDiff = Math.abs((e.liters || 0) - (candidate.liters || 0));
      const costDiff = Math.abs((e.totalCost || 0) - (candidate.totalCost || 0));
      return litDiff <= TOLERANCE && costDiff <= TOLERANCE;
    }) || null;
  }

  function _findFuelNearDuplicateMissingOdo(entries, candidate, excludeId = null) {
    const TOLERANCE = 0.05;
    return entries.find((e) => {
      if (excludeId && e._id === excludeId) return false;
      if (e.date !== candidate.date) return false;
      if (!!e.partialFill !== !!candidate.partialFill) return false;

      const odoA = e.odometer ?? null;
      const odoB = candidate.odometer ?? null;
      const oneMissingOnePresent = (odoA == null) !== (odoB == null);
      if (!oneMissingOnePresent) return false;

      const litDiff = Math.abs((e.liters || 0) - (candidate.liters || 0));
      const costDiff = Math.abs((e.totalCost || 0) - (candidate.totalCost || 0));
      return litDiff <= TOLERANCE && costDiff <= TOLERANCE;
    }) || null;
  }

  async function saveFuelEntry() {
    if (!_currentVehicleId) { toast('Kein Fahrzeug ausgewählt', 'error'); return; }

    const date     = document.getElementById('tf-date').value;
    const odometer = parseInt(document.getElementById('tf-odometer').value) || null;
    const liters   = parseFloat(document.getElementById('tf-liters').value);
    const totalCost= parseFloat(document.getElementById('tf-total').value);
    const note     = document.getElementById('tf-note').value.trim();
    const partial  = document.getElementById('tf-partial').checked;

    const msgEl = document.getElementById('tf-validation-msg');

    const entries = await DB.getFuelEntries(_currentVehicleId);
    const enriched = Calc.enrichFuel(entries);
    const { valid, errors, warnings } = Calc.validateFuel(
      { date, odometer, liters, totalCost }, enriched
    );

    if (!valid) {
      msgEl.className = 'validation-msg error';
      msgEl.textContent = errors.join(' · ');
      msgEl.style.display = 'block';
      return;
    }

    const duplicate = _findFuelDuplicate(entries, {
      date, odometer, liters, totalCost, partialFill: partial
    });
    if (duplicate) {
      msgEl.className = 'validation-msg warn';
      msgEl.textContent = 'Duplikat erkannt: Dieser Tankvorgang ist bereits vorhanden.';
      msgEl.style.display = 'block';
      return;
    }

    const nearDuplicateMissingOdo = _findFuelNearDuplicateMissingOdo(entries, {
      date, odometer, liters, totalCost, partialFill: partial
    });
    if (nearDuplicateMissingOdo) {
      msgEl.className = 'validation-msg warn';
      msgEl.textContent =
        `Fast-Duplikat: Datum/Liter/Betrag passen zu vorhandenem Eintrag (${nearDuplicateMissingOdo.odometer ?? 'ohne'} km). ` +
        'Bitte vorhandenen Eintrag prüfen statt neu speichern.';
      msgEl.style.display = 'block';
      return;
    }

    if (warnings.length) {
      msgEl.className = 'validation-msg warn';
      msgEl.textContent = '⚠ ' + warnings.join(' · ');
      msgEl.style.display = 'block';
    } else {
      msgEl.style.display = 'none';
    }

    const saved = await DB.saveFuelEntry({
      vehicleId: _currentVehicleId, date, odometer, liters,
      totalCost, note, partialFill: partial
    });
    _pendingFuelListFocusId = saved?._id || null;
    _currentListTab = 'fuel';

    // Reset form
    document.getElementById('tf-liters').value = '';
    document.getElementById('tf-total').value = '';
    document.getElementById('tf-odometer').value = '';
    document.getElementById('tf-note').value = '';
    document.getElementById('tf-partial').checked = false;
    document.getElementById('calc-preview').style.display = 'none';
    msgEl.style.display = 'none';
    document.getElementById('tf-date').value = new Date().toISOString().split('T')[0];

    toast('Tankvorgang gespeichert ✓', 'success');
    await go('list');
  }

  // ── FUEL EDIT ────────────────────────────────────────────────

  async function openFuelEdit(id) {
    _editFuelId = id;
    const doc = await DB.getFuelEntries(_currentVehicleId);
    const entry = doc.find(e => e._id === id);
    if (!entry) return;

    document.getElementById('fuel-edit-title').textContent =
      `Tankvorgang — ${Calc.fmtDate(entry.date)}`;
    document.getElementById('fe-id').value = entry._id;
    document.getElementById('fe-date').value = entry.date || '';
    document.getElementById('fe-odometer').value = entry.odometer || '';
    document.getElementById('fe-liters').value = entry.liters || '';
    document.getElementById('fe-total').value = entry.totalCost || '';
    document.getElementById('fe-note').value = entry.note || '';
    document.getElementById('fe-partial').checked = !!entry.partialFill;

    openOverlay('overlay-fuel-edit');
  }

  async function saveFuelEdit() {
    const id       = document.getElementById('fe-id').value;
    const date     = document.getElementById('fe-date').value;
    const odometer = parseInt(document.getElementById('fe-odometer').value) || null;
    const liters   = parseFloat(document.getElementById('fe-liters').value);
    const totalCost= parseFloat(document.getElementById('fe-total').value);
    const note     = document.getElementById('fe-note').value.trim();
    const partial  = document.getElementById('fe-partial').checked;

    if (!date || !liters || !totalCost) { toast('Pflichtfelder ausfüllen', 'error'); return; }

    const allEntries = await DB.getFuelEntries(_currentVehicleId);
    const existing = allEntries.find(e => e._id === id);
    if (!existing) { toast('Eintrag nicht gefunden', 'error'); return; }

    const duplicate = _findFuelDuplicate(
      allEntries,
      { date, odometer, liters, totalCost, partialFill: partial },
      id
    );
    if (duplicate) {
      toast('Duplikat erkannt: Speichern abgebrochen', 'error');
      return;
    }

    const nearDuplicateMissingOdo = _findFuelNearDuplicateMissingOdo(
      allEntries,
      { date, odometer, liters, totalCost, partialFill: partial },
      id
    );
    if (nearDuplicateMissingOdo) {
      toast(
        `Fast-Duplikat erkannt (${nearDuplicateMissingOdo.odometer ?? 'ohne'} km): bitte bestehenden Eintrag prüfen.`,
        'error'
      );
      return;
    }

    await DB.saveFuelEntry({ ...existing, date, odometer, liters, totalCost, note, partialFill: partial });
    closeOverlay('overlay-fuel-edit');
    toast('Gespeichert ✓', 'success');
    await refreshCurrentView();
  }

  async function deleteFuelEntry() {
    const id = document.getElementById('fe-id').value;
    if (!confirm('Tankvorgang löschen?')) return;
    await DB.deleteFuelEntry(id);
    closeOverlay('overlay-fuel-edit');
    toast('Gelöscht', 'success');
    await refreshCurrentView();
  }

  // ── ANALYSE VIEW ─────────────────────────────────────────────

  async function renderAnalyse() {
    if (!_currentVehicleId) {
      document.getElementById('analyse-stats').innerHTML =
        '<div style="grid-column:1/-1;padding:12px;color:var(--t3);font-family:var(--font-mono);font-size:12px">Kein Fahrzeug ausgewählt</div>';
      return;
    }

    const entries = await DB.getFuelEntries(_currentVehicleId);
    const enriched = Calc.enrichFuel(entries);
    const costs = await DB.getCosts(_currentVehicleId);

    const periodDays = _analysePeriod === 'all' ? null : parseInt(_analysePeriod) * 30;
    const s = Calc.summary(enriched, periodDays);

    // Analyse stats
    const statsEl = document.getElementById('analyse-stats');
    statsEl.innerHTML = [
      _statCard('Ø Verbrauch', Calc.fmtNum(s.avgCons, 1), 'L/100km', true),
      _statCard('Ø Verbrauch (letzte 5)', Calc.fmtNum(s.avgConsLast5, 1), 'L/100km'),
      _statCard('Ø €/Liter', Calc.fmtNum(s.avgPpl, 3), '€/L'),
      _statCard('Kosten/100km', Calc.fmtNum(s.avgCostPer100, 2), '€/100km'),
      _statCard('Kraftstoffkosten', Calc.fmtNum(s.totalCost, 2), '€'),
      _statCard('Gesamtstrecke', s.totalKm ? s.totalKm.toLocaleString('de') : '—', 'km'),
    ].join('');

    // Filter entries by period
    let filteredEntries = enriched;
    let filteredCosts = costs;
    if (periodDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - periodDays);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      filteredEntries = enriched.filter(e => e.date >= cutoffStr);
      filteredCosts = costs.filter(c => c.date >= cutoffStr);
    }

    _renderCharts(filteredEntries, filteredCosts);
    _renderCostsBreakdown(filteredCosts);
    _renderAnalyseFacts(filteredEntries, filteredCosts);
  }

  function _renderCharts(entries, costs) {
    const validCons = entries.filter(e => e.consumption);
    const labels    = validCons.map(e => Calc.fmtDate(e.date, true));
    const consData  = validCons.map(e => e.consumption);
    const pplData   = entries.filter(e => e.pricePerLiter)
                             .map(e => ({ x: Calc.fmtDate(e.date, true), y: e.pricePerLiter }));

    // Consumption chart
    _makeChart('chart-consumption', 'line', labels, consData, 'L/100km', '#f59e0b');

    // Price chart
    _makeChart('chart-price', 'line',
      entries.filter(e => e.pricePerLiter).map(e => Calc.fmtDate(e.date, true)),
      entries.filter(e => e.pricePerLiter).map(e => e.pricePerLiter),
      '€/L', '#38bdf8'
    );

    // Monthly costs chart (fuel + extras)
    const fuelByMonth = {};
    entries.forEach(e => {
      const m = e.date.slice(0, 7);
      fuelByMonth[m] = (fuelByMonth[m] || 0) + (e.totalCost || 0);
    });
    costs.forEach(c => {
      const m = c.date.slice(0, 7);
      fuelByMonth[m] = (fuelByMonth[m] || 0) + (c.amount || 0);
    });
    const monthsSorted = Object.keys(fuelByMonth).sort();
    _makeChart('chart-costs', 'bar',
      monthsSorted.map(m => {
        const [y, mo] = m.split('-');
        return `${mo}/${y.slice(2)}`;
      }),
      monthsSorted.map(m => +fuelByMonth[m].toFixed(2)),
      '€', '#4ade80'
    );
  }

  function _makeChart(id, type, labels, data, label, color) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
    if (!labels.length) return;

    _charts[id] = new Chart(canvas, {
      type,
      data: {
        labels,
        datasets: [{
          label, data,
          borderColor: color,
          backgroundColor: type === 'bar' ? color + '60' : color + '18',
          borderWidth: type === 'bar' ? 0 : 2,
          fill: type === 'line',
          tension: 0.35,
          pointBackgroundColor: color,
          pointRadius: data.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          borderRadius: type === 'bar' ? 4 : 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161c23',
            borderColor: '#252d38',
            borderWidth: 1,
            titleColor: '#4a5a6a',
            bodyColor: '#e2e8f0',
            titleFont: { family: 'JetBrains Mono', size: 10 },
            bodyFont: { family: 'JetBrains Mono', size: 13, weight: 'bold' },
            padding: 10,
            callbacks: {
              label: ctx => `${ctx.parsed.y} ${label}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#0f1318' },
            ticks: { color: '#2e3d4d', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 8 },
            border: { color: '#252d38' }
          },
          y: {
            grid: { color: '#0f1318' },
            ticks: { color: '#2e3d4d', font: { family: 'JetBrains Mono', size: 10 } },
            border: { color: '#252d38' }
          }
        }
      }
    });
  }

  function _renderCostsBreakdown(costs) {
    const el = document.getElementById('costs-breakdown');
    if (!costs.length) {
      el.innerHTML = '<div style="padding:14px;color:var(--t3);font-family:var(--font-mono);font-size:12px;text-align:center">Keine Kostendaten im Zeitraum</div>';
      return;
    }

    const byCategory = {};
    let total = 0;
    for (const c of costs) {
      const cat = c.category || 'Sonstiges';
      byCategory[cat] = (byCategory[cat] || 0) + (c.amount || 0);
      total += c.amount || 0;
    }
    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    el.innerHTML = sorted.map(([cat, amt]) => {
      const pct = total > 0 ? (amt / total * 100).toFixed(0) : 0;
      return `
        <div class="cost-bar-row">
          <div class="cost-bar-head">
            <span style="font-family:var(--font-mono);font-size:12px">${esc(cat)}</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--amber)">${Calc.fmtNum(amt, 2)} € <span style="color:var(--t3)">(${pct}%)</span></span>
          </div>
          <div class="cost-bar-track"><div class="cost-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
  }

  function _renderAnalyseFacts(entries, costs) {
    const factsEl = document.getElementById('analyse-facts');
    const factsHead = document.getElementById('analyse-facts-head');
    if (!factsEl) return;

    const fmtDec = (v, d = 1) => Number(v).toFixed(d).replace('.', ',');

    const byMonth = {};
    entries.forEach(e => {
      const m = e.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { km: 0, cost: 0 };
      byMonth[m].km += e.drivenKm || 0;
      byMonth[m].cost += e.totalCost || 0;
    });
    costs.forEach(c => {
      const m = c.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { km: 0, cost: 0 };
      byMonth[m].cost += c.amount || 0;
    });

    let maxKmMonth = null, maxKm = 0, maxCostMonth = null, maxCost = 0;
    Object.entries(byMonth).forEach(([m, v]) => {
      if (v.km > maxKm) { maxKm = v.km; maxKmMonth = m; }
      if (v.cost > maxCost) { maxCost = v.cost; maxCostMonth = m; }
    });

    const fmtM = m => { const [y, mo] = m.split('-'); return `${mo}/${y}`; };
    const facts = [];

    if (maxKmMonth) {
      facts.push(`<div class="fact-row"><span class="fact-icon">🏆</span><span class="fact-text">Meiste Kilometer: <strong>${fmtM(maxKmMonth)}</strong> — ${Math.round(maxKm).toLocaleString('de')} km</span></div>`);
    }
    if (maxCostMonth) {
      facts.push(`<div class="fact-row"><span class="fact-icon">💸</span><span class="fact-text">Teuerster Monat: <strong>${fmtM(maxCostMonth)}</strong> — ${fmtDec(maxCost, 2)} €</span></div>`);
    }

    const drivenEntries = entries.filter(e => (e.drivenKm || 0) > 0);
    if (drivenEntries.length) {
      const avgKmPerFill = drivenEntries.reduce((s, e) => s + (e.drivenKm || 0), 0) / drivenEntries.length;
      const longest = drivenEntries.reduce((a, b) => (a.drivenKm > b.drivenKm ? a : b));
      facts.push(`<div class="fact-row"><span class="fact-icon">🛣️</span><span class="fact-text">Ø Strecke pro Tankfüllung: <strong>${Math.round(avgKmPerFill).toLocaleString('de')} km</strong></span></div>`);
      facts.push(`<div class="fact-row"><span class="fact-icon">📏</span><span class="fact-text">Längste Distanz zwischen Tankungen: <strong>${Math.round(longest.drivenKm).toLocaleString('de')} km</strong> (${Calc.fmtDate(longest.date)})</span></div>`);
    }

    const fullWithConsumption = entries.filter(e => !e.partialFill && e.consumption);
    if (fullWithConsumption.length >= 2) {
      const best = fullWithConsumption.reduce((a, b) => (a.consumption < b.consumption ? a : b));
      const worst = fullWithConsumption.reduce((a, b) => (a.consumption > b.consumption ? a : b));
      facts.push(`<div class="fact-row"><span class="fact-icon">🌿</span><span class="fact-text">Bester Verbrauch: <strong>${fmtDec(best.consumption, 1)} L/100km</strong> (${Calc.fmtDate(best.date)})</span></div>`);
      facts.push(`<div class="fact-row"><span class="fact-icon">🔥</span><span class="fact-text">Höchster Verbrauch: <strong>${fmtDec(worst.consumption, 1)} L/100km</strong> (${Calc.fmtDate(worst.date)})</span></div>`);
    }

    const priced = entries.filter(e => e.pricePerLiter);
    if (priced.length >= 2) {
      const cheapest = priced.reduce((a, b) => (a.pricePerLiter < b.pricePerLiter ? a : b));
      const expensive = priced.reduce((a, b) => (a.pricePerLiter > b.pricePerLiter ? a : b));
      facts.push(`<div class="fact-row"><span class="fact-icon">⛽</span><span class="fact-text">Günstigster Preis: <strong>${fmtDec(cheapest.pricePerLiter, 3)} €/L</strong> (${Calc.fmtDate(cheapest.date)})</span></div>`);
      facts.push(`<div class="fact-row"><span class="fact-icon">📈</span><span class="fact-text">Höchster Preis: <strong>${fmtDec(expensive.pricePerLiter, 3)} €/L</strong> (${Calc.fmtDate(expensive.date)})</span></div>`);
    }

    if (entries.length >= 3) {
      const partialCount = entries.filter(e => e.partialFill).length;
      const partialRate = partialCount / entries.length * 100;
      facts.push(`<div class="fact-row"><span class="fact-icon">🧪</span><span class="fact-text">Teilfüllungen: <strong>${partialCount}</strong> von ${entries.length} (${fmtDec(partialRate, 0)}%)</span></div>`);
    }

    if (facts.length) {
      factsEl.style.display = '';
      if (factsHead) factsHead.style.display = '';
      factsEl.innerHTML = `<div class="facts-list">${facts.join('')}</div>`;
    } else {
      factsEl.style.display = 'none';
      if (factsHead) factsHead.style.display = 'none';
    }
  }

  function setAnalysePeriod(period, btn) {
    _analysePeriod = period;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAnalyse();
  }

  // ── VEHICLE DATABASE PICKER ──────────────────────────────────

  function _initVdbPicker() {
    const brandSel = document.getElementById('vdb-brand');
    if (!brandSel) return;
    brandSel.innerHTML = '<option value="">— Marke wählen —</option>' +
      VehicleDB.getBrands().map(b => `<option value="${b}">${b}</option>`).join('');
    // Reset cascade
    ['vdb-model-group','vdb-gen-group','vdb-variant-group','vdb-tire-group'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const preview = document.getElementById('vdb-preview');
    if (preview) preview.style.display = 'none';
    const applyBtn = document.getElementById('vdb-apply-btn');
    if (applyBtn) applyBtn.style.display = 'none';
  }

  function vdbSelectBrand(brand) {
    const modelSel = document.getElementById('vdb-model');
    const modelGroup = document.getElementById('vdb-model-group');
    ['vdb-gen-group','vdb-variant-group','vdb-tire-group'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    document.getElementById('vdb-preview').style.display = 'none';
    document.getElementById('vdb-apply-btn').style.display = 'none';

    if (!brand) { modelGroup.style.display = 'none'; return; }
    const models = VehicleDB.getModels(brand);
    modelSel.innerHTML = '<option value="">— Modell wählen —</option>' +
      models.map(m => `<option value="${m}">${m}</option>`).join('');
    modelGroup.style.display = 'block';
  }

  function vdbSelectModel(model) {
    const brand = document.getElementById('vdb-brand').value;
    const genSel = document.getElementById('vdb-generation');
    const genGroup = document.getElementById('vdb-gen-group');
    ['vdb-variant-group','vdb-tire-group'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    document.getElementById('vdb-preview').style.display = 'none';
    document.getElementById('vdb-apply-btn').style.display = 'none';

    if (!model) { genGroup.style.display = 'none'; return; }
    const gens = VehicleDB.getGenerations(brand, model);
    genSel.innerHTML = '<option value="">— Generation wählen —</option>' +
      gens.map(g => `<option value="${g}">${g}</option>`).join('');
    genGroup.style.display = 'block';
  }

  function vdbSelectGeneration(gen) {
    const brand = document.getElementById('vdb-brand').value;
    const model = document.getElementById('vdb-model').value;
    const varSel = document.getElementById('vdb-variant');
    const varGroup = document.getElementById('vdb-variant-group');
    document.getElementById('vdb-tire-group').style.display = 'none';
    document.getElementById('vdb-preview').style.display = 'none';
    document.getElementById('vdb-apply-btn').style.display = 'none';

    if (!gen) { varGroup.style.display = 'none'; return; }
    const variants = VehicleDB.getVariants(brand, model, gen);
    varSel.innerHTML = '<option value="">— Variante wählen —</option>' +
      variants.map(v => `<option value="${v.name}">${v.name} ${v.power ? '(' + v.power + ' PS)' : ''}</option>`).join('');
    varGroup.style.display = 'block';
  }

  function vdbSelectVariant(variantName) {
    const brand = document.getElementById('vdb-brand').value;
    const model = document.getElementById('vdb-model').value;
    const gen   = document.getElementById('vdb-generation').value;
    const tireGroup = document.getElementById('vdb-tire-group');
    const preview = document.getElementById('vdb-preview');
    const applyBtn = document.getElementById('vdb-apply-btn');

    if (!variantName) {
      tireGroup.style.display = 'none';
      preview.style.display = 'none';
      applyBtn.style.display = 'none';
      return;
    }

    const v = VehicleDB.findVariant(brand, model, gen, variantName);
    if (!v) return;

    // Tire chips
    if (v.tires && v.tires.length > 1) {
      const chipsEl = document.getElementById('vdb-tire-chips');
      chipsEl.innerHTML = v.tires.map((t, i) =>
        `<button class="chip ${i === 0 ? 'chip-active' : ''}" onclick="App.vdbSelectTire(this,'${t}')">${t}</button>`
      ).join('');
      tireGroup.style.display = 'block';
    } else {
      tireGroup.style.display = 'none';
    }

    // Preview card
    preview.style.display = 'block';
    preview.innerHTML = `
      <div class="vdb-preview-grid">
        <div class="vdb-preview-item"><span class="vdb-pk">Motorcode</span><span class="vdb-pv">${v.code || '—'}</span></div>
        <div class="vdb-preview-item"><span class="vdb-pk">Kraftstoff</span><span class="vdb-pv">${v.fuel || '—'}</span></div>
        <div class="vdb-preview-item"><span class="vdb-pk">Öl</span><span class="vdb-pv">${v.oil || '—'}</span></div>
        <div class="vdb-preview-item"><span class="vdb-pk">Leistung</span><span class="vdb-pv">${v.power ? v.power + ' PS' : '—'}</span></div>
        <div class="vdb-preview-item"><span class="vdb-pk">Reifen</span><span class="vdb-pv">${(v.tires || []).join(' / ') || '—'}</span></div>
        <div class="vdb-preview-item"><span class="vdb-pk">Generation</span><span class="vdb-pv">${gen}</span></div>
      </div>`;

    applyBtn.style.display = 'flex';
  }

  function vdbSelectTire(btn, size) {
    document.querySelectorAll('#vdb-tire-chips .chip').forEach(c => c.classList.remove('chip-active'));
    btn.classList.add('chip-active');
  }

  function vdbApply() {
    const brand    = document.getElementById('vdb-brand').value;
    const model    = document.getElementById('vdb-model').value;
    const gen      = document.getElementById('vdb-generation').value;
    const varName  = document.getElementById('vdb-variant').value;
    const v        = VehicleDB.findVariant(brand, model, gen, varName);
    if (!v) return;

    // Selected tire
    const activeChip = document.querySelector('#vdb-tire-chips .chip-active');
    const tire = activeChip ? activeChip.textContent : (v.tires?.[0] || '');

    // Fill form fields
    document.getElementById('vf-make').value     = brand;
    document.getElementById('vf-model').value    = model;
    document.getElementById('vf-engine').value   = v.code || '';
    document.getElementById('vf-tires').value    = tire;
    document.getElementById('vf-oil').value      = v.oil || '';
    document.getElementById('vf-variant').value  = varName;
    document.getElementById('vf-fueltype').value = v.fuel || 'Benzin';

    // Set name if empty
    if (!document.getElementById('vf-name').value) {
      document.getElementById('vf-name').value = model;
    }

    // Extract year from generation string (e.g. "Golf VI (5K) 2008–2013" → 2008)
    const yearMatch = gen.match(/(\d{4})/);
    if (yearMatch && !document.getElementById('vf-year').value) {
      document.getElementById('vf-year').value = yearMatch[1];
    }

    toast('Fahrzeugdaten übernommen ✓', 'success');

    // Collapse picker
    const body = document.getElementById('vdb-picker-body');
    if (body) body.style.display = 'none';
    const collapseBtn = document.getElementById('vdb-collapse-btn');
    if (collapseBtn) collapseBtn.style.transform = 'rotate(180deg)';
  }

  let _vdbPickerOpen = true;
  function toggleVdbPicker() {
    _vdbPickerOpen = !_vdbPickerOpen;
    const body = document.getElementById('vdb-picker-body');
    const btn = document.getElementById('vdb-collapse-btn');
    if (body) body.style.display = _vdbPickerOpen ? 'block' : 'none';
    if (btn) btn.style.transform = _vdbPickerOpen ? '' : 'rotate(180deg)';
  }

  // ── PLATE PREVIEW ────────────────────────────────────────────

  function updatePlatePreview(value) {
    const el = document.getElementById('plate-text');
    if (!el) return;
    const text = (value || '').trim().toUpperCase() || 'XX·AB 123';
    el.textContent = text;
  }

  // ── GARAGE ──────────────────────────────────────────────────

  function openGarage() {
    _renderGarageList();
    openOverlay('overlay-garage');
  }

  function _renderGarageList() {
    const el = document.getElementById('garage-list');
    if (!_vehicles.length) {
      el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--t3);font-family:var(--font-mono);font-size:12px">Noch kein Fahrzeug angelegt</div>';
      return;
    }
    el.innerHTML = _vehicles.map(v => `
      <div class="garage-vehicle-card ${v._id === _currentVehicleId ? 'selected' : ''}"
           onclick="App.selectAndEdit('${v._id}')">
        <div class="garage-card-left">
          <div class="garage-vehicle-name">${esc(v.name)}</div>
          <div class="garage-vehicle-sub">${[v.make, v.model, v.variant].filter(Boolean).join(' · ')}</div>
          <div class="garage-vehicle-sub" style="margin-top:2px;color:var(--t3)">${v.fuelType || ''} ${v.engineCode ? '· ' + v.engineCode : ''}</div>
        </div>
        <div class="garage-card-right">
          ${_renderMiniPlate(v.plate)}
          ${v._id === _currentVehicleId ? '<span class="garage-vehicle-tag" style="margin-top:6px">Aktiv</span>' : ''}
        </div>
      </div>`).join('');
  }

  function _renderMiniPlate(plate) {
    if (!plate || plate.trim() === '') {
      return `<div class="mini-plate mini-plate-empty">
        <div class="mini-plate-eu">
          <div style="font-size:7px;color:#fff;text-align:center;line-height:1">★</div>
          <div style="font-size:6px;color:#fff;font-weight:bold;text-align:center">D</div>
        </div>
        <span class="mini-plate-text" style="color:#aaa;font-style:italic;font-size:10px">kein Kennz.</span>
      </div>`;
    }
    const text = plate.trim().toUpperCase();
    return `<div class="mini-plate">
      <div class="mini-plate-eu">
        <div style="font-size:7px;color:#fff;text-align:center;line-height:1">★</div>
        <div style="font-size:6px;color:#fff;font-weight:bold;text-align:center">D</div>
      </div>
      <span class="mini-plate-text">${esc(text)}</span>
    </div>`;
  }

  function selectAndEdit(vehicleId) {
    selectVehicle(vehicleId);
    document.getElementById('vehicle-select').value = vehicleId;
    openVehicleForm(vehicleId);
  }

  function openVehicleForm(vehicleId = null) {
    const isEdit = !!vehicleId;
    document.getElementById('vehicle-form-title').textContent = isEdit ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen';
    document.getElementById('vf-id').value = vehicleId || '';
    document.getElementById('vf-delete-btn').style.display = isEdit ? '' : 'none';

    // Reset VDB picker
    _vdbPickerOpen = true;
    const pickerBody = document.getElementById('vdb-picker-body');
    if (pickerBody) pickerBody.style.display = 'block';
    const collapseBtn = document.getElementById('vdb-collapse-btn');
    if (collapseBtn) collapseBtn.style.transform = '';
    _initVdbPicker();

    // Clear form
    ['vf-name','vf-make','vf-model','vf-year','vf-variant','vf-plate',
     'vf-engine','vf-tires','vf-oil','vf-vin','vf-notes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    updatePlatePreview('');

    if (isEdit) {
      const v = _vehicles.find(x => x._id === vehicleId);
      if (v) {
        document.getElementById('vf-name').value   = v.name || '';
        document.getElementById('vf-make').value   = v.make || '';
        document.getElementById('vf-model').value  = v.model || '';
        document.getElementById('vf-year').value   = v.year || '';
        document.getElementById('vf-variant').value= v.variant || '';
        document.getElementById('vf-plate').value  = v.plate || '';
        document.getElementById('vf-engine').value = v.engineCode || '';
        document.getElementById('vf-tires').value  = v.tireSize || '';
        document.getElementById('vf-oil').value    = v.oilSpec || '';
        document.getElementById('vf-vin').value    = v.vin || '';
        document.getElementById('vf-notes').value  = v.notes || '';
        document.getElementById('vf-fueltype').value = v.fuelType || 'Benzin';
        updatePlatePreview(v.plate || '');
        // Hide picker when editing (already have data)
        if (pickerBody) pickerBody.style.display = 'none';
        if (collapseBtn) collapseBtn.style.transform = 'rotate(180deg)';
        _vdbPickerOpen = false;
      }
    }

    openOverlay('overlay-vehicle-form');
  }

  async function saveVehicle() {
    const name = document.getElementById('vf-name').value.trim();
    if (!name) { toast('Name ist Pflichtfeld', 'error'); return; }

    const id = document.getElementById('vf-id').value;
    const v = id ? (_vehicles.find(x => x._id === id) || {}) : {};

    v.name      = name;
    v.make      = document.getElementById('vf-make').value.trim();
    v.model     = document.getElementById('vf-model').value.trim();
    v.year      = parseInt(document.getElementById('vf-year').value) || null;
    v.variant   = document.getElementById('vf-variant').value.trim();
    v.plate     = document.getElementById('vf-plate').value.trim();
    v.engineCode= document.getElementById('vf-engine').value.trim();
    v.tireSize  = document.getElementById('vf-tires').value.trim();
    v.oilSpec   = document.getElementById('vf-oil').value.trim();
    v.vin       = document.getElementById('vf-vin').value.trim();
    v.notes     = document.getElementById('vf-notes').value.trim();
    v.fuelType  = document.getElementById('vf-fueltype').value;

    await DB.saveVehicle(v);
    await refreshVehicles();
    updateVehicleSelect();

    if (!_currentVehicleId && _vehicles.length > 0) {
      _currentVehicleId = _vehicles[0]._id;
      document.getElementById('vehicle-select').value = _currentVehicleId;
    }

    _renderGarageList();
    closeOverlay('overlay-vehicle-form');
    toast('Fahrzeug gespeichert ✓', 'success');
    await refreshCurrentView();
  }

  async function deleteVehicle() {
    const id = document.getElementById('vf-id').value;
    if (!id) return;
    const v = _vehicles.find(x => x._id === id);
    if (!confirm(`Fahrzeug "${v?.name}" und ALLE zugehörigen Daten löschen?`)) return;

    await DB.deleteVehicle(id);
    await refreshVehicles();

    if (_currentVehicleId === id) {
      _currentVehicleId = _vehicles.length > 0 ? _vehicles[0]._id : null;
      if (_currentVehicleId) localStorage.setItem('tanklog_vehicle', _currentVehicleId);
    }
    updateVehicleSelect();
    _renderGarageList();
    closeOverlay('overlay-vehicle-form');
    closeOverlay('overlay-garage');
    toast('Fahrzeug gelöscht', 'success');
    await renderHome();
  }

  // ── MAINTENANCE ──────────────────────────────────────────────

  function openMaintForm(id = null) {
    _editMaintId = id;
    document.getElementById('maint-form-title').textContent = id ? 'Wartung bearbeiten' : 'Wartung anlegen';
    document.getElementById('mf-delete-btn').style.display = id ? '' : 'none';

    // Clear
    ['mf-title','mf-odometer','mf-cost','mf-due-date','mf-due-km',
     'mf-remind-days','mf-remind-km','mf-note'].forEach(x => {
      const el = document.getElementById(x);
      if (el) el.value = '';
    });
    document.getElementById('mf-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('mf-ics-btn').style.display = 'none';

    if (id) {
      DB.getMaintenances(_currentVehicleId || '').then(maints => {
        let m = maints.find(x => x._id === id);
        if (!m) {
          // Search all if not found in current vehicle
          DB.getAllMaintenances().then(all => {
            m = all.find(x => x._id === id);
            if (m) _fillMaintForm(m);
          });
        } else {
          _fillMaintForm(m);
        }
      });
    }
    openOverlay('overlay-maint-form');
  }

  function _fillMaintForm(m) {
    document.getElementById('mf-title').value       = m.title || '';
    document.getElementById('mf-date').value        = m.date || '';
    document.getElementById('mf-odometer').value   = m.odometer || '';
    document.getElementById('mf-cost').value        = m.cost || '';
    document.getElementById('mf-due-date').value   = m.dueDate || '';
    document.getElementById('mf-due-km').value     = m.dueKm || '';
    document.getElementById('mf-remind-days').value= m.reminderDaysBefore || '';
    document.getElementById('mf-remind-km').value  = m.reminderKmBefore || '';
    document.getElementById('mf-note').value        = m.note || '';
    if (m.dueDate) document.getElementById('mf-ics-btn').style.display = '';
  }

  async function saveMaint() {
    if (!_currentVehicleId) { toast('Kein Fahrzeug ausgewählt', 'error'); return; }
    const title = document.getElementById('mf-title').value.trim();
    if (!title) { toast('Titel ist Pflichtfeld', 'error'); return; }

    let m = {};
    if (_editMaintId) {
      const all = await DB.getAllMaintenances();
      m = all.find(x => x._id === _editMaintId) || {};
    }

    m.vehicleId          = _currentVehicleId;
    m.title              = title;
    m.date               = document.getElementById('mf-date').value || null;
    m.odometer           = parseInt(document.getElementById('mf-odometer').value) || null;
    m.cost               = parseFloat(document.getElementById('mf-cost').value) || null;
    m.dueDate            = document.getElementById('mf-due-date').value || null;
    m.dueKm              = parseInt(document.getElementById('mf-due-km').value) || null;
    m.reminderDaysBefore = parseInt(document.getElementById('mf-remind-days').value) || null;
    m.reminderKmBefore   = parseInt(document.getElementById('mf-remind-km').value) || null;
    m.note               = document.getElementById('mf-note').value.trim();

    await DB.saveMaintenance(m);
    closeOverlay('overlay-maint-form');
    toast('Wartung gespeichert ✓', 'success');
    await refreshCurrentView();
    await _renderUpcoming();
  }

  async function deleteMaint() {
    if (!_editMaintId || !confirm('Wartung löschen?')) return;
    await DB.deleteMaintenance(_editMaintId);
    closeOverlay('overlay-maint-form');
    toast('Gelöscht', 'success');
    await refreshCurrentView();
  }

  async function downloadMaintICS() {
    if (!_editMaintId || !_currentVehicleId) return;
    const all = await DB.getAllMaintenances();
    const m = all.find(x => x._id === _editMaintId);
    const v = currentVehicle();
    if (!m || !m.dueDate) { toast('Kein Fälligkeitsdatum gesetzt', 'error'); return; }

    const ics = Calc.generateICS(m, v?.name || 'Fahrzeug');
    if (!ics) return;
    _downloadBlob(ics, 'text/calendar;charset=utf-8', `tanklog_${m.title.replace(/\s+/g,'-')}.ics`);
    toast('ICS heruntergeladen', 'success');
  }

  async function downloadAllICS() {
    const all = await DB.getAllMaintenances();
    const withDue = all.filter(m => m.dueDate);
    if (!withDue.length) { toast('Keine Termine mit Fälligkeitsdatum vorhanden', 'error'); return; }
    const vehicleMap = Object.fromEntries(_vehicles.map(v => [v._id, v.name]));
    const ics = Calc.generateICSAll(withDue, vehicleMap);
    if (!ics) { toast('Keine exportierbaren Termine gefunden', 'error'); return; }
    const today = new Date().toISOString().slice(0, 10);
    _downloadBlob(ics, 'text/calendar;charset=utf-8', `tanklog_termine_${today}.ics`);
    toast(`${withDue.length} Termin(e) als ICS exportiert`, 'success');
  }

  // ── COSTS ────────────────────────────────────────────────────

  function openCostForm(id = null) {
    _editCostId = id;
    document.getElementById('cost-form-title').textContent = id ? 'Kosten bearbeiten' : 'Kosten erfassen';
    document.getElementById('cf-delete-btn').style.display = id ? '' : 'none';

    ['cf-amount','cf-odometer','cf-note'].forEach(x => {
      const el = document.getElementById(x);
      if (el) el.value = '';
    });
    document.getElementById('cf-date').value = new Date().toISOString().split('T')[0];

    if (id) {
      DB.getCosts(_currentVehicleId || '').then(costs => {
        const c = costs.find(x => x._id === id);
        if (c) {
          document.getElementById('cf-date').value     = c.date || '';
          document.getElementById('cf-amount').value  = c.amount || '';
          document.getElementById('cf-category').value= c.category || 'Sonstiges';
          document.getElementById('cf-odometer').value= c.odometer || '';
          document.getElementById('cf-note').value    = c.note || '';
        }
      });
    }
    openOverlay('overlay-cost-form');
  }

  async function saveCost() {
    if (!_currentVehicleId) { toast('Kein Fahrzeug ausgewählt', 'error'); return; }
    const date   = document.getElementById('cf-date').value;
    const amount = parseFloat(document.getElementById('cf-amount').value);

    if (!date || !amount || amount <= 0) { toast('Datum und Betrag ausfüllen', 'error'); return; }

    let c = {};
    if (_editCostId) {
      const all = await DB.getCosts(_currentVehicleId);
      c = all.find(x => x._id === _editCostId) || {};
    }

    c.vehicleId = _currentVehicleId;
    c.date      = date;
    c.amount    = amount;
    c.category  = document.getElementById('cf-category').value;
    c.odometer  = parseInt(document.getElementById('cf-odometer').value) || null;
    c.note      = document.getElementById('cf-note').value.trim();

    await DB.saveCost(c);
    closeOverlay('overlay-cost-form');
    toast('Kosten gespeichert ✓', 'success');
    await refreshCurrentView();
  }

  async function deleteCost() {
    if (!_editCostId || !confirm('Kosten löschen?')) return;
    await DB.deleteCost(_editCostId);
    closeOverlay('overlay-cost-form');
    toast('Gelöscht', 'success');
    await refreshCurrentView();
  }

  // ── IMPORT / EXPORT ──────────────────────────────────────────

  async function exportJSON() {
    const docs = await DB.exportAll();
    const payload = {
      app: 'tanklog', version: 2,
      exported: new Date().toISOString(),
      docs
    };
    _downloadBlob(JSON.stringify(payload, null, 2), 'application/json',
      `tanklog_backup_${new Date().toISOString().split('T')[0]}.json`);
    toast(`${docs.length} Dokumente exportiert`, 'success');
  }

  async function importJSON(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const docs = payload.docs || payload; // support both formats

      if (!Array.isArray(docs)) throw new Error('Ungültiges Format');

      const choice = confirm(
        `${docs.length} Dokumente gefunden.\n\n` +
        `OK = Merge (neuere Daten gewinnen)\n` +
        `Abbrechen = Ersetzen (alle lokalen Daten werden gelöscht)`
      );
      const mode = choice ? 'merge' : 'replace';

      const count = await DB.importAll(docs, mode);
      await refreshVehicles();
      updateVehicleSelect();
      toast(`${count} Dokumente importiert ✓`, 'success');
      await refreshCurrentView();
    } catch (e) {
      toast('Import-Fehler: ' + e.message, 'error');
    }
    input.value = '';
  }

  async function importCSV(input) {
    const file = input.files[0];
    if (!file) return;

    if (!_currentVehicleId) {
      toast('Kein Fahrzeug ausgewählt', 'error');
      input.value = '';
      return;
    }

    try {
      const text = await file.text();
      const { entries, skipped } = Calc.parseCSV(text, _currentVehicleId);

      // ── Deduplication ─────────────────────────────────────────
      // Fetch all existing entries once to avoid N separate DB calls
      const existing = await DB.getFuelEntries(_currentVehicleId);
      const TOLERANCE = 0.05;

      const toImport  = []; // genuinely new entries
      const dupes     = []; // exact duplicates (within tolerance) → skip silently
      const conflicts = []; // same key, values differ → report, don't import

      for (const entry of entries) {
        const { _csvRow, ...data } = entry; // strip internal row-tracking field

        if (data.odometer == null) {
          // Can't reliably deduplicate without odometer → treat as new
          toImport.push(data);
          continue;
        }

        const match = existing.find(e => e.date === data.date && e.odometer === data.odometer);

        if (!match) {
          // No match on (date + odometer) → new entry
          toImport.push(data);
        } else {
          const litDiff  = Math.abs((match.liters     || 0) - (data.liters     || 0));
          const costDiff = Math.abs((match.totalCost  || 0) - (data.totalCost  || 0));
          if (litDiff <= TOLERANCE && costDiff <= TOLERANCE) {
            dupes.push({ row: _csvRow });
          } else {
            conflicts.push({ row: _csvRow, entry: data, existing: match });
          }
        }
      }

      // Only import entries that passed deduplication
      if (toImport.length) await DB.importAll(toImport, 'merge');

      // ── Result dialog ─────────────────────────────────────────
      const bodyEl = document.getElementById('csv-result-body');
      let html = `
        <div style="font-family:var(--font-mono);font-size:13px;margin-bottom:14px;display:flex;flex-direction:column;gap:4px">
          <span style="color:var(--green)">✓ ${toImport.length} neu importiert</span>
          <span style="color:var(--t2)">= ${dupes.length} exakte Duplikate übersprungen</span>
          ${conflicts.length ? `<span style="color:var(--orange)">⚠ ${conflicts.length} Konflikte — nicht importiert</span>` : ''}
          ${skipped.length  ? `<span style="color:var(--orange)">⚠ ${skipped.length} ungültige Zeilen</span>` : ''}
        </div>`;

      if (conflicts.length) {
        html += `<div style="font-family:var(--font-mono);font-size:11px;color:var(--orange);margin-bottom:8px">
          Konflikte — gleiche(r) Datum + km, abweichende Werte. Bitte manuell prüfen:
        </div>`;
        for (const { row, entry, existing: ex } of conflicts) {
          html += `
            <div style="margin-bottom:10px;padding:10px;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.25);border-radius:8px;font-size:12px">
              <div style="font-family:var(--font-mono);font-size:11px;color:var(--t3);margin-bottom:6px">Z.${row} — ${entry.date}, ${entry.odometer} km</div>
              <div style="display:flex;gap:16px">
                <div><span style="color:var(--t2)">Vorhanden:</span>&nbsp;${(ex.liters||0).toFixed(2)} L &middot; ${(ex.totalCost||0).toFixed(2)} €</div>
                <div><span style="color:var(--orange)">CSV:</span>&nbsp;${(entry.liters||0).toFixed(2)} L &middot; ${(entry.totalCost||0).toFixed(2)} €</div>
              </div>
            </div>`;
        }
      }

      if (skipped.length) {
        html += `<div style="font-family:var(--font-mono);font-size:11px;color:var(--t2);margin-bottom:6px;margin-top:4px">Ungültige Zeilen:</div>`;
        html += skipped.map(s => `
          <div class="csv-result-row">
            <span class="csv-row-num">Z.${s.row}</span>
            <span class="csv-status" style="color:var(--orange)">⚠</span>
            <span class="csv-reason">${esc(s.reason)}</span>
          </div>`).join('');
      }

      html += `<button class="btn btn-primary btn-full" style="margin-top:16px" onclick="App.closeOverlay('overlay-csv-result')">Schließen</button>`;
      bodyEl.innerHTML = html;

      await refreshCurrentView();
      openOverlay('overlay-csv-result');
    } catch (e) {
      toast('CSV-Fehler: ' + e.message, 'error');
    }
    input.value = '';
  }

  async function clearAllData() {
    if (!confirm('ALLE lokalen Daten löschen? Nicht rückgängig machbar!')) return;
    await DB.clearAll();
    await refreshVehicles();
    _currentVehicleId = null;
    updateVehicleSelect();
    toast('Alle Daten gelöscht', 'warn');
    await renderHome();
  }

  // ── SETTINGS ────────────────────────────────────────────────

  function openSettings() {
    document.getElementById('set-warn-consumption').value = _settings.warnConsumption || 25;
    document.getElementById('set-remind-days').value = _settings.remindDays || 14;
    openOverlay('overlay-settings');
  }

  async function saveSettings() {
    _settings.warnConsumption = parseFloat(document.getElementById('set-warn-consumption').value) || 25;
    _settings.remindDays = parseInt(document.getElementById('set-remind-days').value) || 14;
    await DB.saveSettings(_settings);
    closeOverlay('overlay-settings');
    toast('Einstellungen gespeichert ✓', 'success');
  }

  // ── OVERLAYS ─────────────────────────────────────────────────

  function openOverlay(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeOverlay(id) {
    document.getElementById(id).classList.remove('open');
  }

  // Close overlay on outside click
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => {
      if (e.target === ov) ov.classList.remove('open');
    });
  });

  // ── TOAST ────────────────────────────────────────────────────

  let _toastTimer = null;
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + type;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = ''; }, 3200);
  }

  // ── HELPERS ──────────────────────────────────────────────────

  function _emptyState(icon, title, sub) {
    return `<div class="empty-state" style="padding:36px 20px">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${title}</div>
      <div class="empty-sub">${sub}</div>
    </div>`;
  }

  function _downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _populateFuelTypeDropdown(id) {
    const types = ['Benzin','Diesel','Hybrid (Benzin)','Hybrid (Diesel)','Elektro','LPG / Autogas','CNG','Sonstiges'];
    document.getElementById(id).innerHTML = types.map(t => `<option value="${t}">${t}</option>`).join('');
  }

  function _populateCostCategoryDropdown(id) {
    const cats = ['Versicherung','Steuer','Reparatur','Teile','Werkstatt','Reinigung','Zubehör','Sonstiges'];
    document.getElementById(id).innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  // ── PUBLIC API ───────────────────────────────────────────────
  async function login() {
    const email = document.getElementById('login-email')?.value.trim().toLowerCase();
    const password = document.getElementById('login-password')?.value || '';
    const errEl = document.getElementById('auth-error');

    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }

    if (!email || !password) {
      if (errEl) {
        errEl.textContent = 'E-Mail und Passwort eingeben';
        errEl.style.display = 'block';
      }
      return;
    }

    try {
      await API.login(email, password);
      document.getElementById('login-password').value = '';
      await init();
    } catch (error) {
      if (errEl) {
        errEl.textContent = error.message || 'Login fehlgeschlagen';
        errEl.style.display = 'block';
      }
    }
  }

  async function logout() {
    await API.logout();
    _session = null;
    _vehicles = [];
    _currentVehicleId = null;
    closeOverlay('overlay-settings');
    _showAuthScreen('Du wurdest abgemeldet.');
  }

  async function toggleSync() {
    toast('Server-Modus aktiv - separater CouchDB-Sync ist deaktiviert', 'warn');
  }

  async function syncNow() {
    toast('Alle Daten laufen bereits direkt ueber das Backend', 'success');
  }

  return {
    init, go, selectVehicle,
    openGarage, openVehicleForm, saveVehicle, deleteVehicle, selectAndEdit,
    openFuelEdit, saveFuelEdit, deleteFuelEntry,
    updateFuelPreview, saveFuelEntry,
    openMaintForm, saveMaint, deleteMaint, downloadMaintICS, downloadAllICS,
    openCostForm, saveCost, deleteCost,
    renderAnalyse, setAnalysePeriod,
    switchListTab, addFromList,
    toggleSync, syncNow,
    exportJSON, importJSON, importCSV, clearAllData,
    openSettings, saveSettings, login, logout,
    openOverlay, closeOverlay,
    // Vehicle DB picker
    vdbSelectBrand, vdbSelectModel, vdbSelectGeneration, vdbSelectVariant,
    vdbSelectTire, vdbApply, toggleVdbPicker,
    updatePlatePreview,
    toast
  };

})();

// ── BOOT ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => App.init());

// Helper escape for use in HTML onclick attributes
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
