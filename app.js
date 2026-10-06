/**
 * PhoneCheck — app.js
 * Vanilla JS, zero dependencies, zero network calls.
 * Everything runs locally in the user's browser.
 *
 * Structure:
 *  1. helpers + state
 *  2. UI rendering (badges, progress, summary)
 *  3. bottom sheet + result prompt
 *  4. full-screen overlay tests: pixel / grid / multi-touch
 *  5. sheet tests: audio / microphone / vibration / gyroscope / refresh rate / camera
 *  6. legal pages (Privacy / Terms / About)
 *  7. init
 */
(() => {
  'use strict';

  /* ======================================================
   * 1. Helpers + state
   * ==================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Tiny DOM builder: h('div', {class:'x', onclick:fn}, child, child) */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) el.append(c); });
    return el;
  }

  const MODULES = {
    pixel: { title: 'فحص البكسلات الميتة' },
    grid:  { title: 'فحص مناطق اللمس الميتة' },
    multi: { title: 'فحص اللمس المتعدد' },
    audio: { title: 'فحص الصوت والسماعات' },
    mic:   { title: 'فحص الميكروفون' },
    vibe:  { title: 'فحص الاهتزاز' },
    gyro:  { title: 'فحص الجيروسكوب' },
    refresh: { title: 'فحص معدل تحديث الشاشة' },
    camera: { title: 'فحص الكاميرا' }
  };
  const MODULE_KEYS = Object.keys(MODULES);
  const STATUS_LABEL = { pass: 'سليم ✓', fail: 'مشكلة ✗', skip: 'تم التخطي' };

  // sessionStorage: progress survives a refresh but resets when the tab closes
  // (so a new inspection never starts with old results).
  const STORE_KEY = 'phonecheck.session.v1';
  let state = { modules: {}, checks: {} };

  function load() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = { modules: parsed.modules || {}, checks: parsed.checks || {} };
      }
    } catch (_) { /* storage unavailable: keep in-memory state */ }
  }
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ======================================================
   * 2. Rendering
   * ==================================================== */
  let summaryShown = false;

  function setStatus(key, status) {
    state.modules[key] = status;
    save();
    render();
  }

  function render() {
    // Module badges
    $$('[data-badge]').forEach(b => {
      const s = state.modules[b.dataset.badge];
      b.textContent = STATUS_LABEL[s] || 'لم يُفحص';
      b.dataset.status = s || 'none';
    });

    // Checklist
    const boxes = $$('[data-check]');
    boxes.forEach(cb => {
      cb.checked = !!state.checks[cb.dataset.check];
      cb.closest('.check').classList.toggle('done', cb.checked);
    });

    // Overall progress = finished modules + ticked checklist items
    const total = MODULE_KEYS.length + boxes.length;
    const done = MODULE_KEYS.filter(k => state.modules[k]).length
               + boxes.filter(cb => cb.checked).length;
    const pct = Math.round((done / total) * 100);
    $('#bar-fill').style.width = pct + '%';
    $('#progress').setAttribute('aria-valuenow', String(pct));
    $('#pct').textContent = pct + '%';
    $('#count').textContent = done + ' / ' + total;

    renderSummary(pct);
  }

  function renderSummary(pct) {
    const box = $('#summary');
    if (pct < 100) { box.hidden = true; summaryShown = false; return; }

    const fails = MODULE_KEYS.filter(k => state.modules[k] === 'fail');
    const skips = MODULE_KEYS.filter(k => state.modules[k] === 'skip');
    const body = $('#summary-body');
    body.textContent = '';

    if (fails.length === 0) {
      box.dataset.verdict = 'good';
      body.append(
        h('strong', { text: '✅ الجهاز عدّى كل الفحوصات التقنية' }),
        h('p', { class: 'muted', text: 'راجع تاني رقم IMEI وحساب المالك قبل ما تدفع، واطلب فاتورة أو إيصال لو ممكن.' })
      );
    } else {
      box.dataset.verdict = 'bad';
      body.append(
        h('strong', { text: '⚠️ لقينا ' + fails.length + ' مشكلة في الفحص' }),
        h('ul', {}, fails.map(k => h('li', { text: MODULES[k].title }))),
        h('p', { class: 'muted', text: 'فاوض على السعر بناءً على المشاكل دي، أو اتجنب الشراء لو المشكلة جوهرية.' })
      );
    }
    if (skips.length) {
      body.append(h('p', { class: 'muted', text: 'فحوصات تم تخطيها (غير مدعومة): ' + skips.map(k => MODULES[k].title).join('، ') }));
    }

    box.hidden = false;
    if (!summaryShown) {
      summaryShown = true;
      setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    }
  }

  /* ======================================================
   * 3. Bottom sheet + result prompt
   * ==================================================== */
  const sheet = $('#sheet');
  const LEGAL_KEYS = ['privacy', 'terms', 'about'];
  let sheetCleanup = null;

  function teardownSheet() {
    if (sheetCleanup) { try { sheetCleanup(); } catch (_) { /* ignore */ } sheetCleanup = null; }
    sheet.hidden = true;
    $('#sheet-body').textContent = '';
    if (!overlayKey) document.body.classList.remove('no-scroll');
  }

  function openSheet(title, nodes, cleanup) {
    teardownSheet();
    $('#sheet-title').textContent = title;
    $('#sheet-body').append(...[].concat(nodes).filter(Boolean));
    sheetCleanup = cleanup || null;
    sheet.hidden = false;
    document.body.classList.add('no-scroll');
    $('.sheet-panel', sheet).scrollTop = 0;
    $('#sheet-close').focus();
  }

  function closeSheet() {
    if (sheet.hidden) return;
    teardownSheet();
    if (LEGAL_KEYS.includes(location.hash.slice(1))) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function resultButtons(key) {
    return h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ok', type: 'button', text: '✅ سليم', onclick: () => { setStatus(key, 'pass'); closeSheet(); } }),
      h('button', { class: 'btn btn-bad', type: 'button', text: '❌ فيه مشكلة', onclick: () => { setStatus(key, 'fail'); closeSheet(); } })
    );
  }

  function askResult(key, note) {
    openSheet(MODULES[key].title, [
      note ? h('p', { text: note }) : null,
      h('p', { text: 'إيه نتيجة الفحص؟' }),
      resultButtons(key)
    ]);
  }

  /* ======================================================
   * 4. Full-screen overlay tests
   * ==================================================== */
  const overlay = $('#overlay');
  let overlayKey = null;
  let overlayCtl = null;
  let fsEntered = false;

  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function requestFs() {
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return; // iOS Safari: the fixed overlay still covers the viewport
    try {
      const p = fn.call(el);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* ignore */ }
  }
  function leaveFs() {
    if (!fsElement()) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      const p = fn && fn.call(document);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* ignore */ }
  }

  function startOverlay(key, runner) {
    overlayKey = key;
    overlay.textContent = '';
    overlay.hidden = false;
    document.body.classList.add('no-scroll');
    overlayCtl = runner(overlay, endTest) || null;
    requestFs();
  }

  function closeOverlay() {
    if (overlayKey === null) return null;
    const key = overlayKey;
    overlayKey = null;
    fsEntered = false;
    if (overlayCtl && overlayCtl.cleanup) overlayCtl.cleanup();
    overlay.hidden = true;
    overlay.textContent = '';
    overlay.removeAttribute('style');
    document.body.classList.remove('no-scroll');
    leaveFs();
    return key;
  }

  /** end(autoStatus?) — autoStatus skips the result prompt (e.g. grid fully covered). */
  function endTest(autoStatus) {
    const note = overlayCtl && overlayCtl.note ? overlayCtl.note() : '';
    overlayCtl = overlayCtl; // keep reference until closeOverlay runs cleanup
    const key = closeOverlay();
    overlayCtl = null;
    if (!key) return;
    if (autoStatus) {
      setStatus(key, autoStatus);
      toast('✅ ' + MODULES[key].title + ': سليم');
    } else {
      askResult(key, note);
    }
  }

  // If the user leaves fullscreen with a system gesture, treat it as "finish".
  function onFsChange() {
    if (fsElement()) { fsEntered = true; return; }
    if (fsEntered && overlayKey) { fsEntered = false; endTest(); }
    else fsEntered = false;
  }

  function makeExit(end) {
    return h('button', {
      class: 'pill exit-btn', type: 'button', 'aria-label': 'إنهاء الفحص', text: '✕ إنهاء',
      onclick: (e) => { e.stopPropagation(); end(); }
    });
  }

  /* ---------- 4a. Dead pixel test ---------- */
  function runPixel(root, end) {
    const COLORS = [
      ['#000000', 'أسود'], ['#ffffff', 'أبيض'], ['#ff0000', 'أحمر'],
      ['#00ff00', 'أخضر'], ['#0000ff', 'أزرق']
    ];
    let i = 0;
    const seen = new Set([0]);
    let timer = 0;

    const label = h('span', { class: 'pill pill-fade' });
    const exit = makeExit(end);
    root.append(h('div', { class: 'hud' }, exit, label));

    function show(msg) {
      label.textContent = msg;
      label.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(() => label.classList.remove('show'), 1500);
    }

    function paint() {
      root.style.background = COLORS[i][0];
      show(COLORS[i][1] + ' (' + (i + 1) + '/' + COLORS.length + ')');
      if (seen.size === COLORS.length) {
        exit.classList.add('ready');
        exit.textContent = '✓ خلصت — إنهاء';
      }
    }

    const onTap = () => { i = (i + 1) % COLORS.length; seen.add(i); paint(); };
    root.addEventListener('click', onTap);

    root.style.background = COLORS[0][0];
    show('المس الشاشة لتغيير اللون — دوّر على نقط ميتة أو بقع أو خطوط');

    return {
      cleanup() { clearTimeout(timer); root.removeEventListener('click', onTap); },
      note: () => (seen.size < COLORS.length ? 'لم تُعرض كل الألوان الخمسة بعد.' : '')
    };
  }

  /* ---------- 4b. Touch dead-zone grid ---------- */
  function runGrid(root, end) {
    const W = window.innerWidth, H = window.innerHeight;
    const target = Math.max(44, Math.round(Math.min(W, H) / 7));
    const cols = Math.max(4, Math.round(W / target));
    const rows = Math.max(4, Math.round(H / target));

    const grid = h('div', { class: 'grid' });
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
    const cells = [];
    for (let n = 0; n < cols * rows; n++) {
      const c = h('div', { class: 'cell' });
      cells.push(c);
      grid.append(c);
    }

    const counter = h('span', { class: 'pill', text: '0%' });
    root.append(grid, h('div', { class: 'hud' }, makeExit(end), counter));

    let covered = 0;
    let finished = false;

    function mark(x, y) {
      const r = root.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const col = Math.min(cols - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * cols)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(((y - r.top) / r.height) * rows)));
      const cell = cells[row * cols + col];
      if (cell.classList.contains('on')) return;
      cell.classList.add('on');
      covered++;
      counter.textContent = Math.floor((covered / cells.length) * 100) + '%';
      if (covered === cells.length && !finished) { finished = true; complete(); }
    }

    // NOTE: we only use real pointer samples (coalesced events), never
    // interpolation — otherwise a dead zone would be "filled in" between
    // the last event before it and the first one after it.
    function handle(e) {
      const list = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents()) || [];
      (list.length ? list : [e]).forEach(p => mark(p.clientX, p.clientY));
    }
    const onDown = (e) => handle(e);
    const onMove = (e) => { if (e.pointerType === 'mouse' && e.buttons === 0) return; handle(e); };
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);

    function complete() {
      if (navigator.vibrate) { try { navigator.vibrate(120); } catch (_) { /* ignore */ } }
      root.append(h('div', { class: 'alert-box', role: 'alertdialog' },
        h('div', { class: 'emoji', text: '✅' }),
        h('strong', { text: 'ممتاز! الشاشة كلها استجابت' }),
        h('p', { text: 'تم تغطية 100% من الشبكة — مفيش مناطق لمس ميتة.' }),
        h('button', { class: 'btn btn-ok', type: 'button', text: 'إنهاء الفحص', onclick: () => end('pass') })
      ));
    }

    return {
      cleanup() {
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('pointermove', onMove);
      },
      note: () => 'تم تغطية ' + Math.floor((covered / cells.length) * 100) + '% من الشبكة. الأجزاء الرمادية = مناطق لم تستجب.'
    };
  }

  /* ---------- 4c. Multi-touch ---------- */
  function runMulti(root, end) {
    const pts = new Map();
    let max = 0;

    const countEl = h('div', { class: 'multi-count', text: '0' });
    const maxEl = h('span', { class: 'pill', text: 'الأقصى: 0' });
    root.append(
      h('div', { class: 'multi-center' }, countEl, h('p', { text: 'ضع أكبر عدد ممكن من الأصابع على الشاشة في نفس الوقت' })),
      h('div', { class: 'hud' }, makeExit(end), maxEl)
    );

    function sync() {
      countEl.textContent = String(pts.size);
      if (pts.size > max) { max = pts.size; maxEl.textContent = 'الأقصى: ' + max; }
    }
    const place = (d, e) => { d.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; };
    const fromExit = (e) => e.target && e.target.closest && e.target.closest('.exit-btn');

    const onDown = (e) => {
      if (fromExit(e) || pts.has(e.pointerId)) return;
      const d = h('div', { class: 'dot' });
      place(d, e);
      root.append(d);
      pts.set(e.pointerId, d);
      d.textContent = String(pts.size);
      sync();
    };
    const onMove = (e) => { const d = pts.get(e.pointerId); if (d) place(d, e); };
    const onUp = (e) => {
      const d = pts.get(e.pointerId);
      if (!d) return;
      d.remove();
      pts.delete(e.pointerId);
      sync();
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);

    return {
      cleanup() {
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerup', onUp);
        root.removeEventListener('pointercancel', onUp);
      },
      note: () => 'أقصى عدد لمسات متزامنة: ' + max + ' (الأجهزة الحديثة بتدعم 5 أو أكتر عادةً).'
    };
  }

  /* ======================================================
   * 5. Sheet-based tests
   * ==================================================== */

  /* ---------- 5a. Audio / speaker ---------- */
  function openAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;

    function getCtx() {
      if (!AC) return null;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    /** channel: 'left' | 'right' | undefined (both) */
    function play(btn, freq, level, channel) {
      const c = getCtx();
      if (!c) { toast('المتصفح لا يدعم Web Audio'); return; }
      const now = c.currentTime, dur = 1.4;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // soft attack/release to avoid clicks
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(level, now + 0.06);
      g.gain.setValueAtTime(level, now + dur - 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g);

      if (channel === 'left' || channel === 'right') {
        // Route the mono tone into only one input of a 2-channel merger.
        const merger = c.createChannelMerger(2);
        g.connect(merger, 0, channel === 'left' ? 0 : 1);
        merger.connect(c.destination);
      } else {
        g.connect(c.destination);
      }

      btn.classList.add('playing');
      osc.onended = () => { btn.classList.remove('playing'); osc.disconnect(); g.disconnect(); };
      osc.start(now);
      osc.stop(now + dur);
    }

    const tone = (label, sub, freq, level, channel) => {
      const b = h('button', { class: 'btn', type: 'button' }, label, h('small', { text: sub }));
      b.addEventListener('click', () => play(b, freq, level, channel));
      return b;
    };

    openSheet(MODULES.audio.title, [
      h('p', { text: 'ارفع الصوت لحوالي 60%، وتأكد إن الموبايل مش على الصامت (على الآيفون زر الصامت بيكتم الصوت).' }),
      h('div', { class: 'group-title', text: 'الترددات' }),
      h('div', { class: 'btn-row three' },
        tone('100Hz', 'باص منخفض', 100, 0.6),
        tone('1kHz', 'صوت بشري', 1000, 0.35),
        tone('10kHz', 'حاد', 10000, 0.2)
      ),
      h('div', { class: 'group-title', text: 'فصل الاستريو' }),
      h('div', { class: 'btn-row three' },
        tone('◀ يسار', 'القناة اليسرى', 440, 0.3, 'left'),
        tone('الاتنين', 'مركز', 440, 0.3),
        tone('يمين ▶', 'القناة اليمنى', 440, 0.3, 'right')
      ),
      h('p', { text: 'ملاحظات: السماعات الصغيرة بتضعف جداً عند 100Hz وده طبيعي. 10kHz قد لا يُسمع لبعض الكبار. بعض الموبايلات سماعتها مونو فاختبار يمين/يسار ممكن يطلع من نفس السماعة — جرّبه بسماعة أذن للتأكد.' }),
      h('p', { class: 'group-title', text: 'إيه رأيك في الصوت؟' }),
      resultButtons('audio')
    ], () => { if (ctx && ctx.close) { const p = ctx.close(); if (p && p.catch) p.catch(() => {}); } });
  }

  /* ---------- 5b. Microphone ---------- */
  function openMic() {
    let stream = null, actx = null, raf = 0, analyser = null, data = null, peak = 0;

    const canvas = h('canvas', { class: 'wave', 'aria-label': 'موجة الصوت' });
    const status = h('p', { text: 'اضغط «ابدأ» واسمح بالميكروفون، ثم اتكلم أو اضرب على الجهاز بخفة.' });
    const bar = h('i');
    const meter = h('div', { class: 'meter' }, bar);
    const startBtn = h('button', { class: 'btn btn-primary', type: 'button', text: '🎙️ ابدأ' });
    const g2d = canvas.getContext('2d');

    function sizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    }

    function draw() {
      raf = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      const w = canvas.width, hh = canvas.height;
      g2d.clearRect(0, 0, w, hh);
      g2d.strokeStyle = 'rgba(147,161,181,.35)';
      g2d.lineWidth = 1;
      g2d.beginPath(); g2d.moveTo(0, hh / 2); g2d.lineTo(w, hh / 2); g2d.stroke();

      g2d.strokeStyle = '#38bdf8';
      g2d.lineWidth = Math.max(2, (window.devicePixelRatio || 1) * 1.5);
      g2d.beginPath();
      let level = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        if (Math.abs(v) > level) level = Math.abs(v);
        const x = (i / (data.length - 1)) * w;
        const y = hh / 2 + v * (hh / 2) * 0.95;
        if (i === 0) g2d.moveTo(x, y); else g2d.lineTo(x, y);
      }
      g2d.stroke();

      bar.style.width = Math.min(100, Math.round(level * 160)) + '%';
      if (level > peak) peak = level;
      if (peak > 0.12) status.textContent = '✅ الميكروفون بيلتقط الصوت بشكل سليم.';
    }

    function stop() {
      cancelAnimationFrame(raf);
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (actx && actx.close) { const p = actx.close(); if (p && p.catch) p.catch(() => {}); }
      actx = null;
    }

    async function start() {
      if (stream) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        status.textContent = 'المتصفح لا يدعم الميكروفون، أو الصفحة مش مفتوحة عبر HTTPS.';
        return;
      }
      try {
        // Disable DSP so the waveform reflects the raw microphone.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
      } catch (err) {
        status.textContent = err && err.name === 'NotAllowedError'
          ? 'تم رفض إذن الميكروفون. فعّله من إعدادات المتصفح ثم جرّب تاني.'
          : 'تعذر تشغيل الميكروفون (' + (err && err.name ? err.name : 'خطأ') + ').';
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      data = new Uint8Array(analyser.fftSize);
      actx.createMediaStreamSource(stream).connect(analyser); // not connected to destination → no feedback
      sizeCanvas();
      peak = 0;
      status.textContent = 'بيسمع… اتكلم قريب من الميكروفون السفلي.';
      startBtn.textContent = '⏹ إيقاف';
      draw();
    }

    startBtn.addEventListener('click', () => {
      if (stream) { stop(); startBtn.textContent = '🎙️ ابدأ'; status.textContent = 'تم الإيقاف.'; }
      else start();
    });

    openSheet(MODULES.mic.title, [
      status, canvas, meter, startBtn,
      h('p', { text: 'الصوت بيتعالج لحظياً على جهازك ولا يتسجل ولا يتبعت لأي مكان. الميكروفون محتاج صفحة HTTPS.' }),
      h('p', { class: 'group-title', text: 'إيه نتيجة الفحص؟' }),
      resultButtons('mic')
    ], stop);
    sizeCanvas();
  }

  /* ---------- 5c. Vibration ---------- */
  function openVibe() {
    const supported = typeof navigator.vibrate === 'function';

    if (!supported) {
      openSheet(MODULES.vibe.title, [
        h('p', { text: 'المتصفح ده مش بيدعم الاهتزاز عبر الويب (آيفون وسفاري مش بيدعموه).' }),
        h('p', { text: 'افحص الاهتزاز يدوياً: الإعدادات ← الأصوات واللمس (اهتزاز) وجرّب نغمة رنين مع الاهتزاز.' }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', text: 'تخطي (غير مدعوم)', onclick: () => { setStatus('vibe', 'skip'); closeSheet(); } }),
          h('button', { class: 'btn btn-bad', type: 'button', text: '❌ فحصته يدوياً: مش شغال', onclick: () => { setStatus('vibe', 'fail'); closeSheet(); } })
        )
      ]);
      return;
    }

    openSheet(MODULES.vibe.title, [
      h('p', { text: 'هيهتز الجهاز: 200ms – وقفة 100ms – 200ms. تأكد إن الموبايل مش على وضع توفير الطاقة.' }),
      h('button', {
        class: 'btn btn-primary', type: 'button', text: '📳 جرّب الاهتزاز',
        onclick: () => { try { navigator.vibrate([200, 100, 200]); } catch (_) { toast('تعذر تشغيل الاهتزاز'); } }
      }),
      h('p', { class: 'group-title', text: 'حسّيت بالاهتزاز؟' }),
      resultButtons('vibe')
    ], () => { try { navigator.vibrate(0); } catch (_) { /* ignore */ } });
  }

  /* ---------- 5d. Gyroscope ---------- */
  function openGyro() {
    let running = false, fallback = false;
    const support = 'DeviceMotionEvent' in window || 'DeviceOrientationEvent' in window;
    const status = h('p', { class: 'sensor-status', text: 'اضغط «ابدأ» وحرّك الجهاز ببطء في كل الاتجاهات.' });
    const values = h('div', { class: 'sensor-grid' },
      h('div', {}, h('strong', { text: 'α' }), h('span', { text: '0°/s', id: 'gyro-alpha' })),
      h('div', {}, h('strong', { text: 'β' }), h('span', { text: '0°/s', id: 'gyro-beta' })),
      h('div', {}, h('strong', { text: 'γ' }), h('span', { text: '0°/s', id: 'gyro-gamma' }))
    );
    const startBtn = h('button', { class: 'btn btn-primary', type: 'button', text: '🧭 ابدأ الاختبار' });
    const setText = (a,b,c) => { $('#gyro-alpha').textContent=a; $('#gyro-beta').textContent=b; $('#gyro-gamma').textContent=c; };
    const onMotion = e => { const r=e.rotationRate; if(!r)return; setText((Number(r.alpha)||0).toFixed(1)+'°/s',(Number(r.beta)||0).toFixed(1)+'°/s',(Number(r.gamma)||0).toFixed(1)+'°/s'); };
    const onOrientation = e => { if(!fallback)return; setText((Number(e.alpha)||0).toFixed(0)+'°',(Number(e.beta)||0).toFixed(0)+'°',(Number(e.gamma)||0).toFixed(0)+'°'); };
    async function start(){
      if(!support){ status.textContent='الجهاز أو المتصفح لا يوفّر مستشعر الحركة عبر الويب.'; return; }
      try {
        if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){
          const permission=await DeviceMotionEvent.requestPermission();
          if(permission!=='granted'){ status.textContent='لم يتم السماح بالوصول إلى مستشعر الحركة.'; return; }
        }
        fallback=!('DeviceMotionEvent' in window);
        window.addEventListener('devicemotion',onMotion,true); window.addEventListener('deviceorientation',onOrientation,true);
        running=true; status.textContent=fallback?'وضع التوافق: حرّك الجهاز وشاهد زوايا الاتجاه α β γ.':'المستشعر يعمل — حرّك الجهاز ببطء وستتغير قيم السرعة الزاوية.'; startBtn.textContent='⏹ إيقاف الاختبار';
      } catch(_){ status.textContent='تعذر تشغيل مستشعر الحركة. تأكد من HTTPS ومنح الإذن.'; }
    }
    function stop(){ window.removeEventListener('devicemotion',onMotion,true); window.removeEventListener('deviceorientation',onOrientation,true); running=false; startBtn.textContent='🧭 ابدأ الاختبار'; }
    startBtn.addEventListener('click',()=>running?stop():start());
    openSheet(MODULES.gyro.title,[h('p',{text:'اختبار الجيروسكوب يقيس استجابة مستشعر الحركة. على بعض أجهزة iPhone قد يطلب Safari إذناً بعد الضغط على ابدأ.'}),values,status,startBtn,h('p',{class:'muted',text:'ملاحظة: بعض المتصفحات لا تعرض السرعة الزاوية الخام؛ في هذه الحالة نستخدم اتجاه الجهاز كاختبار توافق بديل.'}),h('p',{class:'group-title',text:'إيه نتيجة الفحص؟'}),resultButtons('gyro')],stop);
  }

  /* ---------- 5e. Refresh rate ---------- */
  function openRefresh() {
    let running=false, raf=0, start=0, last=0, samples=[];
    const value=h('div',{class:'refresh-value',text:'—'});
    const detail=h('p',{class:'sensor-status',text:'اضغط «ابدأ» لقياس معدل الإطارات الفعلي لمدة ثانيتين.'});
    const startBtn=h('button',{class:'btn btn-primary',type:'button',text:'📈 ابدأ القياس'});
    function frame(ts){
      if(!running)return; if(!start)start=ts; if(last){const dt=ts-last;if(dt>0&&dt<100)samples.push(1000/dt);} last=ts;
      if(ts-start>=2000){const sorted=samples.slice().sort((a,b)=>a-b),trim=sorted.length>20?sorted.slice(Math.floor(sorted.length*.1),Math.ceil(sorted.length*.9)):sorted;const avg=trim.length?trim.reduce((a,b)=>a+b,0)/trim.length:0;value.textContent=Math.round(avg*10)/10+' Hz';detail.textContent='تم القياس من requestAnimationFrame. النتيجة تقريبية وتتأثر بالأداء والحرارة ووضع توفير الطاقة.';running=false;startBtn.textContent='🔄 قياس مرة أخرى';return;} raf=requestAnimationFrame(frame);
    }
    function measure(){cancelAnimationFrame(raf);running=true;start=0;last=0;samples=[];value.textContent='…';detail.textContent='جارٍ القياس — لا تغلق الصفحة ولا تلمس الشاشة.';startBtn.textContent='⏱️ جارٍ القياس…';raf=requestAnimationFrame(frame);}
    startBtn.addEventListener('click',measure);
    openSheet(MODULES.refresh.title,[h('p',{text:'الاختبار يحسب عدد الإطارات التي يستطيع المتصفح رسمها في الثانية. قد ترى 60Hz أو 90Hz أو 120Hz أو رقماً قريباً منها.'}),value,detail,startBtn,h('p',{class:'group-title',text:'إيه نتيجة الفحص؟'}),resultButtons('refresh')],()=>{running=false;cancelAnimationFrame(raf);});
  }

  /* ---------- 5f. Camera ---------- */
  function openCamera() {
    let stream=null, facing='environment';
    const video=h('video',{class:'camera-preview',autoplay:'',playsinline:'',muted:'','aria-label':'معاينة الكاميرا'});
    const status=h('p',{class:'sensor-status',text:'اضغط «تشغيل الكاميرا» واسمح للمتصفح باستخدام الكاميرا.'});
    const startBtn=h('button',{class:'btn btn-primary',type:'button',text:'📷 تشغيل الكاميرا'});
    const switchBtn=h('button',{class:'btn',type:'button',text:'🔄 تبديل أمامية / خلفية',disabled:'disabled'});
    async function startCamera(){
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){status.textContent='المتصفح لا يدعم الكاميرا عبر الويب.';return;}
      try{if(stream)stream.getTracks().forEach(t=>t.stop());stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080}},audio:false});video.srcObject=stream;await video.play().catch(()=>{});switchBtn.disabled=false;startBtn.textContent='⏹ إيقاف الكاميرا';status.textContent=facing==='environment'?'الكاميرا الخلفية تعمل. جرّب التركيز والتفاصيل والضوء.':'الكاميرا الأمامية تعمل. جرّب التركيز والوجه والحواف.';}catch(err){status.textContent=err&&err.name==='NotAllowedError'?'تم رفض إذن الكاميرا. اسمح بالكاميرا من إعدادات المتصفح ثم جرّب مرة أخرى.':'تعذر تشغيل الكاميرا. تأكد أن الصفحة تعمل عبر HTTPS وأن الكاميرا غير مستخدمة في تطبيق آخر.';}}
    function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}video.srcObject=null;switchBtn.disabled=true;startBtn.textContent='📷 تشغيل الكاميرا';}
    startBtn.addEventListener('click',()=>stream?stopCamera():startCamera());switchBtn.addEventListener('click',()=>{facing=facing==='environment'?'user':'environment';startCamera();});
    openSheet(MODULES.camera.title,[h('p',{text:'اختبر الصورة الحية، التركيز، الألوان، البقع، والزوم/العدسات المتاحة على الجهاز. الكاميرا لا تُسجّل ولا تُرفع لأي خادم.'}),video,status,h('div',{class:'btn-row'},startBtn,switchBtn),h('p',{class:'group-title',text:'بعد تشغيل الكاميرا'}),h('ul',{},[h('li',{text:'وجّه الكاميرا لشيء قريب ثم بعيد وتأكد أن التركيز يتغير.'}),h('li',{text:'جرّب كل العدسات والزوم من تطبيق الكاميرا الأصلي أيضاً.'}),h('li',{text:'ابحث عن بقع ثابتة أو خطوط أو اهتزاز غير طبيعي في الصورة.'})]),h('p',{class:'group-title',text:'إيه نتيجة الفحص؟'}),resultButtons('camera')],stopCamera);
  }

  /* ======================================================
   * 6. Legal pages (needed for AdSense review)
   * ==================================================== */
  const LEGAL = {
    privacy: {
      title: 'Privacy Policy · سياسة الخصوصية',
      blocks: [
        ['p', 'PhoneCheck أداة تعمل بالكامل داخل متصفحك. نحن نحترم خصوصيتك ونوضح هنا ما يحدث (وما لا يحدث) لبياناتك.'],
        ['h', 'البيانات التي نجمعها'],
        ['p', 'لا نجمع ولا نخزّن ولا نرسل أي بيانات شخصية إلى خوادمنا. جميع الفحوصات تُنفَّذ محلياً على جهازك.'],
        ['h', 'الميكروفون'],
        ['p', 'يُطلب إذن الميكروفون فقط عند بدء «فحص الميكروفون». الصوت يُعالج لحظياً في ذاكرة المتصفح لرسم الموجة، ولا يُسجَّل ولا يُرسل، ويتوقف الوصول فور إغلاق الفحص.'],
        ['h', 'التخزين المحلي'],
        ['p', 'نستخدم sessionStorage لحفظ تقدّم الفحص أثناء الجلسة فقط، ويُمسح تلقائياً عند إغلاق التبويب. لا نستخدم ملفات تعريف الارتباط (Cookies) لتتبعك.'],
        ['h', 'الإعلانات والخدمات الخارجية'],
        ['p', 'قد يعرض الموقع إعلانات من أطراف خارجية مثل Google AdSense. قد تستخدم هذه الأطراف ملفات تعريف الارتباط لعرض إعلانات مبنية على زياراتك السابقة لهذا الموقع أو لمواقع أخرى. يمكنك إدارة إعلانات Google المخصّصة أو إيقافها من إعدادات الإعلانات في حسابك على Google.'],
        ['h', 'الأطفال'],
        ['p', 'الأداة غير موجّهة للأطفال دون 13 عاماً ولا نجمع منهم أي بيانات.'],
        ['h', 'التعديلات والتواصل'],
        ['p', 'قد نحدّث هذه السياسة من وقت لآخر، وسيظهر أحدث إصدار في هذه الصفحة. للاستفسار: [ضع بريد التواصل هنا].']
      ]
    },
    terms: {
      title: 'Terms of Use · شروط الاستخدام',
      blocks: [
        ['p', 'باستخدامك PhoneCheck فإنك توافق على الشروط التالية.'],
        ['h', 'طبيعة الخدمة'],
        ['p', 'الأداة مجانية وتقدّم فحوصات إرشادية بسيطة للأجهزة المستعملة. النتائج تعتمد على قدرات متصفحك وجهازك وقد لا تكشف كل العيوب.'],
        ['h', 'لا ضمان'],
        ['p', 'تُقدَّم الأداة «كما هي» دون أي ضمانات صريحة أو ضمنية. لا تغني عن فحص فني متخصص أو مراجعة الوثائق وحالة الجهاز القانونية.'],
        ['h', 'مسؤولية المستخدم'],
        ['p', 'قرار الشراء مسؤوليتك وحدك. لا نتحمل أي خسائر ناتجة عن الاعتماد على نتائج الأداة.'],
        ['h', 'الاستخدام المقبول'],
        ['p', 'يُمنع استخدام الأداة بشكل يضر بالآخرين أو يخالف القوانين المعمول بها.'],
        ['h', 'التعديل'],
        ['p', 'نحتفظ بحق تعديل الأداة أو هذه الشروط أو إيقافها في أي وقت.']
      ]
    },
    about: {
      title: 'About Tool · عن الأداة',
      blocks: [
        ['p', 'PhoneCheck (فاحص الأجهزة المستعملة) أداة ويب مجانية تساعد مشتري الموبايلات المستعملة على إجراء فحص سريع للأجهزة قبل الدفع.'],
        ['h', 'إزاي بتشتغل؟'],
        ['p', 'كل شيء يعمل محلياً داخل متصفحك بدون خادم أو تسجيل حساب. افتح الصفحة على الجهاز المراد فحصه وجرّب الفحوصات واحداً تلو الآخر.'],
        ['h', 'الفحوصات المتاحة'],
        ['ul', [
          'البكسلات الميتة بألوان كاملة الشاشة',
          'مناطق اللمس الميتة عبر شبكة تفاعلية',
          'اللمس المتعدد',
          'الصوت والسماعات (ترددات واستريو)',
          'الميكروفون بموجة صوتية حية',
          'الاهتزاز',
          'الجيروسكوب ومستشعر الحركة',
          'معدل تحديث الشاشة',
          'الكاميرا ومعاينة العدسات',
          'قائمة يدوية للبطارية وIMEI وحساب المالك والكاميرا والمنفذ والهيكل'
        ]],
        ['h', 'حدود الأداة'],
        ['p', 'المتصفحات لا تتيح قراءة رقم IMEI أو صحة البطارية مباشرة، لذلك نقدّم لها إرشادات يدوية. بعض الميزات (مثل الاهتزاز) غير مدعومة على آيفون.']
      ]
    }
  };

  function openLegal(kind) {
    const page = LEGAL[kind];
    if (!page) return;
    const nodes = page.blocks.map(([type, content]) => {
      if (type === 'h') return h('h3', { text: content });
      if (type === 'ul') return h('ul', {}, content.map(t => h('li', { text: t })));
      return h('p', { text: content });
    });
    openSheet(page.title, nodes);
  }

  /* ======================================================
   * 7. Init
   * ==================================================== */
  const RUNNERS = {
    pixel: () => startOverlay('pixel', runPixel),
    grid:  () => startOverlay('grid', runGrid),
    multi: () => startOverlay('multi', runMulti),
    audio: openAudio,
    mic:   openMic,
    vibe:  openVibe,
    gyro:  openGyro,
    refresh: openRefresh,
    camera: openCamera
  };

  function init() {
    load();
    $('#year').textContent = String(new Date().getFullYear());

    // Module cards
    $$('[data-test]').forEach(btn => {
      btn.addEventListener('click', () => {
        const run = RUNNERS[btn.dataset.test];
        if (run) run();
      });
    });

    // Checklist
    $$('[data-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        state.checks[cb.dataset.check] = cb.checked;
        save();
        render();
      });
    });

    // Reset
    $('#reset').addEventListener('click', () => {
      if (!window.confirm('هتمسح كل نتائج الفحص الحالية. متأكد؟')) return;
      state = { modules: {}, checks: {} };
      save();
      summaryShown = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Sheet close controls
    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet-backdrop').addEventListener('click', closeSheet);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (overlayKey) endTest(); else closeSheet();
    });

    // Fullscreen exit by system gesture
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    // Legal pages via footer links / hash
    $$('[data-legal]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        history.replaceState(null, '', '#' + a.dataset.legal);
        openLegal(a.dataset.legal);
      });
    });
    const fromHash = () => {
      const k = location.hash.slice(1);
      if (LEGAL_KEYS.includes(k)) openLegal(k);
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();

    render();

    // PWA: offline support (only on HTTPS or localhost)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
