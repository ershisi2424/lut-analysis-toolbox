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
assert.throws(() => LUTUtils.parseCubeSafe(cubeText(['1e100 0 0', ...identityRows.slice(1)])), /Float32 range/);

for (const size of [17, 33, 65]) {
  const source = identity(size);
  const curves = LUTUtils.buildDiagonalCurves(source);
  assert.equal(curves.r.length, 65);
  assert.equal(curves.maxI, 64);
  assert.ok(Math.abs(curves.y[32] - 0.5) < 1e-6);
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

const extendedCurves = LUTUtils.buildDiagonalCurves(domainLut);
assert.equal(extendedCurves.r[0], -1);
assert.equal(extendedCurves.r[32], 0);
assert.equal(extendedCurves.r[64], 1);

const negativeHeadroomRows = identityRows.map(row => row.split(' ').map(value => -0.075 + 1.075 * Number(value)).join(' '));
const negativeHeadroomLut = LUTUtils.parseCubeSafe(cubeText(negativeHeadroomRows));
const negativeHeadroomCurves = LUTUtils.buildDiagonalCurves(negativeHeadroomLut);
assert.ok(Math.abs(negativeHeadroomCurves.y[0] + 0.075) < 1e-7, 'negative LUT output must not be clamped');
assert.equal(LUTUtils.analyzeLUT(negativeHeadroomLut, 0).dynamicRange, '107.5%');

const exactNodePeak = identity(4);
const peakOffset = 3 * ((1 * 4 + 1) * 4 + 1);
exactNodePeak.lut[peakOffset] = 2;
exactNodePeak.lut[peakOffset + 1] = 2;
exactNodePeak.lut[peakOffset + 2] = 2;
assert.equal(LUTUtils.analyzeLUT(exactNodePeak, 0).yPeak, '200.0%', 'analysis must use exact LUT nodes');

for (const sourceSize of [2, 8, 17, 33]) {
  const source = identity(sourceSize);
  for (const method of ['tetrahedral', 'trilinear', 'catmullrom']) {
    const result = LUTUtils.resampleLUT(source, 65, method);
    assert.ok(maxDifference(result.lut, identity(65).lut) < 2e-7, `${method} ${sourceSize}->65 must preserve identity`);
  }
}

function referenceTrilinear(red, green, blue, lutObject) {
  const normalized = [red, green, blue].map((value, channel) => {
    const position = (value - lutObject.domainMin[channel]) / (lutObject.domainMax[channel] - lutObject.domainMin[channel]);
    return Math.max(0, Math.min(1, position)) * (lutObject.size - 1);
  });
  const lower = normalized.map(Math.floor);
  const upper = lower.map((value, channel) => Math.min(value + 1, lutObject.size - 1));
  const fraction = normalized.map((value, channel) => value - lower[channel]);
  const output = [0, 0, 0];
  for (let bz = 0; bz <= 1; bz += 1) for (let gy = 0; gy <= 1; gy += 1) for (let rx = 0; rx <= 1; rx += 1) {
    const coordinates = [rx ? upper[0] : lower[0], gy ? upper[1] : lower[1], bz ? upper[2] : lower[2]];
    const weight = (rx ? fraction[0] : 1 - fraction[0]) * (gy ? fraction[1] : 1 - fraction[1]) * (bz ? fraction[2] : 1 - fraction[2]);
    const offset = 3 * ((coordinates[2] * lutObject.size + coordinates[1]) * lutObject.size + coordinates[0]);
    for (let channel = 0; channel < 3; channel += 1) output[channel] += weight * lutObject.lut[offset + channel];
  }
  return output;
}

function referenceTetrahedral(red, green, blue, lutObject) {
  const normalized = [red, green, blue].map((value, channel) => {
    const position = Math.max(0, Math.min(1, (value - lutObject.domainMin[channel]) / (lutObject.domainMax[channel] - lutObject.domainMin[channel]))) * (lutObject.size - 1);
    return { lower: Math.floor(position), fraction: position - Math.floor(position), axis: channel };
  });
  const base = normalized.map(item => item.lower);
  const sorted = [...normalized].sort((a, b) => b.fraction - a.fraction);
  const vertices = [base.slice()];
  for (const item of sorted) {
    const next = vertices.at(-1).slice();
    next[item.axis] = Math.min(next[item.axis] + 1, lutObject.size - 1);
    vertices.push(next);
  }
  const weights = [1 - sorted[0].fraction, sorted[0].fraction - sorted[1].fraction, sorted[1].fraction - sorted[2].fraction, sorted[2].fraction];
  const output = [0, 0, 0];
  vertices.forEach((coordinates, vertex) => {
    const offset = 3 * ((coordinates[2] * lutObject.size + coordinates[1]) * lutObject.size + coordinates[0]);
    for (let channel = 0; channel < 3; channel += 1) output[channel] += weights[vertex] * lutObject.lut[offset + channel];
  });
  return output;
}

const nonlinear = identity(4, [-0.2, 0.1, -0.4], [1.2, 1.4, 1.1]);
for (let offset = 0; offset < nonlinear.lut.length; offset += 3) {
  const red = nonlinear.lut[offset], green = nonlinear.lut[offset + 1], blue = nonlinear.lut[offset + 2];
  nonlinear.lut[offset] = Math.sin(1.7 * red + 0.3 * green) + 0.1 * blue * blue;
  nonlinear.lut[offset + 1] = Math.cos(0.4 * red - 1.3 * blue) + 0.2 * green * green;
  nonlinear.lut[offset + 2] = red * green - 0.35 * blue + 0.07;
}
let randomState = 0x5eed1234;
const random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 2 ** 32);
for (let sample = 0; sample < 1000; sample += 1) {
  const input = nonlinear.domainMin.map((minimum, channel) => minimum - 0.2 + random() * (nonlinear.domainMax[channel] - minimum + 0.4));
  assert.ok(maxDifference(LUTUtils.trilinearInterp(...input, nonlinear.lut, nonlinear.size), referenceTrilinear(...input, nonlinear)) < 5e-7, 'trilinear interpolation must match independent weighted-corner reference');
  assert.ok(maxDifference(LUTUtils.tetraInterp(...input, nonlinear.lut, nonlinear.size), referenceTetrahedral(...input, nonlinear)) < 5e-7, 'tetrahedral interpolation must match independent sorted-simplex reference');
}
for (let blue = 0; blue < nonlinear.size; blue += 1) for (let green = 0; green < nonlinear.size; green += 1) for (let red = 0; red < nonlinear.size; red += 1) {
  const offset = 3 * ((blue * nonlinear.size + green) * nonlinear.size + red);
  const input = [
    nonlinear.domainMin[0] + red / (nonlinear.size - 1) * (nonlinear.domainMax[0] - nonlinear.domainMin[0]),
    nonlinear.domainMin[1] + green / (nonlinear.size - 1) * (nonlinear.domainMax[1] - nonlinear.domainMin[1]),
    nonlinear.domainMin[2] + blue / (nonlinear.size - 1) * (nonlinear.domainMax[2] - nonlinear.domainMin[2])
  ];
  for (const method of ['tetraInterp', 'trilinearInterp', 'catmullRomInterp']) {
    assert.ok(maxDifference(LUTUtils[method](...input, nonlinear.lut, nonlinear.size), Array.from(nonlinear.lut.slice(offset, offset + 3))) < 5e-7, `${method} must reproduce every exact lattice node`);
  }
}

