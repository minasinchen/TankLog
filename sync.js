/**
 * SYNC MODULE — CouchDB live sync via PouchDB
 *
 * Strategy: PouchDB local DB ↔ CouchDB on NAS
 * - live: true  → continuous replication
 * - retry: true → auto-reconnect on network failures
 * - Conflict resolution: last-write-wins by updatedAt field
 */

const Sync = (() => {
  let _syncHandler = null;
  let _remoteDb = null;
  let _status = 'offline'; // offline | connecting | online | syncing | error
  let _lastSync = null;
  let _onChangeCallback = null;

  const STORAGE_KEY = 'tanklog_sync_config';

  // ── Config persistence ──────────────────────────────────────

  function getConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // ── Status ──────────────────────────────────────────────────

  function setStatus(s, detail = '') {
    _status = s;
    const bar = document.getElementById('sync-bar');
    const dot = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    const badge = document.getElementById('sync-badge');
    const detailEl = document.getElementById('sync-detail-text');
    const btn = document.getElementById('sync-connect-btn');

    if (!bar) return;

    bar.className = 'sync-bar sync-' + s;

    const msgs = {
      offline:     'Offline — nur lokale Daten',
      connecting:  'Verbinde mit NAS…',
      online:      'Verbunden — Live-Sync aktiv',
      syncing:     'Synchronisiere…',
      error:       'Sync-Fehler — retry…'
    };
    label.textContent = msgs[s] || s;

    if (badge) {
      badge.textContent = s === 'online' || s === 'syncing' ? 'Aktiv' : 'Aus';
      badge.className = 'badge ' + (s === 'online' || s === 'syncing' ? 'badge-green' : 'badge-amber');
    }

    if (detailEl) {
      if (detail) detailEl.textContent = detail;
      else if (_lastSync) detailEl.textContent = `Letzter Sync: ${new Date(_lastSync).toLocaleTimeString('de')}`;
      else detailEl.textContent = s === 'offline' ? 'Nicht verbunden' : msgs[s];
    }

    if (btn) {
      btn.textContent = (s === 'online' || s === 'syncing') ? 'Trennen' : 'Verbinden';
    }
  }

  // ── Connect ─────────────────────────────────────────────────

  async function connect(url, username, password) {
    if (_syncHandler) disconnect();

    setStatus('connecting');

    try {
      const opts = { skip_setup: true };
      if (username && password) {
        opts.auth = { username, password };
      }

      _remoteDb = new PouchDB(url, opts);

      // Test connection
      await _remoteDb.info();

      _syncHandler = DB.getDb().sync(_remoteDb, {
        live: true,
        retry: true
      })
        .on('change', info => {
          _lastSync = Date.now();
          setStatus('syncing', `${info.direction}: ${info.change.docs_written || 0} Dok.`);
          setTimeout(() => setStatus('online'), 2000);
          if (_onChangeCallback) _onChangeCallback();
        })
        .on('paused', () => {
          _lastSync = Date.now();
          setStatus('online');
        })
        .on('active', () => {
          setStatus('syncing');
        })
        .on('denied', err => {
          setStatus('error', 'Zugriff verweigert: ' + (err.message || ''));
          console.error('Sync denied:', err);
        })
        .on('error', err => {
          setStatus('error', err.message || 'Unbekannter Fehler');
          console.error('Sync error:', err);
        })
        .on('complete', () => {
          setStatus('offline');
        });

      // Save config
      saveConfig({ url, username, password });
      setStatus('online');
      return true;

    } catch (err) {
      console.error('Connect failed:', err);
      setStatus('error', err.message || 'Verbindung fehlgeschlagen');
      _remoteDb = null;
      return false;
    }
  }

  function disconnect() {
    if (_syncHandler) {
      try { _syncHandler.cancel(); } catch {}
      _syncHandler = null;
    }
    _remoteDb = null;
    _lastSync = null;
    setStatus('offline');
    clearConfig();
  }

  async function syncNow() {
    if (!_remoteDb) return false;
    setStatus('syncing', 'Manueller Sync…');
    try {
      const result = await DB.getDb().sync(_remoteDb);
      _lastSync = Date.now();
      setStatus('online', `Sync abgeschlossen: ${result.push.docs_written + result.pull.docs_written} Dok.`);
      setTimeout(() => setStatus('online'), 3000);
      if (_onChangeCallback) _onChangeCallback();
      return true;
    } catch (err) {
      setStatus('error', err.message);
      return false;
    }
  }

  function isConnected() {
    return _status === 'online' || _status === 'syncing';
  }

  function onRemoteChange(fn) {
    _onChangeCallback = fn;
  }

  // ── Auto-reconnect on startup ────────────────────────────────

  async function autoConnect() {
    const cfg = getConfig();
    if (cfg && cfg.url) {
      await connect(cfg.url, cfg.username, cfg.password);
    }
  }

  return {
    connect, disconnect, syncNow,
    isConnected, getConfig, onRemoteChange,
    autoConnect, setStatus
  };
})();
