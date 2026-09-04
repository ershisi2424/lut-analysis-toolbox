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
}

const analyzerPage = fs.readFileSync(path.join(root, 'index2.html'), 'utf8');
assert.match(analyzerPage, /data-file-trigger="lutfile"/);
assert.match(analyzerPage, /导入 3D LUT/);

const trackedText = pages.concat([
  'README.md', 'README-本地运行.md', 'manifest.json', 'package.json',
  'js/auth.js', 'electron/main.js', '启动LUT分析工具箱.command', '关闭LUT分析工具箱.command'
]).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
assert.doesNotMatch(trackedText, /lus3d分析工具|lus3d-analysis-tool/, 'obsolete project names must be removed');

const previewPage = fs.readFileSync(path.join(root, 'index3.html'), 'utf8');
assert.doesNotMatch(previewPage, /customImageData|lutByName/, 'duplicate custom preview pipeline must be removed');
assert.equal((previewPage.match(/lutpreviewer\.min\.js/g) || []).length, 1);

const auth = fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8');
const passwordHash = crypto.createHash('sha256').update('1820900463').digest('hex');
assert.match(auth, new RegExp(passwordHash));
assert.match(auth, /if \(isAuthenticated\(\)\)/);
assert.match(auth, /showOverlay\(\)/);
assert.match(auth, /hidePage\(\)/);

const analyzer = fs.readFileSync(path.join(root, 'js/lutanayzer.min.js'), 'utf8');
assert.match(analyzer, /O\.width\/ireDpr/);
assert.match(analyzer, /O\.height\/ireDpr/);
assert.doesNotMatch(analyzer, /O\.width\/\(window\.devicePixelRatio/);
assert.doesNotMatch(analyzer, /Math\.max\(320,Math\.round\(O\.clientWidth/);
assert.ok(fs.existsSync(path.join(root, 'css/analyzer-layout-fix.css')));

const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.match(serviceWorker, /lut-analysis-toolbox-v3/);
const cachedPaths = [...serviceWorker.matchAll(/'\.\/([^']+)'/g)].map(match => match[1]).filter(item => item && item !== './');
for (const cachedPath of cachedPaths) assert.ok(fs.existsSync(path.join(root, cachedPath)), `service worker references missing file ${cachedPath}`);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.name, 'lut-analysis-toolbox');
assert.equal(packageJson.version, '1.1.0');
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
