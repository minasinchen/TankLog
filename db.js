/**
 * DB MODULE — PouchDB abstraction for TankLog
 *
 * Document types:
 *   vehicle     → _id: "vehicle_{uuid}"
 *   fuel        → _id: "fuel_{vehicleId}_{isoDate}_{uuid}"
 *   maintenance → _id: "maint_{vehicleId}_{uuid}"
 *   cost        → _id: "cost_{vehicleId}_{isoDate}_{uuid}"
 *   settings    → _id: "settings"
 */

const DB = (() => {
  let _db = null;

  function getDb() {
    if (!_db) _db = new PouchDB('tanklog_v2');
    return _db;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Generic ──────────────────────────────────────────────────

  async function getAll() {
    const result = await getDb().allDocs({ include_docs: true });
    return result.rows
      .filter(r => !r.id.startsWith('_'))
      .map(r => r.doc);
  }

  async function get(id) {
    try { return await getDb().get(id); }
    catch(e) { return null; }
  }

  async function put(doc) {
    doc.updatedAt = Date.now();
    if (!doc._id) throw new Error('No _id');
    const existing = await get(doc._id);
    if (existing) doc._rev = existing._rev;
    return getDb().put(doc);
  }

  async function remove(id) {
    const doc = await get(id);
    if (doc) return getDb().remove(doc);
  }

  async function clearAll() {
    const db = getDb();
    const all = await db.allDocs({ include_docs: true });
    const dels = all.rows
      .filter(r => !r.id.startsWith('_'))
      .map(r => ({ ...r.doc, _deleted: true }));
    if (dels.length) return db.bulkDocs(dels);
  }

  // ── Vehicles ─────────────────────────────────────────────────

  async function getVehicles() {
    const all = await getAll();
    return all.filter(d => d.type === 'vehicle')
              .sort((a, b) => a.createdAt - b.createdAt);
  }

  async function saveVehicle(v) {
    if (!v._id) {
      v._id = 'vehicle_' + uid();
      v.createdAt = Date.now();
    }
    v.type = 'vehicle';
    return put(v);
  }

  async function deleteVehicle(id) {
    // Also delete all related docs
    const all = await getAll();
    const related = all.filter(d =>
      d.vehicleId === id ||
      (d.type === 'vehicle' && d._id === id)
    );
    if (related.length) {
      const dels = related.map(d => ({ ...d, _deleted: true }));
      await getDb().bulkDocs(dels);
    }
  }

  // ── Fuel Entries ──────────────────────────────────────────────

  async function getFuelEntries(vehicleId) {
    const all = await getAll();
    return all
      .filter(d => d.type === 'fuel' && d.vehicleId === vehicleId)
      .sort((a, b) => {
        const dd = a.date.localeCompare(b.date);
        return dd !== 0 ? dd : (a.odometer || 0) - (b.odometer || 0);
      });
  }

  async function saveFuelEntry(e) {
    if (!e._id) {
      e._id = `fuel_${e.vehicleId}_${e.date}_${uid()}`;
      e.createdAt = Date.now();
    }
    e.type = 'fuel';
    return put(e);
  }

  async function deleteFuelEntry(id) {
    return remove(id);
  }

  /**
   * Find an existing fuel entry matching vehicleId + date + odometer.
   * Returns the first match or null. Used for CSV import deduplication.
   */
  async function findMatchingFuelEntry(vehicleId, date, odometer) {
    if (odometer == null) return null; // odometer required for reliable matching
    const entries = await getFuelEntries(vehicleId);
    return entries.find(e => e.date === date && e.odometer === odometer) || null;
  }

  // ── Maintenance ───────────────────────────────────────────────

  async function getMaintenances(vehicleId) {
    const all = await getAll();
    return all
      .filter(d => d.type === 'maintenance' && d.vehicleId === vehicleId)
      .sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.createdAt - b.createdAt;
      });
  }

  async function getAllMaintenances() {
    const all = await getAll();
    return all.filter(d => d.type === 'maintenance');
  }

  async function saveMaintenance(m) {
    if (!m._id) {
      m._id = `maint_${m.vehicleId}_${uid()}`;
      m.createdAt = Date.now();
    }
    m.type = 'maintenance';
    return put(m);
  }

  async function deleteMaintenance(id) {
    return remove(id);
  }

  // ── Costs ─────────────────────────────────────────────────────

  async function getCosts(vehicleId) {
    const all = await getAll();
    return all
      .filter(d => d.type === 'cost' && d.vehicleId === vehicleId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async function saveCost(c) {
    if (!c._id) {
      c._id = `cost_${c.vehicleId}_${c.date}_${uid()}`;
      c.createdAt = Date.now();
    }
    c.type = 'cost';
    return put(c);
  }

  async function deleteCost(id) {
    return remove(id);
  }

  // ── Settings ──────────────────────────────────────────────────

  async function getSettings() {
    const s = await get('settings');
    return s || { _id: 'settings', type: 'settings', warnConsumption: 25, remindDays: 14 };
  }

  async function saveSettings(s) {
    s._id = 'settings';
    s.type = 'settings';
    return put(s);
  }

  // ── Full Export / Import ──────────────────────────────────────

  async function exportAll() {
    return getAll();
  }

  async function importAll(docs, mode = 'merge') {
    const db = getDb();
    if (mode === 'replace') await clearAll();

    const toWrite = [];
    for (const doc of docs) {
      if (!doc._id || doc._id.startsWith('_')) continue;
      const existing = await get(doc._id);
      const d = { ...doc };
      delete d._rev;
      if (existing) {
        // last-write-wins by updatedAt
        if ((d.updatedAt || 0) >= (existing.updatedAt || 0)) {
          d._rev = existing._rev;
          toWrite.push(d);
        }
      } else {
        toWrite.push(d);
      }
    }
    if (toWrite.length) await db.bulkDocs(toWrite);
    return toWrite.length;
  }

  return {
    getDb,
    getVehicles, saveVehicle, deleteVehicle,
    getFuelEntries, saveFuelEntry, deleteFuelEntry, findMatchingFuelEntry,
    getMaintenances, getAllMaintenances, saveMaintenance, deleteMaintenance,
    getCosts, saveCost, deleteCost,
    getSettings, saveSettings,
    exportAll, importAll, clearAll
  };
})();
