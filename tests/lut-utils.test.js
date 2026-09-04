'use strict';

const assert = require('node:assert/strict');
const LUTUtils = require('../js/lut-utils.js');

function identity(size, domainMin = [0, 0, 0], domainMax = [1, 1, 1]) {
  const lut = new Float32Array(size ** 3 * 3);
  const last = size - 1;
  let offset = 0;
  for (let blue = 0; blue < size; blue += 1) {
    for (let green = 0; green < size; green += 1) {
      for (let red = 0; red < size; red += 1) {
        lut[offset++] = domainMin[0] + red / last * (domainMax[0] - domainMin[0]);
        lut[offset++] = domainMin[1] + green / last * (domainMax[1] - domainMin[1]);
        lut[offset++] = domainMin[2] + blue / last * (domainMax[2] - domainMin[2]);
      }
    }
  }
  lut.domainMin = domainMin.slice();
  lut.domainMax = domainMax.slice();
  return { size, lut, domainMin: domainMin.slice(), domainMax: domainMax.slice() };
}

function cubeText(rows, directives = '') {
  return `TITLE "test"\nLUT_3D_SIZE 2\n${directives}${rows.join('\n')}\n`;
}

function maxDifference(a, b) {
  let maximum = 0;
  for (let index = 0; index < a.length; index += 1) maximum = Math.max(maximum, Math.abs(a[index] - b[index]));
  return maximum;
}

const identityRows = [
  '0 0 0', '1 0 0', '0 1 0', '1 1 0',
  '0 0 1', '1 0 1', '0 1 1', '1 1 1'
];

const parsed = LUTUtils.parseCubeSafe(cubeText(identityRows));
assert.equal(parsed.size, 2);
assert.deepEqual(parsed.domainMin, [0, 0, 0]);
assert.deepEqual(parsed.domainMax, [1, 1, 1]);

const domainRows = [
  '-1 -1 -1', '1 -1 -1', '-1 1 -1', '1 1 -1',
  '-1 -1 1', '1 -1 1', '-1 1 1', '1 1 1'
];
const domainLut = LUTUtils.parseCubeSafe(cubeText(domainRows, 'DOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n'));
assert.deepEqual(domainLut.domainMin, [-1, -1, -1]);
assert.deepEqual(domainLut.domainMax, [1, 1, 1]);
assert.deepEqual(LUTUtils.tetraInterp(0, 0, 0, domainLut.lut, 2), [0, 0, 0]);
assert.deepEqual(Array.from(domainLut.lut.slice(0, 3)), [-1, -1, -1]);

const rangeLut = LUTUtils.parseCubeSafe(cubeText(domainRows, 'LUT_3D_INPUT_RANGE -1 1\n'));
assert.deepEqual(rangeLut.domainMin, [-1, -1, -1]);
assert.deepEqual(rangeLut.domainMax, [1, 1, 1]);

assert.throws(() => LUTUtils.parseCubeSafe(cubeText(identityRows) + '0 0 0\n'), /Too many LUT entries/);
assert.throws(() => LUTUtils.parseCubeSafe(cubeText(identityRows).replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2x')), /Malformed/);
assert.throws(() => LUTUtils.parseCubeSafe(cubeText(identityRows, 'DOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n')), /greater/);

for (const size of [17, 33, 65]) {
  const source = identity(size);
  const analysis = LUTUtils.analyzeLUT(source, 0);
  assert.equal(analysis.rPeak, '100.0%');
  assert.equal(analysis.gPeak, '100.0%');
  assert.equal(analysis.bPeak, '100.0%');
  assert.equal(analysis.contrast, '0.00%');
  assert.equal(analysis.dynamicRange, '100.0%');
  assert.deepEqual(LUTUtils.analyzeQuality(source), {
    score: 100,
    rating: 'Excellent',
    srgbPercent: '100.0%',
    blackLift: '0.0%',
    whiteDrop: '0.0%',
    maxCast: '0.00%',
    stepRatio: '1.00',
    identityPercent: '100.0%'
  });
}

for (const sourceSize of [2, 8, 17, 33]) {
  const source = identity(sourceSize);
  for (const method of ['tetrahedral', 'trilinear', 'catmullrom']) {
    const result = LUTUtils.resampleLUT(source, 65, method);
    assert.ok(maxDifference(result.lut, identity(65).lut) < 2e-7, `${method} ${sourceSize}->65 must preserve identity`);
  }
}

for (const passes of [1, 5, 20]) {
  const source = identity(17);
  const result = LUTUtils.smoothLUT(source, passes);
  assert.ok(maxDifference(result.lut, source.lut) < 2e-7, `smoothing ${passes} passes must preserve a linear LUT`);
  assert.deepEqual(Array.from(result.lut.slice(0, 3)), [0, 0, 0]);
  assert.deepEqual(Array.from(result.lut.slice(-3)), [1, 1, 1]);
}

const noisy = identity(5);
const center = 3 * ((2 * 5 + 2) * 5 + 2);
noisy.lut[center] += 0.25;
const smoothed = LUTUtils.smoothLUT(noisy, 1);
assert.ok(smoothed.lut[center] < noisy.lut[center]);

const extended = identity(2);
extended.lut[3] = 1.5;
extended.lut[4] = -0.2;
const compressed = LUTUtils.gamutCompress(extended, 1);
assert.ok(Array.from(compressed.lut).every(value => value >= -1e-7 && value <= 1 + 1e-7));

const clone = LUTUtils.cloneLUT(domainLut);
assert.deepEqual(clone.domainMin, domainLut.domainMin);
assert.deepEqual(clone.domainMax, domainLut.domainMax);
assert.notEqual(clone.lut, domainLut.lut);
assert.deepEqual(LUTUtils.tetraInterp(0, 0, 0, clone.lut, clone.size), [0, 0, 0]);

global.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      imageData: null,
      getContext() {
        return {
          createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: imageData => { this.imageData = imageData; }
        };
      }
    };
  }
};
const haldCanvas = LUTUtils.generateHaldCLUTImage(identity(16), 4);
const haldRoundTrip = LUTUtils.parseHaldCLUTImage(haldCanvas.imageData);
assert.equal(haldCanvas.width, 64);
assert.equal(haldRoundTrip.size, 16);
assert.ok(maxDifference(haldRoundTrip.lut, identity(16).lut) < 2e-7, 'HaldCLUT round trip must preserve a 16³ identity LUT');

console.log('lut-utils regression tests passed');
