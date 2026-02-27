/**
 * TankLog OCR — auto-crop + stronger preprocessing for receipts
 *
 * Why: Your OCR output is still mostly garbage -> OCR can't "see" the receipt text.
 * This version:
 * - auto-crops to the darkest text area (simple but very effective)
 * - upscales
 * - adaptive-ish binarization (Otsu) + extra contrast
 * - tries multiple PSM modes and picks the one with most digits (receipts are digit-heavy)
 *
 * Keep filename as: ocr.js
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
    let thr = 128;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;

      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > varMax) {
        varMax = v;
        thr = t;
      }
    }
    return thr;
  }

  function _makeGrayAndContrast(imgData, contrast = 1.6) {
    const d = imgData.data;
    const gray = new Uint8ClampedArray(d.length / 4);
    const intercept = 128 * (1 - contrast);

    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const g = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      let cg = Math.round(g * contrast + intercept);
      if (cg < 0) cg = 0;
      if (cg > 255) cg = 255;
      gray[p] = cg;
    }
    return gray;
  }

  function _bboxFromDarkPixels(gray, w, h) {
    // Find bounding box of "ink" pixels (dark) with some padding.
    // If nothing found, return full image.
    const thr = 200; // consider <200 as "ink"
    let minX = w, minY = h, maxX = -1, maxY = -1;

    // sample step to be faster on huge images
    const step = Math.max(1, Math.floor(Math.min(w, h) / 800));

    for (let y = 0; y < h; y += step) {
      let rowOff = y * w;
      for (let x = 0; x < w; x += step) {
        const v = gray[rowOff + x];
        if (v < thr) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0 || maxY < 0) return { x: 0, y: 0, w, h };

    // Padding (receipt edges)
    const padX = Math.round(w * 0.03);
    const padY = Math.round(h * 0.03);

    const x0 = Math.max(0, minX - padX);
    const y0 = Math.max(0, minY - padY);
    const x1 = Math.min(w - 1, maxX + padX);
    const y1 = Math.min(h - 1, maxY + padY);

    return { x: x0, y: y0, w: (x1 - x0 + 1), h: (y1 - y0 + 1) };
  }

  async function preprocessToCanvas(file) {
    const bmp = await _fileToImageBitmap(file);

    // First pass canvas (original)
    const c1 = document.createElement('canvas');
    c1.width = bmp.width;
    c1.height = bmp.height;
    const ctx1 = c1.getContext('2d', { willReadFrequently: true });
    ctx1.drawImage(bmp, 0, 0);

    const img1 = ctx1.getImageData(0, 0, c1.width, c1.height);
    const gray1 = _makeGrayAndContrast(img1, 1.45);

    // Auto-crop around text area
    const bb = _bboxFromDarkPixels(gray1, c1.width, c1.height);

    // Crop & upscale into final canvas
    const scale = 2.5;
    const w = Math.max(1, Math.round(bb.w * scale));
    const h = Math.max(1, Math.round(bb.h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c1, bb.x, bb.y, bb.w, bb.h, 0, 0, w, h);

    // Binarize with Otsu
    const img = ctx.getImageData(0, 0, w, h);
    const gray = _makeGrayAndContrast(img, 1.75);
    const thr = _otsuThreshold(gray);
    const d = img.data;
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      const v = gray[p] > thr ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    return canvas;
  }

  function _scoreTextForReceipt(text) {
    const t = text || '';
    const digits = (t.match(/\d/g) || []).length;
    const moneyHints = (t.match(/(EUR|€|L\b|\/L|Liter|Gesamt|Betrag|Total)/gi) || []).length;
    const lines = t.split('\n').filter(Boolean).length;
    return digits * 2 + moneyHints * 10 + Math.min(lines, 50);
  }

  async function recognize(imageFile, onProgress) {
    if (onProgress) onProgress(5, 'Lade OCR-Engine…');
    const worker = await initWorker(onProgress);

    if (onProgress) onProgress(15, 'Schneide Beleg zu…');
    const canvas = await preprocessToCanvas(imageFile);

    const psmModes = ['6', '4', '11']; // try a few
    let best = { text: '', score: -1, psm: '6' };

    for (let i = 0; i < psmModes.length; i++) {
      const psm = psmModes[i];
      try {
        if (worker.setParameters) {
          await worker.setParameters({
            tessedit_pageseg_mode: psm,
            user_defined_dpi: '300',
            preserve_interword_spaces: '1',
          });
        }
      } catch (_) {}

      if (onProgress) onProgress(25 + i * 20, `Analysiere Bild… (Modus ${psm})`);
      const { data: { text } } = await worker.recognize(canvas);
      const score = _scoreTextForReceipt(text);

      if (score > best.score) best = { text: text || '', score, psm };
    }

    if (onProgress) onProgress(100, `Fertig (Modus ${best.psm})`);
    return best.text;
  }

  // ─────────────────────────────────────────────────────────────
  // Parser (same as your improved EUR-aware version)
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

    const dm = flat.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/);
    if (dm) {
      const iso = _parseDate(dm[1]);
      if (iso) result.date = { value: iso, raw: dm[1], conf: 0.65 };
    }

    const litersM = [...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 1 && x.value < 250);
    if (litersM.length) {
      litersM.sort((a,b) => b.value - a.value);
      const best = litersM.find(x => x.value >= 5 && x.value <= 120) || litersM[0];
      result.liters = { value: best.value, raw: best.raw, conf: 0.75 };
    }

    const pplM = [...flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*[lL]\b/gi)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 0.5 && x.value < 5.0);
    if (pplM.length) {
      result.pricePerLiter = { value: pplM[0].value, raw: pplM[0].raw, conf: 0.80 };
    }

    const totalKeySameLineRE =
      /(?:gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|betrag|zu\s+zahlen|zahlbetrag)\b[^\d]{0,40}([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)?/gi;
    for (const m of flat.matchAll(totalKeySameLineRE)) {
      const v = _parseDE(m[1]);
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
          const v = _parseDE(m[1]);
          if (v && v > 2 && v < 500) {
            result.totalCost = { value: v, raw: m[1], conf: 0.80 };
            break;
          }
        }
      }
    }

    if (!result.totalCost.value) {
      const money = [...flat.matchAll(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/gi)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(x => x.value && x.value > 2 && x.value < 500);
      if (money.length) {
        money.sort((a,b) => b.value - a.value);
        result.totalCost = { value: money[0].value, raw: money[0].raw, conf: 0.60 };
      }
    }

    if (!result.pricePerLiter.value && result.totalCost.value && result.liters.value) {
      const ppl = result.totalCost.value / result.liters.value;
      if (ppl > 0.5 && ppl < 5.0) {
        result.pricePerLiter = { value: +ppl.toFixed(4), raw: 'derived', conf: 0.50 };
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────
  // UI (null-safe)
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
