// Japanese vocabulary cards. Plain JavaScript, no external services.
(function () {
  'use strict';

  const DATA_CACHE = 'kotoba-data';
  const $ = (id) => document.getElementById(id);

  let words = [];
  let index = 0;
  const audioById = new Map(); // id -> promise of an audio player
  const ready = new Map();     // id -> audio player that has finished loading
  let lastCheck = null;

  // ---------- small helpers ----------
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  function recall(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function audioType(url) {
    const ext = url.split('.').pop().toLowerCase();
    return { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' }[ext] || '';
  }

  // ---------- word list ----------
  async function loadWords() {
    try {
      const response = await fetch(self.WORDS_URL, { cache: 'no-store' });
      const data = await response.json();
      return Array.isArray(data.words) ? data.words : [];
    } catch (e) {
      const cached = window.caches ? await caches.match(self.WORDS_URL) : null;
      if (cached) return (await cached.json()).words || [];
      return [];
    }
  }

  // ---------- card ----------
  function show(i) {
    if (!words.length) return;
    index = (i + words.length) % words.length;
    const w = words[index];
    store('kotoba-last', w.id);

    $('card').hidden = false;
    $('card').style.animation = 'none';
    void $('card').offsetWidth;
    $('card').style.animation = '';

    const img = $('word-image');
    img.src = w.image;
    img.alt = w.english;
    $('picture').setAttribute('aria-label', 'Play pronunciation of ' + w.english);
    $('word-english').textContent = w.english;
    $('word-japanese').textContent = w.japanese;
    // Longer phrases get a smaller size so they fit on one or two lines.
    const len = (w.japanese || '').length;
    $('word-japanese').className = 'japanese' + (len > 8 ? ' japanese--sentence' : len > 4 ? ' japanese--long' : '');
    $('word-reading').className = 'reading' + (len > 4 ? ' reading--long' : '');
    $('word-reading').textContent = w.reading || '';
    $('word-romaji').textContent = w.romaji || '';
    $('word-note').textContent = w.note || '';
    $('word-note').hidden = !w.note;
    $('counter').textContent = (index + 1) + ' / ' + words.length;

    const single = words.length < 2;
    $('prev').disabled = single;
    $('next').disabled = single;

    prepareAudio(w);
    // Get the neighbours ready too, so the first tap on them is instant.
    if (!single) {
      prepareAudio(words[(index + 1) % words.length]);
      prepareAudio(words[(index - 1 + words.length) % words.length]);
    }
  }

  // ---------- audio ----------
  // The recording is read from the device's saved copy and handed to the
  // player as a local file, which is the most reliable way to play
  // audio offline on iPhone.
  function prepareAudio(w) {
    if (!w || !w.audio) return Promise.resolve(null);
    if (audioById.has(w.id)) return audioById.get(w.id);
    const promise = (async () => {
      let response = window.caches ? await caches.match(w.audio, { ignoreSearch: true }) : null;
      if (!response) response = await fetch(w.audio);
      if (!response.ok) throw new Error('missing');
      let blob = await response.blob();
      const type = audioType(w.audio);
      if (type && blob.type !== type) blob = new Blob([blob], { type: type });
      const player = new Audio();
      player.preload = 'auto';
      player.src = URL.createObjectURL(blob);
      player.load();
      ready.set(w.id, player);
      return player;
    })().catch(() => { audioById.delete(w.id); return null; });
    audioById.set(w.id, promise);
    return promise;
  }

  function play() {
    const w = words[index];
    if (!w) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}

    const start = (player) => {
      if (!player) { toast('Recording not available yet'); return; }
      player.pause();
      try { player.currentTime = 0; } catch (e) {}
      const pic = $('picture');
      pic.classList.add('playing');
      player.onended = player.onpause = () => pic.classList.remove('playing');
      const p = player.play();
      if (p && p.catch) p.catch(() => { pic.classList.remove('playing'); toast('Tap again to play'); });
    };

    // Play straight away inside the tap when the sound is already loaded
    // (iPhone only allows sound that starts directly from a tap).
    const loaded = ready.get(w.id);
    if (loaded) { start(loaded); return; }
    prepareAudio(w).then(start);
  }

  // ---------- browse ----------
  function renderList(filter) {
    const q = (filter || '').trim().toLowerCase();
    const list = $('word-list');
    list.innerHTML = '';
    let shown = 0;
    words.forEach((w, i) => {
      const hay = [w.english, w.japanese, w.reading, w.romaji, w.note].concat(w.tags || []).join(' ').toLowerCase();
      if (q && !hay.includes(q)) return;
      shown++;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      if (i === index) b.className = 'current';
      const img = document.createElement('img');
      img.src = w.image; img.alt = '';
      const text = document.createElement('div');
      const en = document.createElement('div'); en.className = 'wl-en'; en.textContent = w.english;
      const ja = document.createElement('div'); ja.className = 'wl-ja'; ja.lang = 'ja'; ja.textContent = w.japanese;
      const rd = document.createElement('div'); rd.className = 'wl-rd'; rd.textContent = [w.reading, w.romaji].filter(Boolean).join('  ·  ');
      text.append(en, ja, rd);
      b.append(img, text);
      b.addEventListener('click', () => { closeSheet('browser'); show(i); });
      li.append(b);
      list.append(li);
    });
    $('no-results').hidden = shown > 0;
  }

  function openSheet(id) { $(id).hidden = false; }
  function closeSheet(id) { $(id).hidden = true; }

  // ---------- offline readiness ----------
  function requiredFiles() {
    const media = [];
    words.forEach((w) => { if (w.image) media.push(w.image); if (w.audio) media.push(w.audio); });
    return {
      shell: self.APP_SHELL.slice(),
      data: [self.WORDS_URL].concat(media)
    };
  }

  function setStatus(kind, text) {
    const el = $('status');
    el.className = 'status status--' + kind;
    $('status-text').textContent = text;
  }

  async function saveIfMissing(cacheName, url) {
    if (await caches.match(url, { ignoreSearch: true })) return true;
    // App files are saved by the offline helper itself; only report them.
    if (!cacheName || !navigator.onLine) return false;
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) return false;
      const body = await response.blob();
      const cache = await caches.open(cacheName);
      await cache.put(url, new Response(body, { headers: response.headers }));
      return true;
    } catch (e) { return false; }
  }

  let checking = false;
  let retries = 0;
  let retryTimer = null;
  async function checkOffline() {
    if (!('serviceWorker' in navigator) || !window.caches) {
      setStatus('missing', 'Offline not supported');
      return;
    }
    if (checking) return;
    checking = true;
    clearTimeout(retryTimer);
    try {
      const files = requiredFiles();
      const all = files.shell.map((u) => [null, u]).concat(files.data.map((u) => [DATA_CACHE, u]));
      const results = [];
      let done = 0;
      if (!lastCheck) setStatus('checking', 'Checking…');
      for (const [cacheName, url] of all) {
        const ok = await saveIfMissing(cacheName, url);
        results.push({ url: url, ok: ok });
        done++;
        if (!ok || done < all.length) setStatus('saving', 'Saving ' + done + '/' + all.length);
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const workerReady = !!(reg && reg.active);
      const missing = results.filter((r) => !r.ok).length;
      const shellName = (await caches.keys()).filter((n) => n.startsWith('kotoba-shell-v')).sort().pop();
      const version = shellName ? shellName.replace('kotoba-shell-v', '') : '?';
      lastCheck = { results: results, workerReady: workerReady, at: new Date(), version: version };

      if (missing === 0 && workerReady) {
        setStatus('ready', 'Offline ready');
        retries = 0;
      } else if (!navigator.onLine) {
        setStatus('missing', 'Not saved yet');
      } else {
        setStatus('saving', missing ? 'Saving… ' + (all.length - missing) + '/' + all.length : 'Finishing…');
        // Still online but not finished: keep trying on our own for about two minutes.
        if (retries < 40) {
          retries++;
          // If the offline helper failed to install (weak signal), ask for it again.
          if (reg && !reg.installing && !reg.waiting && !reg.active) {
            try { await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); } catch (e) {}
          } else if (!reg) {
            try { await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); } catch (e) {}
          } else if (missing && reg.active && files.shell.some((u) => !results.find((r) => r.url === u).ok)) {
            try { await reg.update(); } catch (e) {}
          }
          retryTimer = setTimeout(checkOffline, 3000);
        }
      }
      if (!$('offline').hidden) renderOffline();
    } finally {
      checking = false;
    }
  }

  function renderOffline() {
    const list = $('file-list');
    list.innerHTML = '';
    if (!lastCheck) { $('offline-summary').textContent = 'Checking…'; return; }
    const saved = lastCheck.results.filter((r) => r.ok).length;
    const total = lastCheck.results.length;
    const allGood = saved === total && lastCheck.workerReady;
    const time = lastCheck.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('offline-summary').textContent = allGood
      ? 'All ' + total + ' files for ' + words.length + ' word' + (words.length === 1 ? '' : 's') + ' are saved on this device. The app will work in Airplane Mode. App version ' + lastCheck.version + ', checked at ' + time + '.'
      : saved + ' of ' + total + ' files saved. Connect to the internet, keep the app open for a moment, then tap Check again.' + (lastCheck.workerReady ? '' : ' (Offline helper still starting.)');
    lastCheck.results.forEach((r) => {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'name';
      name.textContent = r.url === './' ? 'App page' : r.url.replace('./', '');
      const mark = document.createElement('span'); mark.className = r.ok ? 'ok' : 'no';
      mark.textContent = r.ok ? 'Saved ✓' : 'Missing';
      li.append(name, mark);
      list.append(li);
    });
  }

  // ---------- start ----------
  async function start() {
    window.KOTOBA_STARTED = true;
    words = await loadWords();
    if (!words.length) {
      $('empty').hidden = false;
      $('empty').textContent = 'No words found yet. Open the app once while connected to the internet.';
    } else {
      const last = recall('kotoba-last');
      const at = words.findIndex((w) => w.id === last);
      show(at >= 0 ? at : 0);
    }

    $('picture').addEventListener('click', play);
    $('next').addEventListener('click', () => show(index + 1));
    $('prev').addEventListener('click', () => show(index - 1));
    $('browse').addEventListener('click', () => { $('search').value = ''; renderList(''); openSheet('browser'); });
    $('browser-close').addEventListener('click', () => closeSheet('browser'));
    $('search').addEventListener('input', (e) => renderList(e.target.value));
    $('status').addEventListener('click', () => { renderOffline(); openSheet('offline'); });
    $('offline-close').addEventListener('click', () => closeSheet('offline'));
    $('recheck').addEventListener('click', () => { $('offline-summary').textContent = 'Checking…'; retries = 0; checkOffline(); });

    // Swipe left or right on the card to change word.
    let x0 = null;
    $('card').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    $('card').addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 60 && words.length > 1) show(index + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('keydown', (e) => {
      if (!$('browser').hidden) return;
      if (e.key === 'ArrowRight') show(index + 1);
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === ' ') { e.preventDefault(); play(); }
    });

    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // A new version of the app was installed: reload once to use it.
        if (hadController && !reloading) { reloading = true; location.reload(); }
      });
      try {
        await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      } catch (e) { /* reported by the readiness check */ }
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) {}
      }
    }
    checkOffline();
    window.addEventListener('online', () => { retries = 0; checkOffline(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkOffline();
    });
  }

  start();
})();
