/**
 * Electron 主进程（阶段三草案，尚未接入 electron-builder）
 *
 * 目标：Windows EXE。当前仅保证结构与安全策略正确：
 * - 关闭 nodeIntegration，开启 contextIsolation
 * - 外链一律用系统默认浏览器打开（更新下载、捐赠入口都走这里）
 * - 不加载远程内容，只加载打包后的 dist
 */
const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('node:path');

const isDev = process.env.STUDYMATE_DEV === '1';

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b0b0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist-electron', 'index.html'));
  }

  // 所有新窗口/外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const current = win.webContents.getURL();
    if (!url.startsWith('file://') && !url.startsWith(current.split('#')[0])) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  // 关闭权限请求（摄像头、麦克风等本应用不需要）
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:/.test(url)) return shell.openExternal(url);
  return false;
});
