/**
 * TankLog OCR — Rectify v4
 *
 * Fixes based on your screenshot:
 * ✅ €/L parsing fixed for "1.719" (dot used as decimal by OCR) and "EUR/I" or "EUR/1"
 * ✅ Prevents "1,0000 €/L" bogus picks by stricter rules + cross-checking
 * ✅ Points no longer "verzogen" when corners cross: points are auto-ordered TL/TR/BR/BL every render + before warp
 * ✅ Adds a simple "Auto-Ecken" guess (best-effort) to start closer to the receipt
 * ✅ Keeps debug: window.__OCR_LAST_TEXT__ + window.__OCR_LAST_PARSED__
 *
 * IMPORTANT: Save as "ocr.js" in your repo.
 */

const OCR = (() => {

  // ─────────────────────────────────────────────────────────────
  // Debug / state
  // ─────────────────────────────────────────────────────────────
  let _lastText = '';
  let _lastParsed = null;

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
    const { data: { text } } = await worker.recognize(imageOrCanvas);
    if (onProgress) onProgress(100, 'Fertig');
    return text || '';
  }

  // ─────────────────────────────────────────────────────────────
  // 4-point UI state
  // ─────────────────────────────────────────────────────────────
  let _srcBitmap = null;
  let _srcW = 0, _srcH = 0;
  let _cropPts = null; // unordered points; we reorder every time
  let _activeIdx = -1;

  let _ui = {
    wrap: null,
    canvas: null,
    ctx: null,
    handles: [],
    enabled: false,
    scale: 1,
    dispW: 0,
    dispH: 0,
    btnAuto: null,
  };

  // ─────────────────────────────────────────────────────────────
  // Parser — improved €/L and liters robustness
  // ─────────────────────────────────────────────────────────────

  function parse(text) {
    const flat = _normalizeOCRText(text);
    const lines = flat.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
      date:          { value: null, raw: null, conf: 0 },
      liters:        { value: null, raw: null, conf: 0 },
      totalCost:     { value: null, raw: null, conf: 0 },
      pricePerLiter: { value: null, raw: null, conf: 0 },
    };

    // DATE
    const dm = flat.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/);
    if (dm) {
      const iso = _parseDate(dm[1]);
      if (iso) result.date = { value: iso, raw: dm[1], conf: 0.70 };
    }

    // TOTAL COST
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

    // PRICE PER LITER
    // Accept /L, /l, /I, /1 (OCR confusion). But parse carefully:
    // - "1.719" should be 1.719 (dot decimal), not 1719
    // - reject values near 1.0000 if it doesn't make sense with total & liters
    const pplCandidates = [];

    for (const m of flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*([lLiI1])\b/gi)) {
      const rawNum = m[1];
      const unit = m[2];
      const v = _parsePricePerLiter(rawNum);
      if (v && v > 0.8 && v < 3.5) {
        pplCandidates.push({ raw: rawNum, value: v, conf: 0.86 });
      }
    }

    // Also allow patterns like "EUR/L 1.719"
    for (const m of flat.matchAll(/(?:€|eur|euro)\s*\/\s*([lLiI1])\s*[:=]?\s*([0-9]{1,2}[,\.][0-9]{3,4})/gi)) {
      const rawNum = m[2];
      const v = _parsePricePerLiter(rawNum);
      if (v && v > 0.8 && v < 3.5) {
        pplCandidates.push({ raw: rawNum, value: v, conf: 0.78 });
      }
    }

    if (pplCandidates.length) {
      // Prefer the one closest to plausible range 1.2–2.7
      pplCandidates.sort((a,b) => {
        const da = Math.abs(a.value - 1.8);
        const db = Math.abs(b.value - 1.8);
        return da - db;
      });
      result.pricePerLiter = { value: pplCandidates[0].value, raw: pplCandidates[0].raw, conf: pplCandidates[0].conf };
    }

    // LITERS
    // 1) explicit "49,04 L"
    const litersWithUnit = [...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
      .map(m => ({ raw: m[1], value: _parseLiters(m[1]) }))
      .filter(x => x.value && x.value > 1 && x.value < 250);

    if (litersWithUnit.length) {
      litersWithUnit.sort((a,b) => b.value - a.value);
      const best = litersWithUnit.find(x => x.value >= 5 && x.value <= 120) || litersWithUnit[0];
      result.liters = { value: best.value, raw: best.raw, conf: 0.85 };
    }

    // 2) labeled "Menge/Liter/Volumen"
    if (!result.liters.value) {
      const litersLabelRE = /(?:menge|liter|vol(?:umen)?|mng|ltrs?)\b[^\d]{0,20}([0-9]{1,3}[,\.][0-9]{2,3})/gi;
      for (const m of flat.matchAll(litersLabelRE)) {
        const v = _parseLiters(m[1]);
        if (v && v > 1 && v < 250) {
          result.liters = { value: v, raw: m[1], conf: 0.80 };
          break;
        }
      }
    }

    // 3) OCR drops "L": take a number near fuel type AND near total line
    if (!result.liters.value) {
      const fuelContext = /(diesel|super|e10|e5|benzin|kraftstoff|fuel)/i;
      const candidates = [];
      for (let i = 0; i < lines.length; i++) {
        if (!fuelContext.test(lines[i])) continue;
        const look = [lines[i], lines[i+1], lines[i+2]].filter(Boolean).join(' ');
        for (const m of look.matchAll(/\b([0-9]{1,3}[,\.][0-9]{2})\b/g)) {
          const v = _parseLiters(m[1]);
          if (v && v > 1 && v < 250) candidates.push({ raw: m[1], value: v });
        }
      }
      if (candidates.length) {
        const best = candidates.find(x => x.value >= 5 && x.value <= 120) || candidates[0];
        result.liters = { value: best.value, raw: best.raw, conf: 0.55 };
      }
    }

    // Cross-checking
    // If total + €/L exist, derive liters (strong)
    if (result.totalCost.value && result.pricePerLiter.value) {
      const derivedL = result.totalCost.value / result.pricePerLiter.value;
      if (derivedL > 1 && derivedL < 250) {
        // choose derived if current liters is missing or far off (>10%)
        if (!result.liters.value || Math.abs(result.liters.value - derivedL) / derivedL > 0.10) {
          result.liters = { value: +derivedL.toFixed(2), raw: 'berechnet', conf: 0.78 };
        }
      }
    }

    // If liters + total exist, derive €/L (strong)
    if (result.totalCost.value && result.liters.value) {
      const derivedP = result.totalCost.value / result.liters.value;
      if (derivedP > 0.8 && derivedP < 3.5) {
        // If pricePerLiter missing OR looks bogus like exactly 1.0000, prefer derived
        const p = result.pricePerLiter.value;
        const looksBogus = (p != null) && (Math.abs(p - 1.0) < 0.0001);
        if (!p || looksBogus) {
          result.pricePerLiter = { value: +derivedP.toFixed(4), raw: 'berechnet', conf: 0.72 };
        } else {
          // If OCR value deviates too much from derived, prefer derived
          if (Math.abs(p - derivedP) / derivedP > 0.08) {
            result.pricePerLiter = { value: +derivedP.toFixed(4), raw: 'berechnet', conf: 0.70 };
          }
        }
      }
    }

    // Sanity
    if (result.liters.value && (result.liters.value < 1 || result.liters.value > 200)) result.liters.conf = Math.min(result.liters.conf, 0.25);
    if (result.totalCost.value && (result.totalCost.value < 2 || result.totalCost.value > 500)) result.totalCost.conf = Math.min(result.totalCost.conf, 0.25);
    if (result.pricePerLiter.value && (result.pricePerLiter.value < 0.8 || result.pricePerLiter.value > 3.5)) result.pricePerLiter.conf = Math.min(result.pricePerLiter.conf, 0.25);

    return result;
  }

  // Money: accept both "84,30" and "84.30"
  function _parseMoney(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    // If has comma -> German decimal comma
    if (/,/.test(str)) {
      const cleaned = str.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
      const v = parseFloat(cleaned);
      return isNaN(v) ? null : v;
    }
    // If has dot and exactly 2 decimals -> decimal dot
    if (/^\d{1,4}\.\d{2}$/.test(str)) {
      const v = parseFloat(str);
      return isNaN(v) ? null : v;
    }
    // fallback
    const v = parseFloat(str.replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  // Price per liter: treat "1.719" as 1.719 (decimal dot), not 1719
  function _parsePricePerLiter(s) {
    if (!s && s !== 0) return null;
    const str0 = String(s).trim();

    // Cases:
    // "1,719" -> 1.719
    // "1.719" -> 1.719 (decimal dot)
    // "1.7190" -> 1.7190
    // Avoid treating dot as thousands for this specific field.
    let str = str0;

    if (/,/.test(str)) {
      str = str.replace(/\.(?=\d{3,4}\b)/g, '').replace(',', '.');
      const v = parseFloat(str);
      return isNaN(v) ? null : v;
    }

    // dot-decimal with 3-4 decimals
    if (/^\d{1,2}\.\d{3,4}$/.test(str)) {
      const v = parseFloat(str);
      return isNaN(v) ? null : v;
    }

    // sometimes OCR gives "1 719" already normalized elsewhere, but be safe:
    const m = str.match(/^(\d{1,2})\s+(\d{3,4})$/);
    if (m) {
      const v = parseFloat(m[1] + '.' + m[2]);
      return isNaN(v) ? null : v;
    }

    // last resort: standard German parse
    const v = parseFloat(str.replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  function _parseLiters(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    // liters usually have 2 decimals; accept comma or dot
    const m = str.match(/^(\d{1,3})[,.](\d{2,3})$/);
    if (m) {
      const v = parseFloat(m[1] + '.' + m[2]);
      return isNaN(v) ? null : v;
    }
    return null;
  }

  function _parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
    if (!m) return null;
    let [, d, mo, y] = m;
    if (y.length === 2) y = parseInt(y, 10) > 50 ? '19' + y : '20' + y;
    const iso = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return null;
    return iso;
  }

  function _normalizeOCRText(t) {
    if (!t) return '';
    let s = String(t);
    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/\u00A0/g, ' ');
    s = s.replace(/\bEURO\b/gi, 'EUR');

    // Fix spaced decimals: "84 30 EUR" -> "84,30 EUR"; "43 04" -> "43,04" (when near EUR/L or EUR or fuel)
    s = s.replace(/\b(\d{1,4})\s+(\d{2})\b(?=\s*(?:€|eur|euro|\/\s*[lLiI1]|l\b|liter\b))/gi, '$1,$2');
    s = s.replace(/\b(\d{1,3})\s+(\d{2})\b(?=\s*(?:super|diesel|e10|e5|benzin|kraftstoff|fuel))/gi, '$1,$2');

    // Fix spaced €/L number: "1 719 EUR/I" -> "1.719 EUR/I" (we parse as decimal dot)
    s = s.replace(/\b(\d{1,2})\s+(\d{3,4})\b(?=\s*(?:€|eur|euro)\s*\/\s*[lLiI1])/gi, '$1.$2');

    // remove spaces around separators
    s = s.replace(/(\d)\s*([,\.])\s*(\d)/g, '$1$2$3');

    // collapse spaces
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
  }

  function closeOverlay() {
    const ov = document.getElementById('overlay-ocr');
    if (ov) ov.classList.remove('open');
    _disableCropUI();
  }

  async function handleFile(file) {
    if (!file) return;

    _hide('ocr-zone');
    _hide('ocr-result-section');
    _show('ocr-progress-wrap', 'block');
    _setProgress(8, 'Bild geladen…');

    try {
      _srcBitmap = await createImageBitmap(file);
      _srcW = _srcBitmap.width;
      _srcH = _srcBitmap.height;

      // Default: full image inset, then auto-guess corners once
      const aspect = _srcW / _srcH;
      const mx = Math.round(_srcW * (aspect < 0.8 ? 0.08 : 0.06));
      const my = Math.round(_srcH * (aspect < 0.8 ? 0.04 : 0.06));

      _cropPts = [
        { x: mx,        y: my },
        { x: _srcW-mx,  y: my },
        { x: _srcW-mx,  y: _srcH-my },
        { x: mx,        y: _srcH-my },
      ];

      _ensureCropUI();
      _enableCropUI();

      // auto-guess once to start closer
      _autoGuessCorners();

      _renderCrop();
      _setProgress(18, 'Ecken antippen & ziehen (optional), dann „Scannen“');
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

  // ─────────────────────────────────────────────────────────────
  // Crop UI injection
  // ─────────────────────────────────────────────────────────────

  function _ensureCropUI() {
    if (_ui.wrap) return;

    const host =
      document.getElementById('ocr-img-preview-wrap')?.parentElement ||
      document.querySelector('#overlay-ocr .overlay-body') ||
      document.getElementById('overlay-ocr');

    if (!host) return;

    const wrap = document.createElement('div');
    wrap.id = 'ocr-crop-wrap';
    wrap.style.display = 'none';
    wrap.style.marginTop = '10px';
    wrap.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.id = 'ocr-crop-canvas';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.maxWidth = '100%';
    canvas.style.borderRadius = '10px';
    canvas.style.border = '1px solid var(--border)';
    canvas.style.background = '#000';
    canvas.style.touchAction = 'none';
    canvas.style.position = 'relative';
    canvas.style.zIndex = '1';

    const info = document.createElement('div');
    info.style.marginTop = '6px';
    info.style.fontFamily = 'var(--font-mono)';
    info.style.fontSize = '11px';
    info.style.color = 'var(--t3)';
    info.textContent = 'Tippe nahe an einen Punkt & zieh ihn auf die Beleg-Ecke.';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.marginTop = '8px';

    const btnAuto = document.createElement('button');
    btnAuto.type = 'button';
    btnAuto.className = 'btn btn-secondary';
    btnAuto.style.flex = '1';
    btnAuto.textContent = 'Auto-Ecken';
    btnAuto.onclick = () => {
      _autoGuessCorners();
      _renderCrop();
    };

    const btnScan = document.createElement('button');
    btnScan.type = 'button';
    btnScan.className = 'btn btn-primary';
    btnScan.style.flex = '1';
    btnScan.textContent = 'Scannen';
    btnScan.onclick = () => scanCropped();

    const btnOff = document.createElement('button');
    btnOff.type = 'button';
    btnOff.className = 'btn btn-secondary';
    btnOff.style.flex = '1';
    btnOff.textContent = 'Ohne Ausrichten';
    btnOff.onclick = () => scanOriginal();

    row.appendChild(btnAuto);
    row.appendChild(btnScan);
    row.appendChild(btnOff);

    wrap.appendChild(canvas);
    wrap.appendChild(info);
    wrap.appendChild(row);

    // handles
    const handles = [];
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'ocr-handle';
      h.dataset.idx = String(i);
      h.style.position = 'absolute';
      h.style.width = '22px';
      h.style.height = '22px';
      h.style.borderRadius = '999px';
      h.style.background = 'var(--amber)';
      h.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.6)';
      h.style.transform = 'translate(-50%, -50%)';
      h.style.touchAction = 'none';
      h.style.cursor = 'grab';
      h.style.zIndex = '10';
      h.style.pointerEvents = 'auto';
      wrap.appendChild(h);
      handles.push(h);
    }

    const pickNearest = (x, y) => {
      const ordered = _orderPointsTLTRBRBL(_cropPts);
      const ptsC = ordered.map(p => ({ x: p.x * _ui.scale, y: p.y * _ui.scale }));
      let best = -1;
      let bestD = 1e9;
      for (let i = 0; i < 4; i++) {
        const dx = ptsC[i].x - x;
        const dy = ptsC[i].y - y;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD <= 44 ? best : -1;
    };

    const getCanvasXY = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (ev.clientX - rect.left), y: (ev.clientY - rect.top) };
    };

    const onDown = (ev) => {
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      const idx = pickNearest(x, y);
      if (idx === -1) return;
      _activeIdx = idx;
      canvas.setPointerCapture?.(ev.pointerId);
      _setPointCanvas(_activeIdx, x, y);
      _renderCrop();
    };

    const onMove = (ev) => {
      if (_activeIdx < 0) return;
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      _setPointCanvas(_activeIdx, x, y);
      _renderCrop();
    };

    const onUp = (ev) => {
      if (_activeIdx < 0) return;
      ev.preventDefault();
      _activeIdx = -1;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);

    handles.forEach(h => {
      h.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        _activeIdx = parseInt(h.dataset.idx, 10);
        h.setPointerCapture?.(ev.pointerId);
      });
      h.addEventListener('pointermove', onMove);
      h.addEventListener('pointerup', onUp);
      h.addEventListener('pointercancel', onUp);
    });

    host.appendChild(wrap);

    _ui.wrap = wrap;
    _ui.canvas = canvas;
    _ui.ctx = canvas.getContext('2d', { willReadFrequently: true });
    _ui.handles = handles;
    _ui.btnAuto = btnAuto;
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
    const img = document.getElementById('ocr-img-preview');
    if (img) img.style.display = '';
  }

  function _renderCrop() {
    if (!_ui.enabled || !_ui.canvas || !_ui.ctx || !_srcBitmap || !_cropPts) return;

    // Always keep points ordered to avoid "verzogen"
    _cropPts = _orderPointsTLTRBRBL(_cropPts);

    const wrapW = _ui.wrap.getBoundingClientRect().width || 320;
    const maxH = 420;
    const scale = Math.min(wrapW / _srcW, maxH / _srcH);

    const cssW = Math.round(_srcW * scale);
    const cssH = Math.round(_srcH * scale);

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    _ui.canvas.width = Math.round(cssW * dpr);
    _ui.canvas.height = Math.round(cssH * dpr);
    _ui.canvas.style.height = cssH + 'px';

    _ui.scale = scale;
    _ui.dispW = cssW;
    _ui.dispH = cssH;

    const ctx = _ui.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(_srcBitmap, 0, 0, cssW, cssH);

    const ptsC = _cropPts.map(p => ({ x: p.x * scale, y: p.y * scale }));

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 191, 0, 0.95)';
    ctx.fillStyle = 'rgba(255, 191, 0, 0.12)';
    ctx.beginPath();
    ctx.moveTo(ptsC[0].x, ptsC[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(ptsC[i].x, ptsC[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 4; i++) {
      const h = _ui.handles[i];
      if (!h) continue;
      h.style.left = ptsC[i].x + 'px';
      h.style.top  = ptsC[i].y + 'px';
    }
  }

  function _setPointCanvas(idx, cx, cy) {
    // idx is in ordered TL/TR/BR/BL
    const s = _ui.scale || 1;
    const x = Math.max(0, Math.min(_ui.dispW, cx)) / s;
    const y = Math.max(0, Math.min(_ui.dispH, cy)) / s;

    _cropPts = _orderPointsTLTRBRBL(_cropPts);
    _cropPts[idx] = { x, y };
    _cropPts = _orderPointsTLTRBRBL(_cropPts);
  }

  function _orderPointsTLTRBRBL(pts) {
    // robustly order by sum/diff (common technique)
    const p = pts.map(x => ({ x: x.x, y: x.y }));
    const sums = p.map(pt => pt.x + pt.y);
    const diffs = p.map(pt => pt.x - pt.y);

    const tl = p[sums.indexOf(Math.min(...sums))];
    const br = p[sums.indexOf(Math.max(...sums))];
    const tr = p[diffs.indexOf(Math.max(...diffs))];
    const bl = p[diffs.indexOf(Math.min(...diffs))];

    // If any duplicates (can happen if points overlap), fall back to bbox corners
    const uniq = new Set([`${tl.x}|${tl.y}`, `${tr.x}|${tr.y}`, `${br.x}|${br.y}`, `${bl.x}|${bl.y}`]);
    if (uniq.size < 4) {
      const xs = p.map(q => q.x), ys = p.map(q => q.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return [{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
    }
    return [tl, tr, br, bl];
  }

  // Best-effort "Auto-Ecken": find bounding box of darker pixels (rough receipt region)
  function _autoGuessCorners() {
    try {
      const c = document.createElement('canvas');
      const targetW = 600;
      const scale = Math.min(1, targetW / _srcW);
      c.width = Math.max(1, Math.round(_srcW * scale));
      c.height = Math.max(1, Math.round(_srcH * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(_srcBitmap, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const d = img.data;

      let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      const thr = 215; // ink threshold
      const step = Math.max(1, Math.floor(Math.min(c.width, c.height) / 400));

      for (let y = 0; y < c.height; y += step) {
        for (let x = 0; x < c.width; x += step) {
          const i = (y*c.width + x)*4;
          const g = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
          if (g < thr) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < 0) return; // no ink found

      // padding
      const padX = Math.round(c.width * 0.04);
      const padY = Math.round(c.height * 0.04);
      minX = Math.max(0, minX - padX);
      minY = Math.max(0, minY - padY);
      maxX = Math.min(c.width-1, maxX + padX);
      maxY = Math.min(c.height-1, maxY + padY);

      // map back to source pixels
      const inv = 1 / scale;
      const x0 = minX * inv, y0 = minY * inv, x1 = maxX * inv, y1 = maxY * inv;

      _cropPts = _orderPointsTLTRBRBL([
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ]);
    } catch (e) {
      console.warn('Auto-corner guess failed:', e);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Perspective transform
  // ─────────────────────────────────────────────────────────────

  function _dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

  function _computeDstSize(pts) {
    const top = _dist(pts[0], pts[1]);
    const bottom = _dist(pts[3], pts[2]);
    const left = _dist(pts[0], pts[3]);
    const right = _dist(pts[1], pts[2]);
    const w = Math.max(top, bottom);
    const h = Math.max(left, right);
    return { W: Math.max(900, Math.round(w)), H: Math.max(900, Math.round(h)) };
  }

  function _solveHomography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i].x, y = src[i].y;
      const u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u*x, -u*y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v*x, -v*y]); b.push(v);
    }
    const n = 8;
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let r = i+1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[maxRow][i])) maxRow = r;
      [A[i], A[maxRow]] = [A[maxRow], A[i]];
      [b[i], b[maxRow]] = [b[maxRow], b[i]];
      const piv = A[i][i] || 1e-12;
      for (let j = i; j < n; j++) A[i][j] /= piv;
      b[i] /= piv;
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const f = A[r][i];
        for (let j = i; j < n; j++) A[r][j] -= f * A[i][j];
        b[r] -= f * b[i];
      }
    }
    const h = b;
    return [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1],
    ];
  }

  function _invert3x3(m) {
    const a=m[0][0], b=m[0][1], c=m[0][2];
    const d=m[1][0], e=m[1][1], f=m[1][2];
    const g=m[2][0], h=m[2][1], i=m[2][2];
    const A=e*i-f*h, B=-(d*i-f*g), C=d*h-e*g;
    const D=-(b*i-c*h), E=a*i-c*g, F=-(a*h-b*g);
    const G=b*f-c*e, H=-(a*f-c*d), I=a*e-b*d;
    const det = a*A + b*B + c*C;
    const invDet = 1/(det || 1e-12);
    return [
      [A*invDet, D*invDet, G*invDet],
      [B*invDet, E*invDet, H*invDet],
      [C*invDet, F*invDet, I*invDet],
    ];
  }

  function _applyH(m, x, y) {
    const X = m[0][0]*x + m[0][1]*y + m[0][2];
    const Y = m[1][0]*x + m[1][1]*y + m[1][2];
    const Z = m[2][0]*x + m[2][1]*y + m[2][2];
    return { x: X/Z, y: Y/Z };
  }

  function _warpPerspectiveToCanvas(srcBitmap, srcPts) {
    const srcOrdered = _orderPointsTLTRBRBL(srcPts);
    const { W, H } = _computeDstSize(srcOrdered);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = W;
    dstCanvas.height = H;
    const dctx = dstCanvas.getContext('2d', { willReadFrequently: true });

    const sCanvas = document.createElement('canvas');
    sCanvas.width = srcBitmap.width;
    sCanvas.height = srcBitmap.height;
    const sctx = sCanvas.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(srcBitmap, 0, 0);
    const sImg = sctx.getImageData(0, 0, sCanvas.width, sCanvas.height);
    const sData = sImg.data;

    const dstImg = dctx.createImageData(W, H);
    const dData = dstImg.data;

    const dstPts = [
      { x: 0,   y: 0 },
      { x: W-1, y: 0 },
      { x: W-1, y: H-1 },
      { x: 0,   y: H-1 },
    ];

    const Hm = _solveHomography(srcOrdered, dstPts);
    const Hinv = _invert3x3(Hm);

    const sw = sCanvas.width, sh = sCanvas.height;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = _applyH(Hinv, x, y);
        const sx = Math.round(p.x);
        const sy = Math.round(p.y);
        const di = (y*W + x) * 4;

        if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
          const si = (sy*sw + sx) * 4;
          dData[di]   = sData[si];
          dData[di+1] = sData[si+1];
          dData[di+2] = sData[si+2];
          dData[di+3] = 255;
        } else {
          dData[di] = dData[di+1] = dData[di+2] = 255;
          dData[di+3] = 255;
        }
      }
    }

    dctx.putImageData(dstImg, 0, 0);
    return dstCanvas;
  }

  // ─────────────────────────────────────────────────────────────
  // Scan actions + debug storage
  // ─────────────────────────────────────────────────────────────

  async function scanCropped() {
    if (!_srcBitmap || !_cropPts) return;

    _setProgress(10, 'Beleg wird geradegezogen…');
    const warped = _warpPerspectiveToCanvas(_srcBitmap, _cropPts);

    try {
      const text = await recognize(warped, (pct, msg) => _setProgress(pct, msg));

      _lastText = text || '';
      window.__OCR_LAST_TEXT__ = _lastText;
      console.log('OCR RAW TEXT (rectified, first 1800):\n', _lastText.slice(0,1800));

      _setProgress(100, '✓ Text erkannt');

      const parsed = parse(_lastText);
      _lastParsed = parsed;
      window.__OCR_LAST_PARSED__ = parsed;
      console.log('OCR PARSED:', parsed);

      showResult(parsed);

      if (!parsed.date.value && !parsed.liters.value && !parsed.totalCost.value) {
        _setProgress(100, '✓ Text erkannt – aber keine Werte gefunden (Foto evtl. unscharf)');
      }
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
      console.error(err);
    }
  }

  async function scanOriginal() {
    if (!_srcBitmap) return;
    _setProgress(10, 'Scanne ohne Ausrichten…');

    try {
      const text = await recognize(_srcBitmap, (pct, msg) => _setProgress(pct, msg));

      _lastText = text || '';
      window.__OCR_LAST_TEXT__ = _lastText;
      console.log('OCR RAW TEXT (original, first 1800):\n', _lastText.slice(0,1800));

      _setProgress(100, '✓ Text erkannt');

      const parsed = parse(_lastText);
      _lastParsed = parsed;
      window.__OCR_LAST_PARSED__ = parsed;
      console.log('OCR PARSED:', parsed);

      showResult(parsed);
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
      console.error(err);
    }
  }

  async function _scanDirect(file) {
    _setProgress(10, 'Scanne…');
    try {
      const text = await recognize(file, (pct, msg) => _setProgress(pct, msg));

      _lastText = text || '';
      window.__OCR_LAST_TEXT__ = _lastText;
      console.log('OCR RAW TEXT (direct, first 1800):\n', _lastText.slice(0,1800));

      _setProgress(100, '✓ Text erkannt');

      const parsed = parse(_lastText);
      _lastParsed = parsed;
      window.__OCR_LAST_PARSED__ = parsed;
      console.log('OCR PARSED:', parsed);

      showResult(parsed);
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
      console.error(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Results UI
  // ─────────────────────────────────────────────────────────────

  function showResult(parsed) {
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
      const d = parsed?.[f.key];
      el.value = (d && d.value != null) ? f.fmt(d.value) : '';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Small DOM helpers
  // ─────────────────────────────────────────────────────────────

  function _setProgress(pct, msg) {
    const wrap = document.getElementById('ocr-progress-wrap');
    const fill = document.getElementById('ocr-progress-fill');
    const label = document.getElementById('ocr-progress-label');
    if (wrap) wrap.style.display = 'block';
    if (fill && pct !== null && pct !== undefined) fill.style.width = pct + '%';
    if (label && msg) label.textContent = msg;
  }

  function _show(id, disp='block'){ const el=document.getElementById(id); if(el) el.style.display=disp; }
  function _hide(id){ const el=document.getElementById(id); if(el) el.style.display='none'; }
  function _val(id){ const el=document.getElementById(id); return el ? el.value : ''; }
  function _setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

  // Public debug helpers
  function getLastText(){ return _lastText; }
  function getLastParsed(){ return _lastParsed; }

  return {
    openOverlay, closeOverlay, handleFile, transfer,
    parse, recognize,
    scanCropped, scanOriginal,
    getLastText, getLastParsed
  };

})();

window.OCR = OCR;
