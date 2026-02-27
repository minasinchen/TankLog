/**
 * OCR MODULE — Tankzettel-Erkennung via Tesseract.js (lokal, kein Server)
 *
 * Workflow:
 * 1. Foto aufnehmen oder hochladen
 * 2. Tesseract.js erkennt Text lokal im Browser (German language model)
 * 3. Regex-Heuristiken extrahieren: Datum, Liter, Betrag, €/Liter
 * 4. Confidence-Scores für jeden Wert
 * 5. Formular vorausfüllen, Nutzer bestätigt/korrigiert
 */

const OCR = (() => {

  let _worker = null;
  let _workerReady = false;
  let _loading = false;

  // ── Tesseract Worker ────────────────────────────────────────

  async function initWorker(onProgress) {
    if (_worker && _workerReady) return _worker;
    if (_loading) {
      // Wait for ongoing init
      while (_loading) await new Promise(r => setTimeout(r, 100));
      return _worker;
    }

    _loading = true;
    try {
      _worker = await Tesseract.createWorker('deu', 1, {
        logger: m => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(Math.round(m.progress * 100), 'Erkenne Text…');
          } else if (m.status && onProgress) {
            onProgress(null, m.status);
          }
        },
        // Use CDN for language data
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      });
      _workerReady = true;
    } catch (err) {
      _loading = false;
      throw err;
    }
    _loading = false;
    return _worker;
  }

  async function recognize(imageFile, onProgress) {
    if (onProgress) onProgress(5, 'Lade OCR-Engine…');
    const worker = await initWorker(onProgress);
    if (onProgress) onProgress(20, 'Analysiere Bild…');
    const { data: { text } } = await worker.recognize(imageFile);
    if (onProgress) onProgress(100, 'Fertig');
    return text;
  }

  // ── German Receipt Parser ───────────────────────────────────

  /**
   * Parse raw OCR text from a German fuel receipt.
   * Returns { date, liters, totalCost, pricePerLiter } each with:
   *   value: parsed value (or null)
   *   raw:   matched raw string
   *   conf:  confidence 0..1 (0.9=high, 0.5=medium, 0.2=low/implausible)
   */
  function parse(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const flat = text;

    const result = {
      date:          { value: null, raw: null, conf: 0 },
      liters:        { value: null, raw: null, conf: 0 },
      totalCost:     { value: null, raw: null, conf: 0 },
      pricePerLiter: { value: null, raw: null, conf: 0 },
    };

    // ── DATE ──────────────────────────────────────────────────

    // High confidence: labeled "Datum", "Belegdatum", "Kassendatum" etc.
    const dateLabelRE = /(?:datum|date|belegdatum|kassendatum|quittung)[:\s]+(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})/gi;
    const dateLabelM = flat.match(dateLabelRE);
    if (dateLabelM) {
      const inner = dateLabelM[0].match(/(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})/);
      if (inner) { result.date = { value: _parseDate(inner[1]), raw: inner[1], conf: 0.90 }; }
    }

    // Medium: any standalone date in the text
    if (!result.date.value) {
      const dateMatches = [...flat.matchAll(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/g)];
      if (dateMatches.length) {
        // Prefer the first one that looks like a receipt date (not e.g. an expiry date)
        const today = new Date();
        const parsed = dateMatches.map(m => ({ raw: m[1], iso: _parseDate(m[1]) }))
          .filter(d => d.iso)
          .filter(d => {
            const dt = new Date(d.iso);
            return dt <= today && dt >= new Date('1990-01-01');
          });
        if (parsed.length) {
          result.date = { value: parsed[0].iso, raw: parsed[0].raw, conf: 0.65 };
        }
      }
    }

    // ── LITERS ────────────────────────────────────────────────

    // Very high confidence: "Menge" / "Liter" keyword + number
    const literLabelRE = /(?:menge|liter|vol(?:umen)?|kraftstoff|fuel)[:\s=]+([0-9]{1,3}[,\.][0-9]{1,3})\s*[lL]?/gi;
    const llM = [...flat.matchAll(literLabelRE)];
    for (const m of llM) {
      const v = _parseDE(m[1]);
      if (v && v > 1 && v < 250) {
        result.liters = { value: v, raw: m[1], conf: 0.92 };
        break;
      }
    }

    // High confidence: number followed by " L" or " Liter"
    if (!result.liters.value) {
      const literRE = /([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL](?:iter)?\b/g;
      const lMatches = [...flat.matchAll(literRE)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(m => m.value && m.value > 1 && m.value < 250);
      if (lMatches.length) {
        // Prefer values in realistic range 5–120L for a passenger car
        const best = lMatches.find(m => m.value >= 5 && m.value <= 120) || lMatches[0];
        result.liters = { value: best.value, raw: best.raw, conf: 0.78 };
      }
    }

    // ── TOTAL COST ────────────────────────────────────────────

    // 1) High confidence: keyword + value (same line), supports € and EUR
    const totalKeySameLineRE =
      /(?:gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|betrag|zu\s+zahlen|zahlbetrag)\b[^\d]{0,40}([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)?/gi;

    for (const m of flat.matchAll(totalKeySameLineRE)) {
      const v = _parseDE(m[1]);
      if (v && v > 1 && v < 1000) {
        result.totalCost = { value: v, raw: m[1], conf: 0.92 };
        break;
      }
    }

    // 2) Keyword line, value on next 1–3 lines (common on Shell/Aral/etc.)
    if (!result.totalCost.value) {
      const keyLineRE = /(gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|zu\s+zahlen|zahlbetrag|betrag)/i;

      for (let i = 0; i < lines.length; i++) {
        if (!keyLineRE.test(lines[i])) continue;

        const look = [lines[i], lines[i + 1], lines[i + 2], lines[i + 3]]
          .filter(Boolean)
          .join(' ');

        const mm = look.match(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/i);
        if (mm) {
          const v = _parseDE(mm[1]);
          if (v && v > 2 && v < 500) {
            result.totalCost = { value: v, raw: mm[1], conf: 0.80 };
            break;
          }
        }
      }
    }

    // 3) Medium: pick largest plausible money amount anywhere (supports € and EUR)
    if (!result.totalCost.value) {
      const moneyRE = /([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/gi;
      const moneyMatches = [...flat.matchAll(moneyRE)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(m => m.value && m.value > 2 && m.value < 500);

      if (moneyMatches.length) {
        moneyMatches.sort((a, b) => b.value - a.value);
        result.totalCost = { value: moneyMatches[0].value, raw: moneyMatches[0].raw, conf: 0.60 };
      }
    }



    // ── PRICE PER LITER ───────────────────────────────────────

    // "1,479 €/l" or "1.479/L" or labeled "Preis", "Kraftstoffpreis", "Listenpreis"
    const pplRE = /([0-9][,\.][0-9]{3,4})\s*(?:[€$E]\s*)?[\/\\]?\s*(?:[lL]|Liter)/g;
    const pplLabelRE = /(?:preis[\/\\]l|kraftstoffpreis|listenpreis|€\/l|eur\/l)[:\s=]*([0-9][,\.][0-9]{3})/gi;

    const pplLabelM = flat.match(pplLabelRE);
    if (pplLabelM) {
      const inner = pplLabelM[0].match(/([0-9][,\.][0-9]{3,4})/);
      if (inner) {
        const v = _parseDE(inner[1]);
        if (v && v > 0.5 && v < 5.0) {
          result.pricePerLiter = { value: v, raw: inner[1], conf: 0.92 };
        }
      }
    }

    if (!result.pricePerLiter.value) {
      const pplMatches = [...flat.matchAll(pplRE)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(m => m.value && m.value > 0.5 && m.value < 5.0);
      if (pplMatches.length) {
        result.pricePerLiter = { value: pplMatches[0].value, raw: pplMatches[0].raw, conf: 0.80 };
      }
    }

    // ── Cross-validation ──────────────────────────────────────

    // If we have liters + total, derive ppl
    if (result.liters.value && result.totalCost.value && !result.pricePerLiter.value) {
      const derived = result.totalCost.value / result.liters.value;
      if (derived > 0.5 && derived < 5.0) {
        result.pricePerLiter = { value: +derived.toFixed(4), raw: 'berechnet', conf: 0.50 };
      }
    }

    // If we have ppl + total, derive liters
    if (!result.liters.value && result.pricePerLiter.value && result.totalCost.value) {
      const derived = result.totalCost.value / result.pricePerLiter.value;
      if (derived > 1 && derived < 250) {
        result.liters = { value: +derived.toFixed(2), raw: 'berechnet', conf: 0.45 };
      }
    }

    // ── Sanity checks → reduce confidence ─────────────────────

    if (result.liters.value && (result.liters.value < 1 || result.liters.value > 200)) {
      result.liters.conf = Math.min(result.liters.conf, 0.25);
    }
    if (result.totalCost.value && (result.totalCost.value < 2 || result.totalCost.value > 500)) {
      result.totalCost.conf = Math.min(result.totalCost.conf, 0.25);
    }
    if (result.pricePerLiter.value && (result.pricePerLiter.value < 0.80 || result.pricePerLiter.value > 4.0)) {
      result.pricePerLiter.conf = Math.min(result.pricePerLiter.conf, 0.25);
    }

    return result;
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Parse German decimal comma number: "45,21" → 45.21 */
  function _parseDE(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    // Remove thousand separator dots (e.g. 1.234,56 → 1234.56)
    const cleaned = str.replace(/\.(?=\d{3}[,])/g, '').replace(',', '.');
    const v = parseFloat(cleaned);
    return isNaN(v) ? null : v;
  }

  /** Parse various German/ISO date formats to ISO YYYY-MM-DD */
  function _parseDate(s) {
    if (!s) return null;
    s = s.trim();
    // ISO yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // dd.mm.yyyy or dd/mm/yyyy or dd-mm-yyyy
    const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = parseInt(y) > 50 ? '19' + y : '20' + y;
      const iso = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
      // Validate
      const dt = new Date(iso);
      if (isNaN(dt.getTime())) return null;
      return iso;
    }
    return null;
  }

  // ── UI Controller ───────────────────────────────────────────

 function openOverlay() {
  // Reset state (support both: single input OR camera+gallery inputs)
  const idsToReset = ['ocr-file-input', 'ocr-file-camera', 'ocr-file-gallery'];
  idsToReset.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const preview = document.getElementById('ocr-img-preview-wrap');
  if (preview) preview.style.display = 'none';

  const res = document.getElementById('ocr-result-section');
  if (res) res.style.display = 'none';

  const prog = document.getElementById('ocr-progress-wrap');
  if (prog) prog.style.display = 'none';

  const zone = document.getElementById('ocr-zone');
  if (zone) zone.style.display = 'flex';

  const ov = document.getElementById('overlay-ocr');
  if (ov) ov.classList.add('open');
}
  function closeOverlay() {
    document.getElementById('overlay-ocr').classList.remove('open');
  }

  async function handleFile(file) {
    if (!file) return;

    // Show preview
    const previewWrap = document.getElementById('ocr-img-preview-wrap');
    const previewImg = document.getElementById('ocr-img-preview');
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewWrap.style.display = 'block';
    document.getElementById('ocr-zone').style.display = 'none';
    document.getElementById('ocr-result-section').style.display = 'none';

    // Show progress
    const progressWrap = document.getElementById('ocr-progress-wrap');
    const progressFill = document.getElementById('ocr-progress-fill');
    const progressLabel = document.getElementById('ocr-progress-label');
    progressWrap.style.display = 'block';
    progressFill.style.width = '5%';
    progressLabel.textContent = 'Lade OCR-Engine (einmalig ~10MB)…';

    try {
      const text = await recognize(file, (pct, msg) => {
        if (pct !== null) progressFill.style.width = pct + '%';
        if (msg) progressLabel.textContent = msg;
      });

      progressFill.style.width = '100%';
      progressLabel.textContent = '✓ Text erkannt';

      const parsed = parse(text);
      showResult(parsed);

    } catch (err) {
      progressLabel.textContent = '✗ Fehler: ' + err.message;
      progressFill.style.background = 'var(--red)';
    }
  }

  function showResult(parsed) {
    const section = document.getElementById('ocr-result-section');
    section.style.display = 'block';

    const fields = [
      { key: 'date',          id: 'ocr-r-date',  label: 'Datum',     format: v => v },
      { key: 'liters',        id: 'ocr-r-liters', label: 'Liter',    format: v => v?.toFixed(2) },
      { key: 'totalCost',     id: 'ocr-r-total',  label: 'Betrag €', format: v => v?.toFixed(2) },
      { key: 'pricePerLiter', id: 'ocr-r-ppl',    label: '€/Liter',  format: v => v?.toFixed(4) },
    ];

    for (const f of fields) {
      const inp = document.getElementById(f.id);
      const hint = document.getElementById(f.id + '-hint');
      const data = parsed[f.key];

      if (data.value !== null) {
        inp.value = f.key === 'date' ? data.value : f.format(data.value);
      } else {
        inp.value = '';
      }

      const uncertain = data.conf < 0.70;
      inp.classList.toggle('ocr-uncertain', uncertain && data.value !== null);
      if (hint) hint.style.display = (uncertain && data.value !== null) ? 'block' : 'none';
    }
  }

  function transfer() {
    const date   = document.getElementById('ocr-r-date').value;
    const liters = document.getElementById('ocr-r-liters').value;
    const total  = document.getElementById('ocr-r-total').value;

    // Fill main fuel form
    if (date) document.getElementById('tf-date').value = date;
    if (liters) document.getElementById('tf-liters').value = liters;
    if (total)  document.getElementById('tf-total').value = total;

    App.updateFuelPreview();
    closeOverlay();
    App.toast('Werte übernommen — km-Stand ergänzen!', 'success');
  }

  return {
    openOverlay, closeOverlay, handleFile, transfer,
    parse, recognize
  };

})();

// Wichtig für Android/Samsung + inline onclick="OCR.openOverlay()"
window.OCR = OCR;
