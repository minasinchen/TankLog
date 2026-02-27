/**
 * OCR MODULE — Tankzettel-Erkennung via Tesseract.js (lokal)
 * Robust für Android/Samsung + GitHub Pages:
 * - window.OCR gesetzt (für inline onclick)
 * - auto-bindet file inputs (auch ohne onchange im HTML)
 * - null-sichere UI Updates (Preview/Progress/Overlay)
 * - Parser versteht EUR und "Label + Zahl in nächster Zeile"
 */

const OCR = (() => {

  let _worker = null;
  let _workerReady = false;
  let _loading = false;

  // ── Worker ────────────────────────────────────────────────

  async function initWorker(onProgress) {
    if (_worker && _workerReady) return _worker;
    if (_loading) {
      while (_loading) await new Promise(r => setTimeout(r, 100));
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
      _workerReady = true;
    } finally {
      _loading = false;
    }
    return _worker;
  }

  async function recognize(imageFile, onProgress) {
    if (onProgress) onProgress(5, 'Lade OCR-Engine…');
    const worker = await initWorker(onProgress);
    if (onProgress) onProgress(20, 'Analysiere Bild…');
    const { data: { text } } = await worker.recognize(imageFile);
    if (onProgress) onProgress(100, 'Fertig');
    return text || '';
  }

  // ── Helpers ────────────────────────────────────────────────

  function _parseDE(s) {
    if (!s) return null;
    const str = String(s).trim()
      .replace(/\.(?=\d{3}\b)/g, '') // thousands
      .replace(',', '.');
    const v = parseFloat(str);
    return Number.isFinite(v) ? v : null;
  }

  function _parseDate(dmy) {
    if (!dmy) return null;
    const m = String(dmy).trim().match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
    if (!m) return null;
    let [, d, mo, y] = m;
    d = d.padStart(2, '0');
    mo = mo.padStart(2, '0');
    if (y.length === 2) y = (parseInt(y, 10) >= 70 ? '19' : '20') + y;
    return `${y}-${mo}-${d}`;
  }

  function _normalizeOCRText(t) {
    if (!t) return '';
    let s = String(t);

    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/\u00A0/g, ' ');
    s = s.replace(/\bEURO\b/gi, 'EUR');

    // "84 30 EUR" -> "84,30 EUR"
    s = s.replace(/\b(\d{1,4})\s+(\d{2})\b(?=\s*(?:€|eur|euro|l\b|liter\b|\/\s*l))/gi, '$1,$2');

    // remove spaces around separators: "84, 30" -> "84,30"
    s = s.replace(/(\d)\s*([,\.])\s*(\d)/g, '$1$2$3');

    // collapse whitespace
    s = s.replace(/[ \t]{2,}/g, ' ');

    return s;
  }

  // ── Parser ────────────────────────────────────────────────

  function parse(text) {
    const flat = _normalizeOCRText(text);
    const lines = flat.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
      date:          { value: null, raw: null, conf: 0 },
      liters:        { value: null, raw: null, conf: 0 },
      totalCost:     { value: null, raw: null, conf: 0 },
      pricePerLiter: { value: null, raw: null, conf: 0 },
    };

    // DATE: dd.mm.yyyy (auch wenn Uhrzeit dran hängt)
    const dm = flat.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/);
    if (dm) {
      const iso = _parseDate(dm[1]);
      if (iso) result.date = { value: iso, raw: dm[1], conf: 0.65 };
    }

    // LITERS: "49,04 L"
    const litersM = [...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 1 && x.value < 250);
    if (litersM.length) {
      litersM.sort((a,b) => b.value - a.value);
      const best = litersM.find(x => x.value >= 5 && x.value <= 120) || litersM[0];
      result.liters = { value: best.value, raw: best.raw, conf: 0.75 };
    }

    // PRICE/L: "1,719 EUR/L"
    const pplM = [...flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*[lL]\b/gi)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 0.5 && x.value < 5.0);
    if (pplM.length) {
      result.pricePerLiter = { value: pplM[0].value, raw: pplM[0].raw, conf: 0.80 };
    }

    // TOTAL: keyword same line
    const totalKeySameLineRE =
      /(?:gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|betrag|zu\s+zahlen|zahlbetrag)\b[^\d]{0,40}([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)?/gi;
    for (const m of flat.matchAll(totalKeySameLineRE)) {
      const v = _parseDE(m[1]);
      if (v && v > 2 && v < 1000) {
        result.totalCost = { value: v, raw: m[1], conf: 0.92 };
        break;
      }
    }

    // TOTAL: keyword line + value next lines (Shell typisch)
    if (!result.totalCost.value) {
      const keyLineRE = /(gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|zu\s+zahlen|zahlbetrag|betrag)/i;
      for (let i = 0; i < lines.length; i++) {
        if (!keyLineRE.test(lines[i])) continue;
        const look = [lines[i], lines[i+1], lines[i+2], lines[i+3]].filter(Boolean).join(' ');
        const m = look.match(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/i);
        if (m) {
          const v = _parseDE(m[1]);
          if (v && v > 2 && v < 500) {
            result.totalCost = { value: v, raw: m[1], conf: 0.80 };
            break;
          }
        }
      }
    }

    // TOTAL: fallback biggest amount with EUR/€
    if (!result.totalCost.value) {
      const money = [...flat.matchAll(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/gi)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(x => x.value && x.value > 2 && x.value < 500);
      if (money.length) {
        money.sort((a,b) => b.value - a.value);
        result.totalCost = { value: money[0].value, raw: money[0].raw, conf: 0.60 };
      }
    }

    // derive €/L if missing
    if (!result.pricePerLiter.value && result.totalCost.value && result.liters.value) {
      const ppl = result.totalCost.value / result.liters.value;
      if (ppl > 0.5 && ppl < 5.0) {
        result.pricePerLiter = { value: +ppl.toFixed(4), raw: 'derived', conf: 0.50 };
      }
    }

    return result;
  }

  // ── UI / Overlay ───────────────────────────────────────────

  function openOverlay() {
    // reset inputs safely
    ['ocr-file-input','ocr-file-camera','ocr-file-gallery'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // reset UI if those elements exist
    const previewWrap = document.getElementById('ocr-img-preview-wrap');
    if (previewWrap) previewWrap.style.display = 'none';

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
    const ov = document.getElementById('overlay-ocr');
    if (ov) ov.classList.remove('open');
  }

  function _setProgress(pct, msg) {
    const fill = document.getElementById('ocr-progress-fill');
    const label = document.getElementById('ocr-progress-label');
    const wrap = document.getElementById('ocr-progress-wrap');
    if (wrap) wrap.style.display = 'block';
    if (fill && pct !== null && pct !== undefined) fill.style.width = pct + '%';
    if (label && msg) label.textContent = msg;
  }

  function _setPreview(file) {
    const img = document.getElementById('ocr-img-preview');
    const wrap = document.getElementById('ocr-img-preview-wrap');
    if (!img || !wrap) return;
    const url = URL.createObjectURL(file);
    img.src = url;
    wrap.style.display = 'block';
    // revoke later
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function _showResult(parsed) {
    const section = document.getElementById('ocr-result-section');
    if (section) section.style.display = 'block';

    const fields = [
      { key: 'date',          id: 'ocr-r-date',   fmt: v => v },
      { key: 'liters',        id: 'ocr-r-liters', fmt: v => (v != null ? v.toFixed(2) : '') },
      { key: 'totalCost',     id: 'ocr-r-total',  fmt: v => (v != null ? v.toFixed(2) : '') },
      { key: 'pricePerLiter', id: 'ocr-r-ppl',    fmt: v => (v != null ? v.toFixed(4) : '') },
    ];

    for (const f of fields) {
      const el = document.getElementById(f.id);
      if (!el) continue;
      const data = parsed[f.key];
      el.value = data?.value != null ? f.fmt(data.value) : '';
    }
  }

  async function handleFile(file) {
    if (!file) return;

    _setPreview(file);

    _setProgress(5, 'Lade OCR-Engine…');

    try {
      const text = await recognize(file, (pct, msg) => _setProgress(pct, msg));
      _setProgress(100, '✓ Text erkannt');

      const parsed = parse(text);
      _showResult(parsed);
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
      console.error(err);
    }
  }

  // Auto-bind file inputs (so it works even without inline onchange in HTML)
  function _bindInputs() {
    const ids = ['ocr-file-input', 'ocr-file-camera', 'ocr-file-gallery'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.__ocrBound) return;
      el.addEventListener('change', () => handleFile(el.files && el.files[0]));
      el.__ocrBound = true;
    });
  }

  document.addEventListener('DOMContentLoaded', _bindInputs);

  return { openOverlay, closeOverlay, handleFile, parse, recognize };

})();

// critical for inline onclick="OCR.openOverlay()"
window.OCR = OCR;