// Every interpolation method must reproduce affine channel transforms. This
// catches axis swaps and tetrahedron branch errors that an identity LUT misses.
const affine = identity(5, [-0.25, 0.1, -0.5], [1.25, 1.1, 1.5]);
for (let blue = 0; blue < 5; blue += 1) {
  for (let green = 0; green < 5; green += 1) {
    for (let red = 0; red < 5; red += 1) {
      const offset = 3 * ((blue * 5 + green) * 5 + red);
      const input = [affine.lut[offset], affine.lut[offset + 1], affine.lut[offset + 2]];
      affine.lut[offset] = 0.7 * input[0] + 0.2 * input[1] - 0.1 * input[2] + 0.03;
      affine.lut[offset + 1] = -0.15 * input[0] + 0.8 * input[1] + 0.25 * input[2] - 0.02;
      affine.lut[offset + 2] = 0.1 * input[0] - 0.05 * input[1] + 0.9 * input[2] + 0.08;
    }
  }
}
for (const method of ['tetraInterp', 'trilinearInterp', 'catmullRomInterp']) {
  for (const input of [[-0.25, 0.1, -0.5], [0.137, 0.617, 1.231], [1.25, 1.1, 1.5]]) {
    const actual = LUTUtils[method](...input, affine.lut, affine.size);
    const expected = [
      0.7 * input[0] + 0.2 * input[1] - 0.1 * input[2] + 0.03,
      -0.15 * input[0] + 0.8 * input[1] + 0.25 * input[2] - 0.02,
      0.1 * input[0] - 0.05 * input[1] + 0.9 * input[2] + 0.08
    ];
    assert.ok(maxDifference(actual, expected) < 3e-7, `${method} must preserve affine transforms`);
  }
}

