/**
 * TankLog OCR — robust on mobile + improved recognition quality
 *
 * Fixes:
 * - Better OCR output via canvas preprocessing (grayscale + Otsu threshold + upscale)
 * - Tesseract parameters (DPI + PSM) for receipts
 * - Works with existing TankLog overlay IDs
 *
 * IMPORTANT: Keep filename as "ocr.js" in your repo.
 */

const OCR = (() => {
  let _worker = null;
  let _workerReady = false;
  let _loading = false;

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

      // Tune for receipts (safe to ignore if unsupported)
      try {
        await _worker.setParameters({
          tessedit_pageseg_mode: '6',
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        });
      } catch (e) {
        console.warn('OCR setParameters ignored:', e);
      }

      _workerReady = true;
    } finally {
      _loading = false;
    }
    return _worker;
  }

  async function _fileToImageBitmap(file) {
    const blob = file instanceof Blob ? file : new Blob([file]);
    return await createImageBitmap(blob);
  }

  function _otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];

    let sumB = 0;
    let wB = 0;
    let varMax = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  async function preprocessToCanvas(file) {
    const bmp = await _fileToImageBitmap(file);

    // Upscale: receipts need big text
    const scale = 2.0;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const gray = new Uint8ClampedArray(w * h);
    const contrast = 1.35;
    const intercept = 128 * (1 - contrast);

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const g = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      let cg = Math.round(g * contrast + intercept);
      if (cg < 0) cg = 0;
      if (cg > 255) cg = 255;
      gray[p] = cg;
    }

    const thr = _otsuThreshold(gray);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      const v = gray[p] > thr ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  async function recognize(imageFile, onProgress) {
    if (onProgress) onProgress(5, 'Lade OCR-Engine…');
    const worker = await initWorker(onProgress);

    if (onProgress) onProgress(15, 'Bereite Bild vor…');
    const canvas = await preprocessToCanvas(imageFile);

    if (onProgress) onProgress(25, 'Analysiere Bild…');
    const { data: { text } } = await worker.recognize(canvas);

    if (onProgress) onProgress(100, 'Fertig');
    return text || '';
  }

  // ─────────────────────────────────────────────────────────────
  // Parser
  // ─────────────────────────────────────────────────────────────

  function _parseDE(s) {
    if (!s) return null;
    const str = String(s).trim().replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
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
    s = s.replace(/\b(\d{1,4})\s+(\d{2})\b(?=\s*(?:€|eur|euro|l\b|liter\b|\/\s*l))/gi, '$1,$2');
    s = s.replace(/(\d)\s*([,\.])\s*(\d)/g, '$1$2$3');
    s = s.replace(/[ \t]{2,}/g, ' ');
    return s;
  }

  function parse(text) {
    const flat = _normalizeOCRText(text);
    const lines = flat.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
      date:          { value: null, raw: null, conf: 0 },
      liters:        { value: null, raw: null, conf: 0 },
      totalCost:     { value: null, raw: null, conf: 0 },
      pricePerLiter: { value: null, raw: null, conf: 0 },
    };

    // Date
    const dm = flat.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/);
    if (dm) {
      const iso = _parseDate(dm[1]);
      if (iso) result.date = { value: iso, raw: dm[1], conf: 0.65 };
    }

    // Liters
    const litersM = [...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 1 && x.value < 250);
    if (litersM.length) {
      litersM.sort((a,b) => b.value - a.value);
      const best = litersM.find(x => x.value >= 5 && x.value <= 120) || litersM[0];
      result.liters = { value: best.value, raw: best.raw, conf: 0.75 };
    }

    // Price per liter
    const pplM = [...flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*[lL]\b/gi)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 0.5 && x.value < 5.0);
    if (pplM.length) {
      result.pricePerLiter = { value: pplM[0].value, raw: pplM[0].raw, conf: 0.80 };
    }

    // Total cost - same line
    const totalKeySameLineRE =
      /(?:gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|betrag|zu\s+zahlen|zahlbetrag)\b[^\d]{0,40}([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)?/gi;
    for (const m of flat.matchAll(totalKeySameLineRE)) {
      const v = _parseDE(m[1]);
      if (v && v > 2 && v < 1000) {
        result.totalCost = { value: v, raw: m[1], conf: 0.92 };
        break;
      }
    }

    // Total cost - next lines
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

    // Total cost - biggest EUR amount
    if (!result.totalCost.value) {
      const money = [...flat.matchAll(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/gi)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(x => x.value && x.value > 2 && x.value < 500);
      if (money.length) {
        money.sort((a,b) => b.value - a.value);
        result.totalCost = { value: money[0].value, raw: money[0].raw, conf: 0.60 };
      }
    }

    // Derive €/L
    if (!result.pricePerLiter.value && result.totalCost.value && result.liters.value) {
      const ppl = result.totalCost.value / result.liters.value;
      if (ppl > 0.5 && ppl < 5.0) {
        result.pricePerLiter = { value: +ppl.toFixed(4), raw: 'derived', conf: 0.50 };
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // UI helpers
  // ─────────────────────────────────────────────────────────────

  function openOverlay() {
    ['ocr-file-input','ocr-file-camera','ocr-file-gallery'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

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
    const wrap = document.getElementById('ocr-progress-wrap');
    const fill = document.getElementById('ocr-progress-fill');
    const label = document.getElementById('ocr-progress-label');
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

  return { openOverlay, closeOverlay, handleFile, parse, recognize };

})();

window.OCR = OCR;
