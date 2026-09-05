'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isAllowedLocalPage, isPathInside } = require('../electron/navigation');

const root = path.resolve(__dirname, '..');
const pages = ['index.html', 'index1.html', 'index2.html', 'index3.html'];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.match(html, /LUT分析工具箱/, `${page} must use the project name`);
  assert.match(html, /js\/sw-register\.js\?v=/, `${page} must load the cache updater`);
  assert.doesNotMatch(html, /js\/lut-utils\.min\.js/, `${page} must not load the obsolete core`);
  for (const match of html.matchAll(/(?:href|src)="([^"?#]+)[^"?]*(?:\?[^"#]*)?"/g)) {
    const reference = match[1];
    if (/^(?:https?:|data:|#|\/)/.test(reference)) continue;
    assert.ok(fs.existsSync(path.join(root, reference)), `${page} references missing file ${reference}`);
  }
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Function(match[1]), `${page} contains invalid inline JavaScript`);
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${page} must not contain duplicate element IDs`);
}

for (const page of ['index.html', 'index1.html', 'index2.html', 'index3.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.match(html, /css\/desktop-shell\.css\?v=/, `${page} must load the desktop application shell`);
  assert.match(html, /class="[^"]*desktop-app desktop-(?:home|checker|analyzer|previewer)/, `${page} must identify its desktop workspace`);
}

for (const page of ['index1.html', 'index2.html', 'index3.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.match(html, /js\/desktop-ui\.js\?v=/, `${page} must load desktop interactions`);
  assert.match(html, /js\/workspace-features\.js\?v=/, `${page} must load workspace history and summaries`);
}

const analyzerPage = fs.readFileSync(path.join(root, 'index2.html'), 'utf8');
assert.match(analyzerPage, /data-file-trigger="lutfile"/);
assert.match(analyzerPage, /导入 3D LUT/);
assert.match(analyzerPage, /family-summary-table/);

const checkerPage = fs.readFileSync(path.join(root, 'index1.html'), 'utf8');
assert.match(checkerPage, /id="lutviz-file" accept="\.cube"/);
const checkerChart = fs.readFileSync(path.join(root, 'js/lutviz.min.js'), 'utf8');
assert.match(checkerChart, /function calculateCurveScale/);
assert.match(checkerChart, /i\.dataset\.scaleMin/);
for (const summaryId of ['curve-summary', 'granger-summary', 'hue-summary', 'saturation-summary', 'vectorscope-summary']) {
  assert.match(checkerPage, new RegExp(`id="${summaryId}"`));
}

const trackedText = pages.concat([
  'README.md', 'README-本地运行.md', 'manifest.json', 'package.json',
  'js/auth.js', 'electron/main.js', '启动LUT分析工具箱.command', '关闭LUT分析工具箱.command'
]).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(trackedText, /lus3d分析工具|lus3d-analysis-tool/, 'obsolete project names must be removed');

const previewPage = fs.readFileSync(path.join(root, 'index3.html'), 'utf8');
assert.doesNotMatch(previewPage, /customImageData|lutByName/, 'duplicate custom preview pipeline must be removed');
assert.equal((previewPage.match(/lutpreviewer\.min\.js/g) || []).length, 1);
assert.match(previewPage, /ImageMagick Hald/);
const previewer = fs.readFileSync(path.join(root, 'js/lutpreviewer.min.js'), 'utf8');
assert.doesNotMatch(previewer, /\b1920\b|\b1080\b/, 'custom previews must not be silently resized to HD');
assert.match(previewer, /dataset\.pixelPreserved = "true"/);
assert.match(previewer, /colorSpace: "srgb"/);
assert.match(previewer, /M && M\.addEventListener\("change", Ee\)/);
assert.match(previewer, /Hald L\$\{g\} PNG/);
const desktopStyles = fs.readFileSync(path.join(root, 'css/desktop-shell.css'), 'utf8');
assert.match(desktopStyles, /body\.desktop-previewer \.convert-section \{[\s\S]*?position: sticky;[\s\S]*?top: 76px;[\s\S]*?max-height: calc\(100vh - 152px\)/);

const auth = fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8');
const passwordHash = crypto.createHash('sha256').update('1820900463').digest('hex');
assert.match(auth, new RegExp(passwordHash));
assert.match(auth, /if \(isAuthenticated\(\)\)/);
assert.match(auth, /showOverlay\(\)/);
assert.match(auth, /hidePage\(\)/);

const analyzer = fs.readFileSync(path.join(root, 'js/lutanalyzer.js'), 'utf8');
assert.match(analyzerPage, /js\/lutanalyzer\.js\?v=/);
assert.doesNotMatch(analyzerPage, /lutanayzer\.min\.js/);
assert.match(analyzer, /function buildPointCache/);
assert.match(analyzer, /function drawDynamicBox/);
assert.match(analyzer, /function calculateIreScale/);
assert.match(analyzer, /displayBounds/);
assert.match(analyzer, /ireCanvas\.width \/ ratio/);
assert.match(analyzerPage, /id="corner-state"/);
assert.equal((analyzerPage.match(/data-corner=/g) || []).length, 6);
assert.match(analyzerPage, /id="bg"[^>]+min="0"[^>]+max="1"[^>]+step="0\.01"[^>]+value="0\.30"/);
assert.match(analyzerPage, /window\.syncRangeBadge = syncRangeBadge/);
assert.match(analyzer, /function updateWorkspaceBackground/);
assert.equal((analyzer.match(/syncRangeBadge\?\.\(blendInput\)/g) || []).length, 2);
assert.match(analyzer, /sliderValue \* 128/);
assert.ok(fs.existsSync(path.join(root, 'css/analyzer-layout-fix.css')));

const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.match(serviceWorker, /lut-analysis-toolbox-v13/);
const cachedPaths = [...serviceWorker.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]).filter(item => item && item !== './');
for (const cachedPath of cachedPaths) assert.ok(fs.existsSync(path.join(root, cachedPath)), `service worker references missing file ${cachedPath}`);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.name, 'lut-analysis-toolbox');
assert.equal(packageJson.version, '1.3.0');
assert.equal(packageJson.build.productName, 'LUT分析工具箱');
assert.match(packageJson.build.artifactName, /^LUT-Analysis-Toolbox-/);
assert.ok(fs.existsSync(path.join(root, packageJson.main)));
assert.ok(fs.existsSync(path.join(root, packageJson.build.win.icon)));

assert.equal(isAllowedLocalPage(pathToFileURL(path.join(root, 'index1.html')).href, root), true);
assert.equal(isAllowedLocalPage(pathToFileURL(path.join(root, '..', 'outside.html')).href, root), false);
assert.equal(isAllowedLocalPage('https://example.com/index1.html', root), false);
assert.equal(isPathInside('C:\\Program Files\\LUT分析工具箱', 'C:\\Program Files\\LUT分析工具箱\\index1.html', path.win32), true);
assert.equal(isPathInside('C:\\Program Files\\LUT分析工具箱', 'C:\\Program Files\\outside.html', path.win32), false);

console.log('project integrity tests passed');