const intensitySource = identity(5);
intensitySource.lut[7] += 0.2;
assert.ok(maxDifference(LUTUtils.applyIntensity(intensitySource, 0).lut, identity(5).lut) < 2e-7, '0% intensity must be identity');
assert.ok(maxDifference(LUTUtils.applyIntensity(intensitySource, 1).lut, intensitySource.lut) < 2e-7, '100% intensity must preserve LUT values');

const lumaSource = identity(2);
for (let offset = 0; offset < lumaSource.lut.length; offset += 3) {
  lumaSource.lut[offset] = 0;
  lumaSource.lut[offset + 1] = 0;
  lumaSource.lut[offset + 2] = 0;
}
const lumaPreserved = LUTUtils.preserveLuminance(lumaSource, 1);
for (let blue = 0; blue < 2; blue += 1) {
  for (let green = 0; green < 2; green += 1) {
    for (let red = 0; red < 2; red += 1) {
      const offset = 3 * ((blue * 2 + green) * 2 + red);
      const actualY = 0.2126 * lumaPreserved.lut[offset] + 0.7152 * lumaPreserved.lut[offset + 1] + 0.0722 * lumaPreserved.lut[offset + 2];
      const expectedY = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      assert.ok(Math.abs(actualY - expectedY) < 1e-7, 'luma preservation must work even when LUT output is black');
    }
  }
}
assert.equal(LUTUtils.analyzeQuality(identity(5, [-1, -1, -1], [1, 1, 1])).stepRatio, '1.00', 'quality step ratio must respect LUT domain width');
assert.equal(LUTUtils.computeQualityReport(affine, LUTUtils.cloneLUT(affine)).bandingRisk, 0, 'unchanged nonlinear LUT must have no conversion banding risk');

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
// Standard Hald position: flat index = R + size*G + size²*B. A self-only
// round trip would not detect a non-standard permutation.
const standardRed = 3, standardGreen = 7, standardBlue = 11;
const standardIndex = standardRed + 16 * standardGreen + 16 ** 2 * standardBlue;
const standardPixel = standardIndex * 4;
assert.equal(haldCanvas.imageData.data[standardPixel], Math.round(255 * standardRed / 15));
assert.equal(haldCanvas.imageData.data[standardPixel + 1], Math.round(255 * standardGreen / 15));
assert.equal(haldCanvas.imageData.data[standardPixel + 2], Math.round(255 * standardBlue / 15));
assert.throws(() => LUTUtils.parseHaldCLUTImage({ width: 1, height: 1, data: new Uint8ClampedArray(4) }), /2\.\.8/);
assert.throws(() => LUTUtils.parseHaldCLUTImage({ width: 8, height: 8, data: new Uint8ClampedArray(4) }), /长度无效/);

console.log('lut-utils regression tests passed');
