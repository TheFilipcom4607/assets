/* Code Maker — QR & barcode generator. All generation happens locally. */
(function () {
  'use strict';

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  var TYPES = [
    { id: 'qr', label: 'QR Code' },
    { id: 'CODE128', label: 'Code 128', hint: 'Any text — letters, digits, symbols.', placeholder: 'Example1234' },
    { id: 'EAN13', label: 'EAN-13', hint: 'Enter 12 digits (check digit is added for you) or a full 13-digit code.', placeholder: '590123412345', numeric: true },
    { id: 'EAN8', label: 'EAN-8', hint: 'Enter 7 digits (check digit is added for you) or a full 8-digit code.', placeholder: '9638507', numeric: true },
    { id: 'UPC', label: 'UPC-A', hint: 'Enter 11 digits (check digit is added for you) or a full 12-digit code.', placeholder: '12345678901', numeric: true },
    { id: 'CODE39', label: 'Code 39', hint: 'Uppercase letters, digits and - . $ / + % space.', placeholder: 'CODE-39', uppercase: true },
    { id: 'ITF14', label: 'ITF-14', hint: 'Enter 13 digits (check digit is added for you) or a full 14-digit code. Used on shipping cartons.', placeholder: '1234567890123', numeric: true },
    { id: 'ITF', label: 'ITF', hint: 'An even number of digits.', placeholder: '123456', numeric: true },
    { id: 'codabar', label: 'Codabar', hint: 'Digits and - $ : / . + (start/stop letters A–D optional).', placeholder: 'A40156B' },
    { id: 'MSI', label: 'MSI', hint: 'Digits only. Used for inventory and shelf labels.', placeholder: '1234567', numeric: true },
    { id: 'pharmacode', label: 'Pharmacode', hint: 'A number from 3 to 131070. Used on medicine packaging.', placeholder: '1234', numeric: true }
  ];

  var QR_PRESETS = [
    { id: 'text', label: 'Text / URL' },
    { id: 'wifi', label: 'Wi-Fi' },
    { id: 'tel', label: 'Phone' },
    { id: 'sms', label: 'SMS' },
    { id: 'email', label: 'Email' }
  ];

  var state = {
    type: 'qr',
    qrPreset: 'text',
    qrEc: 'M',
    showText: true,
    values: {}
  };

  var els = {
    typeRow: document.getElementById('typeRow'),
    qrPresetRow: document.getElementById('qrPresetRow'),
    fields: document.getElementById('fields'),
    options: document.getElementById('options'),
    hint: document.getElementById('hint'),
    preview: document.getElementById('preview'),
    placeholder: document.getElementById('placeholder'),
    saveTip: document.getElementById('saveTip'),
    saveBtn: document.getElementById('saveBtn'),
    shareBtn: document.getElementById('shareBtn')
  };

  var canvas = document.createElement('canvas');
  var currentDataUrl = null;
  var debounceTimer = null;

  /* ---------- UI building ---------- */

  function makeChip(label, selected, onTap) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', selected ? 'true' : 'false');
    b.textContent = label;
    b.addEventListener('click', onTap);
    return b;
  }

  function renderTypeRow() {
    els.typeRow.innerHTML = '';
    TYPES.forEach(function (t) {
      els.typeRow.appendChild(makeChip(t.label, state.type === t.id, function () {
        state.type = t.id;
        state.values = {};
        renderAll();
      }));
    });
    els.qrPresetRow.hidden = state.type !== 'qr';
    if (state.type === 'qr') {
      els.qrPresetRow.innerHTML = '';
      QR_PRESETS.forEach(function (p) {
        els.qrPresetRow.appendChild(makeChip(p.label, state.qrPreset === p.id, function () {
          state.qrPreset = p.id;
          state.values = {};
          renderAll();
        }));
      });
    }
  }

  function addField(opts) {
    var wrap = document.createElement('div');
    var input;
    if (opts.kind === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 3;
    } else if (opts.kind === 'select') {
      input = document.createElement('select');
      opts.choices.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c[0];
        o.textContent = c[1];
        input.appendChild(o);
      });
    } else if (opts.kind === 'checkbox') {
      wrap.className = 'field-check';
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!state.values[opts.key];
      var span = document.createElement('span');
      span.textContent = opts.label;
      wrap.appendChild(input);
      wrap.appendChild(span);
      input.addEventListener('change', function () {
        state.values[opts.key] = input.checked;
        scheduleGenerate();
      });
      els.fields.appendChild(wrap);
      return;
    } else {
      input = document.createElement('input');
      input.type = opts.kind || 'text';
      if (opts.inputmode) input.inputMode = opts.inputmode;
      input.autocapitalize = opts.autocapitalize || 'off';
      input.autocomplete = 'off';
      input.autocorrect = 'off';
      input.spellcheck = false;
    }
    wrap.className = 'field';
    var label = document.createElement('label');
    label.textContent = opts.label;
    wrap.appendChild(label);
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.value = state.values[opts.key] || '';
    input.addEventListener('input', function () {
      state.values[opts.key] = input.value;
      scheduleGenerate();
    });
    if (opts.kind === 'select') {
      input.value = state.values[opts.key] || opts.choices[0][0];
      state.values[opts.key] = input.value;
      input.addEventListener('change', function () {
        state.values[opts.key] = input.value;
        scheduleGenerate();
      });
    }
    wrap.appendChild(input);
    els.fields.appendChild(wrap);
  }

  function renderFields() {
    els.fields.innerHTML = '';
    if (state.type === 'qr') {
      switch (state.qrPreset) {
        case 'text':
          addField({ key: 'text', label: 'Text or link', kind: 'textarea', placeholder: 'https://example.com or any text' });
          break;
        case 'wifi':
          addField({ key: 'ssid', label: 'Network name (SSID)', placeholder: 'MyWiFi' });
          addField({ key: 'pass', label: 'Password', placeholder: 'secret123' });
          addField({ key: 'sec', label: 'Security', kind: 'select', choices: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']] });
          addField({ key: 'hidden', label: 'Hidden network', kind: 'checkbox' });
          break;
        case 'tel':
          addField({ key: 'tel', label: 'Phone number', kind: 'tel', placeholder: '+48 123 456 789', inputmode: 'tel' });
          break;
        case 'sms':
          addField({ key: 'tel', label: 'Phone number', kind: 'tel', placeholder: '+48 123 456 789', inputmode: 'tel' });
          addField({ key: 'body', label: 'Message (optional)', kind: 'textarea', placeholder: 'Hello!' });
          break;
        case 'email':
          addField({ key: 'to', label: 'Email address', kind: 'email', placeholder: 'someone@example.com' });
          addField({ key: 'subject', label: 'Subject (optional)', placeholder: 'Subject' });
          addField({ key: 'body', label: 'Message (optional)', kind: 'textarea', placeholder: 'Message' });
          break;
      }
    } else {
      var t = typeDef();
      addField({
        key: 'value',
        label: t.label + ' value',
        placeholder: t.placeholder,
        inputmode: t.numeric ? 'numeric' : undefined,
        autocapitalize: t.uppercase ? 'characters' : 'off'
      });
    }
  }

  function renderOptions() {
    els.options.innerHTML = '';
    if (state.type === 'qr') {
      var lab = document.createElement('label');
      lab.className = 'opt-label';
      lab.textContent = 'Error correction';
      var sel = document.createElement('select');
      [['L', 'Low'], ['M', 'Medium'], ['Q', 'Quartile'], ['H', 'High']].forEach(function (c) {
        var o = document.createElement('option');
        o.value = c[0];
        o.textContent = c[1] + ' (' + c[0] + ')';
        sel.appendChild(o);
      });
      sel.value = state.qrEc;
      sel.addEventListener('change', function () {
        state.qrEc = sel.value;
        scheduleGenerate();
      });
      lab.appendChild(sel);
      els.options.appendChild(lab);
    } else {
      var wrap = document.createElement('label');
      wrap.className = 'field-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.showText;
      cb.addEventListener('change', function () {
        state.showText = cb.checked;
        scheduleGenerate();
      });
      var span = document.createElement('span');
      span.textContent = 'Show value under barcode';
      wrap.appendChild(cb);
      wrap.appendChild(span);
      els.options.appendChild(wrap);
    }
  }

  function renderAll() {
    renderTypeRow();
    renderFields();
    renderOptions();
    generate();
  }

  function typeDef() {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === state.type) return TYPES[i];
    return TYPES[0];
  }

  /* ---------- Payload building ---------- */

  function escapeWifi(s) {
    return s.replace(/([\\;,:"'])/g, '\\$1');
  }

  function qrPayload() {
    var v = state.values;
    switch (state.qrPreset) {
      case 'text':
        return (v.text || '').trim() ? v.text : '';
      case 'wifi':
        if (!(v.ssid || '').trim()) return '';
        var sec = v.sec || 'WPA';
        var s = 'WIFI:T:' + sec + ';S:' + escapeWifi(v.ssid) + ';';
        if (sec !== 'nopass') s += 'P:' + escapeWifi(v.pass || '') + ';';
        if (v.hidden) s += 'H:true;';
        return s + ';';
      case 'tel':
        return (v.tel || '').trim() ? 'tel:' + v.tel.replace(/[^\d+#*]/g, '') : '';
      case 'sms':
        if (!(v.tel || '').trim()) return '';
        return 'SMSTO:' + v.tel.replace(/[^\d+#*]/g, '') + ':' + (v.body || '');
      case 'email':
        if (!(v.to || '').trim()) return '';
        var params = [];
        if ((v.subject || '').trim()) params.push('subject=' + encodeURIComponent(v.subject));
        if ((v.body || '').trim()) params.push('body=' + encodeURIComponent(v.body));
        return 'mailto:' + v.to.trim() + (params.length ? '?' + params.join('&') : '');
    }
    return '';
  }

  /* ---------- Generation ---------- */

  function scheduleGenerate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(generate, 150);
  }

  function setHint(msg, isError) {
    var t = typeDef();
    els.hint.textContent = msg || t.hint || '';
    els.hint.classList.toggle('error', !!isError);
  }

  function showEmpty() {
    currentDataUrl = null;
    els.preview.hidden = true;
    els.placeholder.hidden = false;
    els.saveTip.hidden = true;
    els.saveBtn.disabled = true;
    els.shareBtn.disabled = true;
  }

  function showResult() {
    currentDataUrl = canvas.toDataURL('image/png');
    els.preview.src = currentDataUrl;
    els.preview.hidden = false;
    els.placeholder.hidden = true;
    els.saveTip.hidden = false;
    els.saveBtn.disabled = false;
    els.shareBtn.disabled = !(navigator.canShare && navigator.share);
  }

  function drawQr(text) {
    var qr = qrcode(0, state.qrEc); // 0 = auto version
    qr.addData(text, 'Byte');
    qr.make();
    var count = qr.getModuleCount();
    var quiet = 4;
    var scale = Math.max(4, Math.min(16, Math.floor(1024 / (count + quiet * 2))));
    var size = (count + quiet * 2) * scale;
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
  }

  function generate() {
    var t = typeDef();
    if (state.type === 'qr') {
      var payload = qrPayload();
      if (!payload) {
        setHint('');
        showEmpty();
        return;
      }
      try {
        drawQr(payload);
        setHint(payload.length > 60 ? payload.slice(0, 60) + '…' : payload);
        showResult();
      } catch (e) {
        setHint('Too much data for a QR code — try shorter text or lower error correction.', true);
        showEmpty();
      }
      return;
    }

    var value = (state.values.value || '').trim();
    if (t.uppercase) value = value.toUpperCase();
    if (!value) {
      setHint('');
      showEmpty();
      return;
    }
    try {
      JsBarcode(canvas, value, {
        format: state.type,
        displayValue: state.showText,
        margin: 18,
        width: 3,
        height: 140,
        fontSize: 28,
        font: '-apple-system, Segoe UI, Roboto, sans-serif',
        background: '#ffffff',
        lineColor: '#000000'
      });
      setHint('');
      showResult();
    } catch (e) {
      setHint(t.hint || 'Invalid value for this barcode type.', true);
      showEmpty();
    }
  }

  /* ---------- Save & share ---------- */

  function fileName() {
    var base = state.type === 'qr' ? 'qr-code' : typeDef().label.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return base + '-' + Date.now() + '.png';
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: 'image/png' });
  }

  els.saveBtn.addEventListener('click', function () {
    if (!currentDataUrl) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(dataUrlToBlob(currentDataUrl));
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  });

  els.shareBtn.addEventListener('click', function () {
    if (!currentDataUrl || !navigator.share) return;
    var file = new File([dataUrlToBlob(currentDataUrl)], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Code' }).catch(function () {});
    }
  });

  /* ---------- iOS install banner ---------- */

  (function installBanner() {
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    var dismissed = false;
    try { dismissed = localStorage.getItem('installDismissed') === '1'; } catch (e) {}
    if (isIOS && !standalone && !dismissed) {
      var banner = document.getElementById('installBanner');
      banner.hidden = false;
      document.body.classList.add('has-banner');
      document.getElementById('installDismiss').addEventListener('click', function () {
        banner.hidden = true;
        document.body.classList.remove('has-banner');
        try { localStorage.setItem('installDismissed', '1'); } catch (e) {}
      });
    }
  })();

  /* ---------- Service worker ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  renderAll();
})();
