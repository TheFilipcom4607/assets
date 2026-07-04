/* Code Maker — QR & barcode generator. All generation happens locally. */
(function () {
  'use strict';

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  var ICONS = {
    qr: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 1h6v6H1V1zm2 2v2h2V3H3zM9 1h6v6H9V1zm2 2v2h2V3h-2zM1 9h6v6H1V9zm2 2v2h2v-2H3zm6-2h3v3H9V9zm4 0h2v2h-2V9zm-4 4h2v2H9v-2zm4 0h2v2h-2v-2z"/></svg>',
    bars: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 2h2v12H1V2zm3 0h1v12H4V2zm2 0h2v12H6V2zm3 0h1v12H9V2zm2 0h1v12h-1V2zm2 0h2v12h-2V2z"/></svg>',
    text: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3h12v2H2V3zm0 4h12v2H2V7zm0 4h8v2H2v-2z"/></svg>',
    wifi: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 13.6a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2zM4.6 9.3L3.2 7.9a6.8 6.8 0 019.6 0l-1.4 1.4a4.8 4.8 0 00-6.8 0zM1.9 6.5L.5 5.1a10.6 10.6 0 0115 0l-1.4 1.4a8.6 8.6 0 00-12.2 0z"/></svg>',
    tel: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.6 1.7c.4-.4 1.1-.4 1.5 0l2 2c.4.4.4 1.1 0 1.5l-1 1c-.2.2-.3.6-.1.9a10 10 0 002.9 2.9c.3.2.7.1.9-.1l1-1c.4-.4 1.1-.4 1.5 0l2 2c.4.4.4 1.1 0 1.5l-1.1 1.1c-.7.7-1.7 1-2.7.6A14.7 14.7 0 011.9 5.5c-.4-1-.1-2 .6-2.7l1.1-1.1z"/></svg>',
    sms: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h10a2 2 0 012 2v6a2 2 0 01-2 2H7l-4 3v-3H3a2 2 0 01-2-2V4a2 2 0 012-2z"/></svg>',
    email: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3h12a1 1 0 011 1v.4L8 8.9 1 4.4V4a1 1 0 011-1zm-1 3.2l6.6 4.2c.2.2.6.2.8 0L15 6.2V12a1 1 0 01-1 1H2a1 1 0 01-1-1V6.2z"/></svg>'
  };

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

  var COLOR_PRESETS = ['#000000', '#0a84ff', '#5e5ce6', '#34c759', '#ff3b30', '#ff9500'];

  var savedColor = null;
  try { savedColor = localStorage.getItem('codeColor'); } catch (e) {}
  if (!/^#[0-9a-f]{6}$/i.test(savedColor || '')) savedColor = null;

  var state = {
    type: 'qr',
    qrPreset: 'text',
    qrEc: 'M',
    showText: true,
    color: savedColor || '#000000',
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

  function makeChip(label, icon, selected, onTap) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', selected ? 'true' : 'false');
    // Icons come from the hardcoded ICONS map only, never from user input.
    b.innerHTML = icon || '';
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', onTap);
    return b;
  }

  function renderTypeRow() {
    els.typeRow.innerHTML = '';
    TYPES.forEach(function (t) {
      var icon = t.id === 'qr' ? ICONS.qr : ICONS.bars;
      els.typeRow.appendChild(makeChip(t.label, icon, state.type === t.id, function () {
        state.type = t.id;
        state.values = {};
        renderAll();
      }));
    });
    els.qrPresetRow.hidden = state.type !== 'qr';
    if (state.type === 'qr') {
      els.qrPresetRow.innerHTML = '';
      QR_PRESETS.forEach(function (p) {
        var icon = ICONS[p.id] || ICONS.text;
        els.qrPresetRow.appendChild(makeChip(p.label, icon, state.qrPreset === p.id, function () {
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

  function setColor(color) {
    state.color = color;
    try { localStorage.setItem('codeColor', color); } catch (e) {}
    updateSwatches();
    scheduleGenerate();
  }

  function updateSwatches() {
    var matched = false;
    els.options.querySelectorAll('.swatch[data-color]').forEach(function (b) {
      var sel = b.dataset.color.toLowerCase() === state.color.toLowerCase();
      b.classList.toggle('selected', sel);
      if (sel) matched = true;
    });
    var custom = els.options.querySelector('.swatch.custom');
    if (custom) custom.classList.toggle('selected', !matched);
  }

  function renderColorRow() {
    var row = document.createElement('div');
    row.className = 'color-row';
    var label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = 'Code color';
    row.appendChild(label);
    COLOR_PRESETS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.color = c;
      b.style.background = c;
      b.setAttribute('aria-label', 'Color ' + c);
      b.addEventListener('click', function () { setColor(c); });
      row.appendChild(b);
    });
    var custom = document.createElement('label');
    custom.className = 'swatch custom';
    custom.setAttribute('aria-label', 'Custom color');
    var input = document.createElement('input');
    input.type = 'color';
    input.value = state.color;
    input.addEventListener('input', function () { setColor(input.value); });
    custom.appendChild(input);
    row.appendChild(custom);
    els.options.appendChild(row);
    updateSwatches();
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
    renderColorRow();
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

  function setHint(msg, kind) {
    var t = typeDef();
    els.hint.textContent = msg || t.hint || '';
    els.hint.classList.toggle('error', kind === 'error');
    els.hint.classList.toggle('warn', kind === 'warn');
  }

  // WCAG contrast ratio of the code color against the white background.
  function contrastVsWhite(hex) {
    var lin = function (c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return 1.05 / (L + 0.05);
  }

  function contrastWarning() {
    return contrastVsWhite(state.color) < 2 ? 'Light colors may not scan reliably — pick a darker one.' : null;
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
    els.preview.classList.remove('pop');
    void els.preview.offsetWidth; // restart the pop animation
    els.preview.src = currentDataUrl;
    els.preview.classList.add('pop');
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
    ctx.fillStyle = state.color;
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
        var warn = contrastWarning();
        if (warn) setHint(warn, 'warn');
        else setHint(payload.length > 60 ? payload.slice(0, 60) + '…' : payload);
        showResult();
      } catch (e) {
        setHint('Too much data for a QR code — try shorter text or lower error correction.', 'error');
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
        lineColor: state.color
      });
      var warn = contrastWarning();
      if (warn) setHint(warn, 'warn');
      else setHint('');
      showResult();
    } catch (e) {
      setHint(t.hint || 'Invalid value for this barcode type.', 'error');
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
      navigator.serviceWorker.register('/codes/sw.js').catch(function () {});
    });
  }

  renderAll();
})();
