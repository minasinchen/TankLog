/**
 * DB MODULE - Frontend data adapter backed by the API.
 *
 * Public shape stays compatible with the old app:
 * - _id for primary keys
 * - note / partialFill / reminderDaysBefore aliases
 * - local-only settings remain in localStorage
 */

const DB = (() => {
  const SETTINGS_KEY = "tanklog_settings";

  function _toDateOnly(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  function _toNum(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function _mapFuelTypeToApi(value) {
    const key = String(value || "").trim();
    const mapping = {
      Benzin: "PETROL",
      Diesel: "DIESEL",
      "Hybrid (Benzin)": "HYBRID_PETROL",
      "Hybrid (Diesel)": "HYBRID_DIESEL",
      Elektro: "ELECTRIC",
      "LPG / Autogas": "LPG",
      LPG: "LPG",
      CNG: "CNG",
      Sonstiges: "OTHER"
    };
    return mapping[key] || "OTHER";
  }

  function _mapFuelTypeFromApi(value) {
    const mapping = {
      PETROL: "Benzin",
      DIESEL: "Diesel",
      HYBRID_PETROL: "Hybrid (Benzin)",
      HYBRID_DIESEL: "Hybrid (Diesel)",
      ELECTRIC: "Elektro",
      LPG: "LPG / Autogas",
      CNG: "CNG",
      OTHER: "Sonstiges"
    };
    return mapping[value] || "Sonstiges";
  }

  function _mapVehicle(doc) {
    return {
      _id: doc.id,
      name: doc.name,
      make: doc.make || "",
      model: doc.model || "",
      variant: doc.variant || "",
      year: doc.year || null,
      plate: doc.plate || "",
      fuelType: _mapFuelTypeFromApi(doc.fuelType),
      engineCode: doc.engineCode || "",
      tireSize: doc.tireSize || "",
      oilSpec: doc.oilSpec || "",
      note: doc.notes || "",
      notes: doc.notes || "",
      createdAt: doc.createdAt ? Date.parse(doc.createdAt) : Date.now(),
      updatedAt: doc.updatedAt ? Date.parse(doc.updatedAt) : Date.now(),
      type: "vehicle"
    };
  }

  function _mapRefuel(doc) {
    return {
      _id: doc.id,
      vehicleId: doc.vehicleId,
      date: _toDateOnly(doc.date),
      liters: _toNum(doc.liters),
      totalCost: _toNum(doc.totalCost),
      pricePerLiter: _toNum(doc.pricePerLiter),
      odometer: doc.odometer || null,
      partialFill: !!doc.isPartial,
      note: doc.notes || "",
      createdAt: doc.createdAt ? Date.parse(doc.createdAt) : Date.now(),
      updatedAt: doc.updatedAt ? Date.parse(doc.updatedAt) : Date.now(),
      type: "fuel"
    };
  }

  function _mapMaintenance(doc) {
    return {
      _id: doc.id,
      vehicleId: doc.vehicleId,
      title: doc.title,
      date: _toDateOnly(doc.performedAt),
      dueDate: _toDateOnly(doc.dueDate),
      dueKm: doc.dueKm || null,
      reminderDaysBefore: doc.remindDays || null,
      reminderKmBefore: doc.remindKm || null,
      odometer: doc.odometer || null,
      cost: _toNum(doc.cost),
      note: doc.notes || "",
      createdAt: doc.createdAt ? Date.parse(doc.createdAt) : Date.now(),
      updatedAt: doc.updatedAt ? Date.parse(doc.updatedAt) : Date.now(),
      type: "maintenance"
    };
  }

  function _mapCost(doc) {
    return {
      _id: doc.id,
      vehicleId: doc.vehicleId,
      date: _toDateOnly(doc.date),
      category: doc.category,
      amount: _toNum(doc.amount),
      odometer: doc.odometer || null,
      note: doc.notes || "",
      createdAt: doc.createdAt ? Date.parse(doc.createdAt) : Date.now(),
      updatedAt: doc.updatedAt ? Date.parse(doc.updatedAt) : Date.now(),
      type: "cost"
    };
  }

  function _vehiclePayload(v) {
    return {
      name: v.name,
      make: v.make || null,
      model: v.model || null,
      variant: v.variant || null,
      year: v.year || null,
      plate: v.plate || null,
      fuelType: _mapFuelTypeToApi(v.fuelType),
      engineCode: v.engineCode || null,
      tireSize: v.tireSize || null,
      oilSpec: v.oilSpec || null,
      notes: v.note || v.notes || null
    };
  }

  function _refuelPayload(e) {
    const pricePerLiter = e.liters && e.totalCost ? Number(e.totalCost) / Number(e.liters) : null;
    return {
      vehicleId: e.vehicleId,
      date: e.date,
      liters: e.liters,
      totalCost: e.totalCost,
      pricePerLiter,
      odometer: e.odometer || null,
      isPartial: !!(e.partialFill || e.isPartial),
      notes: e.note || e.notes || null
    };
  }

  function _maintenancePayload(m) {
    return {
      vehicleId: m.vehicleId,
      title: m.title,
      performedAt: m.date || null,
      dueDate: m.dueDate || null,
      dueKm: m.dueKm || null,
      remindDays: m.reminderDaysBefore || null,
      remindKm: m.reminderKmBefore || null,
      odometer: m.odometer || null,
      cost: m.cost || null,
      notes: m.note || m.notes || null
    };
  }

  function _costPayload(c) {
    return {
      vehicleId: c.vehicleId,
      date: c.date,
      category: c.category,
      amount: c.amount,
      odometer: c.odometer || null,
      notes: c.note || c.notes || null
    };
  }

  async function getVehicles() {
    const docs = await API.request("/api/vehicles");
    return docs.map(_mapVehicle);
  }

  async function saveVehicle(v) {
    const path = v._id ? `/api/vehicles/${v._id}` : "/api/vehicles";
    const method = v._id ? "PUT" : "POST";
    const doc = await API.request(path, {
      method,
      body: _vehiclePayload(v)
    });
    return _mapVehicle(doc);
  }

  async function deleteVehicle(id) {
    const [refuels, maintenance, costs] = await Promise.all([
      getFuelEntries(id),
      getMaintenances(id),
      getCosts(id)
    ]);

    for (const entry of refuels) await deleteFuelEntry(entry._id);
    for (const item of maintenance) await deleteMaintenance(item._id);
    for (const item of costs) await deleteCost(item._id);

    await API.request(`/api/vehicles/${id}`, { method: "DELETE" });
  }

  async function getFuelEntries(vehicleId) {
    const query = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : "";
    const docs = await API.request(`/api/refuels${query}`);
    return docs
      .map(_mapRefuel)
      .sort((a, b) => {
        const dd = a.date.localeCompare(b.date);
        return dd !== 0 ? dd : (a.odometer || 0) - (b.odometer || 0);
      });
  }

  async function saveFuelEntry(e) {
    const path = e._id ? `/api/refuels/${e._id}` : "/api/refuels";
    const method = e._id ? "PUT" : "POST";
    const doc = await API.request(path, {
      method,
      body: _refuelPayload(e)
    });
    return _mapRefuel(doc);
  }

  async function deleteFuelEntry(id) {
    await API.request(`/api/refuels/${id}`, { method: "DELETE" });
  }

  async function findMatchingFuelEntry(vehicleId, date, odometer) {
    if (odometer == null) return null;
    const entries = await getFuelEntries(vehicleId);
    return entries.find((entry) => entry.date === date && entry.odometer === odometer) || null;
  }

  async function getMaintenances(vehicleId) {
    const query = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : "";
    const docs = await API.request(`/api/maintenance${query}`);
    return docs.map(_mapMaintenance);
  }

  async function getAllMaintenances() {
    const docs = await API.request("/api/maintenance");
    return docs.map(_mapMaintenance);
  }

  async function saveMaintenance(m) {
    const path = m._id ? `/api/maintenance/${m._id}` : "/api/maintenance";
    const method = m._id ? "PUT" : "POST";
    const doc = await API.request(path, {
      method,
      body: _maintenancePayload(m)
    });
    return _mapMaintenance(doc);
  }

  async function deleteMaintenance(id) {
    await API.request(`/api/maintenance/${id}`, { method: "DELETE" });
  }

  async function getCosts(vehicleId) {
    const query = vehicleId ? `?vehicleId=${encodeURIComponent(vehicleId)}` : "";
    const docs = await API.request(`/api/costs${query}`);
    return docs.map(_mapCost);
  }

  async function saveCost(c) {
    const path = c._id ? `/api/costs/${c._id}` : "/api/costs";
    const method = c._id ? "PUT" : "POST";
    const doc = await API.request(path, {
      method,
      body: _costPayload(c)
    });
    return _mapCost(doc);
  }

  async function deleteCost(id) {
    await API.request(`/api/costs/${id}`, { method: "DELETE" });
  }

  async function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { warnConsumption: 25, remindDays: 14 };
    } catch {
      return { warnConsumption: 25, remindDays: 14 };
    }
  }

  async function saveSettings(settings) {
    const next = {
      warnConsumption: Number(settings.warnConsumption) || 25,
      remindDays: Number(settings.remindDays) || 14
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  async function exportAll() {
    const [vehicles, refuels, maintenance, costs, settings] = await Promise.all([
      getVehicles(),
      getFuelEntries(""),
      getAllMaintenances(),
      getCosts(""),
      getSettings()
    ]);

    return [
      ...vehicles,
      ...refuels,
      ...maintenance,
      ...costs,
      { _id: "settings", type: "settings", ...settings }
    ];
  }

  async function importAll(docs, mode = "merge") {
    if (mode === "replace") {
      await clearAll();
    }

    const vehicleMap = {};
    const existingVehicles = await getVehicles();
    for (const vehicle of existingVehicles) {
      vehicleMap[vehicle._id] = vehicle._id;
    }

    let count = 0;
    const sorted = [...docs].filter((doc) => doc && doc.type !== "settings");

    for (const doc of sorted.filter((item) => item.type === "vehicle")) {
      let saved;
      if (doc._id && vehicleMap[doc._id]) {
        saved = await saveVehicle({ ...doc, _id: vehicleMap[doc._id] });
      } else {
        saved = await saveVehicle(doc);
      }
      vehicleMap[doc._id || saved._id] = saved._id;
      count += 1;
    }

    for (const doc of sorted.filter((item) => item.type === "fuel")) {
      const vehicleId = vehicleMap[doc.vehicleId];
      if (!vehicleId) continue;
      const { _id: docId, ...payloadWithoutId } = { ...doc, vehicleId };
      if (docId) {
        try {
          await saveFuelEntry({ ...payloadWithoutId, _id: docId });
        } catch {
          await saveFuelEntry(payloadWithoutId);
        }
      } else {
        await saveFuelEntry(payloadWithoutId);
      }
      count += 1;
    }

    for (const doc of sorted.filter((item) => item.type === "maintenance")) {
      const vehicleId = vehicleMap[doc.vehicleId];
      if (!vehicleId) continue;
      const { _id: docId, ...payloadWithoutId } = { ...doc, vehicleId };
      if (docId) {
        try {
          await saveMaintenance({ ...payloadWithoutId, _id: docId });
        } catch {
          await saveMaintenance(payloadWithoutId);
        }
      } else {
        await saveMaintenance(payloadWithoutId);
      }
      count += 1;
    }

    for (const doc of sorted.filter((item) => item.type === "cost")) {
      const vehicleId = vehicleMap[doc.vehicleId];
      if (!vehicleId) continue;
      const { _id: docId, ...payloadWithoutId } = { ...doc, vehicleId };
      if (docId) {
        try {
          await saveCost({ ...payloadWithoutId, _id: docId });
        } catch {
          await saveCost(payloadWithoutId);
        }
      } else {
        await saveCost(payloadWithoutId);
      }
      count += 1;
    }

    const settingsDoc = docs.find((doc) => doc && doc.type === "settings");
    if (settingsDoc) {
      await saveSettings(settingsDoc);
      count += 1;
    }

    return count;
  }

  async function clearAll() {
    const [refuels, maintenance, costs, vehicles] = await Promise.all([
      getFuelEntries(""),
      getAllMaintenances(),
      getCosts(""),
      getVehicles()
    ]);

    for (const entry of refuels) await deleteFuelEntry(entry._id);
    for (const item of maintenance) await deleteMaintenance(item._id);
    for (const item of costs) await deleteCost(item._id);
    for (const vehicle of vehicles) await deleteVehicle(vehicle._id);
  }

  return {
    getVehicles, saveVehicle, deleteVehicle,
    getFuelEntries, saveFuelEntry, deleteFuelEntry, findMatchingFuelEntry,
    getMaintenances, getAllMaintenances, saveMaintenance, deleteMaintenance,
    getCosts, saveCost, deleteCost,
    getSettings, saveSettings,
    exportAll, importAll, clearAll
  };
})();
