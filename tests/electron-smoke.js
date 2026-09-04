'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { isAllowedLocalPage } = require('../electron/navigation');

const root = path.resolve(__dirname, '..');
const consoleErrors = [];

async function waitFor(window, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function authenticate(window) {
  await waitFor(window, `document.getElementById('auth-overlay')`);
  await window.webContents.executeJavaScript(`
    document.getElementById('auth-input').value = 'wrong-password';
    document.getElementById('auth-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  await waitFor(window, `document.getElementById('auth-error').classList.contains('show')`);
  assert.match(await window.webContents.executeJavaScript(`document.getElementById('auth-error').textContent`), /密码错误/);
  await window.webContents.executeJavaScript(`
    document.getElementById('auth-input').value = '1820900463';
    document.getElementById('auth-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  `);
  await waitFor(window, `!document.getElementById('auth-overlay')`);
  assert.equal(await window.webContents.executeJavaScript(`Boolean(document.getElementById('auth-hide-style'))`), false);
}

const identityCube = `TITLE "Identity"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1`;

async function setFileInput(window, inputId, filename, type, contentExpression) {
  await window.webContents.executeJavaScript(`
    (() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([${contentExpression}], ${JSON.stringify(filename)}, { type: ${JSON.stringify(type)} }));
      const input = document.getElementById(${JSON.stringify(inputId)});
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })();
  `);
}

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.on('console-message', event => {
    if ((event.level === 'error' || event.level === 3) && !/favicon|Autofill/.test(event.message)) consoleErrors.push(event.message);
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalPage(url)) event.preventDefault();
  });

  await window.loadFile(path.join(root, 'index.html'));
  await authenticate(window);
  await window.webContents.executeJavaScript(`document.getElementById('start-using-link').click()`);
  await waitFor(window, `location.pathname.endsWith('/index1.html')`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('h1').textContent.trim()`), 'LUT 检查器');
  await setFileInput(window, 'lutviz-file', 'identity.cube', 'text/plain', JSON.stringify(identityCube));
  await waitFor(window, `document.getElementById('lut-info-size').textContent === '2x2x2'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lut-contrast').textContent`), '0.00%');
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lut-dynamic-range').textContent`), '100.0%');
  const canvasSizes = await window.webContents.executeJavaScript(`
    ['granger-canvas','hue-canvas','heatmap-canvas','vectorscope-canvas'].map(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return [id, Math.round(rect.width), Math.round(rect.height)];
    })
  `);
  assert.ok(canvasSizes.every(([, width, height]) => width > 0 && height > 0 && width <= 902 && height <= 452), JSON.stringify(canvasSizes));

  await window.webContents.executeJavaScript(`document.querySelector('a[href="index2.html"]').click()`);
  await waitFor(window, `location.pathname.endsWith('/index2.html')`);
  await setFileInput(window, 'lutfile', 'identity.cube', 'text/plain', JSON.stringify(identityCube));
  await waitFor(window, `document.getElementById('analysis-size').textContent === '2x2x2'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('analysis-range').textContent`), '100.0%');
  await window.webContents.executeJavaScript(`document.getElementById('iretoggle').click()`);
  await waitFor(window, `document.getElementById('ireOverlay').classList.contains('show')`);
  const ireGeometry = await window.webContents.executeJavaScript(`
    (() => {
      const canvas = document.getElementById('ireCanvas');
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      return {
        backingWidth: canvas.width,
        cssWidth: canvas.clientWidth,
        ratio,
        delta: Math.abs(canvas.width / ratio - canvas.clientWidth)
      };
    })()
  `);
  assert.ok(ireGeometry.cssWidth > 0 && ireGeometry.delta < 2, JSON.stringify(ireGeometry));

  await window.webContents.executeJavaScript(`document.querySelector('a[href="index3.html"]').click()`);
  await waitFor(window, `location.pathname.endsWith('/index3.html')`);
  await setFileInput(window, 'lut-file-input', 'identity.cube', 'text/plain', JSON.stringify(identityCube));
  await waitFor(window, `document.getElementById('lut-count').textContent.includes('1')`);
  await window.webContents.executeJavaScript(`
    new Promise(resolve => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 320, 180); gradient.addColorStop(0, '#f00'); gradient.addColorStop(1, '#00f');
      context.fillStyle = gradient; context.fillRect(0, 0, 320, 180);
      canvas.toBlob(blob => {
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'preview.png', { type: 'image/png' }));
        const input = document.getElementById('image-file-input'); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true })); resolve();
      }, 'image/png');
    })
  `);
  await waitFor(window, `document.getElementById('preview-image-select').value === 'custom'`);
  await waitFor(window, `document.getElementById('preview-canvas').width > 0`);
  const preview = await window.webContents.executeJavaScript(`({ width: document.getElementById('preview-canvas').width, height: document.getElementById('preview-canvas').height })`);
  assert.equal(preview.width / preview.height, 16 / 9);

  window.destroy();
  assert.deepEqual(consoleErrors, []);
  console.log('electron smoke tests passed');
}

run().then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
