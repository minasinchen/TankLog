/**
 * TankLog OCR — Rectify v7
 *
 * NEU in v7:
 * ✅ Strikte Konsistenzprüfung: Auto-Korrektur nur wenn BEIDE Quellfelder stark genug sind.
 * ✅ contextStrength pro Kandidat: 'labeled' > 'label-nearby' > 'isolated' > 'brute-force'.
 * ✅ Abgeleiteter ppl wird nur gesetzt, wenn Liter-Quelle nicht 'brute-force' ist.
 * ✅ ppl-Ableitung außerhalb [0.900–3.000] wird still verworfen (kein falscher Wert im Feld).
 * ✅ Tap-Workflow: Nutzer tippt direkt auf Beleg-Region → OCR nur diese Zone.
 * ✅ Status pro Feld: 'safe' / 'uncertain' / 'derived' / 'conflicting' / 'missing'.
 * ✅ UI zeigt Alternativen wenn ppl-Kandidaten eng beieinander liegen.
 *
 * Aus v6:
 * ✅ EXIF-Rotation, Bildvorverarbeitung, Auflösungsbegrenzung, Liter-Sanity.
 */

const OCR = (() => {

  // ─────────────────────────────────────────────────────────────
  // Debug / state
  // ─────────────────────────────────────────────────────────────
  let _lastText = '';
  let _lastParsed = null;
  let _lastWords = []; // Tesseract word-level bounding boxes für Position-Overlay

  // ─────────────────────────────────────────────────────────────
  // Tesseract worker
  // ─────────────────────────────────────────────────────────────
  let _worker = null;
  let _workerReady = false;
  let _loading = false;

  async function initWorker(onProgress) {
    if (_worker && _workerReady) return _worker;
    if (_loading) {
      while (_loading) await new Promise(r => setTimeout(r, 80));
      return _worker;
    }
    _loading = true;
    try {
      _worker = await Tesseract.createWorker('deu', 1, {
        logger: m => {
          if (!onProgress) return;
          if (m.status === 'recognizing text') {
            onProgress(Math.round((m.progress || 0) * 100), 'Erkenne Text…');
          } else if (m.status) {
            onProgress(null, m.status);
          }
        },
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      });
      try {
        await _worker.setParameters({
          tessedit_pageseg_mode: '6',
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        });
      } catch (_) {}
      _workerReady = true;
    } finally {
      _loading = false;
    }
    return _worker;
  }

  async function recognize(imageOrCanvas, onProgress) {
    if (onProgress) onProgress(5, 'Lade OCR-Engine…');
    const worker = await initWorker(onProgress);
    if (onProgress) onProgress(20, 'Analysiere Bild…');
    const { data } = await worker.recognize(imageOrCanvas);
    // Wort-Koordinaten für Position-Overlay speichern
    _lastWords = (data.words || []).filter(w => w.text && w.text.trim());
    if (onProgress) onProgress(100, 'Fertig');
    return data.text || '';
  }

  // ─────────────────────────────────────────────────────────────
  // 4-point UI state
  // ─────────────────────────────────────────────────────────────
  let _srcBitmap = null;
  let _srcW = 0, _srcH = 0;
  let _cropPts = null;
  let _activeIdx = -1;

  let _ui = {
    wrap: null,
    canvas: null,
    ctx: null,
    handles: [],
    enabled: false,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dispW: 0,
    dispH: 0,
    previewEl: null,
    btnAuto: null,
  };

  // Für Tap-Workflow: zuletzt verwendetes begradigtes Canvas
  let _lastWarped = null;
  // Tap-Modus: welches Feld wird getippt ('liters'|'totalCost'|'pricePerLiter'|'odometer'|null)
  let _tapTarget = null;

  // ─────────────────────────────────────────────────────────────
  // Plausibilitätsgrenzen für Kraftstoff (DE/EU)
  // ─────────────────────────────────────────────────────────────

  const _RANGES = {
    liters:        { safe: [5, 120],     warn: [2, 200]   },
    totalCost:     { safe: [5, 300],     warn: [2, 500]   },
    pricePerLiter: { safe: [0.600, 2.500], warn: [0.450, 3.200] },
  };

  // Gibt 'safe' | 'warn' | 'outside' zurück
  function _rangeStatus(field, v) {
    if (v == null) return 'outside';
    const r = _RANGES[field];
    if (!r) return 'safe';
    if (v >= r.safe[0] && v <= r.safe[1]) return 'safe';
    if (v >= r.warn[0] && v <= r.warn[1]) return 'warn';
    return 'outside';
  }

  // Ein Feld gilt als "stark" für die Konsistenzprüfung:
  // totalCost / liters: conf >= 0.72 und kein 'brute-force'-Ursprung
  // pricePerLiter:      zusätzlich contextStrength === 'labeled' oder 'label-nearby'
  function _isStrong(f, fieldName) {
    if (!f || !f.value) return false;
    if (fieldName === 'pricePerLiter') {
      return (f.contextStrength === 'labeled' || f.contextStrength === 'label-nearby' ||
              f.contextStrength === 'derived'  || f.contextStrength === 'manual') && f.conf >= 0.70;
    }
    return f.conf >= 0.72 && f.contextStrength !== 'brute-force';
  }

  // ─────────────────────────────────────────────────────────────
  // Parser — v7: strikte Konsistenz + contextStrength
  // ─────────────────────────────────────────────────────────────

  function parse(text) {
    const flat = _normalizeOCRText(text);
    const lines = flat.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
      date:          { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
      liters:        { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
      totalCost:     { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
      pricePerLiter: { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
    };
    let totalFallbackCandidates = [];

    // ── DATE ────────────────────────────────────────────────────
    for (const dm of flat.matchAll(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/g)) {
      const iso = _parseDate(dm[1]);
      if (iso) {
        result.date = { value: iso, raw: dm[1], conf: 0.70 };
        break;
      }
    }

    // ── TOTAL COST ───────────────────────────────────────────────
    const totalKeySameLineRE =
      /(?:gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|zu\s+zahlen|zahlbetrag|betrag)\b[^\d]{0,40}([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)?/gi;
    for (const m of flat.matchAll(totalKeySameLineRE)) {
      const v = _parseMoney(m[1]);
      if (v && v > 2 && v < 1000) {
        result.totalCost = { value: v, raw: m[1], conf: 0.92 };
        break;
      }
    }
    if (!result.totalCost.value) {
      const keyLineRE = /(gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|zu\s+zahlen|zahlbetrag|betrag)/i;
      for (let i = 0; i < lines.length; i++) {
        if (!keyLineRE.test(lines[i])) continue;
        const look = [lines[i], lines[i+1], lines[i+2], lines[i+3]].filter(Boolean).join(' ');
        const m = look.match(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/i);
        if (m) {
          const v = _parseMoney(m[1]);
          if (v && v > 2 && v < 500) {
            result.totalCost = { value: v, raw: m[1], conf: 0.80 };
            break;
          }
        }
      }
    }
    if (!result.totalCost.value) {
      const money = [...flat.matchAll(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/gi)]
        .map(m => ({ raw: m[1], value: _parseMoney(m[1]) }))
        .filter(x => x.value && x.value > 2 && x.value < 500);
      if (money.length) {
        money.sort((a,b) => b.value - a.value);
        result.totalCost = { value: money[0].value, raw: money[0].raw, conf: 0.60 };
      }
    }
    // Kraftstoff-Produktzeile als zusätzliche Quelle: "*000003 Diesel  49,43 EUR"
    // Wird als Fallback gesetzt, aber auch als Alternativkandidat für das Einkaufs-Szenario
    // (Gesamtbetrag enthält Nicht-Kraftstoff-Artikel → Produktzeilen-Betrag ist korrekt).
    if (!result.totalCost.value) {
      const fuelProductLineRE = /\b(diesel|super\s*e?10?|e10|e5|benzin|lpg|autogas|kraftstoff)\b/i;
      for (const line of lines) {
        if (!fuelProductLineRE.test(line)) continue;
        const m = line.match(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/i);
        if (m) {
          const v = _parseMoney(m[1]);
          if (v && v > 2 && v < 500) {
            result.totalCost = { value: v, raw: m[1], conf: 0.78, contextStrength: 'fuel-product-line' };
            break;
          }
        }
      }
    }

    // ── PRICE PER LITER ──────────────────────────────────────────
    totalFallbackCandidates = _collectTotalFallbackCandidates(lines);
    const pplCandidates = [];

    // Stärkstes Signal: Zahl direkt vor EUR/l — z.B. "1,454 EUR/l", "1.719 EUR/1"
    for (const m of flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*([lLiI1])\b/gi)) {
      const v = _parsePricePerLiter(m[1]);
      if (v && v >= 0.45 && v < 4.0) pplCandidates.push({ raw: m[1], value: v, conf: 0.88, contextStrength: 'labeled' });
    }
    // Stärkstes Signal rückwärts: "EUR/l: 1,454" oder "EUR/l = 1.719"
    for (const m of flat.matchAll(/(?:€|eur|euro)\s*\/\s*([lLiI1])\s*[:=]?\s*([0-9]{1,2}[,\.][0-9]{3,4})/gi)) {
      const v = _parsePricePerLiter(m[2]);
      if (v && v >= 0.45 && v < 4.0) pplCandidates.push({ raw: m[2], value: v, conf: 0.82, contextStrength: 'labeled' });
    }
    // Mittleres Signal: Zahl nahe Preis/L-Label (andere Zeile)
    for (let i = 0; i < lines.length; i++) {
      if (/preis\s*\/?\s*l\b|literpreis|kraftstoffpreis/i.test(lines[i])) {
        const look = [lines[i], lines[i+1]].filter(Boolean).join(' ');
        const m = look.match(/([0-9]{1,2}[,\.][0-9]{3,4})/);
        if (m) {
          const v = _parsePricePerLiter(m[1]);
          if (v && v >= 0.45 && v < 4.0) pplCandidates.push({ raw: m[1], value: v, conf: 0.75, contextStrength: 'label-nearby' });
        }
      }
    }
    // Schwaches Signal: isolierte Zahl mit 3-4 Dezimalstellen ohne klaren Kontext
    // Conf bewusst niedrig — darf NICHT automatisch als "sicher" gelten
    for (const m of flat.matchAll(/(?:^|[\s*#])([1-2][,\.][0-9]{3,4})(?:\s|$)/gm)) {
      const v = _parsePricePerLiter(m[1]);
      if (v && v > 1.0 && v < 3.0) pplCandidates.push({ raw: m[1], value: v, conf: 0.40, contextStrength: 'isolated' });
    }

    if (pplCandidates.length) {
      // Kleiner Bonus für typisches DE-Preismuster (endet auf 9) — nur bei nicht-isolierten
      for (const c of pplCandidates) {
        if (Math.round(c.value * 1000) % 10 === 9 && c.contextStrength !== 'isolated')
          c.conf = Math.min(0.99, c.conf + 0.05);
      }
      // Sortierung: labeled > label-nearby > isolated; danach conf, dann Nähe zu 1.70
      const _ctxRank = { labeled: 3, 'label-nearby': 2, isolated: 1 };
      pplCandidates.sort((a, b) => {
        const rd = (_ctxRank[b.contextStrength] || 0) - (_ctxRank[a.contextStrength] || 0);
        if (rd !== 0) return rd;
        if (Math.abs(a.conf - b.conf) > 0.05) return b.conf - a.conf;
        return Math.abs(a.value - 1.70) - Math.abs(b.value - 1.70);
      });
      result.pricePerLiter = { ...pplCandidates[0], source: 'ocr' };
      // Alternativen für UI-Anzeige (max. 2 weitere)
      if (pplCandidates.length > 1)
        result.pricePerLiter._alts = pplCandidates.slice(1, 3).map(c => ({ value: c.value, raw: c.raw, contextStrength: c.contextStrength }));
    }
    // Fallback: 4-Ziffern-Ganzzahl ("1719") oder 2-Dezimal-Wert ("1,71") — sehr schwach
    if (!result.pricePerLiter.value) {
      for (const m of flat.matchAll(/\b([12]\d{3}|[12][,\.]\d{2})\b/g)) {
        if (/^\d{4}$/.test(m[1])) {
          const yearish = parseInt(m[1], 10);
          if (yearish >= 1900 && yearish <= 2099) continue;
        }
        const norm = _normalizePPLRaw(m[1]);
        if (norm && norm.value >= 1.0 && norm.value <= 2.5) {
          result.pricePerLiter = { value: norm.value, raw: m[1], conf: 0.38, source: norm.source,
            contextStrength: 'isolated', plausibility: 0 };
          break;
        }
      }
    }

    // ── LITERS ───────────────────────────────────────────────────

    // 1) Explizite Einheit "49,04 L" (Zahl gefolgt von l/L)
    const litersWithUnit = [
      ...[...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
         .map(m => ({ raw: m[1], value: _parseLiters(m[1]) })),
      // Fallback: "49,04 1" – alleinstehende Ziffer 1 nach 2-Dezimal-Zahl (OCR-Fehler l→1)
      // (nach Normalisierung sollte das schon als "l" dastehen, aber doppelt hält besser)
      ...[...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2})\s+1(?!\d)(?=\s+[0-9]{1,4}[,\.][0-9]{2,4})/g)]
         .map(m => ({ raw: m[1], value: _parseLiters(m[1]) })),
    ].filter(x => x.value && x.value > 1 && x.value < 250);

    if (litersWithUnit.length) {
      // Wenn mehrere Kandidaten: bevorzuge den, der mit dem Gesamtbetrag zusammenpasst
      // (Shell-Zeile: "49,04 l 84,30 EUR" → beide matchen; Kreuzcheck löst Mehrdeutigkeit)
      const plausible = litersWithUnit.filter(x => x.value >= 5 && x.value <= 120);
      let best = plausible[0] || litersWithUnit[0];
      if (plausible.length > 1 && result.totalCost.value) {
        // Wähle den Kandidaten, bei dem total/value einen plausiblen €/L-Preis ergibt
        const crossChecked = plausible.find(x => {
          const ppl = result.totalCost.value / x.value;
          return ppl >= 1.0 && ppl <= 3.5;
        });
        if (crossChecked) best = crossChecked;
        else {
          // Kleinsten nehmen (Preis ist immer größer als Liter bei normalem Tankvorgang)
          plausible.sort((a,b) => a.value - b.value);
          best = plausible[0];
        }
      } else if (plausible.length > 1) {
        // Ohne Gesamtbetrag: kleinsten plausiblen Wert nehmen
        plausible.sort((a,b) => a.value - b.value);
        best = plausible[0];
      }
      result.liters = { value: best.value, raw: best.raw, conf: 0.88, contextStrength: 'unit' };
      const alts = plausible
        .filter(x => Math.abs(x.value - best.value) > 0.0001 || x.raw !== best.raw)
        .slice(0, 3)
        .map(x => ({ value: x.value, raw: x.raw, label: 'Mit L-Einheit', contextStrength: 'unit' }));
      if (alts.length) result.liters._alts = alts;
    }

    // 1b) *Zp-Zeile: "*Zp 03  50,00 l  1,439 EUR/l" — Shell/Aral/BP-Format
    // Sicherheitsnetz wenn die l→1-Normalisierung noch nicht greift.
    // Erste Zahl im plausiblen Liter-Bereich auf der *Zp-Zeile = Liter.
    if (!result.liters.value) {
      const zpLineRE = /^\*?zp\s*\d+\b/i;
      for (let i = 0; i < lines.length; i++) {
        if (!zpLineRE.test(lines[i])) continue;
        const zpNums = [...lines[i].matchAll(/\b(\d{1,3}[,.]\d{2,3})\b/g)]
          .map(m => ({ raw: m[1], value: _parseLiters(m[1]) }))
          .filter(x => x.value && x.value >= 5 && x.value <= 120);
        if (zpNums.length) {
          const best = zpNums[0];
          result.liters = { value: best.value, raw: best.raw, conf: 0.88, contextStrength: 'zp-line' };
          // Kraftstoff-Produktzeile direkt vor der *Zp-Zeile → totalCost
          if (i > 0 && !result.totalCost.value) {
            const prev = lines[i - 1];
            if (/\b(diesel|super|e10|e5|benzin|lpg|autogas|kraftstoff)\b/i.test(prev)) {
              const tm = prev.match(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/i);
              if (tm) {
                const tv = _parseMoney(tm[1]);
                if (tv && tv > 2 && tv < 500) {
                  result.totalCost = { value: tv, raw: tm[1], conf: 0.88,
                    contextStrength: 'fuel-product-line' };
                }
              }
            }
          }
        }
        break; // nur die erste *Zp-Zeile auswerten
      }
    }

    // 2) Label-Zeile: "Menge / Liter / Volumen / Kraftstoffmenge"
    if (!result.liters.value) {
      const litersLabelRE = /(?:kraftstoffmenge|menge|liter|vol(?:umen)?|mng|ltrs?|getankt)\b[^\d]{0,25}([0-9]{1,3}[,\.][0-9]{2,3})/gi;
      for (const m of flat.matchAll(litersLabelRE)) {
        const v = _parseLiters(m[1]);
        if (v && v > 1 && v < 250) {
          result.liters = { value: v, raw: m[1], conf: 0.82, contextStrength: 'label' };
          break;
        }
      }
    }

    // 3) Label-Zeile → Folgezeile
    if (!result.liters.value) {
      const labelRE = /^(?:kraftstoffmenge|menge|liter|volumen|getankt)/i;
      for (let i = 0; i < lines.length - 1; i++) {
        if (!labelRE.test(lines[i])) continue;
        const m = lines[i+1].match(/^([0-9]{1,3}[,\.][0-9]{2,3})\b/);
        if (m) {
          const v = _parseLiters(m[1]);
          if (v && v > 1 && v < 250) {
            result.liters = { value: v, raw: m[1], conf: 0.80, contextStrength: 'label' };
            break;
          }
        }
      }
    }

    // 4) Kraftstofftyp-Kontext
    if (!result.liters.value) {
      const fuelRE = /(diesel|super\s*e?10?|e10|e5|benzin|kraftstoff|fuel|regular)/i;
      for (let i = 0; i < lines.length; i++) {
        if (!fuelRE.test(lines[i])) continue;
        const candidates = [];
        const major = [];
        const look = [lines[i], lines[i+1], lines[i+2]].filter(Boolean).join(' ');
        for (const m of look.matchAll(/\b([0-9]{1,3}[,\.][0-9]{2})\b/g)) {
          const v = _parseLiters(m[1]);
          if (v && v >= 3 && v <= 120) candidates.push({ raw: m[1], value: v });
          if (v && v >= 5 && v <= 120) major.push({ raw: m[1], value: v });
        }
        if (candidates.length) {
          let best = candidates.find(x => x.value >= 5) || candidates[0];
          if (major.length >= 2) {
            major.sort((a, b) => a.value - b.value);
            best = major[0];
          }
          result.liters = { value: best.value, raw: best.raw, conf: 0.55, contextStrength: 'context' };
          break;
        }
      }
    }

    // 5) ── STRUKTUR-PARSER: Shell/Aral/BP Produktzeile ──────────────
    if (!result.liters.value) {
      const productLineRE = /(super|diesel|e10|e5|benzin|fuelsave|ultimate|v-power|regular|kraftstoff)/i;
      for (let i = 0; i < lines.length; i++) {
        if (!productLineRE.test(lines[i])) continue;
        const nums = [...lines[i].matchAll(/\b(\d{1,3}[,.]\d{2,3})\b/g)]
          .map(m => _parseLiters(m[1]))
          .filter(v => v && v > 0);
        const major = nums.filter(v => v >= 5);
        if (nums.length >= 2) {
          const pool = major.length >= 2 ? major : nums;
          pool.sort((a,b) => a-b);
          const litVal  = pool[0];
          const costVal = pool[pool.length-1];
          if (litVal >= 5 && litVal <= 120 && costVal > litVal) {
            result.liters = { value: litVal, raw: String(litVal), conf: 0.75, contextStrength: 'structure' };
            if (!result.totalCost.value && costVal > 5 && costVal < 500)
              result.totalCost = { value: costVal, raw: String(costVal), conf: 0.60 };
            break;
          }
        }
      }
    }

    // ── KREUZVALIDIERUNG ─────────────────────────────────────────

    // ⛔ Sanity-Prüfung: Liter/Betrag-Verhältnis muss als realistischer EUR/L-Preis plausibel sein.
    // Grenzen: 0.45–3.50 EUR/L (abgestimmt auf _RANGES.pricePerLiter.warn, inkl. LPG ~0.729).
    // Frühere Grenze 1.05 war zu hoch — verwarf gültige LPG-Preise und alte Diesel-Preise.
    if (result.liters.value && result.totalCost.value) {
      const ratio = result.totalCost.value / result.liters.value;
      if (ratio < 0.45 || ratio > 3.50) {
        // Bevor Liter verworfen wird: gibt es einen besseren Betrag in den Fallback-Kandidaten?
        const knownPpl = result.pricePerLiter?.value;
        const betterTotal = totalFallbackCandidates
          .filter(c => {
            const r = c.value / result.liters.value;
            if (r < 0.45 || r > 3.5) return false;
            if (knownPpl) return Math.abs(r - knownPpl) / knownPpl < 0.12;
            return true;
          })
          .sort((a, b) => b.score - a.score)[0];
        if (betterTotal) {
          console.warn('OCR: Betrag korrigiert (war unplausibel):', result.totalCost.value, '→', betterTotal.value);
          result.totalCost = { value: betterTotal.value, raw: betterTotal.raw,
            conf: betterTotal.conf, contextStrength: betterTotal.contextStrength, source: 'ocr' };
        } else {
          console.warn('OCR: Liter-Wert verworfen (kein plausibler Betrag gefunden):', result.liters.value, '→', ratio.toFixed(3), '€/L');
          result.liters = { value: null, raw: null, conf: 0 };
        }
      }
    }

    // 6) ── BRUTE-FORCE FALLBACK: Liter aus Gesamtbetrag + allen Zahlen im Text ─
    // Markiert bewusst als 'brute-force' — darf NICHT als Basis für ppl-Ableitung dienen
    if (!result.liters.value && result.totalCost.value) {
      const allNums = [...flat.matchAll(/\b(\d{1,3}[,.]\d{2})(?!\s*%)/g)]
        .map(m => _parseLiters(m[1]))
        .filter(v => v && v >= 5 && v <= 120 && Math.abs(v - result.totalCost.value) > 0.5);
      // Bevorzuge Werte im typischen Bereich 15–80L; nimm nicht den ersten blinden Treffer
      const scoredBF = allNums
        .map(v => ({ v, ppl: result.totalCost.value / v }))
        .filter(x => x.ppl >= 1.20 && x.ppl <= 2.90)
        .sort((a, b) => {
          // Bevorzuge mittleren Bereich (30L), dann ppl-Nähe zu 1.70
          const aScore = Math.abs(a.v - 40) + Math.abs(a.ppl - 1.70) * 10;
          const bScore = Math.abs(b.v - 40) + Math.abs(b.ppl - 1.70) * 10;
          return aScore - bScore;
        });
      if (scoredBF.length) {
        const best = scoredBF[0];
        result.liters = { value: best.v, raw: String(best.v), conf: 0.55, contextStrength: 'brute-force' };
        if (scoredBF.length > 1) {
          result.liters._alts = scoredBF.slice(1, 4).map(x => ({
            value: x.v,
            raw: String(x.v),
            label: 'Rechnerisch passend',
            contextStrength: 'brute-force',
          }));
        }
        console.log('OCR: Liter per Brute-Force (schwach):', best.v, '→', best.ppl.toFixed(3), '€/L');
      }
    }

    // ── STRIKTE KONSISTENZPRÜFUNG & ABLEITUNG ────────────────────
    const shouldRerankTotal =
      totalFallbackCandidates.length && (
        result.totalCost.conf <= 0.60 ||
        (
          result.totalCost.value &&
          result.liters.value &&
          result.pricePerLiter.value &&
          Math.abs(result.totalCost.value - (result.liters.value * result.pricePerLiter.value)) / Math.max(1, result.totalCost.value) > 0.05
        )
      );
    if (shouldRerankTotal) {
      const rankedTotals = _rankTotalFallbackCandidates(
        totalFallbackCandidates,
        result.liters.value,
        result.pricePerLiter.value
      );
      if (rankedTotals.length) {
        const best = rankedTotals[0];
        result.totalCost = {
          ...result.totalCost,
          value: best.value,
          raw: best.raw,
          conf: best.conf,
          source: 'ocr',
          contextStrength: best.contextStrength,
        };
        const alts = rankedTotals.slice(1, 4).map(c => ({
          value: c.value,
          raw: c.raw,
          label: c.label,
          contextStrength: c.contextStrength,
        }));
        if (alts.length) result.totalCost._alts = alts;
        else delete result.totalCost._alts;
      }
    }
    _validateFinalize(result);

    return result;
  }

  /**
   * Konsistenzprüfung + Ableitung fehlender Werte.
   * Kernregeln:
   * - Auto-Korrektur nur wenn BEIDE stützenden Felder "stark" sind (_isStrong).
   * - ppl-Ableitung aus Liter+Betrag: Liter muss contextStrength !== 'brute-force' haben.
   * - Abgeleiteter ppl außerhalb [0.900, 3.000] wird verworfen (kein falscher Wert).
   * - Status pro Feld: 'safe' | 'uncertain' | 'derived' | 'conflicting' | 'missing'.
   */
  function _validateFinalize(result) {
    const tot = result.totalCost;
    const lit = result.liters;
    const ppl = result.pricePerLiter;
    const has = f => f && f.value != null;

    if (has(tot) && has(lit) && has(ppl)) {
      // ── Alle 3 Felder: Abweichung berechnen ─────────────────────
      const dLit = Math.abs(lit.value - tot.value / ppl.value) / lit.value;
      const dTot = Math.abs(tot.value - lit.value * ppl.value) / tot.value;
      const dPpl = Math.abs(ppl.value - tot.value / lit.value) / ppl.value;

      if (Math.max(dLit, dTot, dPpl) < 0.03) {
        // Alle drei konsistent
        lit.status = tot.status = ppl.status = 'safe';
      } else {
        console.warn(`OCR Konsistenz: dLit=${dLit.toFixed(3)} dTot=${dTot.toFixed(3)} dPpl=${dPpl.toFixed(3)}`);
        // Größte Abweichung ist wahrscheinlichster Fehler
        if (dLit >= dTot && dLit >= dPpl && dLit > 0.05) {
          // Liter ist Ausreißer → ersetze nur wenn tot+ppl stark
          if (_isStrong(tot, 'totalCost') && _isStrong(ppl, 'pricePerLiter')) {
            const derived = +(tot.value / ppl.value).toFixed(2);
            if (_rangeStatus('liters', derived) !== 'outside') {
              console.warn('OCR Konsistenz: Liter korrigiert', lit.value, '→', derived);
              lit.value = derived; lit.source = 'derived'; lit.status = 'derived';
              lit.reason = `${tot.value.toFixed(2)} € ÷ ${ppl.value.toFixed(4)} €/L`;
              tot.status = ppl.status = 'safe';
            } else {
              lit.status = 'conflicting'; tot.status = ppl.status = 'safe';
            }
          } else {
            lit.status = 'conflicting'; tot.status = ppl.status = 'uncertain';
          }
        } else if (dTot >= dLit && dTot >= dPpl && dTot > 0.05) {
          // Betrag ist Ausreißer → ersetze nur wenn lit+ppl stark
          if (_isStrong(lit, 'liters') && _isStrong(ppl, 'pricePerLiter')) {
            const derived = +(lit.value * ppl.value).toFixed(2);
            if (_rangeStatus('totalCost', derived) !== 'outside') {
              console.warn('OCR Konsistenz: Betrag korrigiert', tot.value, '→', derived);
              tot.value = derived; tot.source = 'derived'; tot.status = 'derived';
              tot.reason = `${lit.value.toFixed(2)} L × ${ppl.value.toFixed(4)} €/L`;
              lit.status = ppl.status = 'safe';
            } else {
              tot.status = 'conflicting'; lit.status = ppl.status = 'safe';
            }
          } else {
            tot.status = 'conflicting'; lit.status = ppl.status = 'uncertain';
          }
        } else if (dPpl > 0.05) {
          // ppl ist Ausreißer → ersetze NUR wenn tot+lit stark und Ergebnis plausibel
          // WICHTIG: ein labeled ppl wird NICHT durch Ableitung überschrieben
          if (ppl.contextStrength === 'labeled' && ppl.conf >= 0.80) {
            // labeled ppl hat Vorrang → eher Liter oder Betrag anpassen
            ppl.status = 'safe';
            lit.status = 'uncertain'; tot.status = 'uncertain';
          } else if (_isStrong(tot, 'totalCost') && _isStrong(lit, 'liters')) {
            const derived = +(tot.value / lit.value).toFixed(4);
            const st = _rangeStatus('pricePerLiter', derived);
            if (st !== 'outside') {
              console.warn('OCR Konsistenz: €/L korrigiert', ppl.value, '→', derived);
              ppl.value = derived; ppl.source = 'derived'; ppl.status = 'derived';
              ppl.reason = `${tot.value.toFixed(2)} € ÷ ${lit.value.toFixed(2)} L`;
              if (st === 'warn') ppl.status = 'uncertain'; // abgeleiteter Wert im Warnbereich
              tot.status = lit.status = 'safe';
            } else {
              ppl.status = 'conflicting'; tot.status = lit.status = 'safe';
            }
          } else {
            ppl.status = 'conflicting'; tot.status = lit.status = 'uncertain';
          }
        }

        // Sonderfall: ppl ist 'isolated'/'brute-force' (kein EUR/L-Label), aber
        // tot und lit sind beide stark → ppl immer aus tot÷lit ableiten.
        // Greift auch wenn Abweichung < 5% (z.B. nach manueller Betrag-Korrektur).
        if ((ppl.contextStrength === 'isolated' || ppl.contextStrength === 'brute-force') &&
            ppl.source !== 'manual' &&
            _isStrong(tot, 'totalCost') && _isStrong(lit, 'liters')) {
          const derivedPpl = +(tot.value / lit.value).toFixed(4);
          const stPpl = _rangeStatus('pricePerLiter', derivedPpl);
          if (stPpl !== 'outside') {
            console.warn('OCR: €/L (isoliert) ersetzt durch tot÷lit:', ppl.value, '→', derivedPpl);
            ppl.value = derivedPpl; ppl.source = 'derived'; ppl.contextStrength = 'derived';
            ppl.reason = `${tot.value.toFixed(2)} € ÷ ${lit.value.toFixed(2)} L`;
            ppl.status = (stPpl === 'warn') ? 'uncertain' : 'derived';
            if (!tot.status || tot.status === 'conflicting' || tot.status === 'uncertain') tot.status = 'safe';
            if (!lit.status || lit.status === 'conflicting' || lit.status === 'uncertain') lit.status = 'safe';
          }
        }
      }

    } else {
      // ── 2 Felder: fehlendes ableiten ────────────────────────────

      if (has(tot) && has(ppl) && !has(lit)) {
        // ppl MUSS normalerweise 'labeled'/'label-nearby' sein, damit Liter abgeleitet wird.
        // Ausnahme: wenn Betrag MANUELL gesetzt wurde, wird auch ein 'isolated' ppl akzeptiert
        // (Nutzer hat den richtigen Betrag eingegeben → Division durch isoliertes ppl ergibt zumindest
        //  einen plausiblen Startpunkt, besser als "Nicht erkannt").
        const manualTot = tot.source === 'manual' && tot.conf >= 0.90;
        const pplOk = ppl.contextStrength === 'labeled' || ppl.contextStrength === 'label-nearby'
                   || ppl.contextStrength === 'derived'  || ppl.contextStrength === 'manual'
                   || manualTot;
        const minPplConf = manualTot ? 0.25 : 0.65;
        if (tot.conf >= 0.65 && pplOk && ppl.conf >= minPplConf) {
          const derived = +(tot.value / ppl.value).toFixed(2);
          if (_rangeStatus('liters', derived) !== 'outside') {
            lit.value = derived; lit.source = 'derived'; lit.conf = 0.72;
            lit.contextStrength = 'derived';
            lit.reason = `${tot.value.toFixed(2)} € ÷ ${ppl.value.toFixed(4)} €/L`;
            lit.status = _rangeStatus('liters', derived) !== 'safe' ? 'uncertain' : 'derived';
          }
        }
        tot.status = tot.status || (tot.conf >= 0.80 ? 'safe' : 'uncertain');
        ppl.status = ppl.status || (ppl.conf >= 0.80 ? 'safe' : 'uncertain');
      }

      if (has(tot) && has(lit) && !has(ppl)) {
        // ppl nur ableiten wenn Liter NICHT aus Brute-Force stammt
        const litOk = lit.contextStrength !== 'brute-force' && lit.conf >= 0.70;
        if (tot.conf >= 0.65 && litOk) {
          const derived = +(tot.value / lit.value).toFixed(4);
          const st = _rangeStatus('pricePerLiter', derived);
          if (st !== 'outside') {
            ppl.value = derived; ppl.source = 'derived'; ppl.conf = 0.70;
            ppl.contextStrength = 'derived';
            ppl.reason = `${tot.value.toFixed(2)} € ÷ ${lit.value.toFixed(2)} L`;
            // 'warn' = abgeleiteter Wert außerhalb Normalbereich → als 'uncertain' markieren
            ppl.status = st === 'safe' ? 'derived' : 'uncertain';
          }
          // Falls 'outside': ppl bleibt leer — kein falscher Wert besser als ein unrealistischer
        }
        tot.status = tot.status || (tot.conf >= 0.80 ? 'safe' : 'uncertain');
        lit.status = lit.status || (lit.conf >= 0.80 ? 'safe' : 'uncertain');
      }

      if (has(lit) && has(ppl) && !has(tot)) {
        const pplOk = ppl.contextStrength === 'labeled' || ppl.contextStrength === 'label-nearby' ||
                      ppl.contextStrength === 'derived'  || ppl.contextStrength === 'manual';
        if (lit.conf >= 0.65 && ppl.conf >= 0.65 && pplOk) {
          const derived = +(lit.value * ppl.value).toFixed(2);
          if (_rangeStatus('totalCost', derived) !== 'outside') {
            tot.value = derived; tot.source = 'derived'; tot.conf = 0.72;
            tot.reason = `${lit.value.toFixed(2)} L × ${ppl.value.toFixed(4)} €/L`;
            tot.status = 'derived';
          }
        }
        lit.status = lit.status || (lit.conf >= 0.80 ? 'safe' : 'uncertain');
        ppl.status = ppl.status || (ppl.conf >= 0.80 ? 'safe' : 'uncertain');
      }
    }

    // ── Fehlende Status-Werte setzen ────────────────────────────
    for (const [key, f] of [['totalCost', tot], ['liters', lit], ['pricePerLiter', ppl]]) {
      if (!f.status) {
        if (!f.value) f.status = 'missing';
        else if (f.source === 'derived') f.status = 'derived';
        else if (f.conf >= 0.82 && _rangeStatus(key, f.value) === 'safe') f.status = 'safe';
        else f.status = 'uncertain';
      }
      if (!f.source) f.source = 'ocr';
      if (f.plausibility == null) f.plausibility = 0;
    }

    // Datum
    const d = result.date;
    d.status = d.value ? (d.conf >= 0.70 ? 'safe' : 'uncertain') : 'missing';
    if (!d.source) d.source = 'ocr';
    if (d.plausibility == null) d.plausibility = 0;

    // Sanity clamp: grob außerhalb → conf stark reduzieren
    if (lit.value && (lit.value < 1 || lit.value > 200))  lit.conf = Math.min(lit.conf, 0.25);
    if (tot.value && (tot.value < 2 || tot.value > 500))  tot.conf = Math.min(tot.conf, 0.25);
    if (ppl.value && (ppl.value < 0.5 || ppl.value > 5.0)) ppl.conf = Math.min(ppl.conf, 0.20);

    // Zusatzwarnung: Liter < 10 L UND Betrag < 20 EUR ist praktisch ausgeschlossen
    // (kleinste reale Betankung ~2 L LPG × 0.60 EUR/L = 1.20 EUR — aber in der Praxis meist >> 20 L × 1 EUR).
    // Beide Werte zusammen so klein → fast sicher eine falsch erkannte Zahl (z.B. MwSt-Betrag).
    if (lit.value && lit.value < 10 && tot.value && tot.value < 20
        && lit.source !== 'manual' && tot.source !== 'manual') {
      if (lit.status === 'derived' || lit.status === 'safe') lit.status = 'uncertain';
      if (tot.status === 'derived' || tot.status === 'safe') tot.status = 'uncertain';
      lit.conf = Math.min(lit.conf, 0.40);
      tot.conf = Math.min(tot.conf, 0.40);
    }
  }

  function _collectTotalFallbackCandidates(lines) {
    const totalLabelRE = /(gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|zu\s+zahlen|zahlbetrag)\b/i;
    const paymentRE = /(gegeben(?:\s+in)?|r\S*ckgeld|bar\b|cash\b|karte\b|ec\b|visa\b|mastercard\b|change\b)/i;
    const taxRE = /(mwst|ust|steuer|netto)\b/i;
    const grossRE = /\bbrutto\b/i;
    const fuelRE = /(diesel|super\s*e?10?|e10|e5|benzin|kraftstoff|fuel|lpg|autogas|verbl)\b/i;
    const moneyRE = /([0-9]{1,4}[,\.][0-9]{2})/g;
    const dedup = new Map();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const neighborhood = [lines[i - 1], line, lines[i + 1]].filter(Boolean).join(' ');
      const hasTotal = totalLabelRE.test(line);
      const nearTotal = !hasTotal && totalLabelRE.test(neighborhood);
      const hasPayment = paymentRE.test(neighborhood);
      const hasTax = taxRE.test(neighborhood);
      const hasGross = grossRE.test(line);
      const hasFuel = fuelRE.test(neighborhood);

      moneyRE.lastIndex = 0;
      for (const m of line.matchAll(moneyRE)) {
        const value = _parseMoney(m[1]);
        if (!value || value <= 2 || value >= 500) continue;

        let score = 0.44;
        if (hasTotal) score += 0.40;
        else if (nearTotal) score += 0.22;
        if (hasGross) score += 0.10;
        if (hasFuel) score += 0.06;
        if (hasTax) score -= 0.26;
        if (hasPayment) score -= 0.58;

        const candidate = {
          value,
          raw: m[1],
          score,
          conf: Math.max(0.28, Math.min(0.72, score)),
          contextStrength: hasTotal ? 'labeled' : nearTotal ? 'label-nearby' : hasFuel ? 'context' : 'isolated',
          label: hasTotal ? 'Gesamtbetrag' : hasPayment ? 'Zahlungszeile' : hasGross ? 'Brutto' : hasFuel ? 'Produktzeile' : 'Weitere Zahl',
        };

        const key = value.toFixed(2);
        const prev = dedup.get(key);
        if (!prev || candidate.score > prev.score) dedup.set(key, candidate);
      }
    }

    return [...dedup.values()];
  }

  function _rankTotalFallbackCandidates(candidates, litersValue, pplValue) {
    return [...(candidates || [])]
      .map(c => {
        let rank = c.score;

        if (litersValue != null && litersValue > 0) {
          const ratio = c.value / litersValue;
          if (ratio >= 1.0 && ratio <= 3.5) {
            rank += 0.22;
            rank -= Math.min(0.18, Math.abs(ratio - 1.65) * 0.06);
          } else {
            rank -= 0.42;
          }
        }

        if (pplValue != null && pplValue > 0) {
          const impliedLiters = c.value / pplValue;
          if (impliedLiters >= 5 && impliedLiters <= 120) rank += 0.08;
          else rank -= 0.12;
        }

        // Wenn Liter UND ppl bekannt: direkter Konsistenzvergleich (Einkaufs-Szenario)
        // Kraftstoffbetrag = Liter × ppl; Gesamtbetrag kann mehr enthalten.
        if (litersValue != null && litersValue > 0 && pplValue != null && pplValue > 0) {
          const expected = litersValue * pplValue;
          const dev = Math.abs(c.value - expected) / expected;
          if (dev < 0.02) rank += 0.40;
          else if (dev < 0.05) rank += 0.20;
          else if (dev < 0.10) rank += 0.05;
          else rank -= 0.20;
        }

        // Bonus für direkte Kraftstoff-Produktzeile (wichtig wenn Gesamtbetrag Einkäufe enthält)
        if (c.contextStrength === 'fuel-product-line') rank += 0.15;

        return { ...c, rank };
      })
      .sort((a, b) => {
        if (Math.abs(a.rank - b.rank) > 0.02) return b.rank - a.rank;
        if (litersValue != null && litersValue > 0) {
          const ar = Math.abs((a.value / litersValue) - 1.65);
          const br = Math.abs((b.value / litersValue) - 1.65);
          if (Math.abs(ar - br) > 0.03) return ar - br;
        }
        return b.value - a.value;
      });
  }

  function _parseMoney(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    if (/,/.test(str)) {
      const cleaned = str.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
      const v = parseFloat(cleaned);
      return isNaN(v) ? null : v;
    }
    if (/^\d{1,4}\.\d{2}$/.test(str)) return parseFloat(str) || null;
    const v = parseFloat(str.replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  function _parsePricePerLiter(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    if (/,/.test(str)) {
      const v = parseFloat(str.replace(/\.(?=\d{3,4}\b)/g, '').replace(',', '.'));
      return isNaN(v) ? null : v;
    }
    if (/^\d{1,2}\.\d{3,4}$/.test(str)) return parseFloat(str) || null;
    const m = str.match(/^(\d{1,2})\s+(\d{3,4})$/);
    if (m) return parseFloat(m[1] + '.' + m[2]) || null;
    const v = parseFloat(str.replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  // Normalize common OCR errors for fuel prices (€/L).
  // Returns { value, source: 'ocr'|'normalized' } or null.
  function _normalizePPLRaw(s) {
    if (!s) return null;
    // Fix common OCR character swaps in digit positions
    let str = String(s).trim().replace(/[Il]/g, '1').replace(/O/g, '0');
    const direct = _parsePricePerLiter(str);
    if (direct && direct >= 0.5 && direct <= 4.0) return { value: direct, source: 'ocr' };
    // "1719" / "1649" → 1.719 / 1.649 (4-digit integer, no separator)
    const m4 = str.match(/^([12])(\d{3})$/);
    if (m4) {
      const v = parseFloat(m4[1] + '.' + m4[2]);
      if (v >= 0.5 && v <= 4.0) return { value: v, source: 'normalized' };
    }
    // "1,71" / "1.71" → 1.710 (2-decimal price, trailing zero assumed)
    const m2 = str.match(/^(\d{1,2})[,.](\d{2})$/);
    if (m2) {
      const v = parseFloat(m2[1] + '.' + m2[2] + '0');
      if (v >= 0.5 && v <= 4.0) return { value: v, source: 'normalized' };
    }
    return null;
  }

  function _parseLiters(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    const m = str.match(/^(\d{1,3})[,.](\d{2,3})$/);
    if (m) return parseFloat(m[1] + '.' + m[2]) || null;
    return null;
  }

  function _parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = parseInt(y, 10) > 50 ? '19' + y : '20' + y;
    const yy = parseInt(y, 10);
    const mm = parseInt(mo, 10);
    const dd = parseInt(d, 10);
    const currentYear = new Date().getFullYear();
    if (yy < 1950 || yy > currentYear + 1) return null;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const iso = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return isNaN(new Date(iso).getTime()) ? null : iso;
  }

  function _normalizeOCRText(t) {
    if (!t) return '';
    let s = String(t);
    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/\u00A0/g, ' ');
    s = s.replace(/\bEURO\b/gi, 'EUR');
    // "71,95 EU" (R am Rand abgeschnitten) → "71,95 EUR"
    s = s.replace(/(\d[,\.]\d{2})\s+EU\b(?!R)/gi, '$1 EUR');

    // Leerzeichen im Dezimalwert: "84 30 EUR" → "84,30 EUR"
    s = s.replace(/\b(\d{1,4})\s+(\d{2})\b(?=\s*(?:€|eur|euro|\/\s*[lLiI1]|l\b|liter\b))/gi, '$1,$2');
    s = s.replace(/\b(\d{1,3})\s+(\d{2})\b(?=\s*(?:super|diesel|e10|e5|benzin|kraftstoff|fuel))/gi, '$1,$2');

    // "1 719 EUR/I" → "1.719 EUR/I"  (vor digit-cleanup damit das Muster noch sichtbar ist)
    s = s.replace(/\b(\d{1,2})\s+(\d{3,4})\b(?=\s*(?:€|eur|euro)?\s*\/\s*[lLiI1])/gi, '$1.$2');

    // ── SCHLÜSSEL-FIX: OCR liest "l" (Liter) als "1" (Ziffer) ────────
    // Shell/BP/Aral: "49,04 1  84,30 EUR" → "49,04 l  84,30 EUR"
    s = s.replace(
      /(\b\d{1,3}[,.]\d{2})\s+1\b(?=\s+\d{1,4}[,.]\d{2,4}\s*(?:€|eur|euro|\/\s*[lLiI1]|\s*#|\s*$))/gi,
      '$1 l'
    );
    s = s.replace(/(\b\d{1,3}[,.]\d{2})\s+1\s*$/gm, '$1 l');

    // Normalisiere "EUR /1" → "EUR/1", "EUR / l" → "EUR/l" (Leerzeichen um Slash)
    s = s.replace(/(eur|€)\s*\/\s*([lLiI1])\b/gi, 'EUR/$2');

    // Ziffernabstand entfernen  — NACH den obigen Muster-Fixes
    s = s.replace(/(\d)\s*([,\.])\s*(\d)/g, '$1$2$3');
    s = s.replace(/[ \t]{2,}/g, ' ');
    return s;
  }

  // ─────────────────────────────────────────────────────────────
  // Overlay / UI
  // ─────────────────────────────────────────────────────────────

  function openOverlay() {
    ['ocr-file-input','ocr-file-camera','ocr-file-gallery'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    _hide('ocr-img-preview-wrap');
    _hide('ocr-result-section');
    _hide('ocr-progress-wrap');
    _show('ocr-zone', 'flex');
    const ov = document.getElementById('overlay-ocr');
    if (ov) ov.classList.add('open');
    _disableCropUI();
    _hideWarpPreview();
  }

  function closeOverlay() {
    const ov = document.getElementById('overlay-ocr');
    if (ov) ov.classList.remove('open');
    _disableCropUI();
    _hideWarpPreview();
  }

  // ─────────────────────────────────────────────────────────────
  // Billladen — KEIN automatisches Drehen
  // ─────────────────────────────────────────────────────────────

  async function _loadImageFixed(file) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return c;
  }

  /** Dreht _srcBitmap um 90° im Uhrzeigersinn und aktualisiert die Crop-Punkte */
  function rotateSrc90() {
    if (!_srcBitmap) return;
    const c = document.createElement('canvas');
    c.width  = _srcBitmap.height;
    c.height = _srcBitmap.width;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(_srcBitmap, 0, 0);
    createImageBitmap(c).then(bmp => {
      _srcBitmap = bmp;
      _srcW = bmp.width;
      _srcH = bmp.height;
      // Crop-Punkte zurücksetzen
      const mx = Math.round(_srcW * 0.06), my = Math.round(_srcH * 0.04);
      _cropPts = [
        { x: mx,       y: my },
        { x: _srcW-mx, y: my },
        { x: _srcW-mx, y: _srcH-my },
        { x: mx,       y: _srcH-my },
      ];
      _autoGuessCorners();
      _renderCrop();
    });
  }

  /**
   * Bildvorverarbeitung vor OCR:
   * - Auf max. 2400px begrenzen (Samsung 20MP → Tesseract zu langsam auf Mobile)
   * - Graustufen
   * - Kontrast-Boost (adaptiv: Histogramm-Stretching)
   * - Leichtes Unsharp-Mask (Schärfen)
   * Gibt ein Canvas zurück.
   */
  function _preprocessForOCR(bitmap) {
    const MAX = 2400;
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width  * scale);
    const h = Math.round(bitmap.height * scale);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;

    // ── 1. Graustufen ──────────────────────────────────────────
    const gray = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      gray[i] = Math.round(0.2126 * d[i*4] + 0.7152 * d[i*4+1] + 0.0722 * d[i*4+2]);
    }

    // ── 2. Histogramm-Stretching (Kontrast) ───────────────────
    // Ignoriere die extremen 2% oben und unten (Ausreißer durch Moiré/Reflexion)
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[gray[i]]++;
    const lo2pct = Math.round(n * 0.02), hi2pct = Math.round(n * 0.98);
    let cumul = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { cumul += hist[v]; if (cumul >= lo2pct) { lo = v; break; } }
    cumul = 0;
    for (let v = 255; v >= 0; v--) { cumul += hist[v]; if (cumul >= n - hi2pct) { hi = v; break; } }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) {
      gray[i] = Math.min(255, Math.max(0, Math.round((gray[i] - lo) / range * 255)));
    }

    // ── 3. Unsharp-Mask (3×3 Gauss-Blur → Differenz addieren) ─
    const blur = new Uint8Array(n);
    // Einfache Box-Blur 3×3 als Annäherung (schnell genug)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        blur[idx] = Math.round((
          gray[idx - w - 1] + gray[idx - w] + gray[idx - w + 1] +
          gray[idx     - 1] + gray[idx]     + gray[idx     + 1] +
          gray[idx + w - 1] + gray[idx + w] + gray[idx + w + 1]
        ) / 9);
      }
    }
    const strength = 1.5; // Schärfungsstärke
    for (let i = 0; i < n; i++) {
      const sharpened = gray[i] + strength * (gray[i] - blur[i]);
      gray[i] = Math.min(255, Math.max(0, Math.round(sharpened)));
    }

    // ── Zurückschreiben als Graustufenbild ─────────────────────
    for (let i = 0; i < n; i++) {
      d[i*4] = d[i*4+1] = d[i*4+2] = gray[i];
      d[i*4+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function handleFile(file) {
    if (!file) return;
    _hide('ocr-zone');
    _hide('ocr-result-section');
    _show('ocr-progress-wrap', 'block');
    _setProgress(5, 'Lade Bild…');

    try {
      // <img>-Element lädt + korrigiert EXIF zuverlässig auf allen Plattformen
      _setProgress(10, 'Lade Bild…');
      const correctedCanvas = await _loadImageFixed(file);
      // createImageBitmap vom korrekten Canvas für _warpPerspectiveToCanvas
      _srcBitmap = await createImageBitmap(correctedCanvas);
      _srcW = _srcBitmap.width;
      _srcH = _srcBitmap.height;

      const mx = Math.round(_srcW * 0.06);
      const my = Math.round(_srcH * 0.04);
      _cropPts = [
        { x: mx,       y: my },
        { x: _srcW-mx, y: my },
        { x: _srcW-mx, y: _srcH-my },
        { x: mx,       y: _srcH-my },
      ];

      _ensureCropUI();
      _enableCropUI();
      _autoGuessCorners();
      _renderCrop();
      _setProgress(18, 'Ecken anpassen (optional), dann „Scannen"');
    } catch (e) {
      console.warn('Bitmap load failed; OCR fallback.', e);
      await _scanDirect(file);
    }
  }

  function transfer() {
    const date   = _val('ocr-r-date');
    const liters = _val('ocr-r-liters');
    const total  = _val('ocr-r-total');
    if (date)   _setVal('tf-date', date);
    if (liters) _setVal('tf-liters', liters);
    if (total)  _setVal('tf-total', total);
    if (window.App && App.updateFuelPreview) App.updateFuelPreview();
    if (window.App && App.toast) App.toast('Werte übernommen — km-Stand ergänzen!', 'success');
    closeOverlay();
  }

  function recalculateFromInputs() {
    if (!_lastParsed) return;
    const merged = _mergeParsedWithInputs();
    _validateFinalize(merged);
    _lastParsed = merged;
    window.__OCR_LAST_PARSED__ = merged;
    showResult(merged);
  }

  function _mergeParsedWithInputs(overrides = {}) {
    const base = _lastParsed
      ? JSON.parse(JSON.stringify(_lastParsed))
      : {
          date:          { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
          liters:        { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
          totalCost:     { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
          pricePerLiter: { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 },
        };

    const applyField = (key, fieldId, parser, precision) => {
      const field = base[key] || { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 };
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
      const rawInput = hasOverride ? overrides[key] : _val(fieldId);
      const raw = rawInput == null ? '' : String(rawInput).trim();

      if (!raw) {
        base[key] = { ...field, value: null, raw: null, conf: 0, source: 'manual', contextStrength: 'manual', status: 'missing' };
        return;
      }

      const parsed = parser(raw);
      if (parsed == null) return;

      const value = typeof precision === 'number' ? +parsed.toFixed(precision) : parsed;

      // Erkennt ob der Nutzer diesen Wert wirklich geändert hat oder ob der Input-Wert
      // noch identisch mit dem OCR-Ergebnis ist (Nutzer hat nur ein anderes Feld geändert).
      // Wenn nicht geändert: originale Metadaten beibehalten, damit _validateFinalize
      // unsichere/abgeleitete Felder neu berechnen kann.
      const origValue = field.value;
      const userChanged = hasOverride || origValue == null || Math.abs(value - origValue) > 0.005;

      if (userChanged) {
        base[key] = {
          ...field,
          value,
          raw,
          conf: 0.97,
          source: 'manual',
          contextStrength: 'manual',
          status: 'safe',
        };
      } else {
        // Wert stammt noch von OCR — nur Wert aktualisieren, Konfidenz/Status bleiben original.
        // Löscht aber manuell gesetzte Status wenn der Wert gleich geblieben ist.
        base[key] = { ...field, value };
      }
    };

    const applyDate = () => {
      const field = base.date || { value: null, raw: null, conf: 0, source: 'ocr', plausibility: 0 };
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, 'date');
      const rawInput = hasOverride ? overrides.date : _val('ocr-r-date');
      const raw = rawInput == null ? '' : String(rawInput).trim();
      if (!raw) {
        base.date = { ...field, value: null, raw: null, conf: 0, source: 'manual', contextStrength: 'manual', status: 'missing' };
        return;
      }
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : _parseDate(raw);
      if (!iso) return;
      const userChanged = hasOverride || !field.value || iso !== field.value;
      if (userChanged) {
        base.date = {
          ...field,
          value: iso,
          raw,
          conf: 0.97,
          source: 'manual',
          contextStrength: 'manual',
          status: 'safe',
        };
      } else {
        base.date = { ...field, value: iso };
      }
    };

    applyDate();
    applyField('liters', 'ocr-r-liters', _parseLiters, 2);
    applyField('totalCost', 'ocr-r-total', _parseMoney, 2);
    applyField('pricePerLiter', 'ocr-r-ppl', _parsePricePerLiter, 4);

    return base;
  }

  // ─────────────────────────────────────────────────────────────
  // Crop UI
  // ─────────────────────────────────────────────────────────────

  function _ensureCropUI() {
    if (_ui.wrap) return;

    const host =
      document.getElementById('ocr-img-preview-wrap')?.parentElement ||
      document.querySelector('#overlay-ocr .overlay-body') ||
      document.getElementById('overlay-ocr');
    if (!host) return;

    // ── Mobile CSS: overlay vollbild, body scrollbar breit genug ──
    if (!document.getElementById('ocr-mobile-css')) {
      const s = document.createElement('style');
      s.id = 'ocr-mobile-css';
      s.textContent = `
        #overlay-ocr .overlay-sheet {
          max-height: 100dvh !important;
          border-radius: 0 !important;
        }
        #overlay-ocr .overlay-body {
          padding: 10px 10px 16px !important;
          -webkit-overflow-scrolling: touch;
        }
        #ocr-crop-canvas { touch-action: none; }
        @media (min-height: 700px) {
          #overlay-ocr .overlay-sheet { max-height: 92dvh !important; border-radius: 16px 16px 0 0 !important; }
        }
      `;
      document.head.appendChild(s);
    }

    // ── Crop wrap ──────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.id = 'ocr-crop-wrap';
    wrap.style.cssText = 'display:none;margin-top:8px;position:relative;';

    const canvas = document.createElement('canvas');
    canvas.id = 'ocr-crop-canvas';
    canvas.style.cssText = [
      'display:block',
      'border-radius:8px',
      'border:1px solid var(--border)',
      'background:#000',
      'touch-action:none',
      'position:relative',
      'z-index:1',
    ].join(';');

    const info = document.createElement('div');
    info.style.cssText = 'margin-top:4px;font-family:var(--font-mono);font-size:10px;color:var(--t3);line-height:1.3';
    info.textContent = 'Ecken ziehen • ↻ Drehen wenn seitlich • Scannen';

    // ── Buttons: 2×2 Grid ─────────────────────────────────────
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px';

    const btnRotate = document.createElement('button');
    btnRotate.type = 'button'; btnRotate.className = 'btn btn-secondary';
    btnRotate.innerHTML = '↻ Drehen';
    btnRotate.onclick = () => rotateSrc90();

    const btnAuto = document.createElement('button');
    btnAuto.type = 'button'; btnAuto.className = 'btn btn-secondary';
    btnAuto.textContent = 'Auto-Ecken';
    btnAuto.onclick = () => { _autoGuessCorners(); _renderCrop(); };

    const btnScan = document.createElement('button');
    btnScan.type = 'button'; btnScan.className = 'btn btn-primary';
    btnScan.innerHTML = '⚡ Scannen';
    btnScan.style.gridColumn = 'span 2';
    btnScan.onclick = () => scanCropped();

    const btnOff = document.createElement('button');
    btnOff.type = 'button'; btnOff.className = 'btn btn-secondary';
    btnOff.style.gridColumn = 'span 2';
    btnOff.textContent = 'Ohne Begradigen scannen';
    btnOff.onclick = () => scanOriginal();

    grid.append(btnRotate, btnAuto, btnScan, btnOff);
    wrap.append(canvas, info, grid);

    // ── Handles ──────────────────────────────────────────────────
    const handles = [];
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'ocr-handle';
      h.dataset.idx = String(i);
      h.style.cssText = [
        'position:absolute',
        'width:26px', 'height:26px',
        'border-radius:999px',
        'background:var(--amber)',
        'box-shadow:0 0 0 2px rgba(0,0,0,0.6)',
        'transform:translate(-50%,-50%)',
        'touch-action:none',
        'cursor:grab',
        'z-index:10',
        'pointer-events:auto',
      ].join(';');
      wrap.appendChild(h);
      handles.push(h);
    }

    // ── Warp-Vorschau canvas ──────────────────────────────────────
    const previewEl = document.createElement('div');
    previewEl.id = 'ocr-warp-preview';
    previewEl.style.cssText = 'display:none;margin-top:10px';
    previewEl.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--t3);margin-bottom:6px">
        Begradigt — sieht das gut aus?
      </div>
      <canvas id="ocr-warp-canvas"
        style="display:block;width:100%;max-height:300px;object-fit:contain;border-radius:10px;border:1px solid var(--border)">
      </canvas>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="btn btn-secondary" style="flex:1" id="ocr-warp-back">← Zurück</button>
        <button type="button" class="btn btn-primary" style="flex:2" id="ocr-warp-ok">✓ Ja, scannen</button>
      </div>`;

    host.append(wrap, previewEl);

    // ── Events ───────────────────────────────────────────────────
    const getCanvasXY = ev => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    const pickNearest = (cx, cy) => {
      const ordered = _orderTLTRBRBL(_cropPts);
      let best = -1, bestD = 1e9;
      for (let i = 0; i < 4; i++) {
        const d = Math.hypot(ordered[i].x * _ui.scale - cx, ordered[i].y * _ui.scale - cy);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD <= 48 ? best : -1;
    };

    // ── Lupe (Mobilgeräte) ────────────────────────────────────────
    const loupe = document.createElement('canvas');
    loupe.id = 'ocr-loupe';
    const LOUPE_SIZE = 96;
    loupe.width  = LOUPE_SIZE;
    loupe.height = LOUPE_SIZE;
    loupe.style.cssText = [
      'display:none',
      'position:absolute',
      'top:4px',
      'right:4px',
      'width:' + LOUPE_SIZE + 'px',
      'height:' + LOUPE_SIZE + 'px',
      'border-radius:50%',
      'border:2px solid var(--amber)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.6)',
      'z-index:20',
      'pointer-events:none',
    ].join(';');
    wrap.appendChild(loupe);
    const loupeCtx = loupe.getContext('2d');

    const _showLoupe = (cx, cy) => {
      if (!_srcBitmap) return;
      const zoom = 3;
      const srcX = (cx / _ui.scale) - (LOUPE_SIZE / 2 / zoom);
      const srcY = (cy / _ui.scale) - (LOUPE_SIZE / 2 / zoom);
      const srcW = LOUPE_SIZE / zoom;
      const srcH = LOUPE_SIZE / zoom;
      loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
      loupeCtx.save();
      loupeCtx.beginPath();
      loupeCtx.arc(LOUPE_SIZE / 2, LOUPE_SIZE / 2, LOUPE_SIZE / 2, 0, Math.PI * 2);
      loupeCtx.clip();
      loupeCtx.drawImage(_srcBitmap, srcX, srcY, srcW, srcH, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
      // Kreuz in der Mitte
      loupeCtx.strokeStyle = 'rgba(255,191,0,0.9)';
      loupeCtx.lineWidth = 1.5;
      loupeCtx.beginPath();
      loupeCtx.moveTo(LOUPE_SIZE / 2 - 8, LOUPE_SIZE / 2);
      loupeCtx.lineTo(LOUPE_SIZE / 2 + 8, LOUPE_SIZE / 2);
      loupeCtx.moveTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 - 8);
      loupeCtx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE / 2 + 8);
      loupeCtx.stroke();
      loupeCtx.restore();
      loupe.style.display = 'block';
    };

    const _hideLoupe = () => { loupe.style.display = 'none'; };

    const onDown = ev => {
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      const idx = pickNearest(x, y);
      if (idx === -1) return;
      _activeIdx = idx;
      canvas.setPointerCapture?.(ev.pointerId);
      _setPointCanvas(_activeIdx, x, y);
      _renderCrop();
      if (ev.pointerType === 'touch') _showLoupe(x, y);
    };
    const onMove = ev => {
      if (_activeIdx < 0) return;
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      _setPointCanvas(_activeIdx, x, y);
      _renderCrop();
      if (ev.pointerType === 'touch') _showLoupe(x, y);
    };
    const onUp = ev => {
      if (_activeIdx >= 0) {
        ev.preventDefault();
        _activeIdx = -1;
        _hideLoupe();
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    handles.forEach(h => {
      h.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        _activeIdx = parseInt(h.dataset.idx, 10);
        h.setPointerCapture?.(ev.pointerId);
        if (ev.pointerType === 'touch') {
          const { x, y } = getCanvasXY(ev);
          _showLoupe(x, y);
        }
      });
      h.addEventListener('pointermove', ev => {
        onMove(ev);
      });
      h.addEventListener('pointerup', onUp);
      h.addEventListener('pointercancel', onUp);
    });

    _ui.wrap = wrap;
    _ui.canvas = canvas;
    _ui.ctx = canvas.getContext('2d', { willReadFrequently: true });
    _ui.handles = handles;
    _ui.btnAuto = btnAuto;
    _ui.previewEl = previewEl;
  }

  function _enableCropUI() {
    if (!_ui.wrap) return;
    _ui.wrap.style.display = 'block';
    _ui.enabled = true;
    const img = document.getElementById('ocr-img-preview');
    if (img) img.style.display = 'none';
  }

  function _disableCropUI() {
    if (!_ui.wrap) return;
    _ui.wrap.style.display = 'none';
    _ui.enabled = false;
    _activeIdx = -1;
  }

  function _hideWarpPreview() {
    if (_ui.previewEl) _ui.previewEl.style.display = 'none';
  }

  // ─────────────────────────────────────────────────────────────
  // Render — FIXED: explicit CSS size, offsetX/offsetY tracked
  // ─────────────────────────────────────────────────────────────

  function _renderCrop() {
    if (!_ui.enabled || !_ui.canvas || !_ui.ctx || !_srcBitmap || !_cropPts) return;

    _cropPts = _orderTLTRBRBL(_cropPts);

    const wrapW = _ui.wrap.getBoundingClientRect().width || 360;
    // Viewport-relativ: max 35% der Bildschirmhöhe — passt auf kleine Handys
    const maxH  = Math.min(340, Math.round(window.innerHeight * 0.35));
    const scale = Math.min(wrapW / _srcW, maxH / _srcH);

    const cssW = Math.round(_srcW * scale);
    const cssH = Math.round(_srcH * scale);

    // Zentrieren im Wrap
    const offsetX = Math.round((wrapW - cssW) / 2);
    const offsetY = 0;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    _ui.canvas.width  = Math.round(cssW * dpr);
    _ui.canvas.height = Math.round(cssH * dpr);

    // ← WICHTIG: explizite CSS-Größe statt width:100%
    _ui.canvas.style.width  = cssW + 'px';
    _ui.canvas.style.height = cssH + 'px';
    _ui.canvas.style.marginLeft = offsetX + 'px';

    _ui.scale   = scale;
    _ui.offsetX = offsetX;
    _ui.offsetY = offsetY;
    _ui.dispW   = cssW;
    _ui.dispH   = cssH;

    const ctx = _ui.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(_srcBitmap, 0, 0, cssW, cssH);

    const ptsC = _cropPts.map(p => ({ x: p.x * scale, y: p.y * scale }));

    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,191,0,0.95)';
    ctx.fillStyle   = 'rgba(255,191,0,0.13)';
    ctx.beginPath();
    ctx.moveTo(ptsC[0].x, ptsC[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(ptsC[i].x, ptsC[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Ecknummern einzeichnen
    const labels = ['TL','TR','BR','BL'];
    ctx.save();
    ctx.font = '10px var(--font-mono, monospace)';
    ctx.fillStyle = 'rgba(255,191,0,0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      ctx.fillText(labels[i], ptsC[i].x, ptsC[i].y);
    }
    ctx.restore();

    // Handle-Positionen: relativ zur WRAP, nicht zum Canvas
    for (let i = 0; i < 4; i++) {
      const h = _ui.handles[i];
      if (!h) continue;
      // ptsC[i] ist relativ zum Canvas → + offsetX für Wrap-relative Position
      h.style.left = (ptsC[i].x + offsetX) + 'px';
      h.style.top  = (ptsC[i].y + offsetY) + 'px';
    }
  }

  function _setPointCanvas(idx, cx, cy) {
    const s = _ui.scale || 1;
    const x = Math.max(0, Math.min(_ui.dispW, cx)) / s;
    const y = Math.max(0, Math.min(_ui.dispH, cy)) / s;
    _cropPts = _orderTLTRBRBL(_cropPts);
    _cropPts[idx] = { x, y };
    _cropPts = _orderTLTRBRBL(_cropPts);
  }

  function _orderTLTRBRBL(pts) {
    const p = pts.map(x => ({ x: x.x, y: x.y }));
    const sums  = p.map(pt => pt.x + pt.y);
    const diffs = p.map(pt => pt.x - pt.y);
    const tl = p[sums.indexOf(Math.min(...sums))];
    const br = p[sums.indexOf(Math.max(...sums))];
    const tr = p[diffs.indexOf(Math.max(...diffs))];
    const bl = p[diffs.indexOf(Math.min(...diffs))];
    const uniq = new Set([`${tl.x}|${tl.y}`,`${tr.x}|${tr.y}`,`${br.x}|${br.y}`,`${bl.x}|${bl.y}`]);
    if (uniq.size < 4) {
      const xs = p.map(q=>q.x), ys = p.map(q=>q.y);
      return [
        {x:Math.min(...xs),y:Math.min(...ys)},{x:Math.max(...xs),y:Math.min(...ys)},
        {x:Math.max(...xs),y:Math.max(...ys)},{x:Math.min(...xs),y:Math.max(...ys)},
      ];
    }
    return [tl, tr, br, bl];
  }

  // ─────────────────────────────────────────────────────────────
  // Auto-Ecken — VERBESSERT: sucht hellen Beleg-Bereich (weißes Papier)
  // ─────────────────────────────────────────────────────────────

  function _autoGuessCorners() {
    try {
      const targetW = 640;
      const sc = Math.min(1, targetW / _srcW);
      const cw = Math.max(1, Math.round(_srcW * sc));
      const ch = Math.max(1, Math.round(_srcH * sc));
      const n  = cw * ch;

      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(_srcBitmap, 0, 0, cw, ch);
      const d = ctx.getImageData(0, 0, cw, ch).data;

      // ── Graustufen ──────────────────────────────────────────────
      const gray = new Uint8Array(n);
      for (let i = 0; i < n; i++)
        gray[i] = Math.round(0.2126*d[i*4] + 0.7152*d[i*4+1] + 0.0722*d[i*4+2]);

      // ── Otsu-Schwellwert (automatisch, besser als fixer 155) ────
      const hist = new Int32Array(256);
      for (let i = 0; i < n; i++) hist[gray[i]]++;
      let sumAll = 0;
      for (let v = 0; v < 256; v++) sumAll += v * hist[v];
      let wB = 0, sumB = 0, maxVar = 0, otsuT = 128;
      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB) continue;
        const wF = n - wB;
        if (!wF) break;
        sumB += t * hist[t];
        const mB = sumB / wB, mF = (sumAll - sumB) / wF;
        const v = wB * wF * (mB - mF) ** 2;
        if (v > maxVar) { maxVar = v; otsuT = t; }
      }

      // ── Begrenzungsrahmen aller hellen (Beleg-)Pixel ────────────
      // Ignoriere äußersten 3%-Rand um Überbelichtungsartefakte zu vermeiden
      const marginX = Math.round(cw * 0.03), marginY = Math.round(ch * 0.03);
      let rMin = ch, rMax = 0, cMin = cw, cMax = 0, brightCount = 0;
      for (let y = marginY; y < ch - marginY; y++) {
        for (let x = marginX; x < cw - marginX; x++) {
          if (gray[y * cw + x] >= otsuT) {
            if (y < rMin) rMin = y; if (y > rMax) rMax = y;
            if (x < cMin) cMin = x; if (x > cMax) cMax = x;
            brightCount++;
          }
        }
      }

      // Fallback auf Gesamtbild wenn keine helle Region gefunden
      if (rMax <= rMin || cMax <= cMin || brightCount < n * 0.05) {
        rMin = marginY; rMax = ch - marginY;
        cMin = marginX; cMax = cw - marginX;
      }

      // ── Konfidenzbewertung ───────────────────────────────────────
      // Gut wenn: Region klar kleiner als Bild und Seitenverhältnis beleg-typisch
      const regionW = cMax - cMin, regionH = rMax - rMin;
      const coverage = (regionW * regionH) / ((cw - 2*marginX) * (ch - 2*marginY));
      const aspect   = regionH > 0 ? regionW / regionH : 1;
      // Kassenbon: typischerweise hochformatig (aspect 0.25–0.90)
      const aspectOk   = aspect >= 0.20 && aspect <= 1.2;
      const coverageOk = coverage > 0.10 && coverage < 0.95;
      const confidence = (aspectOk ? 0.5 : 0.2) + (coverageOk ? 0.5 : 0.2);
      console.log(`Auto-Ecken: Otsu=${otsuT}, coverage=${(coverage*100).toFixed(0)}%, aspect=${aspect.toFixed(2)}, conf=${confidence.toFixed(2)}`);

      // Leichtes Padding um die erkannte Region
      const padX = Math.round(cw * 0.015), padY = Math.round(ch * 0.015);
      const x0 = Math.max(0, cMin - padX) / sc;
      const x1 = Math.min(cw-1, cMax + padX) / sc;
      const y0 = Math.max(0, rMin - padY) / sc;
      const y1 = Math.min(ch-1, rMax + padY) / sc;

      _cropPts = _orderTLTRBRBL([
        { x: x0, y: y0 }, { x: x1, y: y0 },
        { x: x1, y: y1 }, { x: x0, y: y1 },
      ]);

      // Konfidenz im Info-Text anzeigen
      const infoEl = _ui.wrap?.querySelector('div[style*="font-mono"]');
      if (infoEl) {
        const label = confidence >= 0.8 ? '✓ Auto-Ecken gut'
                    : confidence >= 0.5 ? '~ Auto-Ecken OK — bitte prüfen'
                    :                     '⚠ Auto-Ecken unsicher — bitte manuell anpassen';
        infoEl.textContent = `${label} • ↻ Drehen wenn seitlich • Scannen`;
      }
    } catch (e) {
      console.warn('Auto-corner guess failed:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Perspektiv-Transformation
  // ─────────────────────────────────────────────────────────────

  function _dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

  function _computeDstSize(pts) {
    const W = Math.max(_dist(pts[0],pts[1]), _dist(pts[3],pts[2]));
    const H = Math.max(_dist(pts[0],pts[3]), _dist(pts[1],pts[2]));
    return { W: Math.max(900, Math.round(W)), H: Math.max(900, Math.round(H)) };
  }

  function _solveHomography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y, u, v] = [src[i].x, src[i].y, dst[i].x, dst[i].y];
      A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
      A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
    }
    const n = 8;
    for (let i = 0; i < n; i++) {
      let mx = i;
      for (let r=i+1;r<n;r++) if (Math.abs(A[r][i])>Math.abs(A[mx][i])) mx=r;
      [A[i],A[mx]]=[A[mx],A[i]]; [b[i],b[mx]]=[b[mx],b[i]];
      const pv = A[i][i]||1e-12;
      for (let j=i;j<n;j++) A[i][j]/=pv; b[i]/=pv;
      for (let r=0;r<n;r++) { if(r===i) continue; const f=A[r][i]; for(let j=i;j<n;j++) A[r][j]-=f*A[i][j]; b[r]-=f*b[i]; }
    }
    return [[b[0],b[1],b[2]],[b[3],b[4],b[5]],[b[6],b[7],1]];
  }

  function _invert3x3(m) {
    const [a,b,c]=[m[0][0],m[0][1],m[0][2]],[d,e,f]=[m[1][0],m[1][1],m[1][2]],[g,h,i]=[m[2][0],m[2][1],m[2][2]];
    const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,D=-(b*i-c*h),E=a*i-c*g,F=-(a*h-b*g),G=b*f-c*e,H=-(a*f-c*d),I=a*e-b*d;
    const det=a*A+b*B+c*C, inv=1/(det||1e-12);
    return [[A*inv,D*inv,G*inv],[B*inv,E*inv,H*inv],[C*inv,F*inv,I*inv]];
  }

  function _applyH(m,x,y) {
    const X=m[0][0]*x+m[0][1]*y+m[0][2], Y=m[1][0]*x+m[1][1]*y+m[1][2], Z=m[2][0]*x+m[2][1]*y+m[2][2];
    return {x:X/Z, y:Y/Z};
  }

  function _warpPerspectiveToCanvas(srcBitmap, srcPts) {
    const srcOrd = _orderTLTRBRBL(srcPts);
    const { W, H } = _computeDstSize(srcOrd);

    const dst = document.createElement('canvas');
    dst.width = W; dst.height = H;
    const dctx = dst.getContext('2d', { willReadFrequently: true });

    const sc = document.createElement('canvas');
    sc.width = srcBitmap.width; sc.height = srcBitmap.height;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(srcBitmap, 0, 0);
    const sData = sctx.getImageData(0,0,sc.width,sc.height).data;

    const dImg = dctx.createImageData(W, H);
    const dData = dImg.data;

    const dstPts = [{x:0,y:0},{x:W-1,y:0},{x:W-1,y:H-1},{x:0,y:H-1}];
    const Hinv = _invert3x3(_solveHomography(srcOrd, dstPts));
    const sw = sc.width, sh = sc.height;

    for (let y=0; y<H; y++) {
      for (let x=0; x<W; x++) {
        const p = _applyH(Hinv, x, y);
        const sx = Math.round(p.x), sy = Math.round(p.y);
        const di = (y*W+x)*4;
        if (sx>=0 && sx<sw && sy>=0 && sy<sh) {
          const si=(sy*sw+sx)*4;
          dData[di]=sData[si]; dData[di+1]=sData[si+1]; dData[di+2]=sData[si+2]; dData[di+3]=255;
        } else {
          dData[di]=dData[di+1]=dData[di+2]=255; dData[di+3]=255;
        }
      }
    }

    dctx.putImageData(dImg, 0, 0);
    return dst;
  }

  // ─────────────────────────────────────────────────────────────
  // NEU: Warp-Vorschau anzeigen, dann scannen
  // ─────────────────────────────────────────────────────────────

  function _showWarpPreview(warpedCanvas, onConfirm, onBack) {
    if (!_ui.previewEl) return onConfirm(); // fallback

    // Vorschau-Canvas befüllen
    const pc = document.getElementById('ocr-warp-canvas');
    if (pc) {
      const aspect = warpedCanvas.width / warpedCanvas.height;
      // zeige das Bild kompakt — max 300px hoch
      const maxH = 300;
      const dispH = Math.min(maxH, warpedCanvas.height);
      const dispW = Math.round(dispH * aspect);
      pc.width  = warpedCanvas.width;
      pc.height = warpedCanvas.height;
      pc.style.height = dispH + 'px';
      pc.style.width  = dispW + 'px';
      pc.style.maxWidth = '100%';
      pc.getContext('2d').drawImage(warpedCanvas, 0, 0);
    }

    const btnOk   = document.getElementById('ocr-warp-ok');
    const btnBack = document.getElementById('ocr-warp-back');

    // Buttons neu verbinden (cloneNode entfernt alte Listener)
    const newOk   = btnOk?.cloneNode(true);
    const newBack = btnBack?.cloneNode(true);
    if (newOk)   { btnOk.parentNode.replaceChild(newOk, btnOk);     newOk.onclick   = onConfirm; }
    if (newBack) { btnBack.parentNode.replaceChild(newBack, btnBack); newBack.onclick = onBack; }

    _disableCropUI();
    _ui.previewEl.style.display = 'block';
  }

  // ─────────────────────────────────────────────────────────────
  // Scan-Aktionen
  // ─────────────────────────────────────────────────────────────

  async function scanCropped() {
    if (!_srcBitmap || !_cropPts) return;

    _setProgress(10, 'Beleg wird begradigt…');

    const warped = _warpPerspectiveToCanvas(_srcBitmap, _cropPts);
    _lastWarped = warped; // für Tap-Workflow speichern

    _showWarpPreview(
      warped,
      async () => {
        _hideWarpPreview();
        _setProgress(15, 'Starte Texterkennung…');
        await _runOCR(warped);
      },
      () => {
        _hideWarpPreview();
        _enableCropUI();
        _renderCrop();
        _setProgress(18, 'Ecken anpassen, dann „Scannen"');
      }
    );
  }

  async function scanOriginal() {
    if (!_srcBitmap) return;
    _lastWarped = null; // kein begradigtes Bild beim Direktscan
    _setProgress(10, 'Scanne ohne Ausrichten…');
    await _runOCR(_srcBitmap);
  }

  async function _scanDirect(file) {
    _setProgress(10, 'Scanne…');
    try {
      const correctedCanvas = await _loadImageFixed(file);
      await _runOCR(correctedCanvas);
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
    }
  }

  async function _runOCR(source) {
    try {
      _setProgress(12, 'Bildvorverarbeitung…');
      const processed = _preprocessForOCR(source);

      let parsed = null;

      // ── Tesseract + Regex ─────────────────────────────────────
      _setProgress(20, 'Lokale Texterkennung…');
      const text = await recognize(processed, (pct, msg) => _setProgress(pct, msg));
      _lastText = text || '';
      window.__OCR_LAST_TEXT__ = _lastText;
      console.log('Tesseract RAW:\n', _lastText.slice(0, 2000));
      parsed = parse(_lastText);

      _lastParsed = parsed;
      window.__OCR_LAST_PARSED__ = parsed;
      _setProgress(100, '✓ Fertig');
      showResult(parsed);

      if (!parsed.date?.value && !parsed.liters?.value && !parsed.totalCost?.value)
        _setProgress(100, '⚠ Keine Werte gefunden — ist das ein Bon?');

    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
      console.error(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Ergebnis-Anzeige — v7: Status-Badges, Alternativen, Tap-Buttons
  // ─────────────────────────────────────────────────────────────

  function showResult(parsed) {
    const section = document.getElementById('ocr-result-section');
    if (section) section.style.display = 'block';

    const fields = [
      { key: 'date',          id: 'ocr-r-date',   fmt: v => v },
      { key: 'liters',        id: 'ocr-r-liters', fmt: v => v != null ? v.toFixed(2) : '' },
      { key: 'totalCost',     id: 'ocr-r-total',  fmt: v => v != null ? v.toFixed(2) : '' },
      { key: 'pricePerLiter', id: 'ocr-r-ppl',    fmt: v => v != null ? v.toFixed(4) : '' },
    ];

    const focusedId = document.activeElement?.id;
    for (const f of fields) {
      const el    = document.getElementById(f.id);
      const hint  = document.getElementById(f.id + '-hint');
      if (!el) continue;
      section?.querySelectorAll(`[data-ocr-alts-for="${f.id}"]`).forEach(node => node.remove());
      const d = parsed?.[f.key];
      // Aktives Eingabefeld nie überschreiben — Nutzer tippt gerade darin
      if (el.id !== focusedId) {
        el.value = (d && d.value != null) ? f.fmt(d.value) : '';
      }

      if (!hint) continue;
      hint.style.display = 'block';

      const status = d?.status || (d?.value == null ? 'missing' : 'uncertain');

      // ── Statusfarbe ─────────────────────────────────────────────
      const colors = {
        safe:        'var(--t3)',
        derived:     'var(--t3)',
        uncertain:   'var(--amber)',
        conflicting: 'var(--red, #e55)',
        missing:     'var(--red, #e55)',
      };
      hint.style.color = colors[status] || 'var(--amber)';

      // ── Statustext ──────────────────────────────────────────────
      let msg = '';
      if (status === 'missing') {
        msg = '✗ Nicht erkannt';
      } else if (status === 'safe') {
        if (d.source === 'manual') { msg = '✓ Manuell gesetzt'; hint.innerHTML = msg; continue; }
        const ctx = d.contextStrength === 'labeled' ? ' (EUR/L-Label)' : '';
        msg = `✓ Erkannt${ctx}`;
      } else if (status === 'derived') {
        msg = `≈ Errechnet`;
        if (d.reason) msg += ` — ${d.reason}`;
        else if (f.key === 'liters')        msg += ` aus Betrag ÷ €/L`;
        else if (f.key === 'totalCost')     msg += ` aus L × €/L`;
        else if (f.key === 'pricePerLiter') msg += ` aus Betrag ÷ L`;
      } else if (status === 'conflicting') {
        msg = `⚠⚠ Widersprüchlich — bitte manuell prüfen`;
      } else {
        // uncertain
        if (d.source === 'normalized') msg = `🔧 Korrigiert (${d.raw || ''}) — bitte prüfen`;
        else if (d.source === 'derived') msg = `≈ Errechnet (Bereich ungewöhnlich!) — bitte prüfen`;
        else {
          const ctx = d.contextStrength === 'isolated' ? ' (kein Label)' : '';
          msg = `⚠ Unsicher${ctx} — bitte prüfen`;
        }
      }

      // Warn-Bereich-Hinweis für ppl
      if (f.key === 'pricePerLiter' && d?.value != null) {
        const rs = _rangeStatus('pricePerLiter', d.value);
        if (rs === 'warn') msg += ' | Außerhalb Normalbereich!';
        else if (rs === 'outside') msg += ' | UNREALISTISCH!';
      }

      hint.innerHTML = msg;

      // ── Alternativen anzeigen (nur bei ppl) ─────────────────────
      if (d?._alts?.length) {
        const altDiv = document.createElement('div');
        altDiv.dataset.ocrAltsFor = f.id;
        altDiv.style.cssText = 'margin-top:3px;display:flex;gap:6px;flex-wrap:wrap';
        for (const alt of d._alts) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.style.cssText = 'font-size:10px;padding:2px 6px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;color:var(--t2);cursor:pointer';
          const altValue = (alt && alt.value != null) ? f.fmt(alt.value) : '';
          btn.textContent = altValue;
          btn.title = [alt.label, alt.contextStrength].filter(Boolean).join(' / ') || 'Alternative';
          btn.onclick = () => {
            el.value = altValue;
            if (hint) {
              hint.textContent = `✓ Alternative gewählt${alt.label ? ` (${alt.label})` : ''}`;
              hint.style.color = 'var(--t3)';
            }
            altDiv.remove();
            // Neue Konsistenzprüfung mit gewähltem Wert anstoßen
            recalculateFromInputs();
          };
          altDiv.appendChild(btn);
        }
        const altLabel = document.createElement('span');
        altLabel.style.cssText = 'font-size:10px;color:var(--t3);align-self:center';
        altLabel.textContent = 'Alternativen:';
        altDiv.prepend(altLabel);
        hint.after(altDiv);
      }
    }

    // ── Tap-Workflow einblenden wenn Bild vorhanden ──────────────
    _ensureTapSection(parsed);
  }

  // ─────────────────────────────────────────────────────────────
  // Wort-Bounding-Box-Suche (Tesseract word data)
  // ─────────────────────────────────────────────────────────────

  /**
   * Sucht die Bounding-Box eines OCR-Rohwerts in _lastWords.
   * Gibt {x0,y0,x1,y1} in Quell-Pixel zurück oder null.
   */
  function _findValueBbox(rawValue) {
    if (!rawValue || !_lastWords.length) return null;
    const norm = v => String(v).replace(/\s+/g, '').replace(',', '.').toLowerCase();
    const target = norm(rawValue);
    if (!target) return null;

    // 1) Direkter Einzelwort-Treffer
    for (const w of _lastWords) {
      if (norm(w.text) === target) return w.bbox;
    }
    // 2) Zwei aufeinanderfolgende Wörter zusammenführen
    for (let i = 0; i < _lastWords.length - 1; i++) {
      if (norm(_lastWords[i].text + _lastWords[i + 1].text) === target) {
        const a = _lastWords[i].bbox, b = _lastWords[i + 1].bbox;
        return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
                 x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
      }
    }
    // 3) Teilstring-Treffer (wenn Wort Dezimaltrenner enthält, z.B. "71,58" in "71,58EUR")
    for (const w of _lastWords) {
      if (norm(w.text).includes(target)) return w.bbox;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // Tap-Workflow: Nutzer tippt direkt auf Belegbild
  // ─────────────────────────────────────────────────────────────

  function _ensureTapSection(parsed) {
    // Nur anzeigen wenn ein Bild vorhanden
    const imgSrc = _lastWarped || (_srcBitmap ? _bitmapToCanvas(_srcBitmap) : null);
    if (!imgSrc) return;

    const host = document.getElementById('ocr-result-section');
    if (!host) return;

    const existing = document.getElementById('ocr-tap-section');
    if (existing) existing.remove();

    const needsTap = ['date', 'liters', 'totalCost', 'pricePerLiter'].some(k => {
      const st = parsed?.[k]?.status;
      return !st || st === 'missing' || st === 'uncertain' || st === 'conflicting';
    });

    const tapSec = document.createElement('div');
    tapSec.id = 'ocr-tap-section';
    tapSec.style.cssText = 'margin-top:12px;padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;position:relative';

    const tapHead = document.createElement('div');
    tapHead.style.cssText = `font-family:var(--font-mono);font-size:11px;letter-spacing:1px;color:${needsTap ? 'var(--amber)' : 'var(--t3)'};text-transform:uppercase;margin-bottom:6px`;
    tapHead.textContent = needsTap ? 'Wert auf Beleg einrahmen' : 'Erkannte Werte prüfen / korrigieren';
    tapSec.appendChild(tapHead);

    const FIELD_COLORS = {
      date:          { stroke: '#ffbf00', fill: 'rgba(255,191,0,0.18)',  label: 'Datum'  },
      liters:        { stroke: '#4fc96a', fill: 'rgba(79,201,106,0.18)', label: 'Liter'  },
      totalCost:     { stroke: '#ff5555', fill: 'rgba(255,85,85,0.18)',  label: 'Betrag' },
      pricePerLiter: { stroke: '#55aaff', fill: 'rgba(85,170,255,0.18)', label: '€/L'   },
    };

    const tapFields = [
      { key: 'date',          label: 'Datum',    id: 'ocr-r-date'   },
      { key: 'totalCost',     label: 'Betrag €', id: 'ocr-r-total'  },
      { key: 'liters',        label: 'Liter',    id: 'ocr-r-liters' },
      { key: 'pricePerLiter', label: '€/L',      id: 'ocr-r-ppl'    },
      { key: 'odometer',      label: 'km-Stand', id: null            },
    ];

    // Erkannte Feld-Positionen aus Tesseract word data
    const bboxMap = {};
    for (const k of Object.keys(FIELD_COLORS)) {
      const raw = parsed?.[k]?.raw;
      if (raw) { const b = _findValueBbox(raw); if (b) bboxMap[k] = b; }
    }
    const hasBoxes = Object.keys(bboxMap).length > 0;

    // Statuszeile
    const statusLine = document.createElement('div');
    statusLine.style.cssText = 'font-size:11px;color:var(--t3);margin-bottom:6px;min-height:16px';
    statusLine.textContent = hasBoxes
      ? 'Erkannte Felder antippen oder Feld wählen → Kasten ziehen:'
      : 'Feld wählen, dann Kasten um die Zahl ziehen:';
    tapSec.appendChild(statusLine);

    // Feld-Auswahl-Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';

    // selectField wird von Buttons und Bild-Tap-Hit-Test aufgerufen (redrawCanvas ist Closure-ref)
    let selectedKey = null;
    const selectField = (key) => {
      selectedKey = key;
      _tapTarget = key;
      btnRow.querySelectorAll('button[data-tap-key]').forEach(b => {
        const active = b.dataset.tapKey === key;
        b.style.background = active ? 'var(--amber)' : '';
        b.style.color      = active ? '#000' : '';
      });
      redrawCanvas();
      const tf = tapFields.find(f => f.key === key);
      statusLine.textContent = tf ? `Kasten um "${tf.label}" ziehen:` : 'Kasten ziehen:';
      statusLine.style.color = 'var(--amber)';
    };

    for (const tf of tapFields) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'font-size:12px;padding:5px 10px;flex:1;min-width:70px';
      btn.textContent = tf.label;
      btn.dataset.tapKey = tf.key;
      btn.onclick = () => selectField(tf.key);
      btnRow.appendChild(btn);
    }
    tapSec.appendChild(btnRow);

    // ── Kombiniertes Canvas: Bild + farbige Rahmen + Einrahmen ────
    const W = imgSrc.width, H = imgSrc.height;
    const maxDispW = 340, maxDispH = 520;
    const imgAspect = W / H;
    let dispW = Math.min(W, maxDispW);
    let dispH = Math.round(dispW / imgAspect);
    if (dispH > maxDispH) { dispH = maxDispH; dispW = Math.round(dispH * imgAspect); }

    const tc = document.createElement('canvas');
    tc.id = 'ocr-tap-canvas';
    tc.width = W; tc.height = H;
    tc.style.cssText = `display:block;width:${dispW}px;height:${dispH}px;max-width:100%;border-radius:8px;border:2px solid ${needsTap ? 'var(--amber)' : 'var(--border)'};cursor:crosshair;touch-action:none;user-select:none`;
    const tctx = tc.getContext('2d');

    const pad = Math.max(4, W / 200);
    const fontSize = Math.max(20, W / 40);

    // redrawCanvas ist als var (nicht const) deklariert, damit selectField es per Closure referenzieren kann
    // bevor es initialisiert wurde — tatsächlich wird es nur aufgerufen wenn Nutzer klickt (asynchron), also safe
    const redrawCanvas = (dragA, dragB) => {
      tctx.clearRect(0, 0, W, H);
      tctx.drawImage(imgSrc, 0, 0);

      // Erkannte Felder einzeichnen
      for (const [k, bbox] of Object.entries(bboxMap)) {
        const fc = FIELD_COLORS[k];
        if (!fc) continue;
        const isSelected = selectedKey === k;
        const bx = bbox.x0 - pad, by = bbox.y0 - pad;
        const bw = bbox.x1 - bbox.x0 + pad * 2, bh = bbox.y1 - bbox.y0 + pad * 2;
        tctx.save();
        tctx.strokeStyle = fc.stroke;
        tctx.lineWidth = isSelected ? Math.max(4, W / 150) : Math.max(2, W / 300);
        tctx.fillStyle = isSelected ? fc.fill.replace('0.18', '0.32') : fc.fill;
        tctx.beginPath(); tctx.rect(bx, by, bw, bh); tctx.fill(); tctx.stroke();
        tctx.font = `bold ${fontSize}px sans-serif`;
        tctx.fillStyle = fc.stroke;
        const labelY = (by - 4) > fontSize ? (by - 4) : (by + bh + fontSize + 2);
        tctx.fillText(fc.label, bx + 2, labelY);
        tctx.restore();
      }

      // Nutzer-Einrahmen (gestrichelter Kasten)
      if (dragA && dragB) {
        const fc = selectedKey ? FIELD_COLORS[selectedKey] : null;
        const rx = Math.min(dragA.x, dragB.x), ry = Math.min(dragA.y, dragB.y);
        const rw = Math.abs(dragB.x - dragA.x), rh = Math.abs(dragB.y - dragA.y);
        if (rw >= 2 && rh >= 2) {
          tctx.save();
          tctx.fillStyle   = fc ? fc.fill   : 'rgba(255,191,0,0.15)';
          tctx.strokeStyle = fc ? fc.stroke : '#ffbf00';
          tctx.lineWidth   = Math.max(2, W / 400);
          tctx.setLineDash([8, 4]);
          tctx.beginPath(); tctx.rect(rx, ry, rw, rh); tctx.fill(); tctx.stroke();
          tctx.restore();
        }
      }
    };

    redrawCanvas();

    const getScale = () => {
      const r = tc.getBoundingClientRect();
      return { sx: W / r.width, sy: H / r.height };
    };
    const toSrc = (cx, cy) => {
      const { sx, sy } = getScale();
      return { x: Math.round(cx * sx), y: Math.round(cy * sy) };
    };
    const getCanvasXY = ev => {
      const r = tc.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    // ── Lupe (Touch) ──────────────────────────────────────────────
    const TAP_LOUPE_SIZE = 96;
    const tapLoupe = document.createElement('canvas');
    tapLoupe.width = TAP_LOUPE_SIZE; tapLoupe.height = TAP_LOUPE_SIZE;
    tapLoupe.style.cssText = [
      'display:none', 'position:absolute', 'top:4px', 'right:4px',
      'width:' + TAP_LOUPE_SIZE + 'px', 'height:' + TAP_LOUPE_SIZE + 'px',
      'border-radius:50%', 'border:2px solid var(--amber)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.6)', 'z-index:20', 'pointer-events:none',
    ].join(';');
    tapSec.appendChild(tapLoupe);
    const tapLoupeCtx = tapLoupe.getContext('2d');
    const _showTapLoupe = (cpx, cpy) => {
      const { sx, sy } = getScale();
      const zoom = 3;
      const srcX = cpx * sx - TAP_LOUPE_SIZE / 2 / zoom;
      const srcY = cpy * sy - TAP_LOUPE_SIZE / 2 / zoom;
      const srcW = TAP_LOUPE_SIZE / zoom, srcH = TAP_LOUPE_SIZE / zoom;
      tapLoupeCtx.clearRect(0, 0, TAP_LOUPE_SIZE, TAP_LOUPE_SIZE);
      tapLoupeCtx.save();
      tapLoupeCtx.beginPath();
      tapLoupeCtx.arc(TAP_LOUPE_SIZE / 2, TAP_LOUPE_SIZE / 2, TAP_LOUPE_SIZE / 2, 0, Math.PI * 2);
      tapLoupeCtx.clip();
      tapLoupeCtx.drawImage(imgSrc, srcX, srcY, srcW, srcH, 0, 0, TAP_LOUPE_SIZE, TAP_LOUPE_SIZE);
      tapLoupeCtx.strokeStyle = 'rgba(255,191,0,0.9)'; tapLoupeCtx.lineWidth = 1.5;
      tapLoupeCtx.beginPath();
      tapLoupeCtx.moveTo(TAP_LOUPE_SIZE/2 - 8, TAP_LOUPE_SIZE/2); tapLoupeCtx.lineTo(TAP_LOUPE_SIZE/2 + 8, TAP_LOUPE_SIZE/2);
      tapLoupeCtx.moveTo(TAP_LOUPE_SIZE/2, TAP_LOUPE_SIZE/2 - 8); tapLoupeCtx.lineTo(TAP_LOUPE_SIZE/2, TAP_LOUPE_SIZE/2 + 8);
      tapLoupeCtx.stroke(); tapLoupeCtx.restore();
      tapLoupe.style.display = 'block';
    };
    const _hideTapLoupe = () => { tapLoupe.style.display = 'none'; };

    let dragStart = null;

    tc.addEventListener('pointerdown', ev => {
      ev.preventDefault(); ev.stopPropagation();
      tc.setPointerCapture?.(ev.pointerId);
      const { x: cpx, y: cpy } = getCanvasXY(ev);
      const srcPt = toSrc(cpx, cpy);
      // Hit-Test: Klick auf erkannten Rahmen → Feld vorauswählen
      const p2 = Math.max(pad * 3, 20);
      for (const [k, bbox] of Object.entries(bboxMap)) {
        if (srcPt.x >= bbox.x0 - p2 && srcPt.x <= bbox.x1 + p2 &&
            srcPt.y >= bbox.y0 - p2 && srcPt.y <= bbox.y1 + p2) {
          selectField(k); break;
        }
      }
      dragStart = srcPt;
      redrawCanvas(dragStart, dragStart);
      if (ev.pointerType === 'touch') _showTapLoupe(cpx, cpy);
    }, { passive: false });

    tc.addEventListener('pointermove', ev => {
      if (!dragStart) return;
      ev.preventDefault(); ev.stopPropagation();
      const { x, y } = getCanvasXY(ev);
      redrawCanvas(dragStart, toSrc(x, y));
      if (ev.pointerType === 'touch') _showTapLoupe(x, y);
    }, { passive: false });

    tc.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); });

    tc.addEventListener('pointerup', async ev => {
      ev.stopPropagation();
      _hideTapLoupe();
      if (!dragStart) { ev.preventDefault(); return; }
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      const dragEnd = toSrc(x, y);
      redrawCanvas(dragStart, dragEnd);
      const rx = Math.min(dragStart.x, dragEnd.x), ry = Math.min(dragStart.y, dragEnd.y);
      const rw = Math.abs(dragEnd.x - dragStart.x), rh = Math.abs(dragEnd.y - dragStart.y);
      dragStart = null;

      if (rw < 15 || rh < 8) { redrawCanvas(); return; } // Tap, kein Drag

      if (!selectedKey) {
        statusLine.textContent = '⚠ Zuerst ein Feld wählen (Datum, Betrag …)';
        statusLine.style.color = 'var(--amber)';
        redrawCanvas(); return;
      }

      statusLine.textContent = 'Lese markierten Bereich…';
      statusLine.style.color = 'var(--t3)';
      try {
        const tf = tapFields.find(f => f.key === selectedKey);
        const extracted = await _ocrRegionRect(imgSrc, rx, ry, rw, rh, selectedKey);
        if (extracted != null) {
          const targetEl = tf?.id ? document.getElementById(tf.id) : null;
          if (targetEl) {
            targetEl.value = String(extracted);
            const hint = document.getElementById(tf.id + '-hint');
            if (hint) { hint.textContent = '✓ Manuell aus Foto'; hint.style.color = 'var(--t3)'; }
            const merged = _mergeParsedWithInputs({ [selectedKey]: String(extracted) });
            _validateFinalize(merged);
            _lastParsed = merged;
            window.__OCR_LAST_PARSED__ = merged;
            showResult(merged);
          } else if (selectedKey === 'odometer') {
            _setVal('tf-odometer', String(Math.round(extracted)));
            if (window.App?.updateFuelPreview) App.updateFuelPreview();
            statusLine.textContent = `✓ km-Stand: ${extracted}`;
          }
        } else {
          statusLine.textContent = '⚠ Keine Zahl erkannt — anderen Bereich markieren';
          redrawCanvas();
        }
      } catch (e) {
        statusLine.textContent = '✗ Fehler — nochmal versuchen';
      }
    }, { passive: false });

    tc.addEventListener('pointercancel', () => { dragStart = null; _hideTapLoupe(); redrawCanvas(); });

    tapSec.appendChild(tc);
    host.appendChild(tapSec);
  }

  // Hilfsfunktion: ImageBitmap → Canvas
  function _bitmapToCanvas(bmp) {
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return c;
  }

  // _activateTapMode ist nicht mehr im Einsatz — Logik jetzt direkt in _ensureTapSection
  function _activateTapMode(_fieldKey, _fieldId, _imgCanvas, _tapSec, _btnRow) {
    // noop — combined canvas in _ensureTapSection ersetzt diese Funktion
    const wrap = document.getElementById('ocr-tap-canvas-wrap');
    if (!wrap) return;
    wrap.style.display = 'block';
    wrap.innerHTML = '';

    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:var(--amber);margin-bottom:4px';
    info.id = 'ocr-tap-info';
    info.textContent = `Kasten um "${_tapFieldLabel(fieldKey)}" ziehen:`;
    wrap.appendChild(info);

    // Canvas: Breiten-basiertes Scaling (Hochformat-Belege füllen die verfügbare Breite)
    const maxDispW = 340;
    const maxDispH = 520;
    const aspect = imgCanvas.width / imgCanvas.height;
    let dispW = Math.min(imgCanvas.width, maxDispW);
    let dispH = Math.round(dispW / aspect);
    if (dispH > maxDispH) { dispH = maxDispH; dispW = Math.round(dispH * aspect); }

    const tc = document.createElement('canvas');
    tc.id = 'ocr-tap-canvas';
    tc.width  = imgCanvas.width;
    tc.height = imgCanvas.height;
    tc.style.cssText = `display:block;width:${dispW}px;height:${dispH}px;max-width:100%;border-radius:8px;border:2px solid var(--amber);cursor:crosshair;touch-action:none;user-select:none`;
    const tctx = tc.getContext('2d');
    tctx.drawImage(imgCanvas, 0, 0);
    wrap.appendChild(tc);

    // Skalierungsfaktoren: CSS-px → Quell-Pixel
    const getScale = () => {
      const r = tc.getBoundingClientRect();
      return { sx: imgCanvas.width / r.width, sy: imgCanvas.height / r.height };
    };
    const toSrc = (cx, cy) => {
      const { sx, sy } = getScale();
      return { x: Math.round(cx * sx), y: Math.round(cy * sy) };
    };

    let dragStart = null; // in Quell-Pixel

    const drawBox = (a, b) => {
      tctx.clearRect(0, 0, tc.width, tc.height);
      tctx.drawImage(imgCanvas, 0, 0);
      if (!a || !b) return;
      const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x),   rh = Math.abs(b.y - a.y);
      if (rw < 2 || rh < 2) return;
      tctx.save();
      tctx.fillStyle = 'rgba(255,191,0,0.15)';
      tctx.strokeStyle = 'rgba(255,191,0,0.95)';
      tctx.lineWidth = Math.max(2, tc.width / 400);
      tctx.beginPath(); tctx.rect(rx, ry, rw, rh); tctx.fill(); tctx.stroke();
      tctx.restore();
    };

    const getCanvasXY = ev => {
      const r = tc.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    tc.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      tc.setPointerCapture?.(ev.pointerId);
      const { x, y } = getCanvasXY(ev);
      dragStart = toSrc(x, y);
      drawBox(dragStart, dragStart);
    }, { passive: false });

    tc.addEventListener('pointermove', ev => {
      if (!dragStart) return;
      ev.preventDefault();
      ev.stopPropagation();
      const { x, y } = getCanvasXY(ev);
      drawBox(dragStart, toSrc(x, y));
    }, { passive: false });

    // click immer stoppen damit der Overlay-Close-Handler nicht feuert
    tc.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); });

    tc.addEventListener('pointerup', async ev => {
      ev.stopPropagation(); // immer, auch wenn !dragStart
      if (!dragStart) { ev.preventDefault(); return; }
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      const dragEnd = toSrc(x, y);
      drawBox(dragStart, dragEnd);

      const rx = Math.min(dragStart.x, dragEnd.x);
      const ry = Math.min(dragStart.y, dragEnd.y);
      const rw = Math.abs(dragEnd.x - dragStart.x);
      const rh = Math.abs(dragEnd.y - dragStart.y);
      dragStart = null;

      if (rw < 15 || rh < 8) {
        document.getElementById('ocr-tap-info').textContent = '⚠ Kasten zu klein — nochmal ziehen';
        return;
      }

      document.getElementById('ocr-tap-info').textContent = 'Lese markierten Bereich…';
      try {
        const extracted = await _ocrRegionRect(imgCanvas, rx, ry, rw, rh, fieldKey);
        if (extracted != null) {
          const targetEl = fieldId ? document.getElementById(fieldId) : null;
          if (targetEl) {
            targetEl.value = String(extracted);
            const hint = document.getElementById(fieldId + '-hint');
            if (hint) { hint.textContent = '✓ Manuell aus Foto'; hint.style.color = 'var(--t3)'; }
            const overrideKey = fieldKey === 'date' ? 'date' : fieldKey;
            const merged = _mergeParsedWithInputs({ [overrideKey]: String(extracted) });
            _validateFinalize(merged);
            _lastParsed = merged;
            window.__OCR_LAST_PARSED__ = merged;
            showResult(merged);
          } else if (fieldKey === 'odometer') {
            _setVal('tf-odometer', String(Math.round(extracted)));
            if (window.App?.updateFuelPreview) App.updateFuelPreview();
          }
          document.getElementById('ocr-tap-info').textContent = `✓ ${_tapFieldLabel(fieldKey)}: ${extracted}`;
        } else {
          document.getElementById('ocr-tap-info').textContent = '⚠ Keine Zahl erkannt — anderen Bereich markieren';
        }
      } catch(e) {
        document.getElementById('ocr-tap-info').textContent = '✗ Fehler — nochmal versuchen';
      }
    }, { passive: false });

    tc.addEventListener('pointercancel', () => { dragStart = null; });
  }

  function _tapFieldLabel(key) {
    if (key === 'date') return 'Datum';
    return { totalCost: 'Betrag €', liters: 'Liter', pricePerLiter: '€/L', odometer: 'km-Stand' }[key] || key;
  }

  // OCR eines vom Nutzer gezogenen Rechtecks (direkte Quell-Koordinaten)
  async function _ocrRegionRect(srcCanvas, rx, ry, rw, rh, fieldKey) {
    // Leichten Puffer für bessere OCR (5% horizontal, 15% vertikal)
    const padX = Math.round(rw * 0.05);
    const padY = Math.round(rh * 0.15);
    const x = Math.max(0, rx - padX);
    const y = Math.max(0, ry - padY);
    const w = Math.min(srcCanvas.width  - x, rw + padX * 2);
    const h = Math.min(srcCanvas.height - y, rh + padY * 2);
    if (w < 10 || h < 5) return null;

    // Region in neues Canvas kopieren
    const rc = document.createElement('canvas');
    rc.width = w; rc.height = h;
    rc.getContext('2d').drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);

    // Hochskalieren für Tesseract (min 400px Breite für gute Erkennung kleiner Zahlen)
    const minW = 400;
    const upsc = w < minW ? minW / w : 1;
    const uc = document.createElement('canvas');
    uc.width  = Math.round(w * upsc);
    uc.height = Math.round(h * upsc);
    uc.getContext('2d').drawImage(rc, 0, 0, uc.width, uc.height);

    const processed = _preprocessForOCR(uc);
    const savedWords = _lastWords; // Vollbild-Positionen sichern
    const text = await recognize(processed);
    _lastWords = savedWords; // wiederherstellen — Region-OCR darf Vollbild-Koordinaten nicht überschreiben
    return _extractNumberForField(text, fieldKey);
  }

  // Extrahiert die relevante Zahl aus einem kurzen OCR-Text
  function _extractNumberForField(text, fieldKey) {
    const flat = _normalizeOCRText(text);

    if (fieldKey === 'date') {
      for (const m of flat.matchAll(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/g)) {
        const iso = _parseDate(m[1]);
        if (iso) return iso;
      }
      return null;
    }

    if (fieldKey === 'odometer') {
      // km: große Ganzzahl
      const km = [...flat.matchAll(/\b(\d{4,6})\b/g)].map(m => parseInt(m[1], 10)).filter(v => v >= 1000 && v <= 999999);
      return km.length ? km.reduce((a, b) => Math.abs(a - 80000) < Math.abs(b - 80000) ? a : b) : null;
    }

    if (fieldKey === 'pricePerLiter') {
      // ppl: 3-4 Dezimalstellen
      for (const m of flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})/g)) {
        const v = _parsePricePerLiter(m[1]);
        if (v && v >= 0.45 && v < 4.0) return +v.toFixed(4);
      }
      for (const m of flat.matchAll(/([0-9]{1,2}[,\.][0-9]{2})/g)) {
        const v = _parsePricePerLiter(m[1]);
        if (v && v >= 0.45 && v < 4.0) return +v.toFixed(4);
      }
      return null;
    }

    if (fieldKey === 'liters') {
      for (const m of flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})/g)) {
        const v = _parseLiters(m[1]);
        if (v && v >= 2 && v <= 200) return +v.toFixed(2);
      }
      return null;
    }

    if (fieldKey === 'totalCost') {
      for (const m of flat.matchAll(/([0-9]{1,4}[,\.][0-9]{2})/g)) {
        const v = _parseMoney(m[1]);
        if (v && v >= 2 && v <= 1000) return +v.toFixed(2);
      }
      return null;
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // DOM-Helfer
  // ─────────────────────────────────────────────────────────────

  function _setProgress(pct, msg) {
    const wrap  = document.getElementById('ocr-progress-wrap');
    const fill  = document.getElementById('ocr-progress-fill');
    const label = document.getElementById('ocr-progress-label');
    if (wrap)  wrap.style.display = 'block';
    if (fill  && pct != null) fill.style.width = pct + '%';
    if (label && msg)         label.textContent = msg;
  }

  function _show(id, disp='block'){ const el=document.getElementById(id); if(el) el.style.display=disp; }
  function _hide(id){ const el=document.getElementById(id); if(el) el.style.display='none'; }
  function _val(id){ const el=document.getElementById(id); return el ? el.value : ''; }
  function _setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

  function getLastText()   { return _lastText; }
  function getLastParsed() { return _lastParsed; }

  return {
    openOverlay, closeOverlay, handleFile, transfer,
    recalculateFromInputs,
    parse, recognize,
    scanCropped, scanOriginal,
    rotateSrc90,
    getLastText, getLastParsed,
  };

})();

window.OCR = OCR;
