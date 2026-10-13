/** Isolated display-only Electron fixture keeps the real renderer sandbox enabled. */
import { app, BrowserWindow } from 'electron'
app.setPath('userData', process.env.DSH_LIVE2D_TEST_DATA)
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 600, height: 800, show: false, title: 'DSH Live2D isolated test',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL(process.env.DSH_LIVE2D_TEST_URL)
  window.showInactive()
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
