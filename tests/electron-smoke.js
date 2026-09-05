'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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

const compressedCube = `TITLE "Compressed"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0.2 0.2 0.2
0.8 0.2 0.2
0.2 0.8 0.2
0.8 0.8 0.2
0.2 0.2 0.8
0.8 0.2 0.8
0.2 0.8 0.8
0.8 0.8 0.8`;

const negativeHeadroomCube = `TITLE "Negative Headroom"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
-0.075 -0.075 -0.075
1 -0.075 -0.075
-0.075 1 -0.075
1 1 -0.075
-0.075 -0.075 1
1 -0.075 1
-0.075 1 1
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
    width: Number(process.env.LUT_TEST_WIDTH || 1280),
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
  await waitFor(window, `document.querySelector('#drop-zone .drop-zone-text').textContent === 'identity.cube'`);
  await waitFor(window, `document.querySelectorAll('.chart-summary.ready').length === 5`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lut-contrast').textContent`), '0.00%');
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lut-dynamic-range').textContent`), '100.0%');
  assert.match(await window.webContents.executeJavaScript(`document.getElementById('curve-summary').textContent`), /0\.0%/);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lutviz-canvas').dataset.scaleMin`), '0');
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lutviz-canvas').dataset.scaleMax`), '100');
  await window.webContents.executeJavaScript(`document.querySelector('.history-toggle').click()`);
  await waitFor(window, `[...document.querySelectorAll('.history-file-copy strong')].some(node => node.textContent === 'identity.cube')`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('history-drawer').classList.contains('open')`), true);
  await window.webContents.executeJavaScript(`document.querySelector('.history-close').click()`);
  await setFileInput(window, 'lutviz-file', 'negative-headroom.cube', 'text/plain', JSON.stringify(negativeHeadroomCube));
  await waitFor(window, `document.getElementById('lutviz-canvas').dataset.scaleMin === '-10'`);
  await waitFor(window, `document.querySelector('#drop-zone .drop-zone-text').textContent === 'negative-headroom.cube'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lutviz-canvas').dataset.scaleMax`), '100');
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lut-y-min').textContent`), '-7.5%');
  const canvasSizes = await window.webContents.executeJavaScript(`
    ['granger-canvas','hue-canvas','heatmap-canvas','vectorscope-canvas'].map(id => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return [id, Math.round(rect.width), Math.round(rect.height)];
    })
  `);
  assert.ok(canvasSizes.every(([, width, height]) => width > 0 && height > 0 && width <= 902 && height <= 452), JSON.stringify(canvasSizes));
  if (process.env.LUT_UI_CAPTURE_CHECKER) {
    assert.equal(await window.webContents.executeJavaScript(`document.getElementById('lutviz-canvas').dataset.scaleMin`), '-10');
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#drop-zone .drop-zone-text').textContent`), 'negative-headroom.cube');
    await window.webContents.executeJavaScript(`document.getElementById('curve-summary').scrollIntoView({ block: 'center' })`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(process.env.LUT_UI_CAPTURE_CHECKER, screenshot.toPNG());
  }

  await window.webContents.executeJavaScript(`document.querySelector('a[href="index2.html"]').click()`);
  await waitFor(window, `location.pathname.endsWith('/index2.html')`);
  const analyzerImport = await window.webContents.executeJavaScript(`
    (() => {
      const zone = document.getElementById('drop-zone');
      const rect = zone.getBoundingClientRect();
      const style = getComputedStyle(zone);
      return {
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        trigger: zone.dataset.fileTrigger,
        label: zone.textContent.replace(/\\s+/g, ' ').trim()
      };
    })()
  `);
  assert.ok(analyzerImport.width >= 280 && analyzerImport.height >= 80, JSON.stringify(analyzerImport));
  assert.equal(analyzerImport.visibility, 'visible');
  assert.notEqual(analyzerImport.display, 'none');
  assert.equal(analyzerImport.trigger, 'lutfile');
  assert.match(analyzerImport.label, /导入 3D LUT/);
  const defaultWorkspaceBackground = await window.webContents.executeJavaScript(`({
    value: document.getElementById('bg').value,
    gray: document.getElementById('cube').dataset.workspaceGray,
    mappedValue: document.getElementById('cube').dataset.backgroundValue,
    badge: document.querySelector('.range-value[data-for="bg"]').textContent,
    color: getComputedStyle(document.getElementById('cube')).backgroundColor
  })`);
  assert.deepEqual(defaultWorkspaceBackground, { value: '0.3', gray: '15', mappedValue: '0.30', badge: '15% 灰', color: 'rgb(38, 38, 38)' });
  await window.webContents.executeJavaScript(`
    document.getElementById('bg').value = '0.6';
    document.getElementById('bg').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.deepEqual(await window.webContents.executeJavaScript(`({
    gray: document.getElementById('cube').dataset.workspaceGray,
    badge: document.querySelector('.range-value[data-for="bg"]').textContent,
    color: getComputedStyle(document.getElementById('cube')).backgroundColor
  })`), { gray: '30', badge: '30% 灰', color: 'rgb(77, 77, 77)' });
  await window.webContents.executeJavaScript(`
    document.getElementById('bg').value = '1';
    document.getElementById('bg').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.getElementById('cube')).backgroundColor`), 'rgb(128, 128, 128)');
  await window.webContents.executeJavaScript(`
    document.getElementById('bg').value = '0';
    document.getElementById('bg').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.equal(await window.webContents.executeJavaScript(`getComputedStyle(document.getElementById('cube')).backgroundColor`), 'rgb(0, 0, 0)');
  await window.webContents.executeJavaScript(`
    document.getElementById('bg').value = '0.30';
    document.getElementById('bg').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await window.webContents.executeJavaScript(`document.querySelector('.history-toggle').click()`);
  await waitFor(window, `[...document.querySelectorAll('.history-item')].some(item => item.querySelector('strong').textContent === 'identity.cube')`);
  await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.history-item')]
      .find(item => item.querySelector('strong').textContent === 'identity.cube')
      .querySelector('.history-open').click()
  `);
  await waitFor(window, `document.getElementById('analysis-size').textContent === '2x2x2'`);
  await waitFor(window, `document.querySelectorAll('#family-summary-table .family-row').length === 6`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#drop-zone .drop-zone-text').textContent`), 'identity.cube');
  assert.deepEqual(await window.webContents.executeJavaScript(`({
    blend: [document.getElementById('blend').value, document.querySelector('.range-value[data-for="blend"]').textContent],
    density: [document.getElementById('density').value, document.querySelector('.range-value[data-for="density"]').textContent],
    pointSize: [document.getElementById('psize').value, document.querySelector('.range-value[data-for="psize"]').textContent],
    background: [document.getElementById('bg').value, document.querySelector('.range-value[data-for="bg"]').textContent]
  })`), {
    blend: ['1', '100%'], density: ['17', '17'], pointSize: ['3', '3.0'], background: ['0.3', '15% 灰']
  });
  await window.webContents.executeJavaScript(`
    for (const [id, value] of [['blend', '0.37'], ['density', '33'], ['psize', '4'], ['bg', '1']]) {
      const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  assert.deepEqual(await window.webContents.executeJavaScript(`Object.fromEntries(
    ['blend', 'density', 'psize', 'bg'].map(id => [id, document.querySelector('.range-value[data-for="' + id + '"]').textContent])
  )`), { blend: '37%', density: '33', psize: '4.0', bg: '50% 灰' });
  await window.webContents.executeJavaScript(`
    for (const [id, value] of [['blend', '1'], ['density', '17'], ['psize', '3'], ['bg', '0.30']]) {
      const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  if (process.env.LUT_UI_CAPTURE_ANALYZER) {
    const panelScroll = await window.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('.controls');
        panel.scrollTop = panel.scrollHeight;
        return { top: panel.scrollTop, max: panel.scrollHeight - panel.clientHeight };
      })()
    `);
    assert.ok(panelScroll.max > 0 && panelScroll.top > 0, JSON.stringify(panelScroll));
    await new Promise(resolve => setTimeout(resolve, 100));
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(process.env.LUT_UI_CAPTURE_ANALYZER, screenshot.toPNG());
  }
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
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('ireCanvas').dataset.scaleMin`), '0');
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('ireCanvas').dataset.scaleMax`), '100');
  await setFileInput(window, 'lutfile', 'negative-headroom.cube', 'text/plain', JSON.stringify(negativeHeadroomCube));
  await waitFor(window, `document.getElementById('ireCanvas').dataset.scaleMin === '-10'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('ireCanvas').dataset.scaleMax`), '100');
  if (process.env.LUT_UI_CAPTURE_IRE_NEGATIVE) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(process.env.LUT_UI_CAPTURE_IRE_NEGATIVE, screenshot.toPNG());
  }
  const cornerLayout = await window.webContents.executeJavaScript(`
    (() => {
      const buttons = [...document.querySelectorAll('.corner-btn[data-corner]')];
      const centers = buttons.map(button => {
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width };
      });
      const stateRect = document.getElementById('corner-state').getBoundingClientRect();
      const wrapRect = document.querySelector('.corner-buttons-wrap').getBoundingClientRect();
      const rowRect = document.querySelector('.corner-row').getBoundingClientRect();
      return {
        count: buttons.length,
        minWidth: Math.min(...centers.map(point => point.width)),
        primarySpread: Math.max(...centers.slice(0, 3).map(point => point.y)) - Math.min(...centers.slice(0, 3).map(point => point.y)),
        complementarySpread: Math.max(...centers.slice(3).map(point => point.y)) - Math.min(...centers.slice(3).map(point => point.y)),
        rowsApart: centers[3].y - centers[0].y,
        pairDelta: Math.max(...[0, 1, 2].map(index => Math.abs(centers[index].x - centers[index + 3].x))),
        stateCenterDelta: Math.abs(stateRect.left + stateRect.width / 2 - (wrapRect.left + wrapRect.width / 2)),
        contentInsideRow: Math.min(...buttons.map(button => button.getBoundingClientRect().top), stateRect.top) >= rowRect.top
          && Math.max(...buttons.map(button => button.getBoundingClientRect().bottom), stateRect.bottom) <= rowRect.bottom
      };
    })()
  `);
  assert.equal(cornerLayout.count, 6);
  assert.ok(cornerLayout.minWidth >= 36, JSON.stringify(cornerLayout));
  assert.ok(cornerLayout.primarySpread <= 1 && cornerLayout.complementarySpread <= 1, JSON.stringify(cornerLayout));
  assert.ok(cornerLayout.rowsApart > 28 && cornerLayout.pairDelta <= 1 && cornerLayout.stateCenterDelta <= 1 && cornerLayout.contentInsideRow, JSON.stringify(cornerLayout));
  await window.webContents.executeJavaScript(`document.querySelector('.corner-btn[data-corner="red"]').click()`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('corner-state').textContent`), '红色域');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.corner-btn.active').length`), 1);
  await window.webContents.executeJavaScript(`document.querySelector('.corner-btn[data-corner="red"]').click()`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('corner-state').textContent`), '全部色域');
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('.corner-btn.active').length`), 0);

  await setFileInput(window, 'lutfile', 'compressed.cube', 'text/plain', JSON.stringify(compressedCube));
  await waitFor(window, `document.getElementById('filename').textContent === 'compressed.cube'`);
  await waitFor(window, `document.getElementById('cube').dataset.boundsMin === '0.200000,0.200000,0.200000'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('cube').dataset.boundsMax`), '0.800000,0.800000,0.800000');
  await window.webContents.executeJavaScript(`
    document.getElementById('density').value = '33';
    document.getElementById('density').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await waitFor(window, `document.getElementById('cube').dataset.sampleCount === '35937'`);
  await window.webContents.executeJavaScript(`
    document.getElementById('density').value = '17';
    document.getElementById('density').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await waitFor(window, `document.getElementById('cube').dataset.sampleCount === '4913'`);
  await window.webContents.executeJavaScript(`
    document.getElementById('bbox').click();
    document.getElementById('blend').value = '0';
    document.getElementById('blend').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await waitFor(window, `document.getElementById('cube').dataset.boundsMin === '0.000000,0.000000,0.000000'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('cube').dataset.boundsMax`), '1.000000,1.000000,1.000000');
  await window.webContents.executeJavaScript(`
    document.getElementById('blend').value = '0.5';
    document.getElementById('blend').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await waitFor(window, `document.getElementById('cube').dataset.boundsMin === '0.100000,0.100000,0.100000'`);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('cube').dataset.boundsMax`), '0.900000,0.900000,0.900000');
  await window.webContents.executeJavaScript(`
    document.getElementById('blend').value = '1';
    document.getElementById('blend').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await waitFor(window, `document.getElementById('cube').dataset.boundsMax === '0.800000,0.800000,0.800000'`);
  if (process.env.LUT_UI_CAPTURE_BOUNDS) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(process.env.LUT_UI_CAPTURE_BOUNDS, screenshot.toPNG());
  }
  await window.webContents.executeJavaScript(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(window, `document.getElementById('blend').value === '0'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.range-value[data-for="blend"]').textContent`), '0%');

  await window.webContents.executeJavaScript(`document.querySelector('a[href="index3.html"]').click()`);
  await waitFor(window, `location.pathname.endsWith('/index3.html')`);
  await setFileInput(window, 'lut-file-input', 'identity.cube', 'text/plain', JSON.stringify(identityCube));
  await waitFor(window, `document.getElementById('lut-count').textContent.includes('1')`);
  await waitFor(window, `document.querySelector('#drop-zone .drop-zone-text').textContent === 'identity.cube'`);
  await window.webContents.executeJavaScript(`document.querySelector('.history-toggle').click()`);
  await waitFor(window, `[...document.querySelectorAll('.history-file-copy strong')].some(node => node.textContent === 'identity.cube')`);
  const identityHistoryCount = await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.history-file-copy strong')].filter(node => node.textContent === 'identity.cube').length
  `);
  assert.equal(identityHistoryCount, 1);
  await window.webContents.executeJavaScript(`document.querySelector('.history-close').click()`);
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
  assert.deepEqual(await window.webContents.executeJavaScript(`({
    preview: [document.getElementById('intensity-slider').value, document.getElementById('intensity-value').textContent],
    convert: [document.getElementById('intensity-convert-slider').value, document.getElementById('intensity-convert-value').textContent],
    luma: [document.getElementById('luma-preserve-slider').value, document.getElementById('luma-preserve-value').textContent],
    smoothing: [document.getElementById('smoothing-slider').value, document.getElementById('smoothing-value').textContent],
    skin: [document.getElementById('skin-protect-slider').value, document.getElementById('skin-protect-value').textContent],
    gamut: [document.getElementById('gamut-compress-slider').value, document.getElementById('gamut-compress-value').textContent]
  })`), {
    preview: ['100', '100%'], convert: ['100', '100%'], luma: ['0', '0%'], smoothing: ['0', '0%'], skin: ['0', '0%'], gamut: ['0', '0%']
  });
  await window.webContents.executeJavaScript(`
    for (const [id, value] of [['intensity-slider', '37'], ['intensity-convert-slider', '200'], ['luma-preserve-slider', '100'], ['smoothing-slider', '100'], ['skin-protect-slider', '100'], ['gamut-compress-slider', '100']]) {
      const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  assert.deepEqual(await window.webContents.executeJavaScript(`({
    preview: document.getElementById('intensity-value').textContent,
    convert: document.getElementById('intensity-convert-value').textContent,
    luma: document.getElementById('luma-preserve-value').textContent,
    smoothing: document.getElementById('smoothing-value').textContent,
    skin: document.getElementById('skin-protect-value').textContent,
    gamut: document.getElementById('gamut-compress-value').textContent
  })`), { preview: '37%', convert: '200%', luma: '100%', smoothing: '100%', skin: '100%', gamut: '100%' });
  await window.webContents.executeJavaScript(`
    document.getElementById('reset-convert-btn').click();
    document.getElementById('intensity-slider').value = '100';
    document.getElementById('intensity-slider').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  assert.deepEqual(await window.webContents.executeJavaScript(`({
    convert: [document.getElementById('intensity-convert-slider').value, document.getElementById('intensity-convert-value').textContent],
    luma: [document.getElementById('luma-preserve-slider').value, document.getElementById('luma-preserve-value').textContent],
    smoothing: [document.getElementById('smoothing-slider').value, document.getElementById('smoothing-value').textContent],
    skin: [document.getElementById('skin-protect-slider').value, document.getElementById('skin-protect-value').textContent],
    gamut: [document.getElementById('gamut-compress-slider').value, document.getElementById('gamut-compress-value').textContent]
  })`), {
    convert: ['100', '100%'], luma: ['0', '0%'], smoothing: ['0', '0%'], skin: ['0', '0%'], gamut: ['0', '0%']
  });
  const preview = await window.webContents.executeJavaScript(`({
    width: document.getElementById('preview-canvas').width,
    height: document.getElementById('preview-canvas').height,
    sourceWidth: document.getElementById('preview-canvas').dataset.sourceWidth,
    sourceHeight: document.getElementById('preview-canvas').dataset.sourceHeight,
    pixelPreserved: document.getElementById('preview-canvas').dataset.pixelPreserved
  })`);
  assert.deepEqual(preview, { width: 320, height: 180, sourceWidth: '320', sourceHeight: '180', pixelPreserved: 'true' });
  const previewLayout = await window.webContents.executeJavaScript(`
    (() => {
      const controls = document.querySelector('.convert-section').getBoundingClientRect();
      const viewer = document.querySelector('.preview-section').getBoundingClientRect();
      const pngSelect = document.getElementById('png-level-select').getBoundingClientRect();
      const pngPanel = document.querySelector('.png-settings').getBoundingClientRect();
      // On Windows runners with display scaling, documentElement.clientWidth can
      // be reported in scale-adjusted units while DOMRects and fixed positioning
      // use the layout viewport. window.innerWidth shares the DOMRect coordinate
      // space, so it is the correct boundary for visual overflow checks.
      const viewportWidth = window.innerWidth;
      const documentClientWidth = document.documentElement.clientWidth;
      const overflowElements = [...document.querySelectorAll('body *')]
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            selector: element.id ? '#' + element.id : element.className && typeof element.className === 'string' ? '.' + element.className.trim().replace(/\\s+/g, '.') : element.tagName.toLowerCase(),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width)
          };
        })
        .filter(item => item.right > viewportWidth + 1 || item.left < -1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 8);
      return {
        controlsLeft: controls.left,
        viewerLeft: viewer.left,
        topDelta: Math.abs(controls.top - viewer.top),
        controlsCenterDelta: Math.abs((controls.top + controls.bottom) / 2 - window.innerHeight / 2),
        controlsTop: controls.top,
        controlsBottom: controls.bottom,
        pngSelectLeft: pngSelect.left,
        pngSelectRight: pngSelect.right,
        pngPanelLeft: pngPanel.left,
        pngPanelRight: pngPanel.right,
        overflow: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
        viewportWidth,
        viewportHeight: window.innerHeight,
        documentClientWidth,
        overflowElements
      };
    })()
  `);
  assert.ok(previewLayout.viewerLeft > previewLayout.controlsLeft && previewLayout.topDelta < 20, JSON.stringify(previewLayout));
  assert.ok(previewLayout.pngSelectLeft >= previewLayout.pngPanelLeft && previewLayout.pngSelectRight <= previewLayout.pngPanelRight, JSON.stringify(previewLayout));
  assert.equal(previewLayout.overflow, 0, JSON.stringify(previewLayout));
  await window.webContents.executeJavaScript(`
    document.getElementById('png-level-select').value = '3';
    document.getElementById('png-level-select').dispatchEvent(new Event('change', { bubbles: true }));
  `);
  assert.match(await window.webContents.executeJavaScript(`document.getElementById('convert-info').textContent`), /Hald L3 PNG/);
  await window.webContents.executeJavaScript(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const stickyLayout = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('.convert-section').getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      centerDelta: Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2),
      viewportHeight: window.innerHeight
    };
  })()`);
  assert.ok(stickyLayout.top >= 70 && stickyLayout.bottom <= stickyLayout.viewportHeight - 70, JSON.stringify(stickyLayout));
  assert.ok(stickyLayout.centerDelta < 5, JSON.stringify(stickyLayout));
  await window.webContents.executeJavaScript(`window.scrollTo(0, 0)`);

  // A width above the old 1920px cap proves that custom previews keep their
  // native backing dimensions without making this smoke test memory-heavy.
  await window.webContents.executeJavaScript(`
    new Promise(resolve => {
      const canvas = document.createElement('canvas'); canvas.width = 2001; canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = '#804020'; context.fillRect(0, 0, 2001, 32);
      canvas.toBlob(blob => {
        const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'wide-preview.png', { type: 'image/png' }));
        const input = document.getElementById('image-file-input'); input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true })); resolve();
      }, 'image/png');
    })
  `);
  await waitFor(window, `document.getElementById('preview-canvas').dataset.sourceWidth === '2001'`);
  assert.deepEqual(await window.webContents.executeJavaScript(`({
    width: document.getElementById('preview-canvas').width,
    height: document.getElementById('preview-canvas').height
  })`), { width: 2001, height: 32 });
  assert.deepEqual(await window.webContents.executeJavaScript(`(() => {
    const context = document.getElementById('preview-canvas').getContext('2d');
    return {
      original: Array.from(context.getImageData(100, 10, 1, 1).data),
      transformed: Array.from(context.getImageData(1900, 10, 1, 1).data)
    };
  })()`), {
    original: [128, 64, 32, 255],
    transformed: [128, 64, 32, 255]
  });

  window.setSize(900, 720);
  await new Promise(resolve => setTimeout(resolve, 150));
  const narrowLayout = await window.webContents.executeJavaScript(`(() => {
    const select = document.getElementById('png-level-select').getBoundingClientRect();
    const panel = document.querySelector('.png-settings').getBoundingClientRect();
    return {
      columns: getComputedStyle(document.querySelector('.preview-main')).gridTemplateColumns,
      convertPosition: getComputedStyle(document.querySelector('.convert-section')).position,
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      selectInside: select.left >= panel.left && select.right <= panel.right
    };
  })()`);
  assert.equal(narrowLayout.columns.split(' ').length, 1, JSON.stringify(narrowLayout));
  assert.equal(narrowLayout.convertPosition, 'static', JSON.stringify(narrowLayout));
  assert.equal(narrowLayout.overflow, 0, JSON.stringify(narrowLayout));
  assert.equal(narrowLayout.selectInside, true, JSON.stringify(narrowLayout));
  window.setSize(1280, 900);
  await new Promise(resolve => setTimeout(resolve, 150));
  if (process.env.LUT_UI_CAPTURE) {
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(process.env.LUT_UI_CAPTURE, screenshot.toPNG());
  }

  // Let pending canvas compositing finish before tearing down Chromium's GPU
  // resources. Immediate destruction can produce false shared-image errors.
  await new Promise(resolve => setTimeout(resolve, 250));
  window.destroy();
  assert.deepEqual(consoleErrors, []);
  console.log('electron smoke tests passed');
}

run().then(() => app.quit()).catch(error => {
  console.error(error);
  app.exit(1);
});
