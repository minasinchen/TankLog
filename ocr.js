/**
 * TankLog OCR — Rectify v5
 *
 * Fixes & improvements vs v4:
 * ✅ FIX: Handle-Punkte waren falsch positioniert (canvas war width:100% → gestreckt)
 *        Jetzt: Canvas hat explizite CSS-Größe + offsetX für Handles korrekt berechnet
 * ✅ NEU: Warp-Vorschau — nach "Scannen" wird das begradigt Bild ZUERST angezeigt,
 *        User kann bestätigen oder zurückgehen
 * ✅ VERBESSERT: Auto-Ecken erkennt jetzt den hellen Beleg-Bereich (weißes Papier)
 *        per Helligkeitsprofil statt nur Tintenpixel
 * ✅ VERBESSERT: Liter-Parser mit mehr Mustern (Menge auf Folgezeile, Kraftstoffkontext,
 *        stärkere Kreuzvalidierung total/preis → liter)
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
  let _cropPts = null;
  let _activeIdx = -1;

  let _ui = {
    wrap: null,
    canvas: null,
    ctx: null,
    handles: [],
    enabled: false,
    scale: 1,
    offsetX: 0,   // ← NEU: horizontal offset wenn Bild schmaler als wrap
    offsetY: 0,   // ← NEU: vertical offset wenn Bild kürzer als maxH
    dispW: 0,     // canvas logical width (CSS px)
    dispH: 0,     // canvas logical height (CSS px)
    previewEl: null,  // ← NEU: Warp-Vorschau canvas
    btnAuto: null,
  };

  // ─────────────────────────────────────────────────────────────
  // Parser — improved liters + €/L
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

    // ── DATE ────────────────────────────────────────────────────
    const dm = flat.match(/\b(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4})\b/);
    if (dm) {
      const iso = _parseDate(dm[1]);
      if (iso) result.date = { value: iso, raw: dm[1], conf: 0.70 };
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

    // ── PRICE PER LITER ──────────────────────────────────────────
    const pplCandidates = [];

    // "1,719 EUR/l", "1.719 EUR/1", "1,719 EUR /I", "EUR/l 1,719"
    for (const m of flat.matchAll(/([0-9]{1,2}[,\.][0-9]{3,4})\s*(?:€|eur|euro)?\s*\/\s*([lLiI1])\b/gi)) {
      const v = _parsePricePerLiter(m[1]);
      if (v && v > 0.8 && v < 3.5) pplCandidates.push({ raw: m[1], value: v, conf: 0.86 });
    }
    // "EUR/l: 1,719" or "EUR/l = 1.719"
    for (const m of flat.matchAll(/(?:€|eur|euro)\s*\/\s*([lLiI1])\s*[:=]?\s*([0-9]{1,2}[,\.][0-9]{3,4})/gi)) {
      const v = _parsePricePerLiter(m[2]);
      if (v && v > 0.8 && v < 3.5) pplCandidates.push({ raw: m[2], value: v, conf: 0.78 });
    }
    // Keine Einheit: Zahl mit 3-4 Dezimalstellen im Kontext "Preis/L" Label
    for (let i = 0; i < lines.length; i++) {
      if (/preis\s*\/?\s*l\b|literpreis|kraftstoffpreis/i.test(lines[i])) {
        const look = [lines[i], lines[i+1]].filter(Boolean).join(' ');
        const m = look.match(/([0-9]{1,2}[,\.][0-9]{3,4})/);
        if (m) {
          const v = _parsePricePerLiter(m[1]);
          if (v && v > 0.8 && v < 3.5) pplCandidates.push({ raw: m[1], value: v, conf: 0.75 });
        }
      }
    }
    // Alle isolierten Zahlen mit 3-4 Dezimalstellen → wahrscheinlich €/L
    // (z.B. "1,719" allein auf einer Zeile, oder nach Sternchen wie "*1,719")
    for (const m of flat.matchAll(/(?:^|[\s*#])([1-2][,\.][0-9]{3,4})(?:\s|$)/gm)) {
      const v = _parsePricePerLiter(m[1]);
      if (v && v > 1.0 && v < 3.0) pplCandidates.push({ raw: m[1], value: v, conf: 0.65 });
    }

    if (pplCandidates.length) {
      pplCandidates.sort((a,b) => {
        // Konfidenz zuerst, dann Nähe zu 1.70 (typischer Tankstellenpreis)
        if (Math.abs(a.conf - b.conf) > 0.05) return b.conf - a.conf;
        return Math.abs(a.value - 1.70) - Math.abs(b.value - 1.70);
      });
      result.pricePerLiter = pplCandidates[0];
    }

    // ── LITERS ───────────────────────────────────────────────────

    // 1) Explizite Einheit "49,04 L" (Zahl gefolgt von l/L)
    const litersWithUnit = [
      ...[...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2,3})\s*[lL]\b/g)]
         .map(m => ({ raw: m[1], value: _parseLiters(m[1]) })),
      // Fallback: "49,04 1" – alleinstehende Ziffer 1 nach 2-Dezimal-Zahl (OCR-Fehler l→1)
      // (nach Normalisierung sollte das schon als "l" dastehen, aber doppelt hält besser)
      ...[...flat.matchAll(/([0-9]{1,3}[,\.][0-9]{2})\s+1(?!\d)(?=\s+[0-9]{1,4}[,\.][0-9]{2})/g)]
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
      result.liters = { value: best.value, raw: best.raw, conf: 0.85 };
    }

    // 2) Label-Zeile: "Menge / Liter / Volumen / Kraftstoffmenge"
    //    → suche Zahl in gleicher Zeile ODER der nächsten Zeile
    if (!result.liters.value) {
      const litersLabelRE = /(?:kraftstoffmenge|menge|liter|vol(?:umen)?|mng|ltrs?|getankt)\b[^\d]{0,25}([0-9]{1,3}[,\.][0-9]{2,3})/gi;
      for (const m of flat.matchAll(litersLabelRE)) {
        const v = _parseLiters(m[1]);
        if (v && v > 1 && v < 250) {
          result.liters = { value: v, raw: m[1], conf: 0.82 };
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
            result.liters = { value: v, raw: m[1], conf: 0.80 };
            break;
          }
        }
      }
    }

    // 4) Kraftstofftyp-Kontext: "Super E10\n43,04\n53,30"
    //    Zahl nach Kraftstofftyp-Zeile, die nicht das Gesamtbetrag ist
    if (!result.liters.value) {
      const fuelRE = /(diesel|super\s*e?10?|e10|e5|benzin|kraftstoff|fuel|regular)/i;
      for (let i = 0; i < lines.length; i++) {
        if (!fuelRE.test(lines[i])) continue;
        const candidates = [];
        const look = [lines[i], lines[i+1], lines[i+2]].filter(Boolean).join(' ');
        for (const m of look.matchAll(/\b([0-9]{1,3}[,\.][0-9]{2})\b/g)) {
          const v = _parseLiters(m[1]);
          if (v && v >= 3 && v <= 120) candidates.push({ raw: m[1], value: v });
        }
        if (candidates.length) {
          const best = candidates.find(x => x.value >= 5) || candidates[0];
          result.liters = { value: best.value, raw: best.raw, conf: 0.55 };
          break;
        }
      }
    }

    // 5) ── STRUKTUR-PARSER: Shell/Aral/BP Produktzeile ──────────────
    // Format: "* 000002 Super FuelSave E10  49,04 l  84,30 EUR #A*"
    // Zwei 2-Dezimal-Zahlen auf Kraftstoffzeile → kleinere=Liter, größere=Preis
    if (!result.liters.value) {
      const productLineRE = /(super|diesel|e10|e5|benzin|fuelsave|ultimate|v-power|regular|kraftstoff)/i;
      for (let i = 0; i < lines.length; i++) {
        if (!productLineRE.test(lines[i])) continue;
        // Alle 2-Dezimal-Zahlen auf dieser Zeile
        const nums = [...lines[i].matchAll(/\b(\d{1,3}[,.]\d{2})\b/g)]
          .map(m => _parseLiters(m[1]))
          .filter(v => v && v > 0);
        if (nums.length >= 2) {
          nums.sort((a,b) => a-b);
          const litVal  = nums[0]; // kleinste = Liter
          const costVal = nums[nums.length-1]; // größte = Preis
          if (litVal >= 5 && litVal <= 120 && costVal > litVal) {
            result.liters = { value: litVal, raw: String(litVal), conf: 0.75 };
            // Bonus: wenn kein totalCost erkannt, aus dieser Zeile übernehmen
            if (!result.totalCost.value && costVal > 5 && costVal < 500) {
              result.totalCost = { value: costVal, raw: String(costVal), conf: 0.60 };
            }
            break;
          }
        }
      }
    }

    // ── KREUZVALIDIERUNG ─────────────────────────────────────────

    // ⛔ Sanity-Prüfung ZUERST: wenn Liter ≈ Gesamtbetrag → falsch erkannt
    // (passiert wenn Preis als Liter gewertet wird, z.B. 84,30 l statt 49,04 l)
    // Realistischer Kraftstoffpreis: mindestens ~1,10 €/L (EU-Minimum), max 3,50 €/L
    if (result.liters.value && result.totalCost.value) {
      const ratio = result.totalCost.value / result.liters.value;
      if (ratio < 1.05 || ratio > 3.50) {
        console.warn('OCR: Liter-Wert verworfen (ergibt unrealistischen €/L-Preis):', result.liters.value, '→', ratio.toFixed(3), '€/L');
        result.liters = { value: null, raw: null, conf: 0 };
      }
    }

    // 6) ── BRUTE-FORCE FALLBACK: Liter aus Gesamtbetrag + allen Zahlen im Text ─
    // Wenn immer noch kein Liter-Wert: suche ALLE 2-Dezimal-Zahlen im Text,
    // und nehme die, bei der total / zahl einen plausiblen Kraftstoffpreis ergibt
    if (!result.liters.value && result.totalCost.value) {
      const allNums = [...flat.matchAll(/\b(\d{1,3}[,.]\d{2})\b/g)]
        .map(m => _parseLiters(m[1]))
        .filter(v => v && v >= 5 && v <= 120 && Math.abs(v - result.totalCost.value) > 0.5);
      for (const v of allNums) {
        const ppl = result.totalCost.value / v;
        if (ppl >= 1.20 && ppl <= 2.90) {
          result.liters = { value: v, raw: String(v), conf: 0.60 };
          console.log('OCR: Liter per Brute-Force gefunden:', v, '→', ppl.toFixed(3), '€/L');
          break;
        }
      }
    }

    // Total + €/L → Liter berechnen (stark)
    if (result.totalCost.value && result.pricePerLiter.value) {
      const derivedL = result.totalCost.value / result.pricePerLiter.value;
      if (derivedL > 1 && derivedL < 250) {
        if (!result.liters.value || Math.abs(result.liters.value - derivedL) / derivedL > 0.10) {
          result.liters = { value: +derivedL.toFixed(2), raw: 'berechnet', conf: 0.82 };
        }
      }
    }

    // Liter + Total → €/L berechnen (nur wenn Liter plausibel)
    if (result.totalCost.value && result.liters.value && result.liters.raw !== 'berechnet') {
      const derivedP = result.totalCost.value / result.liters.value;
      if (derivedP > 0.8 && derivedP < 3.5) {
        const p = result.pricePerLiter.value;
        // Als "bogus" gilt: exakt 1.0 (Rechenkreis) oder fehlt oder weicht >8% ab
        const looksBogus = (p != null) && (Math.abs(p - 1.0) < 0.005);
        if (!p || looksBogus || Math.abs(p - derivedP) / derivedP > 0.08) {
          result.pricePerLiter = { value: +derivedP.toFixed(4), raw: 'berechnet', conf: 0.72 };
        }
      }
    }

    // Sanity clamp
    if (result.liters.value && (result.liters.value < 1 || result.liters.value > 200))
      result.liters.conf = Math.min(result.liters.conf, 0.25);
    if (result.totalCost.value && (result.totalCost.value < 2 || result.totalCost.value > 500))
      result.totalCost.conf = Math.min(result.totalCost.conf, 0.25);
    if (result.pricePerLiter.value && (result.pricePerLiter.value < 0.8 || result.pricePerLiter.value > 3.5))
      result.pricePerLiter.conf = Math.min(result.pricePerLiter.conf, 0.25);

    return result;
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
    const iso = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return isNaN(new Date(iso).getTime()) ? null : iso;
  }

  function _normalizeOCRText(t) {
    if (!t) return '';
    let s = String(t);
    s = s.replace(/\r\n?/g, '\n');
    s = s.replace(/\u00A0/g, ' ');
    s = s.replace(/\bEURO\b/gi, 'EUR');

    // Leerzeichen im Dezimalwert: "84 30 EUR" → "84,30 EUR"
    s = s.replace(/\b(\d{1,4})\s+(\d{2})\b(?=\s*(?:€|eur|euro|\/\s*[lLiI1]|l\b|liter\b))/gi, '$1,$2');
    s = s.replace(/\b(\d{1,3})\s+(\d{2})\b(?=\s*(?:super|diesel|e10|e5|benzin|kraftstoff|fuel))/gi, '$1,$2');

    // "1 719 EUR/I" → "1.719 EUR/I"  (vor digit-cleanup damit das Muster noch sichtbar ist)
    s = s.replace(/\b(\d{1,2})\s+(\d{3,4})\b(?=\s*(?:€|eur|euro)?\s*\/\s*[lLiI1])/gi, '$1.$2');

    // ── SCHLÜSSEL-FIX: OCR liest "l" (Liter) als "1" (Ziffer) ────────
    // Shell/BP/Aral: "49,04 1  84,30 EUR" → "49,04 l  84,30 EUR"
    s = s.replace(
      /(\b\d{1,3}[,.]\d{2})\s+1\b(?=\s+\d{1,4}[,.]\d{2}\s*(?:€|eur|euro|\s*#|\s*$))/gi,
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

    // ── Crop wrap ──────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.id = 'ocr-crop-wrap';
    wrap.style.cssText = 'display:none;margin-top:10px;position:relative;';

    const canvas = document.createElement('canvas');
    canvas.id = 'ocr-crop-canvas';
    // WICHTIG: kein width:100% mehr — wir setzen die CSS-Größe explizit in _renderCrop
    canvas.style.cssText = [
      'display:block',
      'border-radius:10px',
      'border:1px solid var(--border)',
      'background:#000',
      'touch-action:none',
      'position:relative',
      'z-index:1',
    ].join(';');

    const info = document.createElement('div');
    info.style.cssText = 'margin-top:6px;font-family:var(--font-mono);font-size:11px;color:var(--t3)';
    info.textContent = 'Tippe nahe an einen Punkt & zieh ihn auf die Beleg-Ecke.';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:8px';

    const btnAuto = document.createElement('button');
    btnAuto.type = 'button'; btnAuto.className = 'btn btn-secondary'; btnAuto.style.flex = '1';
    btnAuto.textContent = 'Auto-Ecken';
    btnAuto.onclick = () => { _autoGuessCorners(); _renderCrop(); };

    const btnScan = document.createElement('button');
    btnScan.type = 'button'; btnScan.className = 'btn btn-primary'; btnScan.style.flex = '1';
    btnScan.textContent = 'Scannen';
    btnScan.onclick = () => scanCropped();

    const btnOff = document.createElement('button');
    btnOff.type = 'button'; btnOff.className = 'btn btn-secondary'; btnOff.style.flex = '1';
    btnOff.textContent = 'Ohne Ausrichten';
    btnOff.onclick = () => scanOriginal();

    row.append(btnAuto, btnScan, btnOff);
    wrap.append(canvas, info, row);

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

    const onDown = ev => {
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      const idx = pickNearest(x, y);
      if (idx === -1) return;
      _activeIdx = idx;
      canvas.setPointerCapture?.(ev.pointerId);
      _setPointCanvas(_activeIdx, x, y);
      _renderCrop();
    };
    const onMove = ev => {
      if (_activeIdx < 0) return;
      ev.preventDefault();
      const { x, y } = getCanvasXY(ev);
      _setPointCanvas(_activeIdx, x, y);
      _renderCrop();
    };
    const onUp = ev => { if (_activeIdx >= 0) { ev.preventDefault(); _activeIdx = -1; } };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    handles.forEach(h => {
      h.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        _activeIdx = parseInt(h.dataset.idx, 10);
        h.setPointerCapture?.(ev.pointerId);
      });
      h.addEventListener('pointermove', onMove);
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
    const maxH  = 440;
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

      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(_srcBitmap, 0, 0, cw, ch);
      const img = ctx.getImageData(0, 0, cw, ch);
      const d = img.data;

      // Helligkeits-Profil: Zeilen- und Spalten-Durchschnitt
      const rowBright = new Float32Array(ch);
      const colBright = new Float32Array(cw);

      for (let y = 0; y < ch; y++) {
        let sum = 0;
        for (let x = 0; x < cw; x++) {
          const i = (y*cw + x)*4;
          sum += 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        }
        rowBright[y] = sum / cw;
      }
      for (let x = 0; x < cw; x++) {
        let sum = 0;
        for (let y = 0; y < ch; y++) {
          const i = (y*cw + x)*4;
          sum += 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        }
        colBright[x] = sum / ch;
      }

      // Beleg-Bereich: zusammenhängende Zone mit hoher Helligkeit (> 160)
      // Suche größtes zusammenhängendes Intervall
      const brightThr = 155;

      const findInterval = (arr, thr) => {
        // Finde das längste zusammenhängende Intervall über dem Schwellwert
        let bestStart = 0, bestLen = 0, cur = -1, curLen = 0;
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] >= thr) {
            if (cur < 0) cur = i;
            curLen++;
            if (curLen > bestLen) { bestLen = curLen; bestStart = cur; }
          } else {
            cur = -1; curLen = 0;
          }
        }
        return bestLen > 10
          ? { start: bestStart, end: bestStart + bestLen - 1 }
          : { start: 0, end: arr.length - 1 }; // fallback: ganzes Bild
      };

      const rows = findInterval(rowBright, brightThr);
      const cols = findInterval(colBright, brightThr);

      // Padding
      const padX = Math.round(cw * 0.02);
      const padY = Math.round(ch * 0.02);
      const x0 = Math.max(0, cols.start - padX) / sc;
      const x1 = Math.min(cw-1, cols.end   + padX) / sc;
      const y0 = Math.max(0, rows.start - padY) / sc;
      const y1 = Math.min(ch-1, rows.end   + padY) / sc;

      _cropPts = _orderTLTRBRBL([
        { x: x0, y: y0 }, { x: x1, y: y0 },
        { x: x1, y: y1 }, { x: x0, y: y1 },
      ]);
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

    // Warp-Vorschau anzeigen, User entscheidet
    _showWarpPreview(
      warped,
      // onConfirm → OCR auf dem begradigten Bild
      async () => {
        _hideWarpPreview();
        _setProgress(15, 'Starte Texterkennung…');
        await _runOCR(warped);
      },
      // onBack → zurück zur Ecken-Auswahl
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
    _setProgress(10, 'Scanne ohne Ausrichten…');
    await _runOCR(_srcBitmap);
  }

  async function _scanDirect(file) {
    _setProgress(10, 'Scanne…');
    try {
      const bmp = await createImageBitmap(file);
      await _runOCR(bmp);
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
    }
  }

  async function _runOCR(source) {
    try {
      const text = await recognize(source, (pct, msg) => _setProgress(pct, msg));
      _lastText = text || '';
      window.__OCR_LAST_TEXT__ = _lastText;
      console.log('OCR RAW (erste 2000 Zeichen):\n', _lastText.slice(0, 2000));

      _setProgress(100, '✓ Text erkannt');

      const parsed = parse(_lastText);
      _lastParsed = parsed;
      window.__OCR_LAST_PARSED__ = parsed;
      console.log('OCR PARSED:', parsed);

      showResult(parsed);

      if (!parsed.date.value && !parsed.liters.value && !parsed.totalCost.value) {
        _setProgress(100, '✓ erkannt — aber keine Werte gefunden (Foto evtl. unscharf?)');
      }
    } catch (err) {
      _setProgress(0, '✗ Fehler: ' + (err?.message || err));
      console.error(err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Ergebnis-Anzeige
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

    for (const f of fields) {
      const el = document.getElementById(f.id);
      const hint = document.getElementById(f.id + '-hint');
      if (!el) continue;
      const d = parsed?.[f.key];
      el.value = (d && d.value != null) ? f.fmt(d.value) : '';

      // Hint: Konfidenz-Anzeige
      if (hint) {
        if (!d || d.value == null) {
          hint.textContent = '✗ Nicht erkannt';
          hint.style.color = 'var(--red, #e55)';
          hint.style.display = 'block';
        } else if (d.conf < 0.70) {
          hint.textContent = `⚠ Unsicher (${d.raw || ''})`;
          hint.style.color = 'var(--amber)';
          hint.style.display = 'block';
        } else if (d.raw === 'berechnet') {
          hint.textContent = '≈ Aus Total ÷ Preis berechnet';
          hint.style.color = 'var(--t3)';
          hint.style.display = 'block';
        } else {
          hint.style.display = 'none';
        }
      }
    }
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
    parse, recognize,
    scanCropped, scanOriginal,
    getLastText, getLastParsed,
  };

})();

window.OCR = OCR;
