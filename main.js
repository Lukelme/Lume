'use strict';
const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Abertura rápida: o app desenha as páginas em canvas na CPU, então a aceleração de vídeo ajuda pouco,
// e o processo de GPU (com o cache de shaders em disco falhando) atrasava a primeira pintura em vários segundos.
// Para testar com a GPU ligada: no terminal, "set LUME_GPU=1" e depois "npm start".
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
if (!process.env.LUME_GPU) app.disableHardwareAcceleration();

// Tempos de abertura (aparecem no terminal quando você roda com "npm start")
const boot = (m) => console.log('[boot] ' + m + ': ' + process.uptime().toFixed(2) + 's');

const BAR_HEIGHT = 56;               // altura da barra de cima (igual ao CSS)
const HEX = /^#[0-9a-f]{6}$/i;
let win = null;
let tray = null;
let quitting = false;                // true só quando você escolhe "Sair" (ou o Windows desliga): aí a janela fecha de verdade
let autoStart = true;                // abrir junto com o Windows (lembrado entre sessões)
let wantMax = false;                 // a janela estava maximizada na última vez
let lastBar = null;                  // última cor da barra enviada pela página (e lembrada entre sessões)

// Fica na bandeja do sistema: fechar a janela só a esconde e o ícone a mostra na hora.
// Só vale no app instalado (.exe). Em "npm start" a janela fecha normal; para testar: "set LUME_TRAY=1".
const useTray = () => app.isPackaged || !!process.env.LUME_TRAY;
const keepAlive = () => useTray() && !!tray;

app.setAppUserModelId('com.lume.leitor');   // igual ao appId do package.json

/* ---------- PDF que o Windows manda abrir (clique duplo, "Abrir com...") ---------- */
const pdfFromArgs = (argv) => argv.slice(1).find((a) => /\.pdf$/i.test(a) && fs.existsSync(a));
let pendingPdf = pdfFromArgs(process.argv);
// Aberto pelo Windows no login (--hidden): começa escondido na bandeja. Se veio um PDF, abre a janela.
let startHidden = process.argv.includes('--hidden') && !pendingPdf;

function sendPdf(p) {
  if (!win || win.isDestroyed() || !p) return;
  fs.promises.readFile(p).then((data) => {
    if (win && !win.isDestroyed()) win.webContents.send('lume:open-file', { name: path.basename(p), data });
  }).catch(() => { /* arquivo sumiu ou sem permissão */ });
}

/* ---------- lembrar tamanho e posição da janela ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() || wantMax, bar: lastBar, autoStart }));
  } catch (e) { /* sem problema */ }
}
function onSomeScreen(b) {
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 60 && b.x + b.width > a.x + 60 && b.y >= a.y - 10 && b.y < a.y + a.height - 60;
  });
}

/* ---------- cor da barra de título (botões minimizar, maximizar e fechar) ---------- */
function applyBar(w, p) {
  if (!w || w.isDestroyed() || !p || !HEX.test(p.color) || !HEX.test(p.symbolColor)) return;
  w.setBackgroundColor(p.color);
  if (process.platform !== 'darwin' && typeof w.setTitleBarOverlay === 'function') {
    try { w.setTitleBarOverlay({ color: p.color, symbolColor: p.symbolColor, height: BAR_HEIGHT }); } catch (err) { /* ignora */ }
  }
}

/* ---------- abrir junto com o Windows ---------- */
function applyAutoStart() {
  if (!app.isPackaged) return;   // em "npm start" não registra nada no Windows
  try { app.setLoginItemSettings({ openAtLogin: autoStart, args: ['--hidden'] }); } catch (e) { /* sem permissão */ }
}

