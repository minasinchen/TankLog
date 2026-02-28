/**
 * CALC MODULE — Derived values, CSV parsing, ICS generation
 */

const Calc = {

  // ── Fuel enrichment ─────────────────────────────────────────

  /**
   * Enrich sorted fuel entries with derived fields:
   * pricePerLiter, drivenKm, consumption, costPer100km
   */
  enrichFuel(entries) {
    // Must be sorted by date/odometer ascending
    const sorted = [...entries].sort((a, b) => {
      const dd = a.date.localeCompare(b.date);
      return dd !== 0 ? dd : (a.odometer || 0) - (b.odometer || 0);
    });

    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      e.pricePerLiter = (e.liters > 0 && e.totalCost > 0)
        ? +((e.totalCost / e.liters).toFixed(4)) : null;

      // Find previous full fill (not partial) with valid odometer
      if (i > 0 && e.odometer) {
        // Walk backwards to find usable previous entry
        let prev = null;
        for (let j = i - 1; j >= 0; j--) {
          if (sorted[j].odometer && sorted[j].odometer < e.odometer) {
            prev = sorted[j];
            break;
          }
        }
        if (prev) {
          const driven = e.odometer - prev.odometer;
          if (driven > 0) {
            e.drivenKm = driven;
            // Only calc consumption if current fill is full (not partial)
            if (!e.partialFill && e.liters > 0) {
              e.consumption = +((e.liters / driven * 100).toFixed(2));
              e.costPer100km = +((e.totalCost / driven * 100).toFixed(2));
            } else {
              e.consumption = null;
              e.costPer100km = null;
            }
          } else {
            e.drivenKm = null; e.consumption = null; e.costPer100km = null;
          }
        } else {
          e.drivenKm = null; e.consumption = null; e.costPer100km = null;
        }
      } else {
        e.drivenKm = null; e.consumption = null; e.costPer100km = null;
      }
    }
    return sorted;
  },

  /**
   * Validate a new fuel entry against existing ones
   * Returns { valid, errors[], warnings[] }
   */
  validateFuel(entry, existingEnriched) {
    const errors = [], warnings = [];
    if (!entry.date) errors.push('Datum fehlt');
    if (!entry.liters || entry.liters <= 0) errors.push('Liter muss > 0 sein');
    if (!entry.totalCost || entry.totalCost <= 0) errors.push('Betrag muss > 0 sein');

    if (entry.odometer && existingEnriched.length > 0) {
      const maxOdo = Math.max(...existingEnriched.map(e => e.odometer || 0));
      if (entry.odometer < maxOdo) {
        errors.push(`km-Stand (${entry.odometer}) muss ≥ letztem km-Stand (${maxOdo}) sein`);
      }
    }

    // Plausibility warnings
    if (entry.liters > 200) warnings.push('Ungewöhnlich viele Liter');
    if (entry.totalCost > 500) warnings.push('Ungewöhnlich hoher Betrag');
    const ppl = entry.totalCost / entry.liters;
    if (ppl < 0.5 || ppl > 4.0) warnings.push(`Ungewöhnlicher Preis: ${ppl.toFixed(3)} €/L`);

    return { valid: errors.length === 0, errors, warnings };
  },

  /**
   * Summary statistics for a set of enriched fuel entries
   */
  summary(enriched, periodDays = null) {
    let entries = enriched;
    if (periodDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - periodDays);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      entries = enriched.filter(e => e.date >= cutoffStr);
    }

    const validCons = entries.filter(e => e.consumption && !e.partialFill);
    const totalCost = entries.reduce((s, e) => s + (e.totalCost || 0), 0);
    const totalLiters = entries.reduce((s, e) => s + (e.liters || 0), 0);
    const avgCons = validCons.length
      ? validCons.reduce((s, e) => s + e.consumption, 0) / validCons.length : null;
    const avgPpl = entries.length
      ? entries.filter(e => e.pricePerLiter).reduce((s, e) => s + e.pricePerLiter, 0)
        / entries.filter(e => e.pricePerLiter).length : null;
    const totalKm = entries.filter(e => e.drivenKm).reduce((s, e) => s + e.drivenKm, 0);
    const avgCostPer100 = (avgCons && avgPpl) ? +(avgCons * avgPpl).toFixed(2) : null;

    // Last 5 fills
    const last5 = validCons.slice(-5);
    const avgConsLast5 = last5.length
      ? last5.reduce((s, e) => s + e.consumption, 0) / last5.length : null;

    return {
      count: entries.length, totalCost, totalLiters, avgCons,
      avgPpl, totalKm, avgCostPer100, avgConsLast5
    };
  },


  // ── Date / number helpers ────────────────────────────────────

  parseDE(s) {
    if (s == null || s === '') return null;
    const str = String(s).trim();
    // Remove thousand-separators (dot before comma) → "1.234,56" → "1234.56"
    const cleaned = str.replace(/\.(?=\d{3}[,])/g, '').replace(',', '.');
    const v = parseFloat(cleaned);
    return isNaN(v) ? null : v;
  },

  parseDateDE(s) {
    if (!s) return null;
    s = s.trim();
    // ISO yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // dd.mm.yyyy or dd/mm/yyyy
    const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  },

  fmtDate(isoDate, short = false) {
    if (!isoDate) return '—';
    const [y, m, d] = isoDate.split('-');
    return short ? `${d}.${m}` : `${d}.${m}.${y}`;
  },

  fmtNum(v, dec = 1) {
    if (v == null || isNaN(v)) return '—';
    return v.toFixed(dec);
  },

  fmtEuro(v) {
    if (v == null || isNaN(v)) return '—';
    return v.toFixed(2) + ' €';
  },


  // ── CSV Parser ───────────────────────────────────────────────

  /**
   * Parse CSV for a given vehicleId.
   * Supports , ; \t delimiters, German decimal commas, quoted fields,
   * dd.mm.yyyy and yyyy-mm-dd dates.
   *
   * Returns { entries[], skipped[{row, reason}] }
   */
  parseCSV(text, vehicleId) {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const entries = [], skipped = [];

    // Detect delimiter
    const firstLine = lines[0] || '';
    const delim = firstLine.includes(';') ? ';'
                : firstLine.includes('\t') ? '\t' : ',';

    // Check if first row is a header (contains non-numeric fields)
    let startRow = 0;
    const probablyHeader = /datum|date|km|liter|euro|betrag|notiz/i.test(firstLine);
    if (probablyHeader) startRow = 1;

    for (let i = startRow; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const parts = this._splitCSVLine(line, delim);
      const rowNum = i + 1;

      if (parts.length < 4) {
        skipped.push({ row: rowNum, reason: 'Zu wenige Felder (min. 4: datum,km,liter,euro)' });
        continue;
      }

      const dateRaw = parts[0];
      const kmRaw   = parts[1];
      const litRaw  = parts[2];
      const eurRaw  = parts[3];
      const noteRaw = parts[4] || '';

      const date = this.parseDateDE(dateRaw);
      if (!date) {
        skipped.push({ row: rowNum, reason: `Datum ungültig: "${dateRaw}"` });
        continue;
      }

      const liters = this.parseDE(litRaw);
      if (liters == null || liters <= 0) {
        skipped.push({ row: rowNum, reason: `Liter ungültig: "${litRaw}"` });
        continue;
      }

      const totalCost = this.parseDE(eurRaw);
      if (totalCost == null || totalCost <= 0) {
        skipped.push({ row: rowNum, reason: `Betrag ungültig: "${eurRaw}"` });
        continue;
      }

      const odometer = this.parseDE(kmRaw);

      // _id is assigned in importCSV after deduplication, not here
      entries.push({
        _csvRow: rowNum,
        type: 'fuel',
        vehicleId,
        date,
        odometer: (odometer && odometer > 0) ? Math.round(odometer) : null,
        liters,
        totalCost,
        note: noteRaw.trim(),
        partialFill: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    return { entries, skipped };
  },

  _splitCSVLine(line, delim) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  },


  // ── ICS Generator ────────────────────────────────────────────

  generateICS(maintenance, vehicleName) {
    if (!maintenance.dueDate) return null;

    const dtstart = maintenance.dueDate.replace(/-/g, '');
    const dtend = dtstart; // all-day
    const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    const uid = `tanklog-${maintenance._id}@tanklog-app`;
    const summary = this._icsEscape(`${maintenance.title} — ${vehicleName}`);
    const desc = this._icsEscape(maintenance.note || '');

    let ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TankLog//TankLog//DE',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dtstart}`,
      `DTEND;VALUE=DATE:${dtend}`,
      `SUMMARY:${summary}`,
    ];

    if (desc) ics.push(`DESCRIPTION:${desc}`);
    if (maintenance.reminderDaysBefore) {
      ics.push('BEGIN:VALARM');
      ics.push(`TRIGGER:-P${maintenance.reminderDaysBefore}D`);
      ics.push('ACTION:DISPLAY');
      ics.push(`DESCRIPTION:Erinnerung: ${summary}`);
      ics.push('END:VALARM');
    }

    ics.push('END:VEVENT');
    ics.push('END:VCALENDAR');
    return ics.join('\r\n');
  },

  generateICSAll(maintenances, vehicleMap) {
    const events = [];
    for (const m of maintenances) {
      if (!m.dueDate) continue;
      const vName = vehicleMap[m.vehicleId] || 'Unbekannt';
      const inner = this.generateICS(m, vName);
      if (!inner) continue;
      // Extract VEVENT block
      const match = inner.match(/BEGIN:VEVENT[\s\S]+?END:VEVENT/);
      if (match) events.push(match[0]);
    }
    if (!events.length) return null;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TankLog//TankLog//DE',
      'CALSCALE:GREGORIAN',
      ...events,
      'END:VCALENDAR'
    ].join('\r\n');
  },

  _icsEscape(s) {
    return s.replace(/[,;\\]/g, c => '\\' + c).replace(/\n/g, '\\n');
  },


  // ── Date utils ───────────────────────────────────────────────

  daysUntil(isoDate) {
    if (!isoDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = new Date(isoDate + 'T00:00:00');
    return Math.round((target - today) / 86400000);
  },

  monthlyGroupCosts(entries) {
    // Group cost entries + fuel entries by month
    const map = {};
    for (const e of entries) {
      const m = e.date.slice(0, 7); // "YYYY-MM"
      if (!map[m]) map[m] = 0;
      map[m] += e.totalCost || e.amount || 0;
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }
};
