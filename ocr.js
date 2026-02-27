
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
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(Math.round(m.progress * 100), 'Erkenne Text…');
          } else if (m.status && onProgress) {
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
    return text;
  }

  function _parseDE(s) {
    if (!s) return null;
    return parseFloat(s.replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  }

  function _normalizeOCRText(t) {
    if (!t) return '';
    let s = String(t);
    s = s.replace(/\bEURO\b/gi, 'EUR');
    s = s.replace(/(\d)\s+(\d{2})\b/g, '$1,$2');
    s = s.replace(/(\d)\s*([,\.])\s*(\d)/g, '$1$2$3');
    return s;
  }

  function parse(text) {
    const normalized = _normalizeOCRText(text);
    const result = {
      date: { value:null, conf:0 },
      liters: { value:null, conf:0 },
      totalCost: { value:null, conf:0 },
      pricePerLiter: { value:null, conf:0 }
    };

    const liters = normalized.match(/([0-9]{1,3}[,\.][0-9]{2})\s*L/i);
    if (liters) result.liters = { value:_parseDE(liters[1]), conf:0.8 };

    const total = normalized.match(/([0-9]{1,4}[,\.][0-9]{2})\s*(?:EUR|€)/i);
    if (total) result.totalCost = { value:_parseDE(total[1]), conf:0.8 };

    const date = normalized.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);
    if (date) result.date = { value:date[1], conf:0.7 };

    return result;
  }

  function openOverlay() {
    ['ocr-file-input','ocr-file-camera','ocr-file-gallery'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.value='';
    });

    const ov=document.getElementById('overlay-ocr');
    if(ov) ov.classList.add('open');
  }

  function closeOverlay() {
    const ov=document.getElementById('overlay-ocr');
    if(ov) ov.classList.remove('open');
  }

  async function handleFile(file) {
    if (!file) return;

    const text = await recognize(file);
    const parsed = parse(text);

    const d=document.getElementById('ocr-r-date');
    const l=document.getElementById('ocr-r-liters');
    const t=document.getElementById('ocr-r-total');

    if(d && parsed.date.value) d.value=parsed.date.value;
    if(l && parsed.liters.value) l.value=parsed.liters.value;
    if(t && parsed.totalCost.value) t.value=parsed.totalCost.value;
  }

  return { openOverlay, closeOverlay, handleFile };

})();

window.OCR = OCR;
