/* =========================================================
   Lume — leitor de PDF com visual de papel
   Seções: preferências · banco de dados · utilitários · aparência ·
           geometria · desenho · marcador · leitor · biblioteca · eventos
   ========================================================= */
(function () {
  'use strict';

  console.log('[Lume] script.js começou a executar em ' + Math.round(performance.now()) + ' ms');

  const native = window.Lume || window.folha || null;

  // Seleção de texto. O texto selecionável do PDF costuma ficar mais curto que o texto desenhado (letras espaçadas, justificado).
  //  'stretch' (padrão): estica cada trecho de texto até onde a tinta termina. O mouse e a barra de seleção usam a MESMA geometria.
  //  'off': usa o texto do PDF sem nenhum ajuste.
  //  'full': ajuste palavra por palavra pela imagem (mais preciso em teoria, mas pode pular palavras).
  // Para trocar, rode no console: localStorage.setItem('lume:calibrate','off') (ou 'full', ou removeItem para o padrão) e recarregue.
  const CAL = (function () {
    try { return localStorage.getItem('lume:calibrate') || 'true'; }
    catch (e) { return 'off'; }
  })();
  const CALIBRATE = CAL !== 'off', FULLCAL = CAL === 'full';

  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const app = $('#app'), wrap = $('#wrap'), stage = $('#stage'), docEl = $('#doc');
  const libraryEl = $('#library'), libBody = $('#libBody'), libTools = $('#libTools'), chipsEl = $('#chips'), searchIn = $('#q');
  const libLayout = $('#libLayout'), libSel = $('#libSel');
  const flashEl = $('#flash'), warmEl = $('#warmEl'), toastEl = $('#toast');
  const titleEl = $('#title'), fileIn = $('#file');
  const tocBtn = $('#tocBtn'), tocPanel = $('#tocPanel'), tocList = $('#tocList');
  const hlBtn = $('#hlBtn'), hlPanel = $('#hlPanel'), hlList = $('#hlList');
  const setBtn = $('#setBtn'), setPanel = $('#setPanel'), fsBtn = $('#fsBtn');
  const slider = $('#slider'), pageIn = $('#pageIn'), pageTotal = $('#pageTotal');
  const selBar = $('#selBar'), copyBtn = $('#copyBtn'), rmBtn = $('#rmBtn');
  const stTitle = $('#stTitle'), stPage = $('#stPage'), stPct = $('#stPct');
  const pbarFill = $('#pbarFill'), pcount = $('#pcount');
  const findBar = $('#findBar'), findIn = $('#findIn'), findCount = $('#findCount');
  const bmBtn = $('#bmBtn'), noteBtn = $('#noteBtn'), rulerWrap = $('#rulerWrap'), ruler = $('#ruler');
  const hlTabs = $('#hlTabs'), backupFile = $('#backupFile'), keysPanel = $('#keysPanel');

  const MODES = ['papel', 'sepia', 'eink', 'noite'];
  const MODE_LABEL = { papel: 'Papel', sepia: 'Sépia', eink: 'E-ink', noite: 'Noite' };
  const FITS = ['column', 'width', 'page'];
  const LAYOUTS = ['page', 'dual'];
  const COLORS = ['yellow', 'green', 'blue', 'pink'];
  const COLUMN_MAX = 860; // largura máxima (px) da "coluna" no monitor
  // Cores da área dos botões da janela (minimizar, maximizar, fechar) em cada tela.
  // São iguais ao --paper e à cor da tinta de cada tela (a barra de cima é lisa no desktop).
  const TITLEBAR = { papel: ['#f7f1e1', '#2a2620'], sepia: ['#ebdab2', '#3a2a14'], eink: ['#e4e4dd', '#161614'], noite: ['#1a1a1a', '#d6d2c8'] };
  // O brilho e a luz quente só escurecem o conteúdo do app. Os botões da janela são desenhados pelo
  // sistema, então a cor deles é calculada já com esse efeito para continuar igual à barra.
  function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  function rgbToHex(c) { return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
  function titleBarColors() {
    const base = TITLEBAR[S.mode], b = S.brightness / 100, a = S.warm / 100 * 0.45;
    const f = [1, 1 - a * (1 - 0x8a / 255), 1 - a * (1 - 0x2b / 255)]; // mesma conta do filtro "luz quente"
    return base.map((hex) => rgbToHex(hexToRgb(hex).map((v, i) => v * f[i] * b)));
  }
  function syncTitleBar() {
    const c = titleBarColors();
    window.__lumeBar = { color: c[0], symbolColor: c[1] };   // o main.js também lê isto, caso o aviso pelo preload não chegue
    if (!native || !native.setTitleBar) return;
    native.setTitleBar(c[0], c[1]);
  }
  const DEFAULTS = { mode: null, layout: 'page', scroll: false, brightness: 100, warm: 0, ink: 50, fit: 'column', zoom: 1, crop: false, levels: 16, dither: false, color: false, flashEvery: 1, categories: [], autoSpeed: 4, coverAlone: true, ruler: false, rulerH: 90, goalMin: 20, lang: null, collapsed: [] };
  const S = Object.assign({}, DEFAULTS);
  let firstRun = false;   // true quando ainda não há idioma salvo: mostra a tela de escolha
  const setupEl = $('#setup');

  /* =======================================================
     Idiomas: português, inglês e espanhol.
     Os textos em português são as chaves; as traduções ficam em i18n.js.
     ======================================================= */
  const LANGS = ['pt', 'en', 'es'];
  const LOCALE = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
  const DICT = window.LUME_I18N || {};
  const detectLang = () => {
    const l = String((navigator.languages && navigator.languages[0]) || navigator.language || 'pt').slice(0, 2).toLowerCase();
    return LANGS.includes(l) ? l : 'en';
  };
  // tr('texto em português', { n: 3 }): devolve o texto no idioma escolhido, trocando {n} pelo valor
  function tr(k, v) {
    let s = (S.lang !== 'pt' && DICT[S.lang] && DICT[S.lang][k] !== undefined) ? DICT[S.lang][k] : k;
    if (v) for (const n in v) s = s.split('{' + n + '}').join(v[n]);
    return s;
  }
  const loc = () => LOCALE[S.lang] || 'pt-BR';                  // formato de datas e ordem alfabética
  let sortMenu, levelsMenu, flashMenu, langMenu, webMenu, zoomMenu;
  let booted = false;   // só redesenha a biblioteca ao trocar de idioma depois que o app terminou de iniciar
  // Áreas que o script monta sozinho: não passam pela tradução automática da tela
  const I18N_SKIP = '#setup, #libBody, #hlList, #tocList, #doc, #chips, #sortMenu, #levelsMenu, #flashMenu, #langMenu, #webMenu, #zoomMenu, #keysBody, #toast, #libSel';

  // Traduz os textos fixos do index.html (e dicas, rótulos e campos de busca), guardando o original em português
  function translateDom() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const pe = n.parentElement;
        return pe && n.data.trim() && !pe.closest(I18N_SKIP + ', script, style') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.__k === undefined) n.__k = n.data.trim();
      const m = /^(\s*)[\s\S]*?(\s*)$/.exec(n.data);
      n.data = m[1] + tr(n.__k) + m[2];
    }
    document.querySelectorAll('[placeholder], [title], [aria-label]').forEach((node) => {
      if (node.closest(I18N_SKIP)) return;
      node.__a = node.__a || {};
      ['placeholder', 'title', 'aria-label'].forEach((a) => {
        if (!node.hasAttribute(a)) return;
        if (node.__a[a] === undefined) node.__a[a] = node.getAttribute(a);
        node.setAttribute(a, tr(node.__a[a]));
      });
    });
  }

  // Lista de atalhos: os trechos entre [colchetes] viram teclas
  const KEYS = [
    ['Virar e mover a página', [
      ['[←] [→]', 'Página anterior e próxima'],
      ['[Espaço]', 'Rola uma tela para baixo (com [Shift], para cima)'],
      ['[↑] [↓]', 'Rolam um pouco'],
      ['[Home] [End]', 'Primeira e última página'],
      ['[Ctrl] + [G]', 'Ir para uma página (digite o número e aperte Enter)'],
      ['[Shift] + [←] [→]', 'Movem a página para os lados quando ela está ampliada']]],
    ['Zoom', [
      ['[Ctrl] + [+]', 'Aumenta o zoom'],
      ['[Ctrl] + [−]', 'Diminui o zoom (afasta a página)'],
      ['[Ctrl] + [0]', 'Volta para 100%'],
      ['[Ctrl] + roda do mouse', 'Aumenta ou diminui o zoom'],
      ['[+] [−] [0]', 'Fazem o mesmo, sem o Ctrl']]],
    ['Tela e leitura', [
      ['[M]', 'Troca a tela: papel, sépia, e-ink e noite'],
      ['[H]', 'Esconde ou mostra os controles'],
      ['[F11]', 'Tela cheia'],
      ['[A]', 'Liga e pausa a rolagem automática'],
      ['[R]', 'Liga e desliga a régua de leitura'],
      ['[B]', 'Favorita ou desfavorita a página']]],
    ['Texto, marcações e busca', [
      ['Selecionar um trecho', 'Aparece a barra de cores; [1] [2] [3] [4] marcam com amarelo, verde, azul e rosa'],
      ['Duplo clique, triplo clique', 'Selecionam a palavra e a linha'],
      ['Tocar numa marcação', 'Muda a cor, copia, remove ou adiciona uma nota'],
      ['[Ctrl] + [F]', 'Busca no texto do PDF'],
      ['[Enter] ou [F3]', 'Próximo resultado (com [Shift], o anterior)'],
      ['[Esc]', 'Fecha a busca, os painéis e os menus']]],
    ['Mouse e toque', [
      ['Clicar ou tocar na lateral esquerda', 'Volta uma página'],
      ['Clicar ou tocar no resto da tela', 'Avança (no mouse, só nas margens vazias, fora do texto)'],
      ['Faixa de cima da página', 'Mostra ou esconde as barras'],
      ['Deslizar o dedo para o lado', 'Muda de página']]],
    ['Biblioteca', [
      ['[O]', 'Adiciona um PDF'],
      ['[/] ou [Ctrl] + [F]', 'Busca livros pelo nome'],
      ['[?] ou [F1]', 'Abre esta lista']]]
  ];
  const kbdHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
  function renderKeys() {
    const body = $('#keysBody');
    body.textContent = '';
    for (const sec of KEYS) {
      body.append(el('h3', { text: tr(sec[0]) }));
      const dl = el('dl');
      for (const row of sec[1]) {
        const dt = el('dt'), dd = el('dd');
        dt.innerHTML = kbdHtml(tr(row[0]));
        dd.innerHTML = kbdHtml(tr(row[1]));
        dl.append(dt, dd);
      }
      body.append(dl);
    }
  }

  // Menus suspensos com textos traduzidos (recriados quando o idioma muda)
  function buildMenus() {
    closeMenu();
    ['sortMenu', 'levelsMenu', 'flashMenu', 'langMenu', 'webMenu', 'zoomMenu'].forEach((id) => { $('#' + id).textContent = ''; });
    sortMenu = lumeMenu({
      options: [{ value: 'recent', label: tr('Mais recentes') }, { value: 'title', label: tr('Título (A–Z)') }, { value: 'progress', label: tr('Progresso') }],
      value: libSort, label: tr('Ordenar a biblioteca'), cls: 'sort', onChange: (v) => { libSort = v; renderBody(); }
    });
    $('#sortMenu').append(sortMenu.el);
    levelsMenu = lumeMenu({
      options: [{ value: 2, label: tr('2 (contraste máximo)') }, { value: 4, label: '4' }, { value: 8, label: '8' }, { value: 16, label: '16' }],
      value: S.levels, label: tr('Tons de cinza'),
      onChange: (v) => { S.levels = v; saveSettings(); if (S.mode === 'eink') render(); }
    });
    $('#levelsMenu').append(levelsMenu.el);
    flashMenu = lumeMenu({
      options: [
        { value: 1, label: tr('A cada página') },
        { value: 3, label: tr('A cada {n} páginas', { n: 3 }) },
        { value: 6, label: tr('A cada {n} páginas', { n: 6 }) },
        { value: 10, label: tr('A cada {n} páginas', { n: 10 }) },
        { value: 0, label: tr('Nunca') }
      ],
      value: S.flashEvery, label: tr('Atualização completa da tela'),
      onChange: (v) => { S.flashEvery = v; saveSettings(); }
    });
    $('#flashMenu').append(flashMenu.el);
    langMenu = lumeMenu({
      options: [{ value: 'pt', label: 'Português' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Español' }],
      value: S.lang, label: tr('Idioma'),
      onChange: (v) => { S.lang = v; saveSettings(); applyLang(); }
    });
    $('#langMenu').append(langMenu.el);
    zoomMenu = lumeMenu({
      options: [400, 300, 200, 150, 125, 100, 75, 50].map((z) => ({ value: z, label: z + '%' })),
      value: Math.round(S.zoom * 100), label: tr('Zoom'), cls: 'zoom',
      onChange: (v) => setZoom(v / 100)
    });
    $('#zoomMenu').append(zoomMenu.el);
    // Pesquisar o trecho selecionado (Google, Google Acadêmico, Wikipédia, tradutores)
    webMenu = lumeMenu({
      options: [
        { value: '__ph', label: tr('Pesquisar…') },
        { value: 'google', label: tr('Pesquisar no Google') },
        { value: 'scholar', label: tr('Pesquisar no Google Acadêmico') },
        { value: 'wiki', label: tr('Pesquisar na Wikipédia') },
        { value: 'gtrans', label: tr('Traduzir com o Google') },
        { value: 'deepl', label: tr('Traduzir com o DeepL') }
      ],
      value: '__ph', label: tr('Pesquisar o trecho selecionado'), cls: 'web',
      onChange: (v) => { webMenu.set('__ph'); if (v !== '__ph') webSearch(v); }
    });
    $('#webMenu').append(webMenu.el);
  }

  // Aplica o idioma em tudo: textos fixos, menus, atalhos, botões, painéis e biblioteca
  function applyLang() {
    root.lang = loc();
    document.title = tr('Lume');
    translateDom();
    buildMenus();
    renderKeys();
    applyView();
    updateAutoUI(); updateHlBtn(); updateBmBtn();
    hideBar();
    if (pdf) { renderHlPanel(); updateUI(); }
    if (booted) renderLibrary();
  }

  /* =======================================================
     Preferências (ficam neste computador)
     ======================================================= */
  function loadSettings() {
    try {
      const raw = localStorage.getItem('folha:settings');
      if (raw) {
        const o = JSON.parse(raw);
        for (const k in o) if (k in S) S[k] = o[k];
        if (o.flash === false && !('flashEvery' in o)) S.flashEvery = 0; // preferência antiga: sem piscar
      }
    } catch (e) { /* sem armazenamento: segue com o padrão */ }
    if (!MODES.includes(S.mode)) {
      S.mode = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'noite' : 'papel';
    }
    if (!FITS.includes(S.fit)) S.fit = 'column';
    if (S.layout === 'scroll') { S.layout = 'page'; S.scroll = true; }   // ajuste antigo
    S.scroll = !!S.scroll;
    if (!LAYOUTS.includes(S.layout)) S.layout = 'page';
    if (!Array.isArray(S.categories)) S.categories = [];
    if (!Array.isArray(S.collapsed)) S.collapsed = [];
    S.zoom = Math.min(4, Math.max(0.5, Number(S.zoom) || 1));
    S.autoSpeed = Math.min(10, Math.max(1, Math.round(Number(S.autoSpeed) || 4)));
    S.flashEvery = [0, 1, 3, 6, 10].includes(Number(S.flashEvery)) ? Number(S.flashEvery) : 1;
    S.levels = [2, 4, 8, 16].includes(Number(S.levels)) ? Number(S.levels) : 16;
    S.coverAlone = S.coverAlone !== false;
    S.ruler = !!S.ruler;
    S.color = !!S.color;
    S.rulerH = clamp(Math.round(Number(S.rulerH) || 90), 40, 240);
    S.ink = clamp(Math.round(Number.isFinite(Number(S.ink)) ? Number(S.ink) : 50), 0, 100);
    S.goalMin = clamp(Math.round(Number(S.goalMin) || 20), 5, 120);
    firstRun = !LANGS.includes(S.lang);       // nunca escolheu: vai mostrar a tela de idioma
    if (firstRun) S.lang = detectLang();      // enquanto isso, usa o idioma do sistema
  }
  function saveSettings() { try { localStorage.setItem('folha:settings', JSON.stringify(S)); } catch (e) {} }

  /* =======================================================
     Banco de dados (IndexedDB): metadados + arquivos
     ======================================================= */
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((res, rej) => {
        if (!window.indexedDB) { dbPromise = null; rej(new Error('IndexedDB indisponível')); return; }
        // nome interno mantido (era o nome antigo do app) para não perder a biblioteca já salva.
        // Versão 2: cria só os stores que faltam (conserta um banco que ficou pela metade).
        const r = indexedDB.open('folha', 2);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('books')) r.result.createObjectStore('books', { keyPath: 'id' });
          if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files', { keyPath: 'id' });
        };
        r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
        r.onerror = () => { dbPromise = null; console.error('IndexedDB erro:', r.error); rej(r.error); };
        r.onblocked = () => { dbPromise = null; console.error('IndexedDB bloqueado'); rej(new Error('Banco bloqueado')); };
      });
    }
    return dbPromise;
  }
  function run(stores, mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      const list = [].concat(stores).map((n) => t.objectStore(n));
      let req;
      try { req = fn(...list); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Operação cancelada'));
    }));
  }
  const listBooks = () => run('books', 'readonly', (s) => s.getAll());
  const getBook = (id) => run('books', 'readonly', (s) => s.get(id));
  const putBook = (rec) => run('books', 'readwrite', (s) => s.put(rec));
  const putFile = (id, blob) => run('files', 'readwrite', (s) => s.put({ id, blob }));
  const getFile = (id) => run('files', 'readonly', (s) => s.get(id));
  const deleteBook = (id) => run(['books', 'files'], 'readwrite', (b, f) => { b.delete(id); return f.delete(id); });

  /* =======================================================
     Utilitários
     ======================================================= */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) { if (c != null && c !== false) n.append(c); }
    return n;
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const isPdf = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const nameOf = (f) => f.name.replace(/\.pdf$/i, '');
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const short = (str, n) => (str.length > n ? str.slice(0, n - 1).trimEnd() + '…' : str);

  function relTime(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return tr('agora');
    const m = s / 60; if (m < 60) return tr('há {n} min', { n: Math.floor(m) });
    const h = m / 60; if (h < 24) return tr('há {n} h', { n: Math.floor(h) });
    const d = Math.floor(h / 24); if (d === 1) return tr('ontem');
    if (d < 30) return tr('há {n} dias', { n: d });
    return new Date(ts).toLocaleDateString(loc());
  }
  const progress = (b) => (b.total > 1 ? Math.round((b.page - 1) / (b.total - 1) * 100) : 0);

  let toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(hideToast, ms || 2800);
  }
  function hideToast() { toastEl.hidden = true; }

  /* =======================================================
     Estado
     ======================================================= */
  let pdf = null, current = null, pageNum = 1, total = 0, cropBox, sizes = null;
  let token = 0;
  let pagePg = null;                    // modo página a página: a única página na tela
  let pagePg2 = null;                   // modo duas páginas: a página da direita
  let pgs = [], tops = [], io = null;   // modo rolagem: todas as páginas, posições e observador
  let pre = null, preTimer = 0;         // próxima página já desenhada em segundo plano
  const reading = () => root.dataset.view === 'reader' && !!pdf;
  const activePgs = () => (S.scroll ? pgs.filter((p) => p.state === 3) : [pagePg, pagePg2].filter((p) => p && p.base));

  /* =======================================================
     Aparência
     ======================================================= */
  function applyView() {
    root.dataset.mode = S.mode;
    app.style.filter = S.brightness < 100 ? 'brightness(' + (S.brightness / 100) + ')' : '';
    warmEl.style.opacity = String(S.warm / 100 * 0.45);
    syncTitleBar();
    document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    document.querySelectorAll('#fitSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fit === S.fit)));
    document.querySelectorAll('#layoutSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === S.layout)));
    $('#bright').value = S.brightness;
    $('#warm').value = S.warm;
    $('#ink').value = S.ink;
    $('#inkVal').textContent = S.ink + '%';
    $('#crop').checked = !!S.crop;
    levelsMenu.set(Number(S.levels));
    $('#dither').checked = !!S.dither;
    $('#color').checked = !!S.color;
    root.dataset.color = S.color ? 'on' : 'off';
    flashMenu.set(Number(S.flashEvery));
    $('#einkGroup').hidden = S.mode !== 'eink';
    zoomMenu.set(Math.round(S.zoom * 100), Math.round(S.zoom * 100) + '%');
    $('#autoSpeed').value = S.autoSpeed;
    $('#autoSpeedVal').textContent = S.autoSpeed + '/10';
    $('#brightVal').textContent = S.brightness + '%';
    $('#warmVal').textContent = S.warm + '%';
    root.dataset.layout = S.layout;
    root.dataset.scroll = S.scroll ? 'on' : 'off';
    $('#scrollMode').checked = !!S.scroll;
    $('#coverAlone').checked = !!S.coverAlone;
    $('#coverRow').hidden = S.layout !== 'dual';
    $('#rulerH').value = S.rulerH; $('#rulerHVal').textContent = S.rulerH + ' px';
    $('#goal').value = S.goalMin; $('#goalVal').textContent = S.goalMin + ' min';
    applyRuler();
  }
  function setMode(m) {
    if (!MODES.includes(m) || m === S.mode) return;
    S.mode = m; applyView(); saveSettings();
    if (pdf) render();
  }
  const cycleMode = () => setMode(MODES[(MODES.indexOf(S.mode) + 1) % MODES.length]);
  function setZoom(z) {
    S.zoom = clamp(Math.round(z * 100) / 100, 0.5, 4);
    applyView(); saveSettings(); saveBookView(); render();
  }
  function setLayout(l) {
    if (!LAYOUTS.includes(l) || l === S.layout) return;
    S.layout = l; applyView(); saveSettings();
    if (!pdf) return;
    if (S.scroll) buildScroll({ n: pageNum, ratio: 0, top: true });
    else buildPageView().then(() => { stage.scrollTop = 0; centerX(); updateUI(); });
  }
  function setScroll(on) {
    on = !!on;
    if (on === S.scroll) return;
    S.scroll = on; applyView(); saveSettings();
    if (!pdf) return;
    if (on) buildScroll({ n: pageNum, ratio: 0, top: true });
    else buildPageView().then(() => { stage.scrollTop = 0; centerX(); updateUI(); });
  }

  /* Papel, sépia e noite: a cor da página é aplicada no canvas, igual à cor do fundo (sem filtros na tela) */
  const PAGE_FILTER = { papel: 'contrast(.95) brightness(1.06)', sepia: 'contrast(.94) brightness(1.07)', noite: 'invert(.9) hue-rotate(180deg)' };
  function paintToCanvas(cv, buf) {
    const c = cv.getContext('2d');
    const f = PAGE_FILTER[S.mode];
    if (f) c.filter = f;
    c.drawImage(buf, 0, 0);
    c.filter = 'none';
    if (S.mode === 'papel' || S.mode === 'sepia') { // o branco do PDF vira exatamente a cor do papel
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = getComputedStyle(root).getPropertyValue('--paper').trim();
      c.fillRect(0, 0, cv.width, cv.height);
      c.globalCompositeOperation = 'source-over';
    }
  }

  /* Texto mais escuro: escurece os pixels de tinta mantendo o tom (gama sobre a luminosidade).
     O fundo branco não muda; o dourado vira dourado escuro, em vez de um marrom apagado. */
  function boostInk(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const gamma = 1 + S.ink / 100 * 1.4;                 // 1 (nada) até 2,4 (forte)
    const lut = new Float32Array(256);
    for (let g = 1; g < 256; g++) lut[g] = Math.pow(g / 255, gamma) * 255 / g;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      if (g === 0 || g > 245) continue;
      const f = lut[g];
      d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* E-ink: tons de cinza limitados, tinta sobre papel cinza-claro (#e4e4dd) */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function applyEink(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const lv = Number(S.levels) || 16, step = 255 / (lv - 1);
    const amp = (S.dither && lv > 2) ? step * 0.9 : 0;
    const P = [228, 228, 221], I = [26, 26, 27];
    const color = !!S.color, SAT = 0.7;   // SAT: força das cores no modo Colorsoft (0 = cinza, 1 = cor cheia)
    for (let y = 0; y < h; y++) {
      const row = (y & 3) * 4;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i], gr = d[i + 1], b = d[i + 2];
        const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
        let g = (lum - 128) * 1.12 + 128;
        if (amp) g += ((BAYER[row + (x & 3)] + 0.5) / 16 - 0.5) * amp;
        g = Math.round(g / step) * step;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        const t = g / 255;
        let R = I[0] + (P[0] - I[0]) * t, G = I[1] + (P[1] - I[1]) * t, B = I[2] + (P[2] - I[2]) * t;
        if (color) {   // devolve a cor original, mais suave; preto e branco ficam como estavam
          const k = SAT * (0.6 + 0.4 * t);
          R += (r - lum) * k; G += (gr - lum) * k; B += (b - lum) * k;
        }
        d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }


  /* =======================================================
     Capa e corte automático de margens
     ======================================================= */
  async function makeCover(doc) {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 360 / base.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c.toDataURL('image/jpeg', 0.82);
  }

  async function computeCrop() {
    const n = total, count = Math.min(n, 10), pages = [];
    for (let i = 0; i < count; i++) pages.push(count === 1 ? 1 : Math.round(1 + i * (n - 1) / (count - 1)));
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, found = false;
    for (const p of pages) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 450 / base.width });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
      const cx = c.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: cx, viewport: vp }).promise;
      const w = c.width, h = c.height, d = cx.getImageData(0, 0, w, h).data;
      let mnx = w, mny = h, mxx = -1, mxy = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i] + d[i + 1] + d[i + 2] < 645) {
            if (x < mnx) mnx = x; if (x > mxx) mxx = x;
            if (y < mny) mny = y; if (y > mxy) mxy = y;
          }
        }
      }
      if (mxx >= 0) {
        found = true;
        x0 = Math.min(x0, mnx / w); x1 = Math.max(x1, (mxx + 1) / w);
        y0 = Math.min(y0, mny / h); y1 = Math.max(y1, (mxy + 1) / h);
      }
    }
    if (!found) return null;
    const pad = 0.015;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(1, x1 + pad); y1 = Math.min(1, y1 + pad);
    if ((x1 - x0) < 0.3 || (y1 - y0) < 0.3) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  async function ensureCrop() {
    if (S.crop && cropBox === undefined) {
      toast(tr('Calculando margens…'), 0);
      try { cropBox = await computeCrop(); } catch (e) { cropBox = null; }
      hideToast();
    }
  }

  /* =======================================================
     Geometria: tamanho de cada página na tela
     ======================================================= */
  function stageGeom() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { availW: stage.clientWidth - padX, availH: stage.clientHeight - padY, padTop: parseFloat(cs.paddingTop) };
  }
  function boxFor(base) {
    if (S.crop && cropBox) return { x: cropBox.x * base.w, y: cropBox.y * base.h, w: cropBox.w * base.w, h: cropBox.h * base.h };
    return { x: 0, y: 0, w: base.w, h: base.h };
  }
  function cssFor(box, g) {
    let fit;
    if (S.fit === 'page' && !S.scroll) fit = Math.min(g.availW / box.w, g.availH / box.h);
    else if (S.fit === 'width') fit = g.availW / box.w;
    else fit = Math.min(g.availW, COLUMN_MAX) / box.w;
    return Math.max(0.05, fit * S.zoom);
  }
  async function ensureSizes() {
    if (sizes) return;
    const list = new Array(total);
    for (let n = 1; n <= total; n++) {
      const pg = await pdf.getPage(n);
      const vp = pg.getViewport({ scale: 1 });
      list[n - 1] = { w: vp.width, h: vp.height };
      if (n % 25 === 0) await new Promise((r) => setTimeout(r));
    }
    sizes = list;
  }

  /* =======================================================
     Desenho de uma página: imagem + texto selecionável + marcações
     ======================================================= */
  function makePg(n) {
    const elp = el('div', { class: 'pg' });
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    canvas.getContext('2d', { willReadFrequently: true });   // a seleção lê pixels o tempo todo; sem isso o navegador avisa e fica lento
    const hl = el('div', { class: 'hl' });
    const sel = el('div', { class: 'sel' });
    const fm = el('div', { class: 'fm' });
    const text = el('div', { class: 'textLayer' });
    elp.append(canvas, hl, fm, sel, text);
    return { el: elp, canvas, hl, fm, sel, text, n, base: null, box: null, css: 1, state: 0, task: null, snap: null, ready: false };
  }
  function releasePg(p) {
    if (p.task) { try { p.task.cancel(); } catch (e) {} p.task = null; }
    p.state = 0;
    if (p.canvas.width > 1) { p.canvas.width = 1; p.canvas.height = 1; }
    p.text.textContent = ''; p.hl.textContent = ''; p.fm.textContent = ''; p.sel.textContent = ''; p.snap = null; p.runs = null; p.ready = false;
  }

  async function buildText(p, page) {
    const vp = page.getViewport({ scale: p.css, offsetX: -p.box.x * p.css, offsetY: -p.box.y * p.css });
    const tc = await page.getTextContent();
    const holder = document.createElement('div');
    // O PDF.js 3.x calcula o font-size dos trechos com var(--scale-factor): sem isso o tamanho fica fixo em qualquer zoom.
    holder.style.setProperty('--scale-factor', String(p.css));
    p.text.style.setProperty('--scale-factor', String(p.css));
    // As posições em % do PDF.js valem para a página inteira: com margens cortadas, a camada tem o tamanho da página toda, deslocada.
    Object.assign(p.text.style, {
      inset: 'auto',
      left: (-p.box.x * p.css) + 'px',
      top: (-p.box.y * p.css) + 'px',
      width: (p.base.w * p.css) + 'px',
      height: (p.base.h * p.css) + 'px'
    });
    await pdfjsLib.renderTextLayer({ textContentSource: tc, container: holder, viewport: vp, textDivs: [] }).promise;
    p.text.replaceChildren(...holder.childNodes);
  }

  /* O texto selecionável do PDF.js nunca tem as mesmas medidas do texto desenhado (fonte diferente, texto justificado).
     Aqui cada linha é medida na imagem da página: se as palavras da imagem batem com as palavras do texto, cada palavra
     vira um trecho próprio, colocado e esticado exatamente sobre a palavra desenhada. Assim a seleção acompanha o
     mouse letra por letra, sem acumular erro ao longo da linha. Se não bater, a linha só é esticada até o fim.
     As chaves do cache usam coordenadas relativas à página (não à tela): assim continuam válidas depois de rolar. */
  function wordsFor(p, pr, top, bottom, em) {
    const key = 'w' + Math.round(top - pr.top) + '|' + Math.round(bottom - pr.top) + '|' + Math.round(em);
    if (!p.runs) p.runs = new Map();
    if (p.runs.has(key)) return p.runs.get(key);
    const cv = p.canvas, cw = cv.width, ch = cv.height, kx = cw / pr.width, ky = ch / pr.height;
    const y0 = clamp(Math.floor((top - pr.top) * ky), 0, ch - 1), y1 = clamp(Math.ceil((bottom - pr.top) * ky), y0 + 1, ch);
    let out = [];
    try {
      const hh = y1 - y0, d = cv.getContext('2d').getImageData(0, y0, cw, hh).data;
      const gapPx = Math.max(2, Math.round(em * kx * 0.18));   // espaço entre palavras: a partir de ~18% da altura da letra
      let start = -1, last = -1;
      for (let x = 0; x < cw; x++) {
        let n = 0;
        for (let y = 0; y < hh; y++) if (isInk(d, (y * cw + x) * 4) && ++n >= 2) break;   // 1 ponto sozinho é sujeira do scan
        if (n < 2) continue;
        if (start < 0) { start = x; last = x; }
        else if (x - last > gapPx) { out.push({ l: pr.left + start / kx, r: pr.left + (last + 1) / kx }); start = x; last = x; }
        else last = x;
      }
      if (start >= 0) out.push({ l: pr.left + start / kx, r: pr.left + (last + 1) / kx });
    } catch (e) { out = []; }
    p.runs.set(key, out);
    return out;
  }

  // Divide um trecho de texto em uma peça por palavra, cada uma sobre a palavra desenhada.
  // - mesma quantidade de palavras na imagem e no texto: cada palavra vai exatamente onde está desenhada;
  // - sobrou tinta (manchas do scan, letras separadas): junta os menores espaços até bater;
  // - faltou tinta (palavras coladas): estica o trecho inteiro até onde a tinta termina.
  // Devolve null se não for seguro mexer.
  function splitWords(p, pr, it, nx, top, bottom, runEnd) {
    const t = it.sp.firstChild, str = t.textContent, h = it.r.height;
    const ws = Array.from(str.matchAll(/\S+/g));
    if (!ws.length) return null;
    const limit = nx && nx.r.left > it.r.left + 1 && nx.r.left < runEnd ? nx.r.left : runEnd + 1;
    const segs = wordsFor(p, pr, top, bottom, h)
      .filter((u) => { const c = (u.l + u.r) / 2; return c >= it.r.left - h * 0.5 && c < limit && (u.r - u.l) >= h * 0.1; })
      .map((u) => ({ l: u.l, r: u.r }));
    if (!segs.length || segs.length > ws.length * 1.5 + 2) return null;
    if (Math.abs(segs[0].l - it.r.left) > h * 1.5) return null;
    while (segs.length > ws.length) {
      let k = 0, g = Infinity;
      for (let i = 0; i + 1 < segs.length; i++) { const d = segs[i + 1].l - segs[i].r; if (d < g) { g = d; k = i; } }
      segs[k].r = segs[k + 1].r; segs.splice(k + 1, 1);
    }
    const rg = document.createRange();
    const rw = ws.map((m) => {
      rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length);
      const r = rg.getBoundingClientRect();
      return { l: r.left, w: r.width };
    });
    if (rw.some((r) => r.w < 0.5)) return null;
    let tg;
    if (segs.length === ws.length) tg = segs;
    else {
      const n0 = rw[0].l, n1 = rw[rw.length - 1].l + rw[rw.length - 1].w;
      const L = segs[0].l, R = segs[segs.length - 1].r, s = (R - L) / (n1 - n0);
      if (!(s > 0.4 && s < 6)) return null;
      tg = rw.map((r) => ({ l: L + (r.l - n0) * s, r: L + (r.l - n0 + r.w) * s }));
    }
    const out = [];
    for (let j = 0; j < ws.length; j++) {
      const ratio = (tg[j].r - tg[j].l) / rw[j].w;
      if (!(ratio > 0.25 && ratio < 8)) return null;
      const end = j + 1 < ws.length ? ws[j + 1].index : str.length;   // o espaço depois da palavra vai junto (a cópia não perde espaços)
      const pre = j === 0 ? (rw[0].l - it.r.left) * ratio : 0;         // espaço antes da primeira palavra, se houver
      const n = it.sp.cloneNode(false);
      n.textContent = str.slice(j === 0 ? 0 : ws[j].index, end);
      n.style.left = (tg[j].l - pr.left - pre) + 'px';
      n.style.transform = 'scaleX(' + (it.k * ratio) + ')';
      out.push(n);
    }
    return out;
  }

  function calibrateText(p) {
    const pr = p.el.getBoundingClientRect();
    if (!pr.width || !pr.height) return;
    const items = [];
    for (const sp of spansOf(p)) {
      const tf = sp.style.transform || '';
      const m = /^scaleX\(([\d.]+)\)$/.exec(tf);
      if (tf && !m) continue;                        // texto girado: não mexe
      const r = sp.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      items.push({ sp, r, k: m ? parseFloat(m[1]) : 1 });
    }
    items.sort((a, b) => ((a.r.top + a.r.bottom) - (b.r.top + b.r.bottom)) || a.r.left - b.r.left);
    const lines = [];
    for (const it of items) {
      const cy = (it.r.top + it.r.bottom) / 2, h = it.r.height;
      const ln = lines.find((L) => Math.abs(L.cy - cy) < Math.max(L.h, h) * 0.6);
      if (ln) { ln.items.push(it); ln.h = Math.max(ln.h, h); } else lines.push({ cy, h, items: [it] });
    }
    // primeiro mede tudo, depois altera a página de uma vez (evita recalcular o layout a cada trecho)
    const writes = [];
    for (const L of lines) {
      L.items.sort((a, b) => a.r.left - b.r.left);
      L.items.forEach((it, i) => {
        const h = it.r.height, top = it.r.top + h * 0.12, bottom = it.r.bottom - h * 0.12;
        const run = runsFor(p, pr, top, bottom).find((u) => u.l <= it.r.left + h * 0.5 && u.r > it.r.left);
        if (!run) return;
        const nx = L.items[i + 1];
        const parts = FULLCAL ? splitWords(p, pr, it, nx, top, bottom, run.r) : null;
        if (parts) { writes.push(() => it.sp.replaceWith(...parts)); return; }
        const target = nx && nx.r.left > it.r.left && nx.r.left < run.r ? nx.r.left : run.r;
        if (target - it.r.right < 1.5) return;
        const ratio = (target - it.r.left) / it.r.width;
        if (!(ratio > 0 && ratio < 4)) return;
        writes.push(() => { it.sp.style.transform = 'scaleX(' + (it.k * ratio) + ')'; });
      });
    }
    writes.forEach((w) => w());
  }

  /* ---------- desenho em memória (usado ao mostrar a página e ao pré-carregar a próxima) ---------- */
  function renderScale(box, css) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // economiza RAM: era 2
    let scale = css * dpr;
    const MAXPX = 5e6, px = box.w * scale * box.h * scale;   // menos pixels = página aparece mais rápido (boostInk e e-ink percorrem todos)
    if (px > MAXPX) scale *= Math.sqrt(MAXPX / px);
    return scale;
  }
  // Tudo o que muda o resultado do desenho entra na chave: se algo mudar, a pré-carga é descartada
  const preKey = (n, box, css, scale) => [n, S.mode, S.ink, S.levels, S.dither ? 1 : 0, S.color ? 1 : 0, Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h), scale.toFixed(3)].join('|');

  async function renderBuf(page, box, scale, onTask) {
    const vp = page.getViewport({ scale, offsetX: -box.x * scale, offsetY: -box.y * scale });
    const buf = document.createElement('canvas');
    buf.width = Math.max(1, Math.round(box.w * scale));
    buf.height = Math.max(1, Math.round(box.h * scale));
    const ctx = buf.getContext('2d', { willReadFrequently: true });
    const task = page.render({ canvasContext: ctx, viewport: vp });
    if (onTask) onTask(task);
    await task.promise;
    if (S.ink > 0) boostInk(ctx, buf.width, buf.height);
    if (S.mode === 'eink') applyEink(ctx, buf.width, buf.height);
    return buf;
  }

  // Modo "Uma página": desenha a próxima página em segundo plano, para a virada ser quase instantânea
  function prefetchNext() {
    clearTimeout(preTimer);
    if (S.scroll || S.layout !== 'page' || !pdf || pageNum >= total) return;
    const doc = pdf, n = pageNum + 1;
    preTimer = setTimeout(async () => {
      try {
        const page = await doc.getPage(n);
        if (pdf !== doc) return;
        const vp = page.getViewport({ scale: 1 });
        const box = boxFor({ w: vp.width, h: vp.height });
        const css = cssFor(box, stageGeom());
        const scale = renderScale(box, css);
        const key = preKey(n, box, css, scale);
        if (pre && pre.doc === doc && pre.key === key) return;
        const buf = await renderBuf(page, box, scale, null);
        if (pdf === doc) pre = { doc, key, buf };
      } catch (e) { /* sem pré-carga: segue normal */ }
    }, 400);
  }

  async function drawPg(p, page, alive) {
    p.ready = false;
    const box = p.box, css = p.css;
    const scale = renderScale(box, css);
    const key = preKey(p.n, box, css, scale);
    let buf = null;
    if (pre && pre.doc === pdf && pre.key === key) { buf = pre.buf; pre = null; }   // já estava pronta
    else {
      if (p.task) { try { p.task.cancel(); } catch (e) {} }
      let task = null;
      try { buf = await renderBuf(page, box, scale, (t) => { task = t; p.task = t; }); }
      finally { if (task && p.task === task) p.task = null; }
    }
    if (!alive()) return false;

    const w = Math.round(box.w * css) + 'px', h = Math.round(box.h * css) + 'px';
    p.canvas.width = buf.width; p.canvas.height = buf.height;
    p.canvas.style.width = w; p.canvas.style.height = h;
    p.el.style.width = w; p.el.style.height = h;
    paintToCanvas(p.canvas, buf);
    buf.width = 0; buf.height = 0;   // libera a memória do buffer assim que a página foi pintada
    p.snap = new Map(); p.runs = new Map(); p.sel.textContent = '';

    await buildText(p, page);
    if (!alive()) return false;
    if (CALIBRATE) { try { calibrateText(p); } catch (e) { console.warn('calibrateText:', e); } }
    paintHighlights(p);
    paintFind(p);
    p.ready = true;
    return true;
  }

  /* ---------- modo página a página ---------- */
  function stopScroll() {
    if (io) { io.disconnect(); io = null; }
    pgs.forEach((p) => { if (p.task) { try { p.task.cancel(); } catch (e) {} } });
    pgs = []; tops = [];
  }

  const dualOn = () => S.layout === 'dual';
  // Primeira página de cada par: com "capa sozinha" os pares são (1) (2,3) (4,5)…; sem ela, (1,2) (3,4)…
  function spreadStart(n) {
    if (!dualOn()) return n;
    return S.coverAlone ? (n <= 1 ? 1 : n - (n % 2)) : n - ((n - 1) % 2);
  }
  function spreadPages(n) {
    const a = spreadStart(n);
    if (!dualOn() || a >= total || (S.coverAlone && a === 1)) return [a];
    return [a, a + 1];
  }
  function goNext(opts) { const pg = spreadPages(pageNum); return goPage(pg[pg.length - 1] + 1, opts); }
  function goPrev(opts) { return goPage(pageNum - 1, opts); }

  async function buildPageView() {
    const my = ++token;
    stopScroll();
    pageNum = spreadStart(pageNum);
    const nums = spreadPages(pageNum);
    docEl.className = dualOn() ? 'doc dual' : 'doc';
    if (!pagePg || pagePg.el.parentNode !== docEl) {
      docEl.textContent = '';
      pagePg = makePg(nums[0]); docEl.append(pagePg.el); pagePg2 = null;
    }
    if (nums.length === 2 && !pagePg2) { pagePg2 = makePg(nums[1]); docEl.append(pagePg2.el); }
    if (nums.length === 1 && pagePg2) { pagePg2.el.remove(); pagePg2 = null; }
    try {
      const slots = [pagePg, pagePg2].filter(Boolean);
      const pages = await Promise.all(nums.map((n) => pdf.getPage(n)));
      if (my !== token) return;
      await ensureCrop();
      if (my !== token) return;
      const g = stageGeom();
      if (g.availW < 50 || g.availH < 50) return;
      const gg = dualOn() ? Object.assign({}, g, { availW: g.availW / 2 }) : g;   // duas páginas: cada uma ocupa metade da largura
      slots.forEach((pg, i) => {
        const vp = pages[i].getViewport({ scale: 1 });
        const base = { w: vp.width, h: vp.height }, box = boxFor(base);
        Object.assign(pg, { n: nums[i], base, box, css: cssFor(box, gg) });
      });
      await Promise.all(slots.map((pg, i) => drawPg(pg, pages[i], () => my === token)));
      prefetchNext();
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.error(err);
      toast(tr('Não foi possível desenhar esta página.'));
    }
  }

  /* ---------- modo rolagem contínua ---------- */
  function pageAtY(y) {
    let lo = 0, hi = tops.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; }
    return spreadStart(lo + 1);
  }
  function currentAnchor() {
    if (pgs.length && tops.length) {
      const y = stage.scrollTop + stage.clientHeight * 0.3;
      const n = pageAtY(y), h = pgs[n - 1].el.offsetHeight || 1;
      return { n, ratio: clamp((y - tops[n - 1]) / h, 0, 1), top: false };
    }
    return { n: pageNum, ratio: 0, top: true };
  }

  async function buildScroll(anchor) {
    const my = ++token;
    if (!anchor) anchor = currentAnchor();
    stopScroll(); pagePg = null; pagePg2 = null;
    docEl.className = 'doc scroll'; docEl.textContent = '';
    try {
      if (!sizes) {
        if (total > 80) toast(tr('Preparando páginas…'), 0);
        await ensureSizes();
        hideToast();
        if (my !== token) return;
      }
      await ensureCrop();
      if (my !== token) return;
      const g = stageGeom();
      if (g.availW < 50 || g.availH < 50) return;

      const gg = dualOn() ? Object.assign({}, g, { availW: g.availW / 2 }) : g;   // duas páginas: cada uma ocupa metade da largura
      const frag = document.createDocumentFragment(), list = [];
      for (let n = 1; n <= total;) {
        const nums = spreadPages(n);
        const row = el('div', { class: 'spread' });
        for (const k of nums) {
          const base = sizes[k - 1], box = boxFor(base), css = cssFor(box, gg);
          const p = makePg(k);
          p.base = base; p.box = box; p.css = css;
          p.el.style.width = Math.round(box.w * css) + 'px';
          p.el.style.height = Math.round(box.h * css) + 'px';
          p.el.dataset.n = String(k);
          row.append(p.el); list.push(p);
        }
        frag.append(row);
        n = nums[nums.length - 1] + 1;
      }
      pgs = list; docEl.append(frag);
      if (!pgs.length) { console.error('buildScroll: nenhuma página criada', { total, sizes: sizes && sizes.length, anchor }); return; }

      const sr = stage.getBoundingClientRect();
      tops = pgs.map((p) => p.el.getBoundingClientRect().top - sr.top + stage.scrollTop);
      const a = { n: clamp(Math.round(Number(anchor.n)) || 1, 1, pgs.length), ratio: anchor.ratio || 0, top: !!anchor.top };
      const h = pgs[a.n - 1].el.offsetHeight;
      stage.scrollTop = Math.max(0, a.top ? tops[a.n - 1] - g.padTop : tops[a.n - 1] + a.ratio * h - stage.clientHeight * 0.3);
      centerX();
      pageNum = spreadStart(a.n);
      startObserver(my);
      updateUI();
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return;
      console.error(err);
      toast(tr('Não foi possível montar as páginas.'));
    }
  }

  function startObserver(my) {
    const queue = new Set();
    let busy = false;
    const pump = async () => {
      if (busy) return;
      busy = true;
      try {
        while (queue.size && my === token) {
          const mid = stage.scrollTop + stage.clientHeight / 2;
          let best = null, bd = Infinity;
          for (const p of queue) {
            const d = Math.abs(tops[p.n - 1] + p.el.offsetHeight / 2 - mid);
            if (d < bd) { bd = d; best = p; }
          }
          queue.delete(best);
          if (best.state !== 1) continue;
          best.state = 2;
          try {
            const page = await pdf.getPage(best.n);
            const ok = await drawPg(best, page, () => my === token && best.state === 2);
            if (ok) best.state = 3; else if (best.state === 2) best.state = 0;
          } catch (err) {
            if (!(err && err.name === 'RenderingCancelledException')) console.error(err);
            if (best.state === 2) best.state = 0;
          }
        }
      } finally { busy = false; }
    };
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = pgs[Number(e.target.dataset.n) - 1];
        if (!p) continue;
        if (e.isIntersecting) { if (p.state === 0) { p.state = 1; queue.add(p); } }
        else { queue.delete(p); releasePg(p); }
      }
      pump();
    }, { root: stage, rootMargin: '25% 0px 25% 0px' });
    pgs.forEach((p) => io.observe(p.el));
  }

  // Com a página (ou as duas páginas) mais larga que a janela, volta a mostrar o meio dela
  function centerX() { stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2); }
  function render() { return S.scroll ? buildScroll() : buildPageView().then(() => { centerX(); updateUI(); }); }


  /* =======================================================
     Marcador de texto
     ======================================================= */
  const bar = { mode: null, id: null };
  const highlights = () => (current ? (current.highlights = current.highlights || []) : []);

  function paintHighlights(p) {
    p.hl.textContent = '';
    if (!current || !p.base) return;
    const items = [];
    for (const h of highlights()) {
      if (h.page !== p.n) continue;
      for (const r of h.rects) {
        items.push({
          h,
          l: (r[0] * p.base.w - p.box.x) * p.css,
          t: (r[1] * p.base.h - p.box.y) * p.css,
          r: (r[0] + r[2]) * p.base.w * p.css - p.box.x * p.css,
          b: (r[1] + r[3]) * p.base.h * p.css - p.box.y * p.css
        });
      }
    }
    // marcações feitas em momentos diferentes também ficam com um espacinho entre as linhas
    separateLines(items);
    for (const o of items) {
      const d = el('div', { class: 'mark', 'data-c': o.h.color, 'data-id': o.h.id });
      d.style.left = o.l + 'px';
      d.style.top = o.t + 'px';
      d.style.width = (o.r - o.l) + 'px';
      d.style.height = (o.b - o.t) + 'px';
      p.hl.appendChild(d);
    }
  }
  const paintAll = () => activePgs().forEach(paintHighlights);
  function updateHlBtn() {
    const n = highlights().length;
    hlBtn.textContent = n ? tr('Marcações') + ' (' + n + ')' : tr('Marcações');
  }
  function afterHighlightChange() {
    paintAll(); updateHlBtn(); queueSave(true);
    if (!hlPanel.hidden) renderHlPanel();
  }

  // Junta os retângulos de uma mesma linha (as palavras de uma linha podem ter topos levemente diferentes)
  function mergeRects(rs) {
    const list = rs.map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })).sort((a, b) => (a.t + a.b) - (b.t + b.b));
    const lines = [];
    for (const r of list) {
      const cy = (r.t + r.b) / 2, h = r.b - r.t;
      const ln = lines.find((L) => Math.abs(L.cy - cy) < Math.max(L.h, h) * 0.5);
      if (ln) { ln.items.push(r); ln.cy += (cy - ln.cy) / ln.items.length; ln.h = Math.max(ln.h, h); }
      else lines.push({ cy, h, items: [r] });
    }
    const out = [];
    for (const L of lines) {
      L.items.sort((a, b) => a.l - b.l);
      let cur = null;
      for (const r of L.items) {
        if (cur && r.l <= cur.r + L.h * 1.6) {
          cur.l = Math.min(cur.l, r.l); cur.r = Math.max(cur.r, r.r);
          cur.t = Math.min(cur.t, r.t); cur.b = Math.max(cur.b, r.b);
        } else { cur = Object.assign({}, r); out.push(cur); }
      }
    }
    return out;
  }

  // Cor de "tinta" no canvas (o texto), conforme a tela. O limite é perto do papel (R+G+B do papel: ~713, sépia ~631, e-ink ~677)
  // para que letras finas e claras, de tamanho grande, também sejam reconhecidas.
  const INK_BELOW = { papel: 590, sepia: 520, eink: 565 };
  const isInk = (d, i) => { const t = d[i] + d[i + 1] + d[i + 2]; return S.mode === 'noite' ? t > 215 : t < INK_BELOW[S.mode]; };

  // Mede na imagem da página onde o texto da linha realmente está (do alto das letras ao fim das hastes).
  // Assim a seleção e a marcação ficam retas e coladas no texto, em qualquer fonte e em qualquer sistema.
  // A chave do cache é relativa à página (e não à tela), para continuar certa depois de rolar.
  function snapBand(p, pr, r) {
    const key = Math.round(r.t - pr.top) + '|' + Math.round(r.b - pr.top) + '|' + Math.round(r.l - pr.left) + '|' + Math.round(r.r - pr.left);
    if (p.snap && p.snap.has(key)) return p.snap.get(key);
    const h = r.b - r.t;
    const alto = (o) => !!o && (o.b - o.t) >= h * 0.85;
    let out = measureCore(p, pr, r);
    if (!alto(out)) {
      const o2 = measureBand(p, pr, r, false);
      if (o2 && (!out || (o2.b - o2.t) > (out.b - out.t))) out = o2;
    }
    if (!out) out = measureBand(p, pr, r, true);   // texto grande ou deslocado: procura a tinta numa janela bem maior
    if (out && !alto(out)) out = { t: Math.min(out.t, r.t), b: Math.max(out.b, r.b), runs: out.runs };
    if (p.snap) p.snap.set(key, out);
    return out;
  }

  // Mede a linha pela imagem, sempre em proporção da altura das letras (igual em qualquer zoom):
  // 1) acha o miolo da linha (faixa de tinta mais densa = letras minúsculas);
  // 2) estende para cima (hastes) e para baixo (caudas) enquanto houver tinta;
  // 3) garante uma altura mínima proporcional ao miolo, para todas as linhas ficarem com a mesma altura.
  function measureCore(p, pr, r) {
    const cv = p.canvas, cw = cv.width, ch = cv.height;
    if (cw < 4 || ch < 4) return null;
    const kx = cw / pr.width, ky = ch / pr.height, h = r.b - r.t, hpx = h * ky;
    if (hpx < 6) return null;
    const x0 = clamp(Math.floor((r.l - h * 6 - pr.left) * kx), 0, cw - 2);
    const x1 = clamp(Math.ceil((r.r + h * 6 - pr.left) * kx), x0 + 1, cw);
    const y0 = clamp(Math.floor((r.t - h * 0.9 - pr.top) * ky), 0, ch - 2);
    const y1 = clamp(Math.ceil((r.b + h * 0.9 - pr.top) * ky), y0 + 1, ch);
    const w = x1 - x0, hh = y1 - y0;
    let d;
    try { d = cv.getContext('2d').getImageData(x0, y0, w, hh).data; } catch (e) { return null; }
    const cnt = new Uint32Array(hh);
    for (let y = 0; y < hh; y++) {
      let c = 0;
      for (let x = 0; x < w; x++) if (isInk(d, (y * w + x) * 4)) c++;
      cnt[y] = c;
    }
    const mid = Math.round(((r.t + r.b) / 2 - pr.top) * ky - y0), reach = Math.round(hpx * 0.7);
    const sm = (y) => ((cnt[y - 1] || 0) + cnt[y] + (cnt[y + 1] || 0)) / 3;
    let peakY = -1, peak = 0;
    for (let y = Math.max(0, mid - reach); y <= Math.min(hh - 1, mid + reach); y++) {
      const v = sm(y);
      if (v > peak) { peak = v; peakY = y; }
    }
    if (peakY < 0 || peak < 2) return null;
    const thr = peak * 0.3, g1 = Math.max(1, Math.round(hpx * 0.03));
    let ca = peakY, cb = peakY, g = 0;
    for (let y = peakY - 1; y >= 0; y--) { if (cnt[y] >= thr) { ca = y; g = 0; } else if (++g > g1) break; }
    g = 0;
    for (let y = peakY + 1; y < hh; y++) { if (cnt[y] >= thr) { cb = y; g = 0; } else if (++g > g1) break; }
    const coreH = cb - ca + 1;
    if (coreH < hpx * 0.12 || coreH > hpx * 1.1) return null;
    const minInk = Math.max(1, Math.round(peak * 0.02));
    let ta = ca, tb = cb;
    g = 0;
    for (let y = ca - 1; y >= Math.max(0, ca - Math.round(coreH * 0.8)); y--) { if (cnt[y] >= minInk) { ta = y; g = 0; } else if (++g > g1) break; }
    g = 0;
    for (let y = cb + 1; y <= Math.min(hh - 1, cb + Math.round(coreH * 0.7)); y++) { if (cnt[y] >= minInk) { tb = y; g = 0; } else if (++g > g1) break; }
    const half = Math.round(coreH * 0.5);
    const a = Math.min(ta, ca - half), b = Math.max(tb, cb + half);
    const top = pr.top + (y0 + a) / ky, bottom = pr.top + (y0 + b + 1) / ky;
    const pad = Math.max(1, coreH * 0.1 / ky);   // folga pequena: a barra fica colada nas letras
    return { t: top - pad, b: bottom + pad, runs: runsFor(p, pr, top, bottom) };
  }

  function measureBand(p, pr, r, wide) {
    const cv = p.canvas, cw = cv.width, ch = cv.height;
    if (cw < 4 || ch < 4) return null;
    const kx = cw / pr.width, ky = ch / pr.height, h = r.b - r.t;
    const padX = wide ? 30 : 6, padY = wide ? 10 : 0.4;
    const x0 = clamp(Math.floor((r.l - h * padX - pr.left) * kx), 0, cw - 2);   // olha um pouco além da seleção, na mesma linha
    const x1 = clamp(Math.ceil((r.r + h * padX - pr.left) * kx), x0 + 1, cw);
    const y0 = clamp(Math.floor((r.t - h * padY - pr.top) * ky), 0, ch - 2);
    const y1 = clamp(Math.ceil((r.b + h * padY - pr.top) * ky), y0 + 1, ch);
    const w = x1 - x0, hh = y1 - y0;
    let d;
    try { d = cv.getContext('2d').getImageData(x0, y0, w, hh).data; } catch (e) { return null; }
    const need = Math.max(1, Math.round(w * 0.003));
    const rows = new Uint8Array(hh);
    for (let y = 0; y < hh; y++) {
      let c = 0;
      for (let x = 0; x < w; x++) if (isInk(d, (y * w + x) * 4)) c++;
      rows[y] = c >= need ? 1 : 0;
    }
    const hpx = h * ky, mid = Math.round(((r.t + r.b) / 2 - pr.top) * ky - y0);
    let seed = -1;
    for (let k = 0; k <= Math.round(hpx * (wide ? 10 : 0.5)) && seed < 0; k++) {
      if (mid + k < hh && rows[mid + k]) seed = mid + k;
      else if (mid - k >= 0 && rows[mid - k]) seed = mid - k;
    }
    if (seed < 0) return null;
    const gap = Math.max(2, Math.round(hpx * (wide ? 0.6 : 0.14)));
    let a = seed, b = seed, g = 0;
    for (let y = seed - 1; y >= 0; y--) { if (rows[y]) { a = y; g = 0; } else if (++g > gap) break; }
    g = 0;
    for (let y = seed + 1; y < hh; y++) { if (rows[y]) { b = y; g = 0; } else if (++g > gap) break; }
    const bandH = (b - a + 1) / ky;
    // texto grande: a altura do texto selecionável pode ser bem menor que a da letra desenhada
    if (bandH < h * 0.3 || (wide ? bandH > pr.height * 0.3 : bandH > h * 4.5)) return null;
    const pad = Math.max(2, bandH * 0.24);
    const top = pr.top + (y0 + a) / ky, bottom = pr.top + (y0 + b + 1) / ky;
    return { t: top - pad, b: bottom + pad, runs: runsFor(p, pr, top, bottom) };
  }

  // Trechos de texto da linha, de ponta a ponta, medidos na imagem (palavras separadas por menos de ~2,6 letras "m" formam um trecho).
  // Em PDFs de texto justificado o texto selecionável do PDF.js costuma ficar mais curto que o texto desenhado; isto corrige.
  function runsFor(p, pr, top, bottom) {
    const key = Math.round(top - pr.top) + '|' + Math.round(bottom - pr.top);
    if (!p.runs) p.runs = new Map();
    if (p.runs.has(key)) return p.runs.get(key);
    const cv = p.canvas, cw = cv.width, ch = cv.height, kx = cw / pr.width, ky = ch / pr.height;
    const y0 = clamp(Math.floor((top - pr.top) * ky), 0, ch - 1), y1 = clamp(Math.ceil((bottom - pr.top) * ky), y0 + 1, ch);
    let out = [];
    try {
      const d = cv.getContext('2d').getImageData(0, y0, cw, y1 - y0).data, hh = y1 - y0;
      const gapPx = Math.max(4, Math.round((bottom - top) * kx * 2.6));
      let start = -1, last = -1;
      for (let x = 0; x < cw; x++) {
        let ink = false;
        for (let y = 0; y < hh; y++) if (isInk(d, (y * cw + x) * 4)) { ink = true; break; }
        if (!ink) continue;
        if (start < 0) { start = x; last = x; }
        else if (x - last > gapPx) { out.push({ l: pr.left + start / kx, r: pr.left + (last + 1) / kx }); start = x; last = x; }
        else last = x;
      }
      if (start >= 0) out.push({ l: pr.left + start / kx, r: pr.left + (last + 1) / kx });
    } catch (e) { out = []; }
    p.runs.set(key, out);
    return out;
  }

  /* O texto selecionável nem sempre está no mesmo lugar do texto desenhado (fonte diferente, texto justificado,
     texto em imagem). Aqui as palavras do texto são alinhadas, em ordem, com as palavras que estão desenhadas na imagem;
     entre uma palavra e outra a posição é ajustada em linha reta. O resultado são duas funções:
       f: posição x do texto -> posição x na imagem (usada para desenhar a barra);
       g: posição x na imagem -> posição x do texto (usada para converter o mouse em letra).
     As duas usam os mesmos pontos de ancoragem, então mouse e barra sempre concordam. */
  function alignWords(dom, ink) {
    const n = dom.length, m = ink.length;
    if (!n || !m) return null;
    const d0 = dom[0].l, d1 = dom[n - 1].r, u0 = ink[0].l, u1 = ink[m - 1].r;
    if (d1 - d0 < 1 || u1 - u0 < 1) return null;
    const dc = dom.map((q) => ({ c: ((q.l + q.r) / 2 - d0) / (d1 - d0), w: (q.r - q.l) / (d1 - d0) }));
    const uc = ink.map((q) => ({ c: ((q.l + q.r) / 2 - u0) / (u1 - u0), w: (q.r - q.l) / (u1 - u0) }));
    const GAP = 0.06;
    const cost = (i, j) => Math.abs(dc[i].c - uc[j].c) + 0.5 * Math.abs(dc[i].w - uc[j].w);
    const D = [];
    for (let i = 0; i <= n; i++) { D.push(new Float64Array(m + 1)); D[i][0] = i * GAP; }
    for (let j = 1; j <= m; j++) D[0][j] = j * GAP;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        D[i][j] = Math.min(D[i - 1][j - 1] + cost(i - 1, j - 1), D[i - 1][j] + GAP, D[i][j - 1] + GAP);
      }
    }
    const pairs = [];
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (D[i][j] === D[i - 1][j - 1] + cost(i - 1, j - 1)) { pairs.push([i - 1, j - 1]); i--; j--; }
      else if (D[i][j] === D[i - 1][j] + GAP) i--;
      else j--;
    }
    pairs.reverse();
    if (pairs.length < Math.max(1, Math.ceil(Math.min(n, m) * 0.5))) return null;
    if (pairs.reduce((s, q) => s + cost(q[0], q[1]), 0) / pairs.length > 0.15) return null;
    const A = [];
    for (const q of pairs) {
      for (const pt of [{ d: dom[q[0]].l, u: ink[q[1]].l }, { d: dom[q[0]].r, u: ink[q[1]].r }]) {
        const last = A[A.length - 1];
        if (!last || (pt.d > last.d + 0.01 && pt.u > last.u + 0.01)) A.push(pt);   // crescente nos dois eixos: a inversa também vale
      }
    }
    if (A.length < 2) return null;
    const f0 = A[0], e0 = A[A.length - 1];
    const seg = (x, key, other) => {
      if (x <= f0[key]) return x - f0[key] + f0[other];
      if (x >= e0[key]) return x - e0[key] + e0[other];
      let k = 0;
      while (k + 2 < A.length && x > A[k + 1][key]) k++;
      const a = A[k], b = A[k + 1];
      return a[other] + (x - a[key]) / (b[key] - a[key]) * (b[other] - a[other]);
    };
    return { f: (x) => seg(x, 'd', 'u'), g: (x) => seg(x, 'u', 'd') };
  }

  // Palavras da linha medidas na imagem. Em vez de um espaço mínimo fixo (que falha em letra grande e espaçada),
  // corta a linha nos (n-1) MAIORES espaços, sendo n o número de palavras do texto selecionável.
  function inkWords(p, pr, top, bottom, em, expected) {
    const key = 'i' + Math.round(top - pr.top) + '|' + Math.round(bottom - pr.top) + '|' + expected;
    if (!p.runs) p.runs = new Map();
    if (p.runs.has(key)) return p.runs.get(key);
    const cv = p.canvas, cw = cv.width, ch = cv.height, kx = cw / pr.width, ky = ch / pr.height;
    const y0 = clamp(Math.floor((top - pr.top) * ky), 0, ch - 1), y1 = clamp(Math.ceil((bottom - pr.top) * ky), y0 + 1, ch);
    let out = [];
    try {
      const hh = y1 - y0, d = cv.getContext('2d').getImageData(0, y0, cw, hh).data;
      const minGap = Math.max(1, Math.round(em * kx * 0.04));
      const segs = [];
      let start = -1, last = -1;
      for (let x = 0; x < cw; x++) {
        let n = 0;
        for (let y = 0; y < hh; y++) if (isInk(d, (y * cw + x) * 4) && ++n >= 2) break;   // 1 ponto sozinho é sujeira do scan
        if (n < 2) continue;
        if (start < 0) { start = x; last = x; }
        else if (x - last > minGap) { segs.push([start, last + 1]); start = x; last = x; }
        else last = x;
      }
      if (start >= 0) segs.push([start, last + 1]);
      let words = segs;
      if (expected && segs.length > expected) {
        // mais pedaços que palavras: só os (n-1) maiores espaços separam palavras, o resto é espaço entre letras
        const cut = new Set(segs.slice(1).map((s, i) => ({ i, g: s[0] - segs[i][1] }))
          .sort((a, b) => b.g - a.g).slice(0, expected - 1).map((o) => o.i));
        words = [];
        segs.forEach((s, i) => {
          if (i > 0 && cut.has(i - 1)) words.push([s[0], s[1]]);
          else if (words.length) words[words.length - 1][1] = s[1];
          else words.push([s[0], s[1]]);
        });
      }
      out = words.map((s) => ({ l: pr.left + s[0] / kx, r: pr.left + s[1] / kx }));
    } catch (e) { out = []; }
    p.runs.set(key, out);
    return out;
  }

  function lineWarp(p, pr, band, ref) {
    const key = 'W' + Math.round(band.t - pr.top) + '|' + Math.round(band.b - pr.top);
    const cache = p.snap;
    if (cache && cache.has(key)) return cache.get(key);
    let fn = null;
    try {
      const bh = band.b - band.t, mid = (band.t + band.b) / 2, rg = document.createRange(), dom = [];
      const rm = ref ? (ref.t + ref.b) / 2 : 0, rh = ref ? ref.b - ref.t : 0;
      for (const sp of spansOf(p)) {
        const sr = sp.getBoundingClientRect(), cy = (sr.top + sr.bottom) / 2;
        const onBand = Math.abs(cy - mid) < bh * 0.45;           // só as palavras desta linha (sem pegar a vizinha)
        const onRef = !!ref && Math.abs(cy - rm) < rh * 0.8;     // texto selecionável deslocado em relação à palavra desenhada
        if (!onBand && !onRef) continue;
        const t = sp.firstChild;
        for (const mt of t.data.matchAll(/\S+/g)) {
          rg.setStart(t, mt.index); rg.setEnd(t, mt.index + mt[0].length);
          const q = rg.getBoundingClientRect();
          if (q.width > 0.5) dom.push({ l: q.left, r: q.right });
        }
      }
      dom.sort((a, b) => a.l - b.l);
      if (dom.length) {
        const ink = inkWords(p, pr, band.t + bh * 0.1, band.b - bh * 0.1, bh * 0.8, dom.length)
          .filter((u) => u.r - u.l >= bh * 0.03);
        fn = alignWords(dom, ink);
        if (fn) {
          // Correção legítima é pequena (o texto já foi esticado pelo calibrateText).
          // Se alguma palavra for deslocada demais, o alinhamento casou palavras erradas: descarta.
          const lim = bh * 0.8;
          const bad = dom.some((q) => Math.abs(fn.f(q.l) - q.l) > lim || Math.abs(fn.f(q.r) - q.r) > lim);
          if (bad) fn = null;
        }
      }
    } catch (e) { fn = null; }
    if (cache) cache.set(key, fn);
    return fn;
  }

  // A seleção começa no início / termina no fim do texto da linha? Se sim, a barra deve ir até a ponta da tinta.
  // (Em textos grandes o texto selecionável fica mais curto que o desenhado e a barra parava antes do fim.)
  function lineEdges(p, range, r, sps) {
    const mid = (r.t + r.b) / 2, h = r.b - r.t;
    const line = (sps || spansOf(p).map((sp) => ({ sp, q: sp.getBoundingClientRect() })))
      .filter((o) => Math.abs((o.q.top + o.q.bottom) / 2 - mid) < h * 0.6);
    const blank = (s) => !s.trim();
    const find = (node) => line.find((o) => o.sp.firstChild === node);
    let start = false, end = false;
    const ec = range.endContainer, es = ec.nodeType === 3 ? find(ec) : null;
    if (es && blank(ec.data.slice(range.endOffset))) {
      end = !line.some((o) => o !== es && o.q.left > es.q.left + 1 && !blank(o.sp.textContent));
    }
    const sc = range.startContainer, ss = sc.nodeType === 3 ? find(sc) : null;
    if (ss && blank(sc.data.slice(0, range.startOffset))) {
      start = !line.some((o) => o !== ss && o.q.left < ss.q.left - 1 && !blank(o.sp.textContent));
    }
    return { start, end };
  }

  // Linhas (retângulos em pixels da tela) que cobrem o trecho selecionado numa página.
  // Linhas do meio vão de ponta a ponta; a primeira vai até o fim do texto; a última começa no início do texto.
  function lineRects(p, all, range) {
    const pr = p.el.getBoundingClientRect();
    const rs = all.filter((r) => r.width > 1 && r.height > 1 && r.height < pr.height * 0.2 && r.width <= pr.width * 1.02 &&
      r.left >= pr.left - 2 && r.right <= pr.right + 2 && r.top >= pr.top - 2 && r.bottom <= pr.bottom + 2);
    if (!rs.length) return [];
    const f = rs[0], e = rs[rs.length - 1];
    const fy = (f.top + f.bottom) / 2, ey = (e.top + e.bottom) / 2;
    const onLine = (r, y) => Math.abs(y - (r.t + r.b) / 2) < (r.b - r.t) * 0.6;
    const lines = mergeRects(rs);
    let sps = null;   // medidas dos trechos de texto, calculadas uma vez só por chamada
    const out = lines.map((r) => {
      if (!CALIBRATE) return { l: r.l, r: r.r, t: r.t, b: r.b, run: null };   // posição do texto do PDF, sem medir pixels
      const sn = snapBand(p, pr, r), h = r.b - r.t;
      let l = r.l, rr = r.r, run = null;
      // corrige pelas palavras desenhadas (sempre, não só no modo 'full'): é a mesma correção usada para o mouse
      const warp = sn ? lineWarp(p, pr, sn, r) : null;
      if (warp) { const wl = warp.f(r.l), wr = warp.f(r.r); if (wr - wl > 1) { l = wl; rr = wr; } }
      if (sn && sn.runs && sn.runs.length) {
        const cx = (r.l + r.r) / 2;
        run = sn.runs.find((u) => cx >= u.l - 2 && cx <= u.r + 2) ||
          sn.runs.reduce((m, u) => (Math.abs((u.l + u.r) / 2 - cx) < Math.abs((m.l + m.r) / 2 - cx) ? u : m), sn.runs[0]);
        if (lines.length > 1) {
          const isFirst = onLine(r, fy), isLast = onLine(r, ey);
          if (isFirst && isLast) { /* seleção numa linha só: mantém os pontos de início e fim */ }
          else if (isFirst) rr = Math.max(rr, run.r);
          else if (isLast) l = Math.min(l, run.l);
          else { l = run.l; rr = run.r; }
        }
        // Seleção que chega ao fim (ou parte do início) do texto da linha: a barra vai até a ponta da tinta
        if (range) {
          if (!sps) sps = spansOf(p).map((sp) => ({ sp, q: sp.getBoundingClientRect() }));
          const ed = lineEdges(p, range, r, sps);
          if (ed.end) rr = Math.max(rr, run.r);
          if (ed.start) l = Math.min(l, run.l);
        }
      }
      return sn ? { l, r: rr, t: sn.t, b: sn.b, run } : { l, r: rr, t: r.t + h * 0.04, b: r.t + h * 1.2, run: null };
    });
    // Segurança: se a medição pela imagem deu um valor inválido ou fora do lugar (acontece em zoom alto),
    // usa o retângulo do texto do PDF, para a seleção nunca sumir.
    const safe = out.map((o, i) => {
      const r = lines[i], h = r.b - r.t;
      const finite = [o.l, o.r, o.t, o.b].every(Number.isFinite);
      const sane = finite && (o.r - o.l) > 2 && (o.b - o.t) > 2 &&
        Math.abs((o.t + o.b) / 2 - (r.t + r.b) / 2) < h * 1.5 &&   // não pulou para outra linha
        o.l < r.r + h * 3 && o.r > r.l - h * 3;                    // continua perto do trecho selecionado
      return sane ? o : { l: r.l, r: r.r, t: r.t + h * 0.04, b: r.t + h * 1.2, run: null };
    });
    return separateLines(unionLines(safe));
  }
  // Deixa um espacinho entre uma linha marcada e a de baixo (a de baixo nunca invade a de cima).
  // O espaço é proporcional à altura da barra, então fica igual em qualquer zoom.
  function separateLines(arr) {
    const list = arr.slice().sort((a, b) => (a.t + a.b) - (b.t + b.b));
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      for (let j = i - 1; j >= 0; j--) {
        const a = list[j], ha = a.b - a.t, hb = b.b - b.t;
        if (b.l > a.r || b.r < a.l) continue;   // não se tocam na horizontal
        if (Math.abs((a.t + a.b) / 2 - (b.t + b.b) / 2) < Math.min(ha, hb) * 0.6) continue;   // mesma linha: não mexe
        const gap = Math.max(2, Math.min(ha, hb) * 0.14);
        const over = a.b + gap - b.t;
        if (over > 0) {
          const cut = over / 2;
          if (ha - cut > 2 && hb - cut > 2) { a.b -= cut; b.t += cut; }
        }
      }
    }
    return list;
  }
  // Une pedaços que ficaram sobrepostos na mesma linha (e iguala a altura), para não haver barras duplas
  function unionLines(arr) {
    const list = arr.slice().sort((a, b) => (a.t + a.b) - (b.t + b.b) || a.l - b.l), res = [];
    for (const r of list) {
      const sameRun = (o, r2) => o.run && r2.run && Math.abs(o.run.l - r2.run.l) < 3 && Math.abs(o.run.r - r2.run.r) < 3;
      const m = res.find((o) => Math.abs((o.t + o.b) / 2 - (r.t + r.b) / 2) < Math.max(o.b - o.t, r.b - r.t) * 0.5 && ((r.l <= o.r + 4 && r.r >= o.l - 4) || sameRun(o, r)));
      if (m) { m.l = Math.min(m.l, r.l); m.r = Math.max(m.r, r.r); m.t = Math.min(m.t, r.t); m.b = Math.max(m.b, r.b); }
      else res.push(Object.assign({}, r));
    }
    return res;
  }

  // Seleção desenhada pelo app (no lugar da seleção do navegador, que fica torta nas fontes dos PDFs)
  function clearSel(p) { if (p.sel.firstChild) p.sel.textContent = ''; }
  function updateSelOverlay() {
    const act = activePgs(), sel = getSelection();
    if (!reading() || !sel || sel.isCollapsed || !sel.rangeCount) { act.forEach(clearSel); return; }
    const range = sel.getRangeAt(0), all = Array.from(range.getClientRects());
    for (const p of act) {
      if (!range.intersectsNode(p.text)) { clearSel(p); continue; }
      const pr = p.el.getBoundingClientRect(), frag = document.createDocumentFragment();
      for (const r of lineRects(p, all, range)) {
        const d = document.createElement('div');
        d.className = 'sbar';
        d.style.left = (r.l - pr.left) + 'px'; d.style.top = (r.t - pr.top) + 'px';
        d.style.width = (r.r - r.l) + 'px'; d.style.height = (r.b - r.t) + 'px';
        frag.appendChild(d);
      }
      p.sel.replaceChildren(frag);
    }
  }


  function addHighlight(color) {
    const sel = getSelection();
    if (!current || !sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    const all = Array.from(range.getClientRects());
    const added = [];
    for (const p of activePgs()) {
      if (!range.intersectsNode(p.text)) continue;
      const lines = lineRects(p, all, range);
      if (!lines.length) continue;
      const pr = p.el.getBoundingClientRect();
      const kx = pr.width / p.box.w, ky = pr.height / p.box.h;
      const rects = lines.map((r) => [
        ((r.l - pr.left) / kx + p.box.x) / p.base.w,
        ((r.t - pr.top) / ky + p.box.y) / p.base.h,
        ((r.r - r.l) / kx) / p.base.w,
        ((r.b - r.t) / ky) / p.base.h
      ]);
      added.push({ id: uid(), page: p.n, color, rects, text: (added.length ? tr('(continuação) ') : '') + text.slice(0, 280), t: Date.now() });
    }
    if (!added.length) { toast(tr('Não foi possível marcar esse trecho.')); return; }
    highlights().push(...added);
    sel.removeAllRanges();
    hideBar();
    afterHighlightChange();
  }
  function recolor(id, color) {
    const h = highlights().find((x) => x.id === id);
    if (!h) return;
    h.color = color; hideBar(); afterHighlightChange();
  }
  function removeHighlight(id) {
    current.highlights = highlights().filter((h) => h.id !== id);
    hideBar(); afterHighlightChange();
  }

  function markAt(x, y) {
    for (const p of activePgs()) {
      const r = p.el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      for (const m of p.hl.children) {
        const mr = m.getBoundingClientRect();
        if (x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom) {
          const h = highlights().find((v) => v.id === m.dataset.id);
          if (h) return { h, rect: mr };
        }
      }
    }
    return null;
  }

  /* Barra flutuante (cores, pesquisar, copiar, remover) */
  function hideBar() { closeMenu(); selBar.hidden = true; bar.mode = null; bar.id = null; }
  function showBar(mode, rect, id) {
    bar.mode = mode; bar.id = id || null;
    rmBtn.hidden = mode !== 'mark';
    noteBtn.hidden = mode !== 'mark';
    copyBtn.textContent = mode === 'mark' ? tr('Copiar texto') : tr('Copiar');
    selBar.hidden = false;
    const wr = wrap.getBoundingClientRect(), bw = selBar.offsetWidth, bh = selBar.offsetHeight;
    const left = clamp(rect.left + rect.width / 2 - wr.left - bw / 2, 6, Math.max(6, wr.width - bw - 6));
    let top = rect.top - wr.top - bh - 10;
    if (top < 6) top = rect.bottom - wr.top + 10;
    selBar.style.left = left + 'px'; selBar.style.top = top + 'px';
  }

  let pointerDown = false, hadSelection = false, selTimer = null;
  function onSelectionSettled() {
    if (!reading() || pointerDown) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { if (bar.mode === 'sel') hideBar(); return; }
    const range = sel.getRangeAt(0);
    const a = range.commonAncestorContainer;
    const node = a.nodeType === 1 ? a : a.parentElement;
    if (!node || !node.closest || !node.closest('.doc')) return;
    const r = range.getBoundingClientRect();
    if (!r.width && !r.height) return;
    showBar('sel', r);
  }

  async function copyText(text) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch (e) { try { document.execCommand('copy'); } catch (e2) { /* sem cópia */ } }
    toast(tr('Texto copiado.'), 1600);
  }

  // Texto atual da barra: o da seleção ou, se tocou numa marcação, o texto dela
  function currentText() {
    let t = '';
    if (bar.mode === 'mark') { const h = highlights().find((x) => x.id === bar.id); t = h ? h.text : ''; }
    else t = String(getSelection());
    return t.replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  // Abre a pesquisa ou a tradução do trecho no navegador (o idioma do app é o idioma de destino da tradução)
  function webSearch(kind) {
    const text = currentText();
    if (!text) return;
    const q = encodeURIComponent(text), lg = S.lang;
    const url = {
      google: 'https://www.google.com/search?q=' + q,
      scholar: 'https://scholar.google.com/scholar?q=' + q,
      wiki: 'https://' + lg + '.wikipedia.org/w/index.php?search=' + q,
      gtrans: 'https://translate.google.com/?sl=auto&tl=' + lg + '&op=translate&text=' + q,
      // O DeepL precisa do prefixo de idioma (/pt/translator): sem ele a página redireciona e perde o texto depois do #
      deepl: 'https://www.deepl.com/' + lg + '/translator#en/' + lg + '/' + q.replace(/%2F/g, '%5C%2F')
    }[kind];
    if (!url) return;
    if (kind === 'deepl') {
      // o DeepL às vezes ignora o texto da URL: deixa o trecho copiado para colar
      try { navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* sem cópia */ }
      toast(tr('Texto copiado. Se o DeepL abrir vazio, cole com Ctrl+V.'), 5000);
    }
    window.open(url, '_blank', 'noopener');
    hideBar();
  }

  let hlTab = 'hl';
  const bookmarks = () => (current ? (current.bookmarks = current.bookmarks || []) : []);

  // Campo de nota de uma marcação: salva enquanto digita; vazio, volta para o botão "+ Nota"
  function noteEditor(h, focus) {
    const ta = el('textarea', { class: 'hl-note', rows: '2', maxlength: '600', placeholder: tr('Escreva sua nota…'), 'aria-label': tr('Nota da marcação') });
    ta.value = h.note || '';
    ta.addEventListener('input', () => { h.note = ta.value; queueSave(); });
    ta.addEventListener('blur', () => { h.note = ta.value.trim(); queueSave(true); if (!h.note) renderHlPanel(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); } });
    if (focus) setTimeout(() => ta.focus(), 0);
    return ta;
  }

  function renderBmList() {
    const list = bookmarks().slice().sort((a, b) => a.page - b.page);
    if (!list.length) {
      hlList.append(el('p', { class: 'hint', text: tr('Nenhuma página favorita ainda. Use o botão Favoritar ou a tecla B.') }));
      return;
    }
    for (const b of list) {
      hlList.append(el('div', { class: 'hl-item' },
        el('div', { class: 'hl-row' },
          el('button', { type: 'button', class: 'hl-go', onclick: () => { closePanels(); goPage(b.page); } },
            el('span', { class: 'hl-text' },
              el('span', { class: 'hl-page', text: tr('Página {n}', { n: b.page }) }),
              el('span', { class: 'hl-snip', text: tr('Salva em {d}', { d: new Date(b.t).toLocaleDateString(loc()) }) }))),
          el('button', { type: 'button', class: 'hl-del', 'aria-label': tr('Remover favorito'), text: '×', onclick: () => toggleBookmark(b.page) }))));
    }
  }

  function renderHlPanel(focusId) {
    hlList.textContent = '';
    hlTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === hlTab)));
    if (hlTab === 'bm') { renderBmList(); return; }
    const list = highlights().slice().sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
    if (!list.length) {
      hlList.append(el('p', { class: 'hint', text: tr('Nenhuma marcação ainda. Selecione um trecho do texto e escolha uma cor.') }));
      return;
    }
    for (const h of list) {
      let noteArea;
      if (h.note || h.id === focusId) noteArea = noteEditor(h, h.id === focusId);
      else {
        noteArea = el('button', { type: 'button', class: 'hl-addnote', text: tr('+ Nota') });
        noteArea.addEventListener('click', () => noteArea.replaceWith(noteEditor(h, true)));
      }
      const item = el('div', { class: 'hl-item' },
        el('div', { class: 'hl-row' },
          el('button', { type: 'button', class: 'hl-go', onclick: () => { closePanels(); goToHighlight(h); } },
            el('span', { class: 'dot', 'data-c': h.color }),
            el('span', { class: 'hl-text' },
              el('span', { class: 'hl-page', text: tr('Página {n}', { n: h.page }) }),
              el('span', { class: 'hl-snip', text: h.text || tr('(sem texto)') }))),
          el('button', { type: 'button', class: 'hl-del', 'aria-label': tr('Remover marcação'), text: '×', onclick: () => removeHighlight(h.id) })),
        noteArea);
      hlList.append(item);
      if (h.id === focusId) setTimeout(() => item.scrollIntoView({ block: 'nearest' }), 0);
    }
  }

  // Abre o painel já no campo de nota da marcação tocada
  function openNote(id) {
    hideBar();
    hlTab = 'hl';
    closePanels();
    hlPanel.hidden = false;
    renderHlPanel(id);
  }

  function updateBmBtn() {
    const on = !!current && bookmarks().some((b) => b.page === pageNum);
    bmBtn.setAttribute('aria-pressed', String(on));
    bmBtn.textContent = on ? tr('★ Favorita') : tr('☆ Favoritar');
  }
  function toggleBookmark(n) {
    if (!current) return;
    n = n || pageNum;
    const list = bookmarks(), i = list.findIndex((b) => b.page === n);
    if (i >= 0) { list.splice(i, 1); toast(tr('Favorito removido.'), 1400); }
    else { list.push({ page: n, t: Date.now() }); toast(tr('Página {n} favoritada.', { n }), 1400); }
    queueSave(true); updateBmBtn();
    if (!hlPanel.hidden) renderHlPanel();
  }

  // Baixa um arquivo gerado pelo app
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Exporta trechos, notas e páginas favoritas do livro aberto em Markdown
  function exportNotes() {
    if (!current) return;
    const hs = highlights().slice().sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
    const bs = bookmarks().slice().sort((a, b) => a.page - b.page);
    if (!hs.length && !bs.length) { toast(tr('Ainda não há nada para exportar.')); return; }
    const cor = { yellow: tr('amarelo'), green: tr('verde'), blue: tr('azul'), pink: tr('rosa') };
    let md = '# ' + current.name + '\n\n_' + tr('Exportado do Lume em {d}', { d: new Date().toLocaleDateString(loc()) }) + '_\n';
    if (bs.length) md += '\n## ' + tr('Páginas favoritas') + '\n\n' + bs.map((b) => '- ' + tr('Página {n}', { n: b.page })).join('\n') + '\n';
    if (hs.length) {
      md += '\n## ' + tr('Marcações') + '\n';
      let last = 0;
      for (const h of hs) {
        if (h.page !== last) { md += '\n### ' + tr('Página {n}', { n: h.page }) + '\n\n'; last = h.page; }
        md += '> ' + String(h.text || '').replace(/\s+/g, ' ') + ' _(' + (cor[h.color] || h.color) + ')_\n';
        if (h.note) md += '\n**' + tr('Nota:') + '** ' + h.note.trim().replace(/\n/g, '  \n') + '\n';
        md += '\n';
      }
    }
    const safe = current.name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || tr('livro');
    saveBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), safe + ' - ' + tr('anotações') + '.md');
    toast(tr('Anotações exportadas.'), 2000);
  }

  async function goToHighlight(h) {
    if (S.scroll || h.page !== pageNum) await goPage(h.page);
    const p = S.scroll ? pgs[h.page - 1] : activePgs().find((q) => q.n === h.page);
    if (!p || !p.base) return;
    const y = (h.rects[0][1] * p.base.h - p.box.y) * p.css;
    const pr = p.el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    stage.scrollTop = Math.max(0, pr.top - sr.top + stage.scrollTop + y - stage.clientHeight * 0.3);
  }

  /* =======================================================
     Leitor: navegação e progresso
     ======================================================= */
  function updateUI() {
    slider.max = String(Math.max(1, total)); slider.value = String(pageNum);
    pageIn.max = String(Math.max(1, total)); pageIn.value = String(pageNum);
    pageTotal.textContent = '/ ' + total;
    // linha de status (barras escondidas)
    stTitle.textContent = current ? current.name : '';
    const now = spreadPages(pageNum);
    stPage.textContent = now.length === 2 ? tr('Páginas {a}–{b} de {t}', { a: now[0], b: now[1], t: total }) : tr('Página {n} de {t}', { n: pageNum, t: total });
    pcount.textContent = pageNum + ' / ' + total;
    updateBar();
    stPct.textContent = (total > 1 ? Math.round((pageNum - 1) / (total - 1) * 100) : 0) + '%';
    markToc();
    trackPage(); updateBmBtn();
  }
  // Barra fininha do modo rolagem: acompanha a rolagem de verdade, não só a troca de página
  function updateBar() {
    if (!S.scroll) return;
    const max = Math.max(1, stage.scrollHeight - stage.clientHeight);
    pbarFill.style.width = clamp(stage.scrollTop / max * 100, 0, 100) + '%';
  }
  let flashTimer = null, turns = 0;
  function flash() {
    flashEl.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl.classList.remove('on'), 110);
  }

  let saveTimer = null;
  function queueSave(now) {
    if (!current || current.volatile) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, now ? 0 : 500);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    if (!current || current.volatile) return Promise.resolve();
    current.page = pageNum; current.total = total; current.lastOpened = Date.now();
    return putBook(current).catch(() => {});
  }

  async function goPage(n, opts) {
    if (!pdf) return;
    opts = opts || {};
    n = spreadStart(clamp(Math.round(n) || 1, 1, total));
    hideBar();
    if (S.scroll) {
      pageNum = n;
      if (tops.length) stage.scrollTop = Math.max(0, tops[n - 1] - stageGeom().padTop);
      updateUI(); queueSave();
      return;
    }
    if (n === pageNum && !opts.force) { updateUI(); return; }
    pageNum = n;
    if (S.mode === 'eink' && S.flashEvery && ++turns % S.flashEvery === 0) flash();
    await buildPageView();
    stage.scrollTop = opts.bottom ? stage.scrollHeight : 0;
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
    updateUI(); queueSave();
  }
  function next() {
    const max = stage.scrollHeight - stage.clientHeight;
    if (S.scroll || (max > 6 && stage.scrollTop < max - 6)) { stage.scrollBy(0, Math.round(stage.clientHeight * 0.9)); return; }
    goNext();
  }
  function prev() {
    if (S.scroll || stage.scrollTop > 6) { stage.scrollBy(0, -Math.round(stage.clientHeight * 0.9)); return; }
    goPrev({ bottom: true });
  }

  /* Sumário do PDF */
  async function resolvePage(dest) {
    try {
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!dest || !dest.length) return null;
      const ref = dest[0];
      if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref)) + 1;
      if (Number.isInteger(ref)) return ref + 1;
    } catch (e) { /* destino inválido */ }
    return null;
  }
  let tocItems = [];
  function markToc() {
    let cur = null;
    for (const e of tocItems) { if (e.page && e.page <= pageNum) cur = e; }
    tocItems.forEach((e) => {
      e.btn.classList.toggle('cur', e === cur);
      if (e === cur) e.btn.setAttribute('aria-current', 'true'); else e.btn.removeAttribute('aria-current');
    });
  }
  async function buildOutline() {
    tocList.textContent = ''; tocItems = [];
    const doc0 = pdf;
    let out = null;
    try { out = await doc0.getOutline(); } catch (e) {}
    if (pdf !== doc0) return;
    const has = !!(out && out.length);
    tocBtn.hidden = !has;
    if (!has) return;
    (function walk(items, depth) {
      items.forEach((it) => {
        const b = el('button', { type: 'button', class: 'toc-item', text: it.title || tr('(sem título)') });
        b.style.paddingLeft = (0.5 + depth * 0.8) + 'rem';
        const entry = { btn: b, dest: it.dest, page: null };
        b.addEventListener('click', async () => {
          const target = entry.page || await resolvePage(it.dest);
          if (target) { closePanels(); goPage(target); }
        });
        tocList.appendChild(b); tocItems.push(entry);
        if (it.items && it.items.length) walk(it.items, depth + 1);
      });
    })(out, 0);
    // descobre a página de cada item em segundo plano, para destacar o capítulo atual
    const doc = pdf;
    (async () => {
      for (const e of tocItems) { if (pdf !== doc) return; e.page = await resolvePage(e.dest); }
      markToc();
    })();
  }

  /* =======================================================
     Telas: biblioteca <-> leitor
     ======================================================= */
  function showView(v) {
    resetSelect();
    root.dataset.view = v;
    autoStop();
    if (v === 'library') {
      app.classList.remove('immersive');
      closePanels(); hideBar();
      tocBtn.hidden = true;
      titleEl.textContent = 'Lume'; titleEl.title = '';
    }
    applyRuler();
  }

  /* Corte de margens, zoom e ajuste valem para cada livro; sem nada salvo, usa o padrão */
  function applyBookView(rec) {
    const v = rec.view || {};
    S.crop = v.crop !== undefined ? !!v.crop : DEFAULTS.crop;
    S.zoom = clamp(Number(v.zoom) || DEFAULTS.zoom, 0.5, 4);
    S.fit = FITS.includes(v.fit) ? v.fit : DEFAULTS.fit;
  }
  function saveBookView() {
    if (!current) return;
    current.view = { crop: !!S.crop, zoom: S.zoom, fit: S.fit };
    queueSave(true);
  }

  async function loadPdf(buffer, rec, ready) {
    const doc = ready || await pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    stopScroll();
    if (pdf) { try { pdf.destroy(); } catch (e) {} }
    pdf = doc; total = doc.numPages; current = rec; cropBox = undefined; sizes = null; pagePg = null; pagePg2 = null; findReset();
    applyBookView(rec); applyView();
    rec.highlights = Array.isArray(rec.highlights) ? rec.highlights : [];
    rec.category = rec.category || '';
    rec.bookmarks = Array.isArray(rec.bookmarks) ? rec.bookmarks : [];
    statLast = null; hlTab = 'hl';
    rec.opened = true; rec.total = total; rec.lastOpened = Date.now();
    pageNum = clamp(rec.page || 1, 1, total);
    docEl.className = 'doc'; docEl.textContent = '';
    titleEl.textContent = rec.name; titleEl.title = rec.name;
    showView('reader');
    // em telas de toque abre sem as barras (como no Kindle); no monitor elas continuam e a tecla H esconde
    app.classList.toggle('immersive', matchMedia('(pointer: coarse)').matches);
    updateHlBtn(); renderHlPanel();
    buildOutline();   // em segundo plano: a primeira página não espera o sumário
    if (S.scroll) await buildScroll({ n: pageNum, ratio: 0, top: true });
    else { await buildPageView(); stage.scrollTop = 0; centerX(); }
    updateUI(); hideToast(); queueSave(true);
    stage.focus({ preventScroll: true });
  }

  /* ---------- pré-carga: o PDF fica aberto em segundo plano, então abrir é quase instantâneo ----------
     Só um PDF fica pré-carregado por vez: o último que você leu (ou o último adicionado), o que você acabou
     de adicionar, ou aquele sobre o qual o mouse parou. A primeira página também já é preparada. */
  let warm = null, hoverT = 0;   // warm: { id, promise }
  function warmDrop() {
    if (!warm) return;
    const w = warm; warm = null;
    w.promise.then((d) => { try { d.destroy(); } catch (e) {} }).catch(() => {});
  }
  // WARM = true mantém o último PDF aberto em segundo plano (abre mais rápido, mas gasta dezenas de MB de RAM)
  const WARM = false;
  function warmBook(id, ready) {
    if (!WARM) { if (ready) { try { ready.destroy(); } catch (e) {} } return; }
    if (!window.pdfjsLib || root.dataset.view !== 'library') return;
    if (warm && warm.id === id) return;
    warmDrop();
    const mine = { id, promise: null };
    mine.promise = (async () => {
      const rec = await getBook(id);
      if (!rec) throw new Error('sem registro');
      let d = ready;
      if (!d) {
        const file = await getFile(id);
        if (!file) throw new Error('sem arquivo');
        d = await pdfjsLib.getDocument({ data: new Uint8Array(await file.blob.arrayBuffer()), isEvalSupported: false }).promise;
      }
      try {   // prepara a página onde você parou: o desenho depois reaproveita o que já foi lido
        const pg = await d.getPage(clamp(rec.page || 1, 1, d.numPages));
        pg.getOperatorList().catch(() => {});
        pg.getTextContent().catch(() => {});
      } catch (e) { /* sem pré-carga da página: abre normal */ }
      return d;
    })();
    mine.promise.catch(() => { if (warm === mine) warm = null; });
    warm = mine;
  }
  function warmRecent() {
    if (!booksCache.length || root.dataset.view !== 'library') return;
    const lastRead = booksCache.filter((b) => b.opened).sort((a, b) => b.lastOpened - a.lastOpened)[0];
    const pick = lastRead || booksCache.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))[0];
    if (pick) setTimeout(() => warmBook(pick.id), 300);   // depois de a biblioteca aparecer
  }
  function hoverWarm(id) {
    if (selMode) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => warmBook(id), 150);
  }

  async function openBook(id) {
    if (!(await loadPdfjs())) { toast(tr('A biblioteca de PDF não carregou. Feche o app e abra de novo.')); return; }
    const w = warm && warm.id === id ? warm : null;
    if (w) warm = null;                       // o PDF pré-carregado passa a ser o aberto
    clearTimeout(hoverT);
    if (!w) toast(tr('Abrindo…'), 0);         // pré-carregado: sem aviso de "Abrindo…"
    try {
      let ready = null;
      if (w) { try { ready = await w.promise; } catch (e) { ready = null; } }
      const rec = await getBook(id);
      if (ready && rec) { await loadPdf(null, rec, ready); return; }
      if (ready) { try { ready.destroy(); } catch (e) {} }
      const file = rec ? await getFile(id) : null;
      if (!rec || !file) { toast(tr('Esse arquivo não está mais na biblioteca.')); await refreshLibrary(); return; }
      await loadPdf(await file.blob.arrayBuffer(), rec);
    } catch (err) {
      console.error(err);
      toast(err && err.name === 'PasswordException'
        ? tr('Este PDF tem senha. Remova a proteção e tente de novo.')
        : tr('Não foi possível abrir este PDF.'));
    }
  }

  async function showLibrary() {
    await flushSave();
    token++;
    stopScroll();
    if (pdf) { try { pdf.destroy(); } catch (e) {} pdf = null; }
    current = null; total = 0; pagePg = null; pagePg2 = null; sizes = null; pre = null; findReset(); statLast = null;
    docEl.textContent = '';
    showView('library');
    await refreshLibrary();
    libraryEl.scrollTop = 0;
  }

  /* Adicionar PDFs à biblioteca (na categoria aberta, se houver).
     Os PDFs novos só aparecem na biblioteca: não abrem sozinhos. */
  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter(isPdf);
    if (!files.length) { toast(tr('Escolha arquivos PDF.')); return; }
    if (!(await loadPdfjs())) { toast(tr('A biblioteca de PDF não carregou. Feche o app e abra de novo.')); return; }

    let openTemp = null, added = 0, failed = 0;
    let kept = null;   // último PDF adicionado: fica aberto em segundo plano para abrir sem espera
    let existing = [];
    try { existing = await listBooks(); } catch (e) { /* segue sem biblioteca */ }
    const category = libCat !== 'all' ? libCat : '';

    for (const file of files) {
      toast(tr('Adicionando {name}…', { name: short(file.name, 48) }), 0);
      try {
        const dup = existing.find((b) => b.name === nameOf(file) && b.size === file.size);
        if (dup) continue;

        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
        const cover = await makeCover(doc).catch(() => '');
        const rec = { id: uid(), name: nameOf(file), size: file.size, addedAt: Date.now(), lastOpened: Date.now(), page: 1, total: doc.numPages, opened: false, cover, category, highlights: [] };
        let keep = false;

        try {
          await putFile(rec.id, file);
          await putBook(rec);
          existing.push(rec);
          openTemp = null; added++;
          if (kept) { try { kept.doc.destroy(); } catch (e) {} }
          kept = { id: rec.id, doc }; keep = true;
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        } catch (storeErr) {
          console.error(storeErr);
          rec.volatile = true;
          openTemp = { rec, buf };
          toast(tr('Não foi possível guardar na biblioteca. O PDF abre, mas não ficará salvo.'), 4000);
        }
        if (!keep) { try { doc.destroy(); } catch (e) {} }
      } catch (err) {
        console.error(err);
        failed++;
      }
    }
    hideToast();
    if (failed) toast(failed === 1 ? tr('Um arquivo não pôde ser lido.') : tr('{n} arquivos não puderam ser lidos.', { n: failed }));
    await refreshLibrary(true);
    if (kept) {
      if (root.dataset.view === 'library') warmBook(kept.id, kept.doc);
      else { try { kept.doc.destroy(); } catch (e) {} }
    }

    if (openTemp) {
      // não coube na biblioteca: abre direto, senão o PDF se perderia
      try { await loadPdf(openTemp.buf, openTemp.rec); }
      catch (err) { console.error(err); toast(tr('Não foi possível abrir este PDF.')); }
      return;
    }
    if (added && !failed) {
      toast(added === 1 ? tr('{n} PDF adicionado.', { n: added }) : tr('{n} PDFs adicionados.', { n: added }));
    } else if (!added && !failed) {
      toast(tr('Esse PDF já está na biblioteca.'));
    }
  }


  /* =======================================================
     Biblioteca: busca, categorias e cartões
     ======================================================= */
  let booksCache = [], libCat = 'all', libQuery = '', libSort = 'recent', libBroken = false; // libCat: 'all' | '' (sem categoria) | nome
  let selMode = false, libVisible = [];     // seleção de vários livros: modo ligado e livros que estão na tela
  const picked = new Set();                 // ids dos livros marcados
  const SHELF_MAX = 8;                      // livros mostrados por prateleira na tela "Todos"

  function allCategories() {
    const set = new Set(S.categories);
    booksCache.forEach((b) => { if (b.category) set.add(b.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, loc()));
  }

  /* Menu suspenso no estilo do Lume (no lugar do <select> do sistema).
     opts: { options: [{ value, label }], value, onChange(valor), search: true|false, label, cls, placeholder }
     Devolve { el, set(valor, texto) }: o set troca o item mostrado sem disparar o onChange
     (o texto opcional permite mostrar valores que não estão na lista, como 152%). */
  let openMenu = null;
  function closeMenu() { if (openMenu) openMenu.close(); }
  function lumeMenu(opts) {
    const box = el('div', { class: 'menu ' + (opts.cls || '') });
    const btn = el('button', { type: 'button', class: 'menu-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': opts.label || tr('Escolher') });
    const txt = el('span', { class: 'menu-txt' });
    btn.append(txt, el('span', { class: 'menu-caret', 'aria-hidden': 'true', text: '▾' }));
    const pop = el('div', { class: 'menu-pop', hidden: true });
    const list = el('div', { class: 'menu-list', role: 'listbox' });
    const search = opts.search ? el('input', { type: 'text', class: 'menu-search', maxlength: '40', autocomplete: 'off', spellcheck: 'false', placeholder: opts.placeholder || tr('Buscar'), 'aria-label': opts.placeholder || tr('Buscar') }) : null;
    if (search) pop.append(search);
    pop.append(list);
    box.append(btn, pop);

    let value = opts.value;
    const labelOf = (v) => (opts.options.find((o) => o.value === v) || opts.options[0]).label;
    txt.textContent = labelOf(value);

    function fill() {
      const q = search ? norm(search.value.trim()) : '';
      list.textContent = '';
      const shown = opts.options.filter((o) => !q || norm(o.label).includes(q));
      for (const o of shown) {
        const it = el('button', { type: 'button', class: 'menu-item', role: 'option', 'aria-selected': String(o.value === value), text: o.label });
        it.addEventListener('click', () => { value = o.value; txt.textContent = o.label; close(); opts.onChange(o.value); });
        list.append(it);
      }
      if (!shown.length) list.append(el('p', { class: 'menu-none', text: tr('Nada encontrado.') }));
    }
    function close() {
      pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (openMenu && openMenu.el === box) openMenu = null;
    }
    function open() {
      closeMenu();
      if (search) search.value = '';
      fill();
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      pop.style.left = '0'; pop.style.right = 'auto'; pop.style.top = 'calc(100% + 4px)'; pop.style.bottom = 'auto';
      const r = pop.getBoundingClientRect(), b = btn.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) { pop.style.left = 'auto'; pop.style.right = '0'; }          // não sai pela direita da janela
      if (r.bottom > window.innerHeight - 8 && b.top > window.innerHeight - b.bottom) { pop.style.top = 'auto'; pop.style.bottom = 'calc(100% + 4px)'; } // abre para cima se faltar espaço embaixo
      openMenu = { el: box, close };
      const sel = list.querySelector('[aria-selected="true"]');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      (search || sel || list.querySelector('.menu-item') || btn).focus({ preventScroll: true });
    }
    btn.addEventListener('click', () => { if (pop.hidden) open(); else close(); });
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && pop.hidden) { e.preventDefault(); open(); } });
    if (search) search.addEventListener('input', fill);
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); return; }
      if (e.key === 'Enter' && e.target === search) { e.preventDefault(); const f = list.querySelector('.menu-item'); if (f) f.click(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = Array.from(list.querySelectorAll('.menu-item')), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowUp' && i <= 0 && search) { search.focus(); return; }
      const n = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      if (items[n]) items[n].focus();
    });
    return { el: box, set: (v, label) => { value = v; txt.textContent = label || labelOf(v); } };
  }

  function coverEl(b) {
    return el('span', { class: 'cover' },
      b.opened ? null : el('span', { class: 'badge', text: tr('NOVO') }),
      b.cover ? el('img', { src: b.cover, alt: '', draggable: 'false' }) : el('span', { class: 'noimg' }));
  }
  const infoText = (b) => (b.opened ? tr('{p}% lido · {t}', { p: progress(b), t: relTime(b.lastOpened) }) : tr(b.total === 1 ? '{n} página' : '{n} páginas', { n: b.total }));
  function progressEl(b) {
    const i = el('i'); i.style.width = progress(b) + '%';
    return el('span', { class: 'progress', 'aria-hidden': 'true' }, i);
  }

  function heroEl(b) {
    return el('button', { type: 'button', class: 'hero', onclick: () => openBook(b.id) },
      coverEl(b),
      el('span', { class: 'hero-text' },
        el('span', { class: 'hero-name', text: short(b.name, 48), title: b.name }),
        el('span', { class: 'hero-info', text: infoText(b) }),
        progressEl(b),
        el('span', { class: 'hero-go', text: tr('Continuar na página {n}', { n: b.page }) })));
  }

  function bookEl(b) {
    const cats = allCategories();
    const del = el('button', { type: 'button', class: 'book-del', 'aria-label': tr('Remover {name} da biblioteca', { name: b.name }), text: tr('Remover') });
    let timer = null;
    del.addEventListener('click', async () => {
      if (!del.classList.contains('armed')) {
        del.classList.add('armed'); del.textContent = tr('Confirmar remoção');
        timer = setTimeout(() => { del.classList.remove('armed'); del.textContent = tr('Remover'); }, 3500);
        return;
      }
      clearTimeout(timer);
      try { await deleteBook(b.id); booksCache = booksCache.filter((x) => x.id !== b.id); } catch (e) { toast(tr('Não foi possível remover.')); }
      renderLibrary();
    });

    let catSel = null;
    if (cats.length) {
      catSel = lumeMenu({
        options: [{ value: '', label: tr('Sem categoria') }].concat(cats.map((c) => ({ value: c, label: c }))),
        value: b.category || '', search: true, placeholder: tr('Buscar categoria'), label: tr('Categoria de {name}', { name: b.name }), cls: 'book-cat-menu',
        onChange: async (v) => {
          b.category = v;
          try { await putBook(b); } catch (e) { toast(tr('Não foi possível mudar a categoria.')); }
          renderLibrary();
        }
      }).el;
    }

    const art = el('article', { class: 'book' + (picked.has(b.id) ? ' picked' : '') },
      el('button', {
        type: 'button', class: 'book-open',
        'aria-label': selMode ? tr('Selecionar {name}', { name: b.name }) : tr('Abrir {name}', { name: b.name }),
        role: selMode ? 'checkbox' : false,
        'aria-checked': selMode ? String(picked.has(b.id)) : false,
        onclick: () => (selMode ? togglePick(b.id, art) : openBook(b.id))
      },
        coverEl(b),
        el('span', { class: 'meta' },
          el('span', { class: 'name', text: b.name, title: b.name }),
          el('span', { class: 'info', text: infoText(b) }),
          b.opened ? progressEl(b) : null)),
      el('span', { class: 'tick', 'aria-hidden': 'true', text: '✓' }),
      el('div', { class: 'book-foot' }, catSel, del));
    art.addEventListener('pointerenter', () => hoverWarm(b.id));
    return art;
  }

  /* Campo de texto no lugar de um botão (criar e renomear categoria) */
  function nameInput(initial, onSubmit, onCancel) {
    const inp = el('input', { type: 'text', class: 'chip-input', maxlength: '40', placeholder: tr('Nome da categoria'), 'aria-label': tr('Nome da categoria'), value: initial || '' });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (ok && inp.value.trim()) onSubmit(inp.value.trim()); else onCancel();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(false));
    return inp;
  }

  function createCategory(name) {
    const found = allCategories().find((c) => norm(c) === norm(name));
    if (!found) { S.categories.push(name); saveSettings(); }
    libCat = found || name;
    renderLibrary();
  }
  async function renameCategory(oldName, newName) {
    const target = allCategories().find((c) => norm(c) === norm(newName) && c !== oldName) || newName;
    S.categories = S.categories.filter((c) => c !== oldName);
    if (!S.categories.includes(target)) S.categories.push(target);
    saveSettings();
    for (const b of booksCache) {
      if (b.category === oldName) { b.category = target; try { await putBook(b); } catch (e) {} }
    }
    libCat = target;
    renderLibrary();
  }
  async function deleteCategory(name) {
    S.categories = S.categories.filter((c) => c !== name);
    saveSettings();
    for (const b of booksCache) {
      if (b.category === name) { b.category = ''; try { await putBook(b); } catch (e) {} }
    }
    libCat = 'all';
    renderLibrary();
  }

  /* ---------- prateleira da tela "Todos": título que recolhe, até SHELF_MAX livros e "Ver todos" ---------- */
  function shelfEl(g, shown) {
    const closed = S.collapsed.includes(g.key);
    const tog = el('button', { type: 'button', class: 'shelf-tog', 'aria-expanded': String(!closed) },
      el('span', { class: 'menu-caret', 'aria-hidden': 'true', text: closed ? '▸' : '▾' }),
      el('span', { class: 'shelf-title', text: g.title + ' (' + g.books.length + ')' }));
    tog.addEventListener('click', () => {
      const i = S.collapsed.indexOf(g.key);
      if (i >= 0) S.collapsed.splice(i, 1); else S.collapsed.push(g.key);
      saveSettings(); renderBody();
    });
    const head = el('div', { class: 'shelf-head' }, tog);
    if (!closed && g.books.length > SHELF_MAX) {
      head.append(el('button', {
        type: 'button', class: 'shelf-more', text: tr('Ver todos ({n})', { n: g.books.length }),
        onclick: () => { libCat = g.cat; libraryEl.scrollTop = 0; renderChips(); renderBody(); }
      }));
    }
    const sec = el('section', { class: 'shelf' }, head);
    if (!closed) {
      const grid = el('div', { class: 'grid' });
      g.books.slice(0, SHELF_MAX).forEach((b) => grid.append(shown(b)));
      sec.append(grid);
    }
    return sec;
  }

  /* ---------- seleção de vários livros ---------- */
  function resetSelect() { selMode = false; picked.clear(); libSel.hidden = true; libSel.textContent = ''; }
  function enterSelect() { selMode = true; renderBody(); renderSel(); }
  function exitSelect() { resetSelect(); renderBody(); }
  function togglePick(id, art) {
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    const on = picked.has(id);
    art.classList.toggle('picked', on);
    const o = art.querySelector('.book-open');
    if (o) o.setAttribute('aria-checked', String(on));
    renderSel();
  }
  function ensureCategory(name) {
    const found = allCategories().find((c) => norm(c) === norm(name));
    if (found) return found;
    S.categories.push(name); saveSettings();
    return name;
  }
  async function moveSelected(cat) {
    const n = picked.size;
    let fail = false;
    for (const b of booksCache) {
      if (!picked.has(b.id)) continue;
      b.category = cat;
      try { await putBook(b); } catch (e) { fail = true; }
    }
    resetSelect();
    renderLibrary();
    toast(fail ? tr('Não foi possível mudar a categoria.') : tr(n === 1 ? '1 livro movido.' : '{n} livros movidos.', { n }), 2200);
  }
  async function removeSelected() {
    let fail = false;
    for (const id of Array.from(picked)) {
      try { await deleteBook(id); booksCache = booksCache.filter((x) => x.id !== id); } catch (e) { fail = true; }
    }
    resetSelect();
    renderLibrary();
    if (fail) toast(tr('Não foi possível remover.'));
  }
  function renderSel() {
    libSel.textContent = '';
    libSel.hidden = !selMode || root.dataset.view !== 'library';
    if (libSel.hidden) return;
    const n = picked.size;
    libSel.append(el('span', { class: 'libsel-n', text: n === 0 ? tr('Nenhum selecionado') : n === 1 ? tr('1 selecionado') : tr('{n} selecionados', { n }) }));
    libSel.append(el('button', {
      type: 'button', text: tr('Selecionar todos'),
      onclick: () => { libVisible.forEach((id) => picked.add(id)); renderBody(); renderSel(); }
    }));
    if (n) {
      const cats = allCategories();
      const mv = lumeMenu({
        options: [{ value: '__ph', label: tr('Mover para…') }, { value: '', label: tr('Sem categoria') }]
          .concat(cats.map((c) => ({ value: c, label: c })), [{ value: '__new', label: tr('+ Nova categoria…') }]),
        value: '__ph', search: cats.length > 6, placeholder: tr('Buscar categoria'), label: tr('Mover para categoria'), cls: 'libsel-menu',
        onChange: (v) => {
          if (v === '__ph') return;
          if (v === '__new') {
            const inp = nameInput('', (name) => moveSelected(ensureCategory(name)), renderSel);
            mv.el.replaceWith(inp); inp.focus();
            return;
          }
          moveSelected(v);
        }
      });
      libSel.append(mv.el);
      const rm = el('button', { type: 'button', text: tr('Remover') });
      let t = null;
      rm.addEventListener('click', () => {
        if (!rm.classList.contains('armed')) {
          rm.classList.add('armed'); rm.textContent = tr('Confirmar remoção');
          t = setTimeout(() => { rm.classList.remove('armed'); rm.textContent = tr('Remover'); }, 3500);
          return;
        }
        clearTimeout(t); removeSelected();
      });
      libSel.append(rm);
    }
    libSel.append(el('button', { type: 'button', text: tr('Cancelar'), onclick: exitSelect }));
  }

  /* ---------- lista lateral de categorias ---------- */
  function renderChips() {
    chipsEl.textContent = '';
    const cats = allCategories();
    const uncategorized = booksCache.filter((b) => !b.category).length;
    if (libCat !== 'all' && libCat !== '' && !cats.includes(libCat)) libCat = 'all';
    if (libCat === '' && (!cats.length || !uncategorized)) libCat = 'all';

    const item = (label, value, n) => el('button', {
      type: 'button', class: 'cat', 'aria-pressed': String(libCat === value), title: label,
      onclick: () => { libCat = value; libraryEl.scrollTop = 0; renderChips(); renderBody(); }
    }, el('span', { class: 'cat-name', text: label }), n != null ? el('span', { class: 'n', text: String(n) }) : null);

    chipsEl.append(item(tr('Todos'), 'all', booksCache.length));
    cats.forEach((c) => chipsEl.append(item(c, c, booksCache.filter((b) => b.category === c).length)));
    if (cats.length && uncategorized) chipsEl.append(item(tr('Sem categoria'), '', uncategorized));

    const add = el('button', { type: 'button', class: 'cat add', text: tr('+ Categoria') });
    add.addEventListener('click', () => {
      const inp = nameInput('', createCategory, renderChips);
      add.replaceWith(inp); inp.focus();
    });
    chipsEl.append(add);
  }

  function renderBody() {
    libBody.textContent = '';
    libBody.classList.toggle('selecting', selMode);
    libVisible = [];
    if (libBroken) {
      libBody.append(el('div', { class: 'lib-empty' },
        el('div', { class: 'ghost', 'aria-hidden': 'true' }),
        el('h2', { text: tr('Biblioteca indisponível') }),
        el('p', { text: tr('Este ambiente não deixou guardar arquivos. Você ainda pode abrir um PDF, mas ele não ficará salvo.') }),
        el('button', { type: 'button', class: 'primary', text: tr('Abrir PDF sem salvar'), onclick: openDialog })));
      return;
    }
    if (!booksCache.length) {
      libBody.append(el('div', { class: 'lib-empty' },
        el('div', { class: 'ghost', 'aria-hidden': 'true' }),
        el('h2', { text: tr('Sua biblioteca está vazia') }),
        el('p', { text: tr('Adicione um PDF para ler com tela de papel, sépia, e-ink ou noite. Ele fica guardado neste computador, com a última página lida e suas marcações.') }),
        el('button', { type: 'button', class: 'primary', text: tr('Adicionar PDF'), onclick: openDialog }),
        el('p', { text: tr('Você também pode arrastar os arquivos para esta janela.') }),
        el('button', { type: 'button', text: tr('Restaurar backup'), onclick: openBackupDialog })));
      return;
    }

    const q = norm(libQuery.trim());
    let list = booksCache.slice().sort((a, b) =>
      libSort === 'title' ? a.name.localeCompare(b.name, loc()) :
      libSort === 'progress' ? progress(b) - progress(a) : b.lastOpened - a.lastOpened);
    if (libCat !== 'all') list = list.filter((b) => (b.category || '') === libCat);
    if (q) list = list.filter((b) => norm(b.name).includes(q) || norm(b.category).includes(q));
    const filtering = !!q || libCat !== 'all';
    const cats = allCategories();
    const shelves = !filtering && cats.length > 0;   // "Todos" com categorias: prateleiras

    const recent = !filtering ? booksCache.filter((b) => b.opened).sort((a, b) => b.lastOpened - a.lastOpened)[0] : null;
    if (recent) {
      libBody.append(el('section', { class: 'lib-sec' }, el('h2', { text: tr('Continuar lendo') }), heroEl(recent)));
    }

    if (!filtering && statsHasData()) libBody.append(statsEl());

    // Cabeçalho da lista
    const realCat = libCat !== 'all' && libCat !== '';
    let head;
    if (q) head = el('h2', { text: list.length === 1 ? tr('1 resultado') : tr('{n} resultados', { n: list.length }) });
    else if (realCat) head = el('h2', { text: libCat + ' (' + list.length + ')' });
    else if (libCat === '') head = el('h2', { text: tr('Sem categoria') + ' (' + list.length + ')' });
    else head = el('h2', { text: booksCache.length === 1 ? tr('1 PDF na biblioteca') : tr('{n} PDFs na biblioteca', { n: booksCache.length }) });

    const headRow = el('div', { class: 'sec-head' }, head);
    const acts = el('div', { class: 'sec-actions' });
    if (realCat && !q) {
      const ren = el('button', { type: 'button', text: tr('Renomear') });
      ren.addEventListener('click', () => {
        const inp = nameInput(libCat, (v) => renameCategory(libCat, v), renderBody);
        head.replaceWith(inp); ren.disabled = true; inp.focus(); inp.select();
      });
      const rem = el('button', { type: 'button', text: tr('Excluir categoria') });
      let t = null;
      rem.addEventListener('click', () => {
        if (!rem.classList.contains('armed')) {
          rem.classList.add('armed'); rem.textContent = tr('Confirmar exclusão');
          t = setTimeout(() => { rem.classList.remove('armed'); rem.textContent = tr('Excluir categoria'); }, 3500);
          return;
        }
        clearTimeout(t); deleteCategory(libCat);
      });
      acts.append(ren, rem);
    }
    if (shelves) acts.append(el('button', { type: 'button', class: 'cta', text: tr('Adicionar PDF'), onclick: openDialog }));
    acts.append(el('button', {
      type: 'button', class: selMode ? 'armed' : '', text: selMode ? tr('Cancelar seleção') : tr('Selecionar'),
      onclick: () => (selMode ? exitSelect() : enterSelect())
    }));
    headRow.append(acts);

    const shown = (b) => { libVisible.push(b.id); return bookEl(b); };
    if (shelves) {
      const groups = cats.map((c) => ({ key: c, title: c, cat: c, books: list.filter((b) => b.category === c) }));
      groups.push({ key: '__none__', title: tr('Sem categoria'), cat: '', books: list.filter((b) => !b.category) });
      const wrapEl = el('div', { class: 'shelves' });
      groups.filter((g) => g.books.length).forEach((g) => wrapEl.append(shelfEl(g, shown)));
      libBody.append(el('section', { class: 'lib-sec' }, headRow, wrapEl));
    } else {
      const grid = el('div', { class: 'grid' });
      if (!q) {
        grid.append(el('button', { type: 'button', class: 'add-card', onclick: openDialog },
          el('span', { class: 'plus', text: '+' }),
          el('span', { text: realCat ? tr('Adicionar em {name}', { name: libCat }) : tr('Adicionar PDF') })));
      }
      list.forEach((b) => grid.append(shown(b)));
      libBody.append(el('section', { class: 'lib-sec' }, headRow, grid));

      if (!list.length) {
        libBody.append(el('p', { class: 'lib-none', text: q ? tr('Nenhum livro encontrado para “{q}”.', { q: libQuery.trim() }) : tr('Nenhum livro nesta categoria ainda.') }));
      }
    }

    libBody.append(backupEl());
    const note = el('p', { class: 'lib-foot', text: native ? tr('Os PDFs ficam guardados no seu computador, nos dados do app.') : tr('Os PDFs ficam guardados só neste navegador, no seu aparelho.') });
    libBody.append(note);
    storageNote().then((t2) => { if (t2) note.textContent += t2; });
  }

  async function storageNote() {
    try {
      const e = await navigator.storage.estimate();
      const mb = e.usage / 1048576;
      return ' ' + tr('({n} MB usados)', { n: mb < 10 ? mb.toFixed(1) : Math.round(mb) });
    } catch (err) { return ''; }
  }

  function renderLibrary() {
    const hide = libBroken || !booksCache.length;
    if (hide) resetSelect();
    libTools.hidden = hide;
    chipsEl.hidden = hide;
    libLayout.classList.toggle('with-side', !hide);
    renderChips();
    renderBody();
    renderSel();
  }

  async function refreshLibrary(noWarm) {
    libBroken = false;
    try { booksCache = await listBooks(); }
    catch (e) {
      console.error('listBooks falhou:', e);
      booksCache = []; libBroken = true;
      toast('Erro no banco: ' + ((e && e.name) || '') + ' ' + ((e && e.message) || ''), 9000);
    }
    renderLibrary();
    if (!noWarm) warmRecent();
  }

  /* =======================================================
     Busca no PDF (Ctrl+F)
     ======================================================= */
  let findQ = '', findList = [], findIdx = -1, findCur = null, findTexts = null, findTextsP = null, findToken = 0, findTimer = null;

  // Minúsculas, sem acentos e com espaços iguais; guarda de onde veio cada letra para achar o trecho original
  function normMap(str) {
    let out = '';
    const map = [];
    for (let i = 0; i < str.length; i++) {
      const ch = /\s/.test(str[i]) ? ' ' : str[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (ch === ' ' && (out === '' || out[out.length - 1] === ' ')) continue;   // espaços repetidos viram um só
      for (let j = 0; j < ch.length; j++) { out += ch[j]; map.push(i); }
    }
    return { out, map };
  }
  const normQuery = (str) => normMap(str).out.replace(/ +/g, ' ').trim();
  function occurrences(t, q, cap) {
    const out = [];
    let i = t.indexOf(q);
    while (i !== -1 && out.length < cap) { out.push(i); i = t.indexOf(q, i + q.length); }
    return out;
  }

  // Lê o texto de todas as páginas uma vez (fica guardado até trocar de PDF)
  async function ensureFindText() {
    if (findTexts) return findTexts;
    if (!findTextsP) {
      const doc = pdf;
      findTextsP = (async () => {
        const list = new Array(total);
        for (let n = 1; n <= total; n++) {
          if (pdf !== doc) return null;
          const page = await doc.getPage(n), tc = await page.getTextContent();
          let t = '';
          for (const it of tc.items) { if (it.str) t += it.str; if (it.hasEOL) t += ' '; }
          list[n - 1] = normMap(t).out;
          if (n % 8 === 0) { findCount.textContent = tr('Lendo o texto… {n}%', { n: Math.round(n / total * 100) }); await new Promise((r) => setTimeout(r)); }
        }
        if (pdf !== doc) return null;
        findTexts = list;
        return list;
      })();
    }
    const res = await findTextsP;
    findTextsP = null;
    return res;
  }

  // Marca os resultados na página (usa o mesmo desenho da seleção, colado no texto)
  function paintFind(p) {
    p.fm.textContent = '';
    if (!findQ || !p.base || !p.text.firstChild) return;
    const nodes = [];
    let full = '';
    for (const ch of p.text.childNodes) {
      if (ch.nodeType === 1 && ch.tagName === 'BR') { full += ' '; continue; }
      const t = ch.firstChild;
      if (t && t.nodeType === 3) { nodes.push({ t, s: full.length, e: full.length + t.length }); full += t.data; }
    }
    const { out, map } = normMap(full);
    const hits = occurrences(out, findQ, 300);
    if (!hits.length) return;
    const pr = p.el.getBoundingClientRect(), rg = document.createRange(), frag = document.createDocumentFragment();
    const at = (pos) => nodes.find((x) => pos >= x.s && pos < x.e);
    const curK = findCur && findCur.page === p.n ? Math.min(findCur.k, hits.length - 1) : -1;
    hits.forEach((hit, k) => {
      const a = map[hit], b = map[hit + findQ.length - 1] + 1;
      const na = at(a), nb = at(b - 1);
      if (!na || !nb) return;
      rg.setStart(na.t, a - na.s); rg.setEnd(nb.t, b - nb.s);
      for (const r of lineRects(p, Array.from(rg.getClientRects()), rg)) {
        const d = document.createElement('div');
        d.className = 'fmark' + (k === curK ? ' cur' : '');
        d.style.left = (r.l - pr.left) + 'px'; d.style.top = (r.t - pr.top) + 'px';
        d.style.width = (r.r - r.l) + 'px'; d.style.height = (r.b - r.t) + 'px';
        frag.appendChild(d);
      }
    });
    p.fm.replaceChildren(frag);
  }
  const paintFindAll = () => activePgs().forEach(paintFind);

  function revealFind() {
    const m = document.querySelector('.fmark.cur');
    if (!m) return;
    const r = m.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    if (r.top < sr.top + sr.height * 0.12 || r.bottom > sr.bottom - sr.height * 0.12) stage.scrollTop += r.top - sr.top - sr.height * 0.35;
    if (r.left < sr.left || r.right > sr.right) stage.scrollLeft += r.left - sr.left - sr.width * 0.3;
  }

  async function findShow() {
    const m = findList[findIdx];
    if (!m) return;
    findCur = m;
    findCount.textContent = tr('{i} de {n}', { i: findIdx + 1, n: findList.length });
    await goPage(m.page);
    for (let i = 0; i < 50; i++) {                     // no modo rolagem a página pode demorar um pouco para ser desenhada
      const p = activePgs().find((q) => q.n === m.page);
      if (p && p.ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    paintFindAll(); revealFind();
  }
  function findStep(d) {
    if (!findList.length) return;
    findIdx = (findIdx + d + findList.length) % findList.length;
    findShow();
  }
  async function findRun() {
    const my = ++findToken;
    const q = normQuery(findIn.value);
    findQ = q.length >= 2 ? q : '';
    findList = []; findIdx = -1; findCur = null;
    paintFindAll();
    if (!findQ) { findCount.textContent = q ? tr('Digite mais uma letra') : ''; return; }
    const texts = await ensureFindText();
    if (!texts || my !== findToken) return;
    for (let n = 1; n <= total; n++) occurrences(texts[n - 1], findQ, 500).forEach((_, k) => findList.push({ page: n, k }));
    if (!findList.length) { findCount.textContent = tr('Nenhum resultado'); return; }
    const i = findList.findIndex((m) => m.page >= pageNum);   // começa no primeiro resultado a partir da página atual
    findIdx = i < 0 ? 0 : i;
    findShow();
  }
  function openFind() {
    if (!reading()) return;
    closePanels(); hideBar();
    findBar.hidden = false;
    findIn.focus(); findIn.select();
    if (findIn.value.trim() && !findQ) findRun();
  }
  function closeFind() {
    if (findBar.hidden && !findQ) return;
    findBar.hidden = true; findToken++; clearTimeout(findTimer);
    findQ = ''; findList = []; findIdx = -1; findCur = null; findCount.textContent = '';
    paintFindAll();
    if (reading()) stage.focus({ preventScroll: true });
  }
  function findReset() {                               // ao trocar de PDF
    findToken++; clearTimeout(findTimer);
    findQ = ''; findList = []; findIdx = -1; findCur = null; findTexts = null; findTextsP = null;
    findBar.hidden = true; findCount.textContent = '';
  }

  /* =======================================================
     Painéis
     ======================================================= */
  function closePanels() {
    tocPanel.hidden = true; hlPanel.hidden = true; setPanel.hidden = true; keysPanel.hidden = true;
    setBtn.setAttribute('aria-expanded', 'false');
  }
  function togglePanel(which) {
    const panel = which === 'toc' ? tocPanel : which === 'hl' ? hlPanel : which === 'keys' ? keysPanel : setPanel;
    const open = panel.hidden;
    closePanels();
    if (!open) return;
    if (which === 'hl') renderHlPanel();
    panel.hidden = false;
    if (which === 'set') setBtn.setAttribute('aria-expanded', 'true');
    if (which === 'toc') { const c = tocList.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'center' }); }
  }
  const panelsOpen = () => !tocPanel.hidden || !hlPanel.hidden || !setPanel.hidden || !keysPanel.hidden;


  /* =======================================================
     Rolagem automática (a página vai descendo sozinha)
     ======================================================= */
  const autoPill = $('#autoPill');
  let autoOn = false, autoRaf = 0, autoLast = 0, autoPos = 0, autoBusy = false;
  const autoSpeed = () => 6 * Math.pow(1.507, S.autoSpeed - 1); // pixels por segundo (de 6 no nível 1 a cerca de 240 no 10)
  function updateAutoUI() {
    const b = $('#autoBtn');
    b.setAttribute('aria-pressed', String(autoOn));
    b.textContent = autoOn ? tr('Desligar') : tr('Ligar');
    autoPill.hidden = !autoOn;
  }
  function autoStop() { autoOn = false; cancelAnimationFrame(autoRaf); updateAutoUI(); }
  function autoStart() {
    if (!reading()) { toast(tr('Abra um PDF para usar a rolagem automática.')); return; }
    if (autoOn) return;
    autoOn = true; autoBusy = false; autoPos = stage.scrollTop; autoLast = performance.now();
    autoRaf = requestAnimationFrame(autoTick);
    updateAutoUI();
  }
  function autoTick(t) {
    if (!autoOn) return;
    autoRaf = requestAnimationFrame(autoTick);
    const dt = Math.min(100, t - autoLast) / 1000;
    autoLast = t;
    if (autoBusy) return;
    const max = Math.max(0, stage.scrollHeight - stage.clientHeight);
    if (autoPos <= max && Math.abs(stage.scrollTop - autoPos) > 2) autoPos = stage.scrollTop; // a pessoa rolou à mão
    autoPos += dt * autoSpeed();
    if (S.scroll) {
      if (autoPos >= max) { stage.scrollTop = max; autoStop(); toast(tr('Fim do documento.'), 1800); return; }
      stage.scrollTop = autoPos;
      return;
    }
    // página a página: rola a página e, no fim, passa para a próxima.
    // Se a página já cabe inteira na tela, não há o que rolar: conta o tempo de uma tela de leitura e então passa a página.
    const fits = max <= 6;
    const limit = fits ? stage.clientHeight * 0.9 : max + stage.clientHeight * 0.3;
    if (autoPos < limit) { if (!fits) stage.scrollTop = Math.min(autoPos, max); return; }
    const last = spreadPages(pageNum);
    if (last[last.length - 1] >= total) { autoStop(); toast(tr('Fim do documento.'), 1800); return; }
    autoBusy = true;
    goNext().then(() => { autoPos = stage.scrollTop; autoLast = performance.now(); autoBusy = false; });
  }

  /* =======================================================
     Estatísticas de leitura (tempo e páginas por dia, meta e sequência)
     ======================================================= */
  let stats = { days: {} }, statLast = null, statDirty = false, statTick = 0, lastAct = Date.now();
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
  function loadStats() {
    try {
      const o = JSON.parse(localStorage.getItem('folha:stats') || 'null');
      if (o && o.days && typeof o.days === 'object') stats = { days: o.days };
    } catch (e) { /* sem estatísticas salvas */ }
  }
  function saveStats() {
    if (!statDirty) return;
    statDirty = false;
    try { localStorage.setItem('folha:stats', JSON.stringify(stats)); } catch (e) {}
  }
  const dayStat = () => { const k = dayKey(); return stats.days[k] || (stats.days[k] = { sec: 0, pages: 0 }); };
  function addTime() {
    const d = dayStat();
    d.sec++; statDirty = true;
    if (d.sec === S.goalMin * 60) toast(tr('Meta de leitura de hoje concluída!'), 4000);
    if (++statTick % 15 === 0) saveStats();
  }
  // Conta páginas lidas: só avanços pequenos (virar página), não pulos pelo slider ou pelo sumário
  function trackPage() {
    if (!reading()) return;
    if (statLast !== null) {
      const d = pageNum - statLast;
      if (d > 0 && d <= 3) { dayStat().pages += d; statDirty = true; }
    }
    statLast = pageNum;
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true }));
  stage.addEventListener('scroll', () => { lastAct = Date.now(); }, { passive: true });
  // Conta o tempo só com o app à vista, em foco e com atividade recente (ou rolagem automática ligada)
  setInterval(() => {
    if (!reading() || document.hidden || !document.hasFocus()) return;
    if (!autoOn && Date.now() - lastAct > 120000) return;
    addTime();
  }, 1000);

  const fmtTime = (sec) => { const m = Math.floor(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad2(m % 60) + ' min'; };
  const statsHasData = () => Object.values(stats.days).some((d) => d && d.sec >= 30);
  function streakDays() {
    let n = 0;
    const d = new Date();
    if (!(((stats.days[dayKey(d)] || {}).sec || 0) >= 60)) d.setDate(d.getDate() - 1);   // hoje ainda sem leitura: conta a partir de ontem
    while (((stats.days[dayKey(d)] || {}).sec || 0) >= 60) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function statsEl() {
    const goal = S.goalMin * 60, today = (stats.days[dayKey()] || {}).sec || 0;
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const st = stats.days[dayKey(d)] || {};
      week.push({ d, sec: st.sec || 0, pages: st.pages || 0 });
    }
    const weekSec = week.reduce((a, w) => a + w.sec, 0), weekPages = week.reduce((a, w) => a + w.pages, 0);
    const top = Math.max(goal, ...week.map((w) => w.sec));
    const bars = el('div', { class: 'bars', 'aria-hidden': 'true' }, ...week.map((w) => {
      const i = el('i');
      i.style.height = w.sec ? Math.max(8, Math.round(w.sec / top * 100)) + '%' : '2px';
      return el('span', { class: 'bcol' },
        el('span', { class: 'btrack' }, i),
        el('b', { text: w.d.toLocaleDateString(loc(), { weekday: 'narrow' }).toUpperCase() }));
    }));
    const fill = el('i'); fill.style.width = Math.min(100, Math.round(today / goal * 100)) + '%';
    const n = streakDays();
    return el('section', { class: 'lib-sec' },
      el('h2', { text: tr('Sua leitura') }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' },
          el('span', { class: 'k', text: tr('Hoje') }),
          el('span', { class: 'v', text: fmtTime(today) }),
          el('span', { class: 'progress', 'aria-hidden': 'true' }, fill),
          el('span', { class: 's', text: today >= goal ? tr('Meta de {n} min concluída', { n: S.goalMin }) : tr('Meta: {n} min por dia', { n: S.goalMin }) })),
        el('div', { class: 'stat' },
          el('span', { class: 'k', text: tr('Sequência') }),
          el('span', { class: 'v', text: tr(n === 1 ? '{n} dia' : '{n} dias', { n }) }),
          el('span', { class: 's', text: tr('seguidos, com ao menos 1 min de leitura') })),
        el('div', { class: 'stat' },
          el('span', { class: 'k', text: tr('Últimos 7 dias') }),
          el('span', { class: 'v', text: fmtTime(weekSec) }),
          bars,
          el('span', { class: 's', text: tr(weekPages === 1 ? '{n} página' : '{n} páginas', { n: weekPages }) }))));
  }

  /* =======================================================
     Régua de leitura (modo foco): escurece tudo menos uma faixa que segue o mouse ou o dedo
     ======================================================= */
  let rulerY = null, rulerRaf = 0;
  function applyRuler() {
    const on = !!S.ruler && reading();
    rulerWrap.hidden = !on;
    const b = $('#rulerBtn');
    b.setAttribute('aria-pressed', String(!!S.ruler));
    b.textContent = S.ruler ? tr('Desligar') : tr('Ligar');
    if (!on) return;
    const h = wrap.clientHeight;
    if (rulerY === null) rulerY = h / 2;
    ruler.style.height = S.rulerH + 'px';
    ruler.style.top = clamp(rulerY - S.rulerH / 2, 0, Math.max(0, h - S.rulerH)) + 'px';
  }
  ['pointermove', 'pointerdown'].forEach((ev) => wrap.addEventListener(ev, (e) => {
    if (!S.ruler || !reading() || rulerRaf) return;
    const y = e.clientY;
    rulerRaf = requestAnimationFrame(() => { rulerRaf = 0; rulerY = y - wrap.getBoundingClientRect().top; applyRuler(); });
  }));
  function toggleRuler() { S.ruler = !S.ruler; saveSettings(); applyRuler(); }

  /* =======================================================
     Backup e restauração da biblioteca (um arquivo .lume com PDFs, progresso, marcações e metas)
     Formato: "LUMEBK01" (backups antigos, "FOLHABK1", também são aceitos) + tamanho do índice (4 bytes) + índice em JSON + os PDFs, um depois do outro.
     ======================================================= */
  const BACKUP_MAGIC = 'LUMEBK01', OLD_BACKUP_MAGIC = 'FOLHABK1';
  const bkErr = (k) => Object.assign(new Error(k), { user: true });   // erro com mensagem própria para mostrar à pessoa
  function openBackupDialog() { backupFile.value = ''; backupFile.click(); }
  function backupEl() {
    return el('div', { class: 'lib-actions' },
      el('button', { type: 'button', text: tr('Fazer backup'), onclick: exportBackup }),
      el('button', { type: 'button', text: tr('Restaurar backup'), onclick: openBackupDialog }));
  }
  async function exportBackup() {
    toast(tr('Preparando backup…'), 0);
    try {
      const [books, files] = await Promise.all([listBooks(), run('files', 'readonly', (st) => st.getAll())]);
      const blobs = new Map(files.map((f) => [f.id, f.blob]));
      const items = books.filter((b) => blobs.has(b.id));
      if (!items.length) { toast(tr('A biblioteca está vazia.')); return; }
      saveStats();
      const manifest = { app: 'lume', version: 1, date: Date.now(), settings: S, stats, books: items.map((b) => ({ rec: b, size: blobs.get(b.id).size })) };
      const json = new TextEncoder().encode(JSON.stringify(manifest));
      const head = new Uint8Array(12);
      head.set(new TextEncoder().encode(BACKUP_MAGIC), 0);
      new DataView(head.buffer).setUint32(8, json.length);
      saveBlob(new Blob([head, json, ...items.map((b) => blobs.get(b.id))], { type: 'application/octet-stream' }), 'lume-backup-' + dayKey() + '.lume');
      toast(tr(items.length === 1 ? 'Backup criado com {n} PDF.' : 'Backup criado com {n} PDFs.', { n: items.length }), 3000);
    } catch (err) {
      console.error(err);
      toast(tr('Não foi possível criar o backup.'));
    }
  }
  async function importBackup(file) {
    toast(tr('Lendo backup…'), 0);
    try {
      const dec = new TextDecoder();
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (head.length < 12 || ![BACKUP_MAGIC, OLD_BACKUP_MAGIC].includes(dec.decode(head.slice(0, 8)))) throw bkErr('Arquivo de backup inválido.');
      const jlen = new DataView(head.buffer).getUint32(8);
      if (12 + jlen > file.size) throw bkErr('Arquivo de backup incompleto.');
      const man = JSON.parse(dec.decode(await file.slice(12, 12 + jlen).arrayBuffer()));
      if (!man || !['lume', 'folha'].includes(man.app) || !Array.isArray(man.books)) throw bkErr('Arquivo de backup inválido.');

      const existing = await listBooks();
      const wasEmpty = !existing.length;
      let off = 12 + jlen, added = 0, skipped = 0;
      for (const it of man.books) {
        const rec = it && it.rec, size = it && it.size;
        if (!rec || !rec.id || !(size >= 0) || off + size > file.size) throw bkErr('Arquivo de backup incompleto.');
        const blob = file.slice(off, off + size, 'application/pdf');
        off += size;
        rec.name = String(rec.name || 'Sem título');
        if (existing.some((b) => b.name === rec.name && b.size === rec.size)) { skipped++; continue; }   // já está na biblioteca
        if (existing.some((b) => b.id === rec.id)) rec.id = uid();
        toast(tr('Restaurando {name}…', { name: short(rec.name, 40) }), 0);
        await putFile(rec.id, blob);
        await putBook(rec);
        existing.push(rec); added++;
      }

      // categorias, preferências (só numa biblioteca vazia) e estatísticas
      const st = man.settings && typeof man.settings === 'object' ? man.settings : null;
      if (st && Array.isArray(st.categories)) st.categories.forEach((c) => { if (typeof c === 'string' && !S.categories.includes(c)) S.categories.push(c); });
      if (st && wasEmpty) {
        try { localStorage.setItem('folha:settings', JSON.stringify(st)); } catch (e) {}
        loadSettings();
      }
      saveSettings(); applyView();
      const md = man.stats && man.stats.days;
      if (md && typeof md === 'object') {
        for (const k in md) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
          const a = md[k] || {}, b = stats.days[k] || { sec: 0, pages: 0 };
          stats.days[k] = { sec: Math.max(Number(a.sec) || 0, b.sec), pages: Math.max(Number(a.pages) || 0, b.pages) };
        }
        statDirty = true; saveStats();
      }
      await refreshLibrary();
      toast(added
        ? tr(added === 1 ? '{n} PDF restaurado' : '{n} PDFs restaurados', { n: added }) + (skipped ? tr(' ({k} já estavam na biblioteca).', { k: skipped }) : '.')
        : tr('Todos os PDFs do backup já estavam na biblioteca.'), 4000);
    } catch (err) {
      console.error(err);
      toast(err && err.user ? tr(err.message) : tr('Não foi possível restaurar este backup.'), 4000);
    }
  }


  /* =======================================================
     Eventos
     ======================================================= */
  function openDialog() { fileIn.value = ''; fileIn.click(); }
  $('#libBtn').addEventListener('click', showLibrary);
  const addBtnEl = $('#addBtn');
  if (addBtnEl) addBtnEl.addEventListener('click', openDialog);
  fileIn.addEventListener('change', () => importFiles(fileIn.files));
  tocBtn.addEventListener('click', () => togglePanel('toc'));
  hlBtn.addEventListener('click', () => togglePanel('hl'));
  setBtn.addEventListener('click', () => togglePanel('set'));
  $('#autoBtn').addEventListener('click', () => { if (autoOn) autoStop(); else autoStart(); });
  $('#autoSpeed').addEventListener('input', (e) => { S.autoSpeed = Number(e.target.value); $('#autoSpeedVal').textContent = S.autoSpeed + '/10'; saveSettings(); });
  autoPill.addEventListener('click', autoStop);

  searchIn.addEventListener('input', () => { libQuery = searchIn.value; renderBody(); });
  searchIn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); searchIn.value = ''; libQuery = ''; renderBody(); searchIn.blur(); }
  });

  document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#layoutSeg button').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));
  document.querySelectorAll('#fitSeg button').forEach((b) => b.addEventListener('click', () => {
    S.fit = b.dataset.fit; applyView(); saveSettings(); saveBookView(); render();
  }));
  $('#bright').addEventListener('input', (e) => { S.brightness = Number(e.target.value); applyView(); saveSettings(); });
  $('#warm').addEventListener('input', (e) => { S.warm = Number(e.target.value); applyView(); saveSettings(); });
  // Texto mais escuro: redesenhar a página é pesado, então só redesenha ao soltar o controle
  $('#ink').addEventListener('input', (e) => { $('#inkVal').textContent = e.target.value + '%'; });
  $('#ink').addEventListener('change', (e) => { S.ink = Number(e.target.value); saveSettings(); if (pdf) render(); });
  $('#zoomIn').addEventListener('click', () => setZoom(S.zoom * 1.15));
  $('#zoomOut').addEventListener('click', () => setZoom(S.zoom / 1.15));
  $('#coverAlone').addEventListener('change', (e) => { S.coverAlone = e.target.checked; saveSettings(); if (pdf && dualOn()) render(); });
  $('#crop').addEventListener('change', (e) => { S.crop = e.target.checked; saveSettings(); saveBookView(); render(); });
  $('#dither').addEventListener('change', (e) => { S.dither = e.target.checked; saveSettings(); if (S.mode === 'eink') render(); });
  $('#color').addEventListener('change', (e) => { S.color = e.target.checked; applyView(); saveSettings(); if (S.mode === 'eink' && pdf) render(); });
  $('#scrollMode').addEventListener('change', (e) => setScroll(e.target.checked));

  // Os menus (ordenar, tons de cinza, atualização, idioma, zoom, pesquisar) são criados em buildMenus(), no idioma escolhido

  // Favoritos, notas e exportação
  bmBtn.addEventListener('click', () => toggleBookmark());
  noteBtn.addEventListener('click', () => { if (bar.id) openNote(bar.id); });
  hlTabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { hlTab = b.dataset.tab; renderHlPanel(); }));
  $('#exportBtn').addEventListener('click', exportNotes);
  // Lista de atalhos
  $('#keysBtn').addEventListener('click', () => togglePanel('keys'));
  $('#keysClose').addEventListener('click', closePanels);
  // Régua, meta e backup
  $('#rulerBtn').addEventListener('click', toggleRuler);
  $('#rulerH').addEventListener('input', (e) => { S.rulerH = Number(e.target.value); $('#rulerHVal').textContent = S.rulerH + ' px'; saveSettings(); applyRuler(); });
  $('#goal').addEventListener('input', (e) => { S.goalMin = Number(e.target.value); $('#goalVal').textContent = S.goalMin + ' min'; saveSettings(); });
  backupFile.addEventListener('change', () => { if (backupFile.files[0]) importBackup(backupFile.files[0]); });

  findIn.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(findRun, 300); });
  findIn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); clearTimeout(findTimer);
    if (normQuery(findIn.value) !== findQ) findRun(); else findStep(e.shiftKey ? -1 : 1);
  });
  $('#findNext').addEventListener('click', () => findStep(1));
  $('#findPrev').addEventListener('click', () => findStep(-1));
  $('#findClose').addEventListener('click', closeFind);

  $('#prevBtn').addEventListener('click', () => goPrev());
  $('#nextBtn').addEventListener('click', () => goNext());
  slider.addEventListener('input', () => { pageIn.value = slider.value; });
  slider.addEventListener('change', () => goPage(Number(slider.value)));
  pageIn.addEventListener('change', () => goPage(Number(pageIn.value)));
  pageIn.addEventListener('focus', () => pageIn.select());
  pageIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); goPage(Number(pageIn.value)); stage.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { e.preventDefault(); pageIn.value = String(pageNum); stage.focus({ preventScroll: true }); }
  });

  if (document.fullscreenEnabled && !native) { // no app de desktop, use F11
    fsBtn.hidden = false;
    fsBtn.addEventListener('click', () => {
      try { if (document.fullscreenElement) document.exitFullscreen(); else root.requestFullscreen(); } catch (e) {}
    });
  }

  /* ---------- marcador: barra flutuante ---------- */
  selBar.addEventListener('mousedown', (e) => e.preventDefault()); // mantém o texto selecionado
  document.querySelectorAll('#swatches .sw').forEach((b) => b.addEventListener('click', () => {
    if (bar.mode === 'mark') recolor(bar.id, b.dataset.c); else addHighlight(b.dataset.c);
  }));
  copyBtn.addEventListener('click', () => {
    if (bar.mode === 'mark') { const h = highlights().find((x) => x.id === bar.id); copyText(h && h.text); hideBar(); }
    else { copyText(String(getSelection()).replace(/\s+/g, ' ').trim()); }
  });
  rmBtn.addEventListener('click', () => { if (bar.id) removeHighlight(bar.id); });

  let selRaf = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer); selTimer = setTimeout(onSelectionSettled, 130);
    if (!selRaf) selRaf = requestAnimationFrame(() => { selRaf = 0; if (reading()) updateSelOverlay(); });
  });
  let lastPointer = 'mouse';
  stage.addEventListener('pointerdown', (e) => {
    pointerDown = true; lastPointer = e.pointerType || 'mouse';
    const sel = getSelection();
    hadSelection = !!(sel && !sel.isCollapsed);
  });
  document.addEventListener('pointerup', () => {
    pointerDown = false;
    clearTimeout(selTimer); selTimer = setTimeout(onSelectionSettled, 60);
  });

  /* ---------- seleção de texto com o mouse ----------
     O navegador salta e fica torto ao selecionar nesse tipo de texto. Aqui a seleção segue sempre o trecho
     de texto mais próximo do mouse, rola sozinha perto da borda e entende duplo clique (palavra) e triplo (linha). */
  const spansOf = (p) => Array.from(p.text.children).filter((sp) => sp.firstChild && sp.firstChild.nodeType === 3 && sp.textContent.length);

  function charOffset(t, x) {
    const n = t.length, rg = document.createRange();
    const box = (i) => { rg.setStart(t, i); rg.setEnd(t, i + 1); return rg.getBoundingClientRect(); };
    const L = (i) => { for (let j = i; j < n; j++) { const r = box(j); if (r.width > 0.01) return r.left; } return Infinity; };
    let end = n - 1;
    while (end > 0 && box(end).width <= 0.01) end--;
    if (x <= L(0)) return 0;
    if (x >= box(end).right) return n;
    let lo = 0, hi = end;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (L(mid) <= x) lo = mid; else hi = mid - 1; }
    const b = box(lo);
    if (b.width <= 0.01) return lo;
    return x < (b.left + b.right) / 2 ? lo : lo + 1;
  }

  // Posição do texto mais próxima do ponto (x, y) da tela: primeiro escolhe a linha pela altura do mouse
  // (centro mais próximo; em texto apertado as caixas das linhas se sobrepõem), depois o trecho mais próximo na horizontal.
  // A posição horizontal do mouse (que está sobre a imagem) é convertida para a posição do texto com a MESMA correção
  // usada para desenhar a barra de seleção (lineWarp): assim o mouse e a barra sempre concordam, letra por letra.
  function textPosAt(x, y) {
    let page = null, pd = Infinity;
    for (const p of activePgs()) {
      const r = p.el.getBoundingClientRect();
      const d = (y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0) + (x < r.left ? r.left - x : x > r.right ? x - r.right : 0);
      if (d < pd) { pd = d; page = p; }
    }
    if (!page) return null;
    const list = spansOf(page).map((sp) => ({ sp, r: sp.getBoundingClientRect() }));
    let cy0 = null, h0 = 0, bd = Infinity;
    for (const o of list) {
      const cy = (o.r.top + o.r.bottom) / 2, d = Math.abs(y - cy);
      if (d < bd) { bd = d; cy0 = cy; h0 = o.r.height; }
    }
    if (cy0 === null) return null;
    const line = list.filter((o) => Math.abs((o.r.top + o.r.bottom) / 2 - cy0) <= Math.max(h0, o.r.height) * 0.7);
    if (!line.length) return null;

    // converte a posição do mouse (imagem) para a posição do texto
    let xd = x;
    if (CALIBRATE) {
      try {
        const pr = page.el.getBoundingClientRect();
        const u = {
          l: Math.min(...line.map((o) => o.r.left)), r: Math.max(...line.map((o) => o.r.right)),
          t: Math.min(...line.map((o) => o.r.top)), b: Math.max(...line.map((o) => o.r.bottom))
        };
        const sn = snapBand(page, pr, u);
        const warp = sn ? lineWarp(page, pr, sn, u) : null;
        if (warp) xd = warp.g(x);
        if (Math.abs(xd - x) > h0 * 1.2) xd = x;
      } catch (e) { /* sem correção: usa o texto do PDF */ }
    }

    let best = null, bs = Infinity;
    for (const o of line) {
      const dx = xd < o.r.left ? o.r.left - xd : xd > o.r.right ? xd - o.r.right : 0;
      if (dx < bs) { bs = dx; best = o.sp; if (!dx) break; }
    }
    return best ? { node: best.firstChild, off: charOffset(best.firstChild, xd), span: best, page } : null;
  }

  function selectWordAt(pos) {
    const t = pos.node, str = t.textContent, isW = (ch) => /[\p{L}\p{N}_'’-]/u.test(ch || '');
    let a = pos.off;
    if (!isW(str[a]) && isW(str[a - 1])) a--;
    if (!isW(str[a])) return;
    let b = a;
    while (a > 0 && isW(str[a - 1])) a--;
    while (b < str.length && isW(str[b])) b++;
    getSelection().setBaseAndExtent(t, a, t, b);
  }
  function selectLineAt(pos) {
    const c = pos.span.getBoundingClientRect(), mid = (c.top + c.bottom) / 2, h = c.height;
    const line = spansOf(pos.page).filter((sp) => { const r = sp.getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - mid) < h * 0.5; });
    if (!line.length) return;
    const first = line[0].firstChild, last = line[line.length - 1].firstChild;
    getSelection().setBaseAndExtent(first, 0, last, last.length);
  }

  let drag = null;
  function dragStep() {
    if (!drag) return;
    drag.raf = 0;
    const pos = textPosAt(drag.x, drag.y);
    if (pos) getSelection().setBaseAndExtent(drag.anchor.node, drag.anchor.off, pos.node, pos.off);
    const r = stage.getBoundingClientRect(), m = 40;     // perto da borda: rola sozinho
    let dy = 0;
    if (drag.y < r.top + m) dy = -(r.top + m - drag.y) / m * 24;
    else if (drag.y > r.bottom - m) dy = (drag.y - (r.bottom - m)) / m * 24;
    if (dy) { stage.scrollBy(0, dy); drag.raf = requestAnimationFrame(dragStep); }
  }
  stage.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !reading() || !e.target.closest) return;
    if (!overText(e)) { startPan(e); return; }   // fora do texto: o botão esquerdo arrasta a página
    const pos = textPosAt(e.clientX, e.clientY);
    if (!pos) return;
    e.preventDefault();                      // sem a seleção do navegador
    stage.focus({ preventScroll: true });
    const sel = getSelection();
    if (e.detail === 2) { selectWordAt(pos); drag = null; return; }
    if (e.detail >= 3) { selectLineAt(pos); drag = null; return; }
    if (e.shiftKey && sel.anchorNode && !sel.isCollapsed) {
      drag = { anchor: { node: sel.anchorNode, off: sel.anchorOffset }, x: e.clientX, y: e.clientY, raf: 0 };
      sel.setBaseAndExtent(drag.anchor.node, drag.anchor.off, pos.node, pos.off);
      return;
    }
    drag = { anchor: { node: pos.node, off: pos.off }, x: e.clientX, y: e.clientY, raf: 0 };
    sel.setBaseAndExtent(pos.node, pos.off, pos.node, pos.off);
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    if (e.buttons === 0) { cancelAnimationFrame(drag.raf); drag = null; return; }
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.raf) drag.raf = requestAnimationFrame(dragStep);
  });
  document.addEventListener('mouseup', () => { if (drag) { cancelAnimationFrame(drag.raf); drag = null; } });
  stage.addEventListener('scroll', () => { if (!selBar.hidden) hideBar(); }, { passive: true });

  /* ---------- arrastar a página com o botão esquerdo (só fora do texto) ----------
     Sobre uma palavra, o botão esquerdo seleciona o texto; em qualquer outro ponto (margens, espaço entre linhas,
     imagens) ele arrasta a página. Em "Rolagem" a página sobe e desce; ampliada, vai também para os lados. */
  let pan = null, panMoved = false;
  const overText = (e) => !!(e.target.closest && e.target.closest('.textLayer span'));
  function endPan() { pan = null; stage.classList.remove('panning'); }
  function startPan(e) {
    const r = stage.getBoundingClientRect();
    if (e.clientX - r.left >= stage.clientWidth || e.clientY - r.top >= stage.clientHeight) return;   // clique na barra de rolagem: deixa o navegador cuidar
    e.preventDefault();
    panMoved = false;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
    stage.focus({ preventScroll: true });
    pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    hideBar();
  }
  document.addEventListener('mousemove', (e) => {
    if (!pan) return;
    if (!(e.buttons & 1)) { endPan(); return; }          // soltou o botão fora da janela
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!panMoved) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;  // ainda é um clique, não um arrasto
      panMoved = true;
      stage.classList.add('panning');
    }
    stage.scrollLeft = pan.sl - dx;
    stage.scrollTop = pan.st - dy;
  });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) endPan(); });

  /* ---------- rolagem contínua: página atual ---------- */
  let scrollRaf = 0;
  stage.addEventListener('scroll', () => {
    if (!S.scroll || !pgs.length || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateBar();
      const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2 && stage.scrollTop > 0;
      const n = atBottom ? spreadStart(total) : pageAtY(stage.scrollTop + stage.clientHeight * 0.3);
      if (n !== pageNum) { pageNum = n; updateUI(); queueSave(); }
    });
  }, { passive: true });

  /* ---------- toque (como no Kindle): faixa de cima mostra/esconde as barras, lado esquerdo volta, o resto avança ---------- */
  stage.addEventListener('click', (e) => {
    if (panMoved) { panMoved = false; hadSelection = false; return; }   // acabou de arrastar a página: não é um clique para virar página
    if (hadSelection) { hadSelection = false; return; }
    if (panelsOpen()) { closePanels(); return; }
    if (!reading() || e.detail >= 2) return;           // duplo e triplo clique são para selecionar
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    const hit = markAt(e.clientX, e.clientY);
    if (hit) { showBar('mark', hit.rect, hit.h.id); return; }
    hideBar();
    // com o mouse, clicar sobre a página só seleciona; as laterais viram a página nas margens vazias (e no toque, em qualquer ponto)
    if (lastPointer === 'mouse' && activePgs().some((p) => { const b = p.el.getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom; })) return;
    const r = stage.getBoundingClientRect(), f = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if (v < 0.12) app.classList.toggle('immersive');
    else if (f < 0.25) prev();
    else next();
  });
  document.addEventListener('pointerdown', (e) => {
    if (panelsOpen() && !e.target.closest('.panel') && !e.target.closest('#setBtn') && !e.target.closest('#tocBtn') && !e.target.closest('#hlBtn') && !e.target.closest('#stage')) closePanels();
  });

  document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.el.contains(e.target)) closeMenu(); });

  // Clicar fora da busca no PDF fecha a busca
  document.addEventListener('pointerdown', (e) => {
    if (!findBar.hidden && !e.target.closest('#findBar')) closeFind();
  });

  // Deslizar o dedo muda de página (modo página a página, quando a página cabe na largura)
  let tx = 0, ty = 0;
  stage.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!reading() || S.scroll || !pagePg || docEl.offsetWidth > stage.clientWidth + 2) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { if (dx < 0) goNext(); else goPrev(); }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (setupEl && !setupEl.hidden) return;   // com a tela de idioma aberta, nenhum atalho dispara por trás
    const tag = e.target && e.target.tagName;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F') && root.dataset.view === 'library') {
      e.preventDefault(); searchIn.focus(); searchIn.select(); return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F') && reading()) { e.preventDefault(); openFind(); return; }
    // Ctrl + e Ctrl - dão zoom na página (e não na janela inteira); Ctrl 0 volta a 100%
    if ((e.ctrlKey || e.metaKey) && !e.altKey && reading() && ['+', '=', '-', '_', '0'].includes(e.key)) {
      e.preventDefault();
      if (e.key === '0') setZoom(1);
      else if (e.key === '-' || e.key === '_') setZoom(S.zoom / 1.15);
      else setZoom(S.zoom * 1.15);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'g' || e.key === 'G') && reading()) {
      e.preventDefault();
      app.classList.remove('immersive');
      pageIn.focus();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { closeMenu(); closePanels(); hideBar(); closeFind(); if (selMode) exitSelect(); return; }
    if (openMenu) return;   // com um menu aberto, as teclas são só dele (setas, Enter)
    if (e.key === 'F3' && reading()) { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); return; }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const key = e.key;
    if (key === '?' || key === 'F1') { e.preventDefault(); togglePanel('keys'); return; }
    if (key === 'm' || key === 'M') { cycleMode(); return; }
    if (key === 'o' || key === 'O') { openDialog(); return; }
    if ((key === 'a' || key === 'A') && reading()) { if (autoOn) autoStop(); else autoStart(); return; }
    if ((key === 'b' || key === 'B') && reading()) { toggleBookmark(); return; }
    if ((key === 'r' || key === 'R') && reading()) { toggleRuler(); return; }
    if (key === '/' && root.dataset.view === 'library' && !libTools.hidden) { e.preventDefault(); searchIn.focus(); return; }
    if (!reading()) return;

    const sel = getSelection();
    if (key.length === 1 && '1234'.includes(key) && sel && !sel.isCollapsed) { addHighlight(COLORS[Number(key) - 1]); e.preventDefault(); return; }

    if (key === 'ArrowRight' && e.shiftKey) { stage.scrollBy(90, 0); e.preventDefault(); }
    else if (key === 'ArrowLeft' && e.shiftKey) { stage.scrollBy(-90, 0); e.preventDefault(); }
    else if (key === 'ArrowRight') { goNext(); e.preventDefault(); }
    else if (key === 'ArrowLeft') { goPrev(); e.preventDefault(); }
    else if (key === 'ArrowDown') { stage.scrollBy(0, 70); e.preventDefault(); }
    else if (key === 'ArrowUp') { stage.scrollBy(0, -70); e.preventDefault(); }
    else if (key === 'PageDown' || (key === ' ' && !e.shiftKey)) { next(); e.preventDefault(); }
    else if (key === 'PageUp' || (key === ' ' && e.shiftKey)) { prev(); e.preventDefault(); }
    else if (key === 'Home') { goPage(1); e.preventDefault(); }
    else if (key === 'End') { goPage(total); e.preventDefault(); }
    else if (key === '+' || key === '=') setZoom(S.zoom * 1.15);
    else if (key === '-') setZoom(S.zoom / 1.15);
    else if (key === '0') setZoom(1);
    else if (key === 'h' || key === 'H') app.classList.toggle('immersive');
  });

  // Ctrl + roda do mouse (e a pinça do touchpad) dão zoom; um passo a cada instante, porque redesenhar é pesado
  let wheelAcc = 0, wheelTimer = 0;
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !reading()) return;
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (wheelTimer) return;
    wheelTimer = setTimeout(() => {
      wheelTimer = 0;
      if (wheelAcc) setZoom(wheelAcc < 0 ? S.zoom * 1.15 : S.zoom / 1.15);
      wheelAcc = 0;
    }, 140);
  }, { passive: false });

  // Arrastar e soltar
  window.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) root.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); root.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
  });

  // Salva a página atual e as marcações ao sair ou trocar de janela
  window.addEventListener('pagehide', () => { flushSave(); saveStats(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flushSave(); saveStats(); } });

  // Redesenha ao redimensionar a janela
  let rzTimer = null, firstRz = true;
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (firstRz) { firstRz = false; return; }
      applyRuler();
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => { if (reading()) render(); }, 160);
    }).observe(wrap);
  }

  /* =======================================================
     Tela de escolha de idioma (primeira vez que o app abre)
     ======================================================= */
  function showSetup() {
    if (!setupEl) return;
    setupEl.hidden = false;
    const btns = Array.from(setupEl.querySelectorAll('button'));
    if (!btns.length) return;
    btns.forEach((b) => {
      b.addEventListener('click', () => {
        S.lang = b.dataset.lang;
        saveSettings();
        applyLang();
        setupEl.hidden = true;
        firstRun = false;
      });
    });
    const first = btns.find((b) => b.dataset.lang === S.lang) || btns[0];
    first.focus();   // o idioma detectado já vem em foco: basta apertar Enter
  }

  /* =======================================================
     Início
     ======================================================= */
  // O pdf.js (grande) só é carregado depois que a biblioteca já apareceu, ou na hora em que um PDF é aberto ou adicionado.
  // Se o index.html ainda tiver a linha <script src="lib/pdf.min.js">, ele já vem carregado e esta função só confirma.
  let pdfjsP = null;
  function loadPdfjs() {
    if (window.pdfjsLib) {
      try { pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.js', location.href).href; } catch (e) {}   // caminho absoluto: mais seguro com file:// no Electron
      return Promise.resolve(true);
    }
    if (!pdfjsP) {
      pdfjsP = new Promise((res) => {
        const t0 = performance.now();
        const sc = document.createElement('script');
        sc.src = 'lib/pdf.min.js';
        sc.onload = () => {
          try { pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.js', location.href).href; } catch (e) {}
          console.log('[Lume] pdf.js carregado em ' + Math.round(performance.now() - t0) + ' ms');
          res(true);
        };
        sc.onerror = () => { pdfjsP = null; res(false); };
        document.head.append(sc);
      });
    }
    return pdfjsP;
  }
  if (native) root.classList.add('electron');
  loadSettings();
  loadStats();
  applyLang();
  showView('library');
  booted = true;
  console.log('[Lume] interface montada em ' + Math.round(performance.now()) + ' ms');
  if (firstRun) showSetup();

  // Abrir um PDF vindo do sistema (duplo clique no arquivo, "Abrir com…"): importa para a biblioteca e abre
  if (native && native.onOpenFile) {
    native.onOpenFile(async (f) => {
      await flushSave();   // salva a página do livro que estava aberto
      const file = new File([f.data], f.name, { type: 'application/pdf' });
      await importFiles([file]);
      const b = booksCache.find((x) => x.name === nameOf(file) && x.size === file.size);
      if (b) openBook(b.id);
    });
  }

  refreshLibrary().then(() => {
    console.log('[Lume] biblioteca pronta em ' + Math.round(performance.now()) + ' ms desde o início da página');
    setTimeout(loadPdfjs, 50);   // carrega o pdf.js em segundo plano
  });

})();