'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const defaultAppRoot = path.resolve(__dirname, '..');

function isPathInside(appRoot, targetPath, pathApi = path) {
  const relativePath = pathApi.relative(pathApi.resolve(appRoot), pathApi.resolve(targetPath));
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativePath)
  );
}

function isAllowedLocalPage(url, appRoot = defaultAppRoot) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' && isPathInside(appRoot, fileURLToPath(parsed));
  } catch {
    return false;
  }
}

module.exports = { isAllowedLocalPage, isPathInside };
