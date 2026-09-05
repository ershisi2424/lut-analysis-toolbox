(function () {
  'use strict';

  const canvas = document.getElementById('cube');
  if (!canvas || !window.LUTUtils) return;

  const context = canvas.getContext('2d', { willReadFrequently: false });
  const input = document.getElementById('lutfile');
  const filename = document.getElementById('filename');
  const blendInput = document.getElementById('blend');
  const densityInput = document.getElementById('density');
  const pointSizeInput = document.getElementById('psize');
  const backgroundInput = document.getElementById('bg');
  const autoRotateInput = document.getElementById('autorotate');
  const boxInput = document.getElementById('bbox');
  const neutralsInput = document.getElementById('neutrals');
  const ireInput = document.getElementById('iretoggle');
  const ireOverlay = document.getElementById('ireOverlay');
  const ireCanvas = document.getElementById('ireCanvas');
  const ireContext = ireCanvas.getContext('2d', { willReadFrequently: false });
  const cornerButtons = [...document.querySelectorAll('.corner-btn[data-corner]')];
  const cornerState = document.getElementById('corner-state');

  const MAX_FILE_BYTES = 9 * 1024 * 1024;
  const EDGE_PAIRS = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  const CORNER_LABELS = { all: '全部色域', red: '红色域', green: '绿色域', blue: '蓝色域', cyan: '青色域', magenta: '品红域', yellow: '黄色域' };

  let lutObject = null;
  let curves = null;
  let density = Number(densityInput.value);
  let pointSize = Number(pointSizeInput.value);
  let blend = Number(blendInput.value);
  let autoRotate = autoRotateInput.checked;
  let showBox = boxInput.checked;
  let neutralsOnly = neutralsInput.checked;
  let cornerMode = 'all';
  let zoom = 0.18;
  let rotation = normalizeQuaternion([0.382683, 0.434, 0, 0.816]);
  let dragging = false;
  let dragButton = 0;
  let lastX = 0;
  let lastY = 0;
  let frameHandle = 0;
  let deviceScale = 1;
  let cssWidth = 1;
  let cssHeight = 1;

  let basePoints = new Float32Array(0);
  let outputPoints = new Float32Array(0);
  let displayPoints = new Float32Array(0);
  let visibleMask = new Uint8Array(0);
  let projectedX = new Float32Array(0);
  let projectedY = new Float32Array(0);
  let projectedDepth = new Float32Array(0);
  let drawOrder = [];
  let displayBounds = { min: [0, 0, 0], max: [1, 1, 1] };

  function multiplyQuaternion(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  }

  function axisAngle(axis, angle) {
    const half = angle * 0.5, sine = Math.sin(half);
    return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
  }

  function normalizeQuaternion(value) {
    const length = Math.hypot(...value) || 1;
    return value.map(component => component / length);
  }

  function quaternionMatrix([x, y, z, w]) {
    const x2 = x + x, y2 = y + y, z2 = z + z;
    return [
      1 - y * y2 - z * z2, x * y2 + w * z2, x * z2 - w * y2,
      x * y2 - w * z2, 1 - x * x2 - z * z2, y * z2 + w * x2,
      x * z2 + w * y2, y * z2 - w * x2, 1 - x * x2 - y * y2
    ];
  }

  function domainValue(channel, normalized) {
    if (!lutObject) return normalized;
    const min = lutObject.domainMin || [0, 0, 0];
    const max = lutObject.domainMax || [1, 1, 1];
    return min[channel] + normalized * (max[channel] - min[channel]);
  }

  function matchesCorner(red, green, blue) {
    if (cornerMode === 'all') return true;
    if (cornerMode === 'red') return red >= green && red >= blue;
    if (cornerMode === 'green') return green >= red && green >= blue;
    if (cornerMode === 'blue') return blue >= red && blue >= green;
    if (cornerMode === 'cyan') return green >= red && blue >= red;
    if (cornerMode === 'magenta') return red >= green && blue >= green;
    return red >= blue && green >= blue;
  }

  function buildPointCache() {
    const pointCount = density ** 3;
    basePoints = new Float32Array(pointCount * 3);
    outputPoints = new Float32Array(pointCount * 3);
    displayPoints = new Float32Array(pointCount * 3);
    visibleMask = new Uint8Array(pointCount);
    projectedX = new Float32Array(pointCount);
    projectedY = new Float32Array(pointCount);
    projectedDepth = new Float32Array(pointCount);
    drawOrder = new Array(pointCount);

    const last = density - 1;
    let offset = 0;
    for (let redIndex = 0; redIndex < density; redIndex += 1) {
      for (let greenIndex = 0; greenIndex < density; greenIndex += 1) {
        for (let blueIndex = 0; blueIndex < density; blueIndex += 1) {
          const red = redIndex / last, green = greenIndex / last, blue = blueIndex / last;
          basePoints[offset] = red;
          basePoints[offset + 1] = green;
          basePoints[offset + 2] = blue;
          if (lutObject) {
            const output = LUTUtils.tetraInterp(
              domainValue(0, red), domainValue(1, green), domainValue(2, blue),
              lutObject.lut, lutObject.size
            );
            outputPoints[offset] = output[0];
            outputPoints[offset + 1] = output[1];
            outputPoints[offset + 2] = output[2];
          } else {
            outputPoints[offset] = red;
            outputPoints[offset + 1] = green;
            outputPoints[offset + 2] = blue;
          }
          offset += 3;
        }
      }
    }
    updateDisplayCache();
  }

  function updateDisplayCache() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let index = 0, offset = 0; index < drawOrder.length; index += 1, offset += 3) {
      const red = basePoints[offset], green = basePoints[offset + 1], blue = basePoints[offset + 2];
      let visible = matchesCorner(red, green, blue);
      if (neutralsOnly && (Math.abs(red - green) > 1e-6 || Math.abs(green - blue) > 1e-6)) visible = false;
      visibleMask[index] = visible ? 1 : 0;
      drawOrder[index] = index;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = basePoints[offset + channel] + blend * (outputPoints[offset + channel] - basePoints[offset + channel]);
        displayPoints[offset + channel] = value;
        min[channel] = Math.min(min[channel], value);
        max[channel] = Math.max(max[channel], value);
      }
    }
    for (let channel = 0; channel < 3; channel += 1) {
      if (!Number.isFinite(min[channel]) || !Number.isFinite(max[channel])) { min[channel] = 0; max[channel] = 1; }
      if (Math.abs(max[channel] - min[channel]) < 1e-6) { min[channel] -= 0.005; max[channel] += 0.005; }
    }
    displayBounds = { min, max };
    canvas.dataset.boundsMin = min.map(value => value.toFixed(6)).join(',');
    canvas.dataset.boundsMax = max.map(value => value.toFixed(6)).join(',');
    canvas.dataset.sampleCount = String(drawOrder.length);
    drawIre();
  }

  function project(red, green, blue, matrix, scale, centerX, centerY) {
    const x = (red - 0.5) * 2, y = (green - 0.5) * 2, z = (0.5 - blue) * 2;
    const vx = matrix[0] * x + matrix[3] * y + matrix[6] * z;
    const vy = matrix[1] * x + matrix[4] * y + matrix[7] * z;
    const vz = matrix[2] * x + matrix[5] * y + matrix[8] * z;
    const perspective = 3 / (3 - vz);
    return [centerX + vx * scale * perspective, centerY - vy * scale * perspective, perspective];
  }

  function boundsCorners() {
    const { min, max } = displayBounds;
    return [
      [min[0], min[1], min[2]], [max[0], min[1], min[2]],
      [min[0], max[1], min[2]], [max[0], max[1], min[2]],
      [min[0], min[1], max[2]], [max[0], min[1], max[2]],
      [min[0], max[1], max[2]], [max[0], max[1], max[2]]
    ];
  }

  function drawDynamicBox(matrix, scale, centerX, centerY) {
    const corners = boundsCorners().map(point => project(...point, matrix, scale, centerX, centerY));
    context.save();
    context.setLineDash([5, 4]);
    const traceEdges = () => {
      context.beginPath();
      EDGE_PAIRS.forEach(([start, end]) => {
        context.moveTo(corners[start][0], corners[start][1]);
        context.lineTo(corners[end][0], corners[end][1]);
      });
      context.stroke();
    };
    // A dark under-stroke separates the bounds from bright samples; the light
    // stroke remains readable on the empty, near-black parts of the canvas.
    context.strokeStyle = 'rgba(4, 8, 18, 0.9)';
    context.lineWidth = 3.5;
    traceEdges();
    context.strokeStyle = 'rgba(197, 211, 242, 0.9)';
    context.lineWidth = 1.35;
    traceEdges();
    context.restore();
  }

  function render() {
    if (autoRotate && !dragging) {
      rotation = normalizeQuaternion(multiplyQuaternion(axisAngle([0, 1, 0], 0.001), multiplyQuaternion(axisAngle([0, 0, 1], 0.0007), rotation)));
    }
    context.clearRect(0, 0, cssWidth, cssHeight);
    const matrix = quaternionMatrix(rotation);
    const scale = Math.min(cssWidth, cssHeight) * zoom;
    const centerX = Math.max(cssWidth * 0.5, 390 + (cssWidth - 390) * 0.5);
    const centerY = cssHeight * 0.5;

    for (let index = 0, offset = 0; index < drawOrder.length; index += 1, offset += 3) {
      const projected = project(displayPoints[offset], displayPoints[offset + 1], displayPoints[offset + 2], matrix, scale, centerX, centerY);
      projectedX[index] = projected[0];
      projectedY[index] = projected[1];
      projectedDepth[index] = projected[2];
    }
    drawOrder.sort((a, b) => projectedDepth[a] - projectedDepth[b]);

    const radius = pointSize;
    for (const index of drawOrder) {
      if (!visibleMask[index]) continue;
      const offset = index * 3;
      const red = LUTUtils.clamp01(displayPoints[offset]);
      const green = LUTUtils.clamp01(displayPoints[offset + 1]);
      const blue = LUTUtils.clamp01(displayPoints[offset + 2]);
      context.fillStyle = `rgb(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)})`;
      context.beginPath();
      context.arc(projectedX[index], projectedY[index], radius, 0, Math.PI * 2);
      context.fill();
    }
    if (showBox) drawDynamicBox(matrix, scale, centerX, centerY);
    frameHandle = requestAnimationFrame(render);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(2, Math.round(rect.width || window.innerWidth));
    cssHeight = Math.max(2, Math.round(rect.height || window.innerHeight));
    deviceScale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssWidth * deviceScale);
    canvas.height = Math.round(cssHeight * deviceScale);
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    resizeIre();
  }

  function updateWorkspaceBackground(value) {
    const sliderValue = Math.max(0, Math.min(1, Number(value)));
    // Match MonoNodes LUT Cube Analyzer: the 0..1 control maps to RGB 0..128.
    const channel = Math.round(sliderValue * 128);
    document.documentElement.style.setProperty('--analyzer-workspace-bg', `rgb(${channel}, ${channel}, ${channel})`);
    canvas.dataset.workspaceGray = String(Math.round(channel / 255 * 100));
    canvas.dataset.backgroundValue = sliderValue.toFixed(2);
  }

  function resizeIre() {
    const width = Math.max(1, Math.round(ireCanvas.clientWidth || 800));
    const height = Math.max(220, Math.round(width * 0.54));
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    ireCanvas.width = Math.round(width * ratio);
    ireCanvas.height = Math.round(height * ratio);
    ireContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawIre();
  }

  function ireSeries() {
    const samples = curves || { r: null, g: null, b: null, y: null };
    return [['white', samples.y, 2.5], ['red', samples.r, 2], ['lime', samples.g, 2], ['deepskyblue', samples.b, 2]];
  }

  function displayedIreValue(values, index, count) {
    const normalized = index / (count - 1);
    const output = values ? values[index] : normalized;
    return normalized + blend * (output - normalized);
  }

  function calculateIreScale(series) {
    let minimum = 0, maximum = 1;
    for (const [, values] of series) {
      const count = values ? values.length : 65;
      for (let index = 0; index < count; index += 1) {
        const value = displayedIreValue(values, index, count);
        if (!Number.isFinite(value)) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
    // Retain the standard 0–100 IRE region and extend only when the LUT needs it.
    const minPercent = Math.min(0, Math.floor(minimum * 10) * 10);
    const maxPercent = Math.max(100, Math.ceil(maximum * 10) * 10);
    return { minPercent, maxPercent };
  }

  function ireGridStep(span) {
    if (span <= 120) return 10;
    const rough = span / 10;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return factor * magnitude;
  }

  function drawIre() {
    if (!ireOverlay.classList.contains('show')) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = ireCanvas.width / ratio, height = ireCanvas.height / ratio;
    const margins = { left: 58, top: 18, right: 18, bottom: 18 };
    const plotWidth = width - margins.left - margins.right;
    const plotHeight = height - margins.top - margins.bottom;
    const series = ireSeries();
    const { minPercent, maxPercent } = calculateIreScale(series);
    const scaleSpan = maxPercent - minPercent;
    const gridStep = ireGridStep(scaleSpan);
    const plotY = value => margins.top + plotHeight * (maxPercent - value * 100) / scaleSpan;
    ireCanvas.dataset.scaleMin = String(minPercent);
    ireCanvas.dataset.scaleMax = String(maxPercent);
    ireContext.fillStyle = '#000';
    ireContext.fillRect(0, 0, width, height);
    ireContext.font = '12px system-ui, Segoe UI, sans-serif';
    ireContext.textBaseline = 'middle';
    ireContext.textAlign = 'right';
    const firstGrid = Math.ceil(minPercent / gridStep) * gridStep;
    for (let value = firstGrid; value <= maxPercent + 1e-7; value += gridStep) {
      const y = plotY(value / 100);
      const referenceLine = value === 0 || value === 100;
      ireContext.strokeStyle = referenceLine ? '#596273' : '#2c2c2c';
      ireContext.lineWidth = referenceLine ? 1.35 : 1;
      ireContext.beginPath(); ireContext.moveTo(margins.left, y); ireContext.lineTo(width - margins.right, y); ireContext.stroke();
      ireContext.fillStyle = value < 0 ? '#f09a9a' : '#9aa0a6';
      ireContext.fillText(String(Object.is(value, -0) ? 0 : value), margins.left - 9, y);
    }
    ireContext.strokeStyle = '#444';
    ireContext.lineWidth = 1;
    ireContext.strokeRect(margins.left, margins.top, plotWidth, plotHeight);

    series.forEach(([color, values, lineWidth]) => {
      ireContext.strokeStyle = color; ireContext.lineWidth = lineWidth; ireContext.lineJoin = 'round'; ireContext.beginPath();
      const count = values ? values.length : 65;
      for (let index = 0; index < count; index += 1) {
        const normalized = index / (count - 1);
        const value = displayedIreValue(values, index, count);
        const x = margins.left + plotWidth * normalized;
        const y = plotY(value);
        if (index) ireContext.lineTo(x, y); else ireContext.moveTo(x, y);
      }
      ireContext.stroke();
    });
  }

  function updateSummary(value) {
    const ids = {
      'analysis-size': value?.size,
      'analysis-range': value?.dynamicRange,
      'analysis-contrast': value?.contrast,
      'analysis-saturation': value?.saturation
    };
    Object.entries(ids).forEach(([id, text]) => { document.getElementById(id).textContent = text || '-'; });
    const quality = value ? LUTUtils.analyzeQuality(lutObject) : null;
    document.getElementById('analysis-black-lift').textContent = quality?.blackLift || '-';
    document.getElementById('analysis-white-drop').textContent = quality?.whiteDrop || '-';
    document.getElementById('analysis-cast').textContent = quality?.maxCast || '-';
    document.getElementById('analysis-score').textContent = quality?.score ?? '-';
  }

  function clearLut(showMessage) {
    lutObject = null;
    curves = null;
    window.currentLUT = null;
    input.value = '';
    filename.textContent = '';
    blend = 0;
    blendInput.value = '0';
    window.syncRangeBadge?.(blendInput);
    updateSummary(null);
    buildPointCache();
    drawIre();
    if (showMessage && window.showToast) window.showToast('已重置', 'info');
  }

  function loadFile(file) {
    if (!file) return;
    if (!/\.cube$/i.test(file.name)) {
      window.showToast?.('请选择 .cube 文件', 'error'); input.value = ''; return;
    }
    if (file.size > MAX_FILE_BYTES) {
      window.showToast?.('文件太大，最大 9 MB', 'error'); input.value = ''; return;
    }
    const reader = new FileReader();
    reader.onerror = () => window.showToast?.('无法读取文件', 'error');
    reader.onload = () => {
      try {
        lutObject = LUTUtils.parseCubeSafe(String(reader.result || ''));
        curves = LUTUtils.buildDiagonalCurves(lutObject);
        window.currentLUT = lutObject;
        filename.textContent = file.name;
        blend = 1;
        blendInput.value = '1';
        window.syncRangeBadge?.(blendInput);
        buildPointCache();
        updateSummary(LUTUtils.analyzeLUT(lutObject, file.size));
        window.showToast?.('LUT 分析完成', 'success');
      } catch (error) {
        clearLut(false);
        window.showToast?.(`解析 LUT 错误: ${error.message}`, 'error');
      }
    };
    reader.readAsText(file);
  }

  blendInput.addEventListener('input', event => { blend = Number(event.target.value); updateDisplayCache(); });
  densityInput.addEventListener('input', event => { density = Math.round(Number(event.target.value)); buildPointCache(); });
  pointSizeInput.addEventListener('input', event => { pointSize = Number(event.target.value); });
  backgroundInput.addEventListener('input', event => updateWorkspaceBackground(event.target.value));
  autoRotateInput.addEventListener('change', event => { autoRotate = event.target.checked; });
  boxInput.addEventListener('change', event => { showBox = event.target.checked; });
  neutralsInput.addEventListener('change', event => { neutralsOnly = event.target.checked; updateDisplayCache(); });
  ireInput.addEventListener('change', event => {
    ireOverlay.classList.toggle('show', event.target.checked);
    if (event.target.checked) resizeIre();
  });

  cornerButtons.forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.corner;
    cornerMode = cornerMode === selected ? 'all' : selected;
    cornerButtons.forEach(item => item.classList.toggle('active', item.dataset.corner === cornerMode));
    cornerState.textContent = CORNER_LABELS[cornerMode];
    updateDisplayCache();
  }));

  input.addEventListener('change', event => loadFile(event.target.files?.[0]));
  const dropZone = document.getElementById('drop-zone');
  ['dragover', 'dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.toggle('drag-over', type === 'dragover');
    if (type === 'drop' && event.dataTransfer?.files?.[0]) loadFile(event.dataTransfer.files[0]);
  }));
  dropZone.addEventListener('click', () => input.click());

  canvas.addEventListener('mousedown', event => {
    dragging = true; dragButton = event.button; lastX = event.clientX; lastY = event.clientY; canvas.classList.add('dragging');
  });
  window.addEventListener('mouseup', () => { dragging = false; canvas.classList.remove('dragging'); });
  window.addEventListener('mousemove', event => {
    if (!dragging) return;
    const deltaX = event.clientX - lastX, deltaY = event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY;
    if (dragButton === 2) rotation = normalizeQuaternion(multiplyQuaternion(axisAngle([0, 0, 1], deltaX * 0.008), rotation));
    else rotation = normalizeQuaternion(multiplyQuaternion(axisAngle([0, 1, 0], deltaX * 0.008), multiplyQuaternion(axisAngle([1, 0, 0], deltaY * 0.008), rotation)));
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoom = Math.max(0.15, Math.min(0.6, zoom + (event.deltaY < 0 ? 0.02 : -0.02)));
  }, { passive: false });

  document.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.matches('INPUT, TEXTAREA, SELECT')) return;
    if (event.key === 'Escape') clearLut(true);
    if (event.key.toLowerCase() === 'f' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o')) {
      event.preventDefault(); input.click();
    }
  });
  window.addEventListener('resize', resizeCanvas);

  context.imageSmoothingEnabled = true;
  ireContext.imageSmoothingEnabled = true;
  cornerState.textContent = CORNER_LABELS.all;
  updateWorkspaceBackground(backgroundInput.value);
  resizeCanvas();
  buildPointCache();
  cancelAnimationFrame(frameHandle);
  render();
  setTimeout(() => document.getElementById('loading-overlay')?.classList.add('hidden'), 500);
})();
