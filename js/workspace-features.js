(function (root) {
  'use strict';

  const HISTORY_DB = 'lut-analysis-toolbox-history';
  const HISTORY_STORE = 'lut-files';
  const HISTORY_LIMIT = 20;
  const COLOR_FAMILIES = [
    { key: 'red', label: '红色', hue: 0 },
    { key: 'yellow', label: '黄色', hue: 60 },
    { key: 'green', label: '绿色', hue: 120 },
    { key: 'cyan', label: '青色', hue: 180 },
    { key: 'blue', label: '蓝色', hue: 240 },
    { key: 'magenta', label: '品红', hue: 300 }
  ];

  function wrapHueDegrees(value) {
    let result = value;
    while (result < -180) result += 360;
    while (result > 180) result -= 360;
    return result;
  }

  function analyzeColorFamilies(lutObject, utils) {
    if (!lutObject || !utils) throw new Error('LUT and LUT utilities are required');
    const offsets = [-10, 0, 10];
    const saturations = [0.5, 1];
    const values = [0.25, 0.5, 0.75, 1];
    return COLOR_FAMILIES.map(family => {
      let brightness = 0;
      let saturation = 0;
      let hueShift = 0;
      let hueSamples = 0;
      let maxHueShift = 0;
      let clipping = 0;
      let samples = 0;
      for (const offset of offsets) for (const sat of saturations) for (const value of values) {
        const hue = ((family.hue + offset + 360) % 360) / 360;
        const input = utils.hsvToRgb(hue, sat, value);
        const output = utils.tetraInterp(input[0], input[1], input[2], lutObject.lut, lutObject.size);
        const inputY = 0.2126 * input[0] + 0.7152 * input[1] + 0.0722 * input[2];
        const outputY = 0.2126 * output[0] + 0.7152 * output[1] + 0.0722 * output[2];
        const displayOutput = output.map(utils.clamp01);
        const outputHsv = utils.rgbToHsv(displayOutput[0], displayOutput[1], displayOutput[2]);
        brightness += outputY - inputY;
        saturation += outputHsv[1] - sat;
        if (outputHsv[1] >= 0.05) {
          const shift = wrapHueDegrees(360 * (outputHsv[0] - hue));
          hueShift += shift;
          hueSamples += 1;
          maxHueShift = Math.max(maxHueShift, Math.abs(shift));
        }
        if (output.some(channel => channel < 0 || channel > 1)) clipping += 1;
        samples += 1;
      }
      return {
        key: family.key,
        label: family.label,
        brightnessDelta: brightness / samples,
        saturationDelta: saturation / samples,
        hueShift: hueSamples ? hueShift / hueSamples : 0,
        maxHueShift,
        clippingPercent: 100 * clipping / samples,
        samples
      };
    });
  }

  function signedPercent(value) {
    const percent = 100 * value;
    if (Math.abs(percent) < 0.05) return '0.0%';
    return `${percent > 0.005 ? '+' : ''}${percent.toFixed(1)}%`;
  }

  function signedDegrees(value) {
    if (Math.abs(value) < 0.05) return '0.0°';
    return `${value > 0.005 ? '+' : ''}${value.toFixed(1)}°`;
  }

  function dominant(items, property, direction) {
    return items.reduce((best, item) => {
      if (!best) return item;
      return direction * item[property] > direction * best[property] ? item : best;
    }, null);
  }

  function buildColorSummary(families) {
    const brightest = dominant(families, 'brightnessDelta', 1);
    const darkest = dominant(families, 'brightnessDelta', -1);
    const saturated = dominant(families, 'saturationDelta', 1);
    const reduced = dominant(families, 'saturationDelta', -1);
    const shifted = families.reduce((best, item) => !best || Math.abs(item.hueShift) > Math.abs(best.hueShift) ? item : best, null);
    const clipped = dominant(families, 'clippingPercent', 1);
    const brightnessUniform = Math.abs(brightest.brightnessDelta - darkest.brightnessDelta) < 0.00005;
    const saturationUniform = Math.abs(saturated.saturationDelta - reduced.saturationDelta) < 0.00005;
    const hueNeutral = families.every(item => Math.abs(item.hueShift) < 0.005);
    return {
      curve: brightnessUniform
        ? `六个基础色系亮度平均变化均为 ${signedPercent(brightest.brightnessDelta)}。`
        : `${brightest.label}亮度变化最高 ${signedPercent(brightest.brightnessDelta)}；${darkest.label}变化最低 ${signedPercent(darkest.brightnessDelta)}。`,
      granger: clipped.clippingPercent > 0
        ? `${clipped.label}测试样本中 ${clipped.clippingPercent.toFixed(1)}% 超出 0–1 范围，请重点检查高饱和区域。`
        : '六个基础色系采样均位于 0–1 范围内，未发现基础采样越界。',
      hue: hueNeutral
        ? '六个基础色系未检测到平均色相偏移。'
        : `${shifted.label}平均色相偏移最大，为 ${signedDegrees(shifted.hueShift)}；正值表示沿色相环正方向移动。`,
      saturation: saturationUniform
        ? `六个基础色系饱和度平均变化均为 ${signedPercent(saturated.saturationDelta)}。`
        : `${saturated.label}饱和度增强最多 ${signedPercent(saturated.saturationDelta)}；${reduced.label}降低最多 ${signedPercent(reduced.saturationDelta)}。`,
      vectorscope: saturationUniform
        ? `六个基础色系径向变化一致，为 ${signedPercent(saturated.saturationDelta)}。`
        : `扩张最明显：${saturated.label} ${signedPercent(saturated.saturationDelta)}；收缩最明显：${reduced.label} ${signedPercent(reduced.saturationDelta)}。`
    };
  }

  function openHistoryDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('当前环境不支持本地历史记录'));
      const request = root.indexedDB.open(HISTORY_DB, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(HISTORY_STORE)) {
          const store = database.createObjectStore(HISTORY_STORE, { keyPath: 'hash' });
          store.createIndex('lastOpenedAt', 'lastOpenedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('历史数据库打开失败'));
    });
  }

  async function withHistoryStore(mode, operation) {
    const database = await openHistoryDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(HISTORY_STORE, mode);
        const store = transaction.objectStore(HISTORY_STORE);
        let result;
        try { result = operation(store); } catch (error) { reject(error); return; }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('历史数据库操作失败'));
        transaction.onabort = () => reject(transaction.error || new Error('历史数据库操作已中止'));
      });
    } finally {
      database.close();
    }
  }

  async function hashBuffer(buffer) {
    const digest = await root.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  }

  async function listHistory() {
    const database = await openHistoryDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(HISTORY_STORE, 'readonly').objectStore(HISTORY_STORE).getAll();
        request.onsuccess = () => resolve(request.result.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt));
        request.onerror = () => reject(request.error || new Error('读取历史记录失败'));
      });
    } finally {
      database.close();
    }
  }

  async function trimHistory() {
    const records = await listHistory();
    if (records.length <= HISTORY_LIMIT) return;
    await withHistoryStore('readwrite', store => {
      records.slice(HISTORY_LIMIT).forEach(record => store.delete(record.hash));
    });
  }

  async function saveHistory(file, buffer, lutObject, page) {
    const hash = await hashBuffer(buffer);
    const timestamp = Date.now();
    const existing = (await listHistory()).find(record => record.hash === hash);
    const record = {
      hash,
      name: file.name,
      type: file.type || 'text/plain',
      size: file.size,
      lastModified: file.lastModified || timestamp,
      createdAt: existing ? existing.createdAt : timestamp,
      lastOpenedAt: timestamp,
      page,
      lutSize: lutObject.size,
      domainMin: Array.from(lutObject.domainMin || [0, 0, 0]),
      domainMax: Array.from(lutObject.domainMax || [1, 1, 1]),
      blob: new Blob([buffer], { type: file.type || 'text/plain' }),
      analysisVersion: 1
    };
    await withHistoryStore('readwrite', store => { store.put(record); });
    await trimHistory();
    return record;
  }

  async function deleteHistory(hash) {
    await withHistoryStore('readwrite', store => { store.delete(hash); });
  }

  function pageInput() {
    if (document.body.classList.contains('desktop-checker')) return document.getElementById('lutviz-file');
    if (document.body.classList.contains('desktop-analyzer')) return document.getElementById('lutfile');
    if (document.body.classList.contains('desktop-previewer')) return document.getElementById('lut-file-input');
    return null;
  }

  function currentPageName() {
    if (document.body.classList.contains('desktop-checker')) return 'checker';
    if (document.body.classList.contains('desktop-analyzer')) return 'analyzer';
    if (document.body.classList.contains('desktop-previewer')) return 'previewer';
    return 'home';
  }

  function setImportFile(zone, file, lutObject) {
    if (!zone) return;
    zone.classList.add('has-file');
    const title = zone.querySelector('.drop-zone-text');
    const hint = zone.querySelector('.drop-zone-hint');
    if (title) title.textContent = file.name;
    if (hint) hint.textContent = `${lutObject.size}³ · ${root.LUTUtils.formatFileSize(file.size)} · 已保存到历史`;
    zone.title = file.name;
  }

  function renderFamilyTable(families) {
    return families.map(item => `
      <div class="family-row family-${item.key}">
        <span class="family-name">${item.label}</span>
        <span>${signedPercent(item.brightnessDelta)}</span>
        <span>${signedPercent(item.saturationDelta)}</span>
        <span>${signedDegrees(item.hueShift)}</span>
      </div>`).join('');
  }

  function renderSummaries(families) {
    const summary = buildColorSummary(families);
    const content = {
      'curve-summary': summary.curve,
      'granger-summary': summary.granger,
      'hue-summary': summary.hue,
      'saturation-summary': summary.saturation,
      'vectorscope-summary': summary.vectorscope
    };
    Object.entries(content).forEach(([id, text]) => {
      const element = document.getElementById(id);
      if (element) { element.textContent = text; element.classList.add('ready'); }
    });
    const familyTable = document.getElementById('family-summary-table');
    if (familyTable) familyTable.innerHTML = renderFamilyTable(families);
  }

  function createHistoryDrawer() {
    if (document.getElementById('history-drawer')) return;
    const nav = document.querySelector('.yx-nav');
    if (nav) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-toggle';
      button.setAttribute('aria-controls', 'history-drawer');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = '<span aria-hidden="true">◷</span> 历史';
      nav.appendChild(button);
    }
    document.body.insertAdjacentHTML('beforeend', `
      <div class="history-backdrop" id="history-backdrop"></div>
      <aside class="history-drawer" id="history-drawer" aria-label="LUT 历史记录" aria-hidden="true">
        <div class="history-header"><div><span class="workspace-kicker">LOCAL LIBRARY</span><h2>最近使用</h2></div><button type="button" class="history-close" aria-label="关闭历史">×</button></div>
        <p class="history-description">保存在本机，最多 20 个 LUT；相同文件自动去重。</p>
        <div class="history-list" id="history-list"><div class="history-empty">正在读取历史…</div></div>
      </aside>`);
    const drawer = document.getElementById('history-drawer');
    const backdrop = document.getElementById('history-backdrop');
    const toggle = document.querySelector('.history-toggle');
    const setOpen = open => {
      drawer.classList.toggle('open', open);
      backdrop.classList.toggle('open', open);
      drawer.setAttribute('aria-hidden', String(!open));
      toggle && toggle.setAttribute('aria-expanded', String(open));
      if (open) refreshHistory();
    };
    toggle && toggle.addEventListener('click', () => setOpen(true));
    backdrop.addEventListener('click', () => setOpen(false));
    drawer.querySelector('.history-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && drawer.classList.contains('open')) setOpen(false); });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  async function restoreHistory(record) {
    const input = pageInput();
    if (!input) return;
    if (input.accept === '.cube' && !/\.cube$/i.test(record.name)) {
      root.showToast && root.showToast('当前工具只支持 .cube 文件', 'error');
      return;
    }
    const file = new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.history-close')?.click();
  }

  async function refreshHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    try {
      const records = await listHistory();
      if (!records.length) { list.innerHTML = '<div class="history-empty">还没有历史记录<br><span>导入 LUT 后会自动保存在这里</span></div>'; return; }
      list.innerHTML = records.map(record => `
        <article class="history-item" data-hash="${record.hash}">
          <button type="button" class="history-open" title="打开 ${escapeHtml(record.name)}">
            <span class="history-file-icon">3D</span>
            <span class="history-file-copy"><strong>${escapeHtml(record.name)}</strong><small>${record.lutSize}³ · ${root.LUTUtils.formatFileSize(record.size)} · ${new Date(record.lastOpenedAt).toLocaleString()}</small></span>
          </button>
          <button type="button" class="history-delete" aria-label="删除 ${escapeHtml(record.name)}">×</button>
        </article>`).join('');
      list.querySelectorAll('.history-item').forEach((item, index) => {
        item.querySelector('.history-open').addEventListener('click', () => restoreHistory(records[index]));
        item.querySelector('.history-delete').addEventListener('click', async () => {
          if (!root.confirm(`从历史记录中删除“${records[index].name}”？`)) return;
          await deleteHistory(item.dataset.hash);
          await refreshHistory();
        });
      });
    } catch (error) {
      list.innerHTML = `<div class="history-empty">历史记录不可用<br><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  async function decodeLutFile(file, buffer) {
    if (/\.cube$/i.test(file.name)) {
      return root.LUTUtils.parseCubeSafe(new TextDecoder('utf-8').decode(buffer));
    }
    if (/\.png$/i.test(file.name) && document.body.classList.contains('desktop-previewer')) {
      const bitmap = await root.createImageBitmap(new Blob([buffer], { type: file.type || 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const lutObject = root.LUTUtils.parseHaldCLUTImage(context.getImageData(0, 0, bitmap.width, bitmap.height));
      return lutObject;
    }
    return null;
  }

  async function processFile(file, zone) {
    if (!file || !/\.(cube|png)$/i.test(file.name) || file.size > 16 * 1024 * 1024) return;
    const buffer = await file.arrayBuffer();
    const lutObject = await decodeLutFile(file, buffer);
    if (!lutObject) return;
    setImportFile(zone, file, lutObject);
    if (!document.body.classList.contains('desktop-previewer')) renderSummaries(analyzeColorFamilies(lutObject, root.LUTUtils));
    await saveHistory(file, buffer, lutObject, currentPageName());
    await refreshHistory();
  }

  function installFileTracking() {
    const input = pageInput();
    if (!input) return;
    const zone = input.closest('.drop-zone');
    input.addEventListener('change', event => {
      const files = Array.from(event.target.files || []);
      files.forEach(file => processFile(file, zone).catch(error => {
        console.warn('工作区扩展处理失败：', error);
      }));
    }, { capture: true });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      setTimeout(() => {
        if (input.files && input.files.length) return;
        zone && zone.classList.remove('has-file');
      }, 0);
    });
  }

  function installGlassMotion() {
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    document.addEventListener('pointermove', event => {
      if (frame) return;
      frame = root.requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--glass-x', `${event.clientX}px`);
        document.documentElement.style.setProperty('--glass-y', `${event.clientY}px`);
        frame = 0;
      });
    }, { passive: true });
  }

  function initialize() {
    if (!root.LUTUtils || document.body.classList.contains('desktop-home')) return;
    createHistoryDrawer();
    installFileTracking();
    installGlassMotion();
    refreshHistory();
  }

  const api = { COLOR_FAMILIES, wrapHueDegrees, analyzeColorFamilies, buildColorSummary, signedPercent, signedDegrees };
  root.LUTWorkspaceFeatures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