/* ---------- mostrar a janela (a partir da bandeja, de outro PDF aberto, etc.) ---------- */
function showWindow() {
  startHidden = false;
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (wantMax) { win.maximize(); wantMax = false; }   // maximize() numa janela escondida a faz aparecer; por isso só aqui
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- ícone da bandeja ---------- */
const FALLBACK_ICON = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR4nO3OIQEAIAwAwUVBIehfiAgo5LAkYIgTL95djN6ysgC4Z6/5JAAAAAAAAAAAAAAAgH8BFQEcCwfvqmQJfe8AAAAASUVORK5CYII=';
function trayIcon() {
  const candidates = [path.join(__dirname, 'build', 'icon.ico'), path.join(process.resourcesPath || '', 'icon.ico')];
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const img = nativeImage.createFromPath(c);
      if (!img.isEmpty()) return img;
    } catch (e) { /* tenta o próximo */ }
  }
  return nativeImage.createFromDataURL('data:image/png;base64,' + FALLBACK_ICON);
}
function createTray() {
  if (tray || !useTray()) return;
  try { tray = new Tray(trayIcon()); } catch (e) { tray = null; return; }
  tray.setToolTip('Lume');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Lume', click: showWindow },
    {
      label: 'Iniciar com o Windows', type: 'checkbox', checked: autoStart,
      click: (item) => { autoStart = item.checked; applyAutoStart(); saveState(); }
    },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
  boot('bandeja pronta');
}

/* ---------- janela ---------- */
function createWindow() {
  const st = loadState();
  if (st.bar && HEX.test(st.bar.color) && HEX.test(st.bar.symbolColor)) lastBar = st.bar;
  autoStart = st.autoStart !== false;
  wantMax = !!st.maximized;
  const opts = {
    width: Number(st.width) || 1100,
    height: Number(st.height) || 800,
    minWidth: 720,
    minHeight: 520,
    show: false,   // fica escondida até a primeira pintura (evita mostrar uma janela em branco)
    backgroundColor: lastBar ? lastBar.color : '#f7f1e1',
    title: 'Lume',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: lastBar ? lastBar.color : '#f7f1e1',
      symbolColor: lastBar ? lastBar.symbolColor : '#2a2620',
      height: BAR_HEIGHT
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
  if (onSomeScreen({ x: st.x, y: st.y, width: opts.width, height: opts.height })) { opts.x = st.x; opts.y = st.y; }

  win = new BrowserWindow(opts);
  boot('janela criada');

  let revealed = false;
  const reveal = () => {
    if (revealed || !win || win.isDestroyed()) return;
    revealed = true;
    if (!startHidden) showWindow();   // aberto no login: fica carregada e escondida, esperando o clique na bandeja
  };
  win.once('ready-to-show', () => { boot('ready-to-show'); reveal(); });
  win.webContents.on('did-fail-load', reveal);        // se algo falhar, não deixa o app invisível
  setTimeout(reveal, 20000);                            // segurança

  win.on('close', (e) => {
    saveState();
    if (!quitting && keepAlive()) { e.preventDefault(); win.hide(); }   // fecha só na aparência: continua pronto na bandeja
  });
  win.on('session-end', () => { quitting = true; });    // Windows desligando ou saindo da conta
  win.on('closed', () => { win = null; });

  // Medições extras da carga da página (aparecem no terminal com "npm start")
  const wc = win.webContents;
  wc.on('did-start-loading', () => boot('did-start-loading'));
  wc.on('dom-ready', () => boot('dom-ready'));
  wc.on('console-message', (...a) => {   // repassa os avisos "[Lume] ..." do script.js para o terminal
    const m = a[0] && typeof a[0].message === 'string' ? a[0].message : a[2];
    if (typeof m === 'string' && m.startsWith('[Lume]')) boot(m);
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => {
    boot('did-finish-load');
    applyBar(win, lastBar);
    if (pendingPdf) { sendPdf(pendingPdf); pendingPdf = null; }
  });

  // Links externos abrem no navegador; o app nunca navega para fora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });

  // F11: tela cheia. F12: ferramentas de desenvolvedor (só fora do .exe).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F12' && !app.isPackaged) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

// A página avisa a cor da tela atual (papel, sépia, e-ink, noite), já com brilho e luz quente.
ipcMain.on('titlebar', (e, p) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || !p || !HEX.test(p.color) || !HEX.test(p.symbolColor)) return;
  lastBar = { color: p.color, symbolColor: p.symbolColor };
  applyBar(w, lastBar);
});

/* ---------- ciclo de vida ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    showWindow();                 // clicar de novo no atalho mostra a janela que estava escondida
    sendPdf(pdfFromArgs(argv));   // outro PDF aberto com o Lume já rodando
  });
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(() => {
    boot('app ready');
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    applyAutoStart();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}