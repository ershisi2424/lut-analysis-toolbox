'use strict';

const assert = require('node:assert/strict');
const LUTUtils = require('../js/lut-utils');
const Workspace = require('../js/workspace-features');

const identitySource = `TITLE "Identity"
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

const identity = LUTUtils.parseCubeSafe(identitySource);
const identityFamilies = Workspace.analyzeColorFamilies(identity, LUTUtils);
assert.equal(identityFamilies.length, 6);
for (const family of identityFamilies) {
  assert.equal(family.samples, 24);
  assert.ok(Math.abs(family.brightnessDelta) < 1e-6, `${family.label} brightness must remain neutral`);
  assert.ok(Math.abs(family.saturationDelta) < 1e-6, `${family.label} saturation must remain neutral`);
  assert.ok(Math.abs(family.hueShift) < 1e-6, `${family.label} hue must remain neutral`);
  assert.equal(family.clippingPercent, 0);
}

const identitySummary = Workspace.buildColorSummary(identityFamilies);
assert.equal(identitySummary.curve, '六个基础色系亮度平均变化均为 0.0%。');
assert.match(identitySummary.granger, /未发现基础采样越界/);
assert.match(identitySummary.hue, /未检测到平均色相偏移/);

const desaturated = LUTUtils.mapLUT
  ? LUTUtils.mapLUT(identity, (_input, output) => {
      const y = 0.2126 * output[0] + 0.7152 * output[1] + 0.0722 * output[2];
      return [y, y, y];
    })
  : {
      size: identity.size,
      domainMin: identity.domainMin,
      domainMax: identity.domainMax,
      lut: new Float32Array(identity.lut.length)
    };

if (!LUTUtils.mapLUT) {
  for (let offset = 0; offset < identity.lut.length; offset += 3) {
    const y = 0.2126 * identity.lut[offset] + 0.7152 * identity.lut[offset + 1] + 0.0722 * identity.lut[offset + 2];
    desaturated.lut[offset] = y;
    desaturated.lut[offset + 1] = y;
    desaturated.lut[offset + 2] = y;
  }
}

const grayFamilies = Workspace.analyzeColorFamilies(desaturated, LUTUtils);
assert.ok(grayFamilies.every(family => family.saturationDelta < -0.49));
assert.equal(Workspace.wrapHueDegrees(190), -170);
assert.equal(Workspace.wrapHueDegrees(-190), 170);

console.log('workspace feature tests passed');
