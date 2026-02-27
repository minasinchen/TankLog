/**
 * TankLog OCR — mit manuellem "Beleg ausrichten" (4 Punkte) + Perspective Transform
 *
 * Warum: OCR liefert bei schrägen/kleinen Belegen oft nur Müll. Banking-Apps lösen das
 * durch: 4 Eckpunkte -> geradeziehen -> dann OCR.
 *
 * Diese Datei:
 * - behält deine UI-IDs/Flows (openOverlay/closeOverlay/handleFile/showResult/transfer)
 * - fügt im OCR-Overlay automatisch eine Ausrichten-Ansicht hinzu (ohne HTML-Änderungen)
 * - nutzt Perspective Warp (Homography) in reinem JS/Canvas
 * - fällt zurück auf normales OCR, wenn Ausrichten nicht genutzt wird
 */

const OCR = (() => {

  let _worker = null;
  let _workerReady = false;
  let _loading = false;

  // State for cropping
  let _srcBitmap = null;
  let _srcW = 0, _srcH = 0;
  let _cropPts = null;   // in source image pixels: [{x,y}...]
  let _ui = {
    wrap: null,
    canvas: null,
    ctx: null,
    handles: [],
    btnToggle: null,
    btnScan: null,
    info: null,
    activeIdx: -1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dispW: 0,
    dispH: 0,
    enabled: false,
  };

  // ── Tesseract Worker ────────────────────────────────────────

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
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(Math.round((m.progress || 0) * 100), 'Erkenne Text…');
          } else if (m.status && onProgress) {
            onProgress(null, m.status);
          }
        },
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
      });

      // Receipt-friendly settings (ignore if unsupported)
      try {
        await _worker.setParameters({
          tessedit_pageseg_mode: '6',
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        });
      } catch (e) {}
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

  // ── Parser (deine existierende Logik, leicht robust) ─────────

  function parse(text) {
    const normalized = _normalizeOCRText(text);
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    const flat = normalized;

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

    // Liters: 49,04 L
    const litersM = [...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 1 && x.value < 250);
    if (litersM.length) {
      litersM.sort((a,b) => b.value - a.value);
      const best = litersM.find(x => x.value >= 5 && x.value <= 120) || litersM[0];
      result.liters = { value: best.value, raw: best.raw, conf: 0.75 };
    }

    // €/L
    const pplM = [...flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*[lL]\b/gi)]
      .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
      .filter(x => x.value && x.value > 0.5 && x.value < 5.0);
    if (pplM.length) {
      result.pricePerLiter = { value: pplM[0].value, raw: pplM[0].raw, conf: 0.80 };
    }

    // Total: keyword same line
    const totalKeySameLineRE =
      /(?:gesamt(?:betrag)?|bruttobetrag|endbetrag|summe|total|betrag|zu\s+zahlen|zahlbetrag)\b[^\d]{0,40}([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)?/gi;
    for (const m of flat.matchAll(totalKeySameLineRE)) {
      const v = _parseDE(m[1]);
      if (v && v > 2 && v < 1000) {
        result.totalCost = { value: v, raw: m[1], conf: 0.92 };
        break;
      }
    }

    // Total: keyword line + next lines (Shell)
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

    // Fallback: biggest EUR amount
    if (!result.totalCost.value) {
      const money = [...flat.matchAll(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:€|eur|euro)\b/gi)]
        .map(m => ({ raw: m[1], value: _parseDE(m[1]) }))
        .filter(x => x.value && x.value > 2 && x.value < 500);
      if (money.length) {
        money.sort((a,b) => b.value - a.value);
        result.totalCost = { value: money[0].value, raw: money[0].raw, conf: 0.60 };
      }
    }

    // derive €/L
    if (!result.pricePerLiter.value && result.totalCost.value && result.liters.value) {
      const ppl = result.totalCost.value / result.liters.value;
      if (ppl > 0.5 && ppl < 5.0) {
        result.pricePerLiter = { value: +ppl.toFixed(4), raw: 'derived', conf: 0.50 };
      }
    }

    return result;
  }

  function _parseDE(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim().replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const v = parseFloat(str);
    return isNaN(v) ? null : v;
  }

  function _parseDate(s) {
    if (!s) return null;
    s = s.trim();
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
    // "84 30 EUR" -> "84,30 EUR"
    s = s.replace(/\b(\d{1,4})\s+(\d{2})\b(?=\s*(?:€|eur|euro|l\b|liter\b|\/\s*l))/gi, '$1,$2');
    // remove spaces around separators
    s = s.replace(/(\d)\s*([,\.])\s*(\d)/g, '$1$2$3');
    // collapse whitespace
    s = s.replace(/[ \t]{2,}/g, ' ');
    return s;
  }

  // ── UI Controller (deine IDs) ───────────────────────────────

  function openOverlay() {
    // Support both (single input) and (camera/gallery)
    ['ocr-file-input', 'ocr-file-camera', 'ocr-file-gallery'].forEach(id => {
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

    // Preview (existing UI)
    const previewWrap = document.getElementById('ocr-img-preview-wrap');
    const previewImg  = document.getElementById('ocr-img-preview');
    if (previewWrap && previewImg) {
      const url = URL.createObjectURL(file);
      previewImg.src = url;
      previewWrap.style.display = 'block';
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    _hide('ocr-zone');
    _hide('ocr-result-section');
    _show('ocr-progress-wrap', 'block');

    const progressFill  = document.getElementById('ocr-progress-fill');
    const progressLabel = document.getElementById('ocr-progress-label');
    if (progressFill) progressFill.style.width = '5%';
    if (progressLabel) progressLabel.textContent = 'Bereite Bild…';

    // Load bitmap for crop UI
    try {
      _srcBitmap = await createImageBitmap(file);
      _srcW = _srcBitmap.width;
      _srcH = _srcBitmap.height;
      // default points (slight inset)
      const mX = Math.round(_srcW * 0.05);
      const mY = Math.round(_srcH * 0.05);
      _cropPts = [
        { x: mX,        y: mY },         // TL
        { x: _srcW-mX,  y: mY },         // TR
        { x: _srcW-mX,  y: _srcH-mY },   // BR
        { x: mX,        y: _srcH-mY },   // BL
      ];

      _ensureCropUI();
      _enableCropUI();        // show the 4-point UI automatically
      _renderCrop();

      if (progressLabel) progressLabel.textContent = 'Ecken anpassen (optional) – dann „Scannen“';
      if (progressFill)  progressFill.style.width = '15%';
    } catch (e) {
      console.warn('createImageBitmap failed, fallback OCR:', e);
      // If bitmap fails, fallback to direct OCR
      await _scanAndFill(file);
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

  // ── Crop UI injection ───────────────────────────────────────

  function _ensureCropUI() {
    if (_ui.wrap) return;

    const host = document.getElementById('ocr-img-preview-wrap')?.parentElement || document.querySelector('#overlay-ocr .overlay-body');
    if (!host) return;

    const wrap = document.createElement('div');
    wrap.id = 'ocr-crop-wrap';
    wrap.style.display = 'none';
    wrap.style.marginTop = '10px';
    wrap.style.position = 'relative';

    const canvas = document.createElement('canvas');
    canvas.id = 'ocr-crop-canvas';
    canvas.style.width = '100%';
    canvas.style.borderRadius = '10px';
    canvas.style.border = '1px solid var(--border)';
    canvas.style.background = '#000';
    canvas.style.touchAction = 'none';

    const info = document.createElement('div');
    info.style.marginTop = '6px';
    info.style.fontFamily = 'var(--font-mono)';
    info.style.fontSize = '11px';
    info.style.color = 'var(--t3)';
    info.textContent = 'Zieh die 4 Punkte auf die Beleg-Ecken.';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.marginTop = '8px';

    const btnScan = document.createElement('button');
    btnScan.type = 'button';
    btnScan.className = 'btn btn-primary';
    btnScan.style.flex = '1';
    btnScan.textContent = 'Scannen (geradeziehen)';
    btnScan.onclick = () => scanCropped();

    const btnOff = document.createElement('button');
    btnOff.type = 'button';
    btnOff.className = 'btn btn-secondary';
    btnOff.style.flex = '1';
    btnOff.textContent = 'Ohne Ausrichten scannen';
    btnOff.onclick = () => scanOriginal();

    row.appendChild(btnScan);
    row.appendChild(btnOff);

    wrap.appendChild(canvas);
    wrap.appendChild(info);
    wrap.appendChild(row);

    // handles (4 dots)
    const handles = [];
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('div');
      h.className = 'ocr-handle';
      h.dataset.idx = String(i);
      h.style.position = 'absolute';
      h.style.width = '18px';
      h.style.height = '18px';
      h.style.borderRadius = '999px';
      h.style.background = 'var(--amber)';
      h.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.6)';
      h.style.transform = 'translate(-50%, -50%)';
      h.style.touchAction = 'none';
      h.style.cursor = 'grab';
      wrap.appendChild(h);
      handles.push(h);
    }

    // Events
    const onDown = (ev) => {
      const t = ev.target;
      if (!t || !t.dataset || t.dataset.idx == null) return;
      ev.preventDefault();
      _ui.activeIdx = parseInt(t.dataset.idx, 10);
      t.setPointerCapture?.(ev.pointerId);
      t.style.cursor = 'grabbing';
    };
    const onMove = (ev) => {
      if (_ui.activeIdx < 0) return;
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = (ev.clientX - rect.left);
      const y = (ev.clientY - rect.top);
      _setPointCanvas(_ui.activeIdx, x, y);
      _renderCrop();
    };
    const onUp = (ev) => {
      if (_ui.activeIdx < 0) return;
      ev.preventDefault();
      const idx = _ui.activeIdx;
      _ui.activeIdx = -1;
      if (handles[idx]) handles[idx].style.cursor = 'grab';
    };

    handles.forEach(h => {
      h.addEventListener('pointerdown', onDown);
    });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onUp);

    host.appendChild(wrap);

    _ui.wrap = wrap;
    _ui.canvas = canvas;
    _ui.ctx = canvas.getContext('2d', { willReadFrequently: true });
    _ui.handles = handles;
    _ui.btnScan = btnScan;
    _ui.info = info;
  }

  function _enableCropUI() {
    if (!_ui.wrap) return;
    _ui.wrap.style.display = 'block';
    _ui.enabled = true;
    // hide the plain preview image if present (canvas is the new view)
    const img = document.getElementById('ocr-img-preview');
    if (img) img.style.display = 'none';
  }

  function _disableCropUI() {
    if (!_ui.wrap) return;
    _ui.wrap.style.display = 'none';
    _ui.enabled = false;
    _ui.activeIdx = -1;
    const img = document.getElementById('ocr-img-preview');
    if (img) img.style.display = '';
  }

  function _renderCrop() {
    if (!_ui.enabled || !_ui.canvas || !_ui.ctx || !_srcBitmap || !_cropPts) return;

    // Fit image into canvas width, keep aspect
    const wrapW = _ui.wrap.getBoundingClientRect().width;
    const maxH = 260; // matches your preview max height vibe
    const scale = Math.min(wrapW / _srcW, maxH / _srcH);
    const dispW = Math.round(_srcW * scale);
    const dispH = Math.round(_srcH * scale);

    _ui.canvas.width = dispW;
    _ui.canvas.height = dispH;
    _ui.scale = scale;
    _ui.dispW = dispW;
    _ui.dispH = dispH;

    const ctx = _ui.ctx;
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(_srcBitmap, 0, 0, dispW, dispH);

    // Overlay polygon
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

    // Position handles
    for (let i = 0; i < 4; i++) {
      const h = _ui.handles[i];
      if (!h) continue;
      h.style.left = ptsC[i].x + 'px';
      h.style.top  = ptsC[i].y + 'px';
    }
  }

  function _setPointCanvas(idx, cx, cy) {
    // convert canvas coords -> image coords
    const s = _ui.scale || 1;
    const x = Math.max(0, Math.min(_ui.dispW, cx)) / s;
    const y = Math.max(0, Math.min(_ui.dispH, cy)) / s;
    _cropPts[idx] = { x, y };
  }

  // ── Perspective warp ────────────────────────────────────────

  function _dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

  function _computeDstSize(pts) {
    // pts order: TL, TR, BR, BL
    const top = _dist(pts[0], pts[1]);
    const bottom = _dist(pts[3], pts[2]);
    const left = _dist(pts[0], pts[3]);
    const right = _dist(pts[1], pts[2]);
    const w = Math.max(top, bottom);
    const h = Math.max(left, right);
    // clamp to something reasonable
    const W = Math.max(300, Math.round(w));
    const H = Math.max(300, Math.round(h));
    return { W, H };
  }

  function _solveHomography(src, dst) {
    // Solve 8x8 for homography with h33 = 1.
    // src/dst are arrays of 4 points.
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i].x, y = src[i].y;
      const u = dst[i].x, v = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -u*x, -u*y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v*x, -v*y]); b.push(v);
    }

    // Gaussian elimination
    const n = 8;
    for (let i = 0; i < n; i++) {
      // pivot
      let maxRow = i;
      for (let r = i+1; r < n; r++) {
        if (Math.abs(A[r][i]) > Math.abs(A[maxRow][i])) maxRow = r;
      }
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
    const h = b; // solution
    // return full 3x3
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
    const { W, H } = _computeDstSize(srcPts);
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = W;
    dstCanvas.height = H;
    const dctx = dstCanvas.getContext('2d', { willReadFrequently: true });

    // get source pixels
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

    const Hm = _solveHomography(srcPts, dstPts);
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

  // ── Scan actions ────────────────────────────────────────────

  async function scanCropped() {
    if (!_srcBitmap || !_cropPts) return;
    const progressFill  = document.getElementById('ocr-progress-fill');
    const progressLabel = document.getElementById('ocr-progress-label');

    if (progressFill) progressFill.style.width = '10%';
    if (progressLabel) progressLabel.textContent = 'Beleg wird geradegezogen…';

    // Warp
    const warped = _warpPerspectiveToCanvas(_srcBitmap, _cropPts);

    // OCR
    try {
      const text = await recognize(warped, (pct, msg) => {
        if (progressFill && pct != null) progressFill.style.width = pct + '%';
        if (progressLabel && msg) progressLabel.textContent = msg;
      });

      if (progressFill) progressFill.style.width = '100%';
      if (progressLabel) progressLabel.textContent = '✓ Text erkannt';

      const parsed = parse(text);
      showResult(parsed);

      // If still empty, tell user gently
      if (!parsed.date.value && !parsed.liters.value && !parsed.totalCost.value) {
        if (progressLabel) progressLabel.textContent = '✓ Text erkannt – aber keine Werte gefunden (Bild evtl. zu unscharf)';
      }
    } catch (err) {
      if (progressLabel) progressLabel.textContent = '✗ Fehler: ' + (err?.message || err);
      if (progressFill) progressFill.style.width = '0%';
      console.error(err);
    }
  }

  async function scanOriginal() {
    if (!_srcBitmap) return;
    try {
      const progressFill  = document.getElementById('ocr-progress-fill');
      const progressLabel = document.getElementById('ocr-progress-label');
      if (progressFill) progressFill.style.width = '10%';
      if (progressLabel) progressLabel.textContent = 'Scanne ohne Ausrichten…';

      const text = await recognize(_srcBitmap, (pct, msg) => {
        if (progressFill && pct != null) progressFill.style.width = pct + '%';
        if (progressLabel && msg) progressLabel.textContent = msg;
      });

      if (progressFill) progressFill.style.width = '100%';
      if (progressLabel) progressLabel.textContent = '✓ Text erkannt';

      const parsed = parse(text);
      showResult(parsed);
    } catch (err) {
      console.error(err);
    }
  }

  // Keep a fallback path if bitmap isn't available
  async function _scanAndFill(file) {
    const progressFill  = document.getElementById('ocr-progress-fill');
    const progressLabel = document.getElementById('ocr-progress-label');

    try {
      const text = await recognize(file, (pct, msg) => {
        if (progressFill && pct != null) progressFill.style.width = pct + '%';
        if (progressLabel && msg) progressLabel.textContent = msg;
      });
      const parsed = parse(text);
      showResult(parsed);
    } catch (e) {
      console.error(e);
    }
  }

  // ── Result UI (dein bestehender Teil) ───────────────────────

  function showResult(parsed) {
    const section = document.getElementById('ocr-result-section');
    if (section) section.style.display = 'block';

    const fields = [
      { key: 'date',          id: 'ocr-r-date',  format: v => v },
      { key: 'liters',        id: 'ocr-r-liters', format: v => v?.toFixed(2) },
      { key: 'totalCost',     id: 'ocr-r-total',  format: v => v?.toFixed(2) },
      { key: 'pricePerLiter', id: 'ocr-r-ppl',    format: v => v?.toFixed(4) },
    ];

    for (const f of fields) {
      const inp = document.getElementById(f.id);
      const hint = document.getElementById(f.id + '-hint');
      const data = parsed[f.key] || { value: null, conf: 0 };

      if (inp) {
        if (data.value !== null) {
          inp.value = f.key === 'date' ? data.value : f.format(data.value);
        } else {
          inp.value = '';
        }

        const uncertain = (data.conf || 0) < 0.70;
        inp.classList.toggle('ocr-uncertain', uncertain && data.value !== null);
      }
      if (hint) {
        const uncertain = (data.conf || 0) < 0.70;
        hint.style.display = (uncertain && data.value !== null) ? 'block' : 'none';
      }
    }
  }

  // ── tiny DOM helpers ────────────────────────────────────────

  function _show(id, disp='block'){ const el=document.getElementById(id); if(el) el.style.display=disp; }
  function _hide(id){ const el=document.getElementById(id); if(el) el.style.display='none'; }
  function _val(id){ const el=document.getElementById(id); return el ? el.value : ''; }
  function _setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

  return {
    openOverlay, closeOverlay, handleFile, transfer,
    parse, recognize,
    // manual scan actions
    scanCropped, scanOriginal
  };

})();

// Make it global for inline onclick handlers
window.OCR = OCR;
