(function (root) {
  'use strict';

  const MAX_LUT_SIZE = 65;
  const FILE_CAP_BYTES = 9 * 1024 * 1024;
  const DEFAULT_DOMAIN_MIN = Object.freeze([0, 0, 0]);
  const DEFAULT_DOMAIN_MAX = Object.freeze([1, 1, 1]);

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function cloneDomain(value, fallback) {
    return Array.isArray(value) && value.length === 3 ? value.map(Number) : fallback.slice();
  }

  function attachDomain(lut, domainMin, domainMax) {
    lut.domainMin = cloneDomain(domainMin, DEFAULT_DOMAIN_MIN);
    lut.domainMax = cloneDomain(domainMax, DEFAULT_DOMAIN_MAX);
    return lut;
  }

  function makeLut(size, lut, domainMin, domainMax) {
    const min = cloneDomain(domainMin || lut.domainMin, DEFAULT_DOMAIN_MIN);
    const max = cloneDomain(domainMax || lut.domainMax, DEFAULT_DOMAIN_MAX);
    attachDomain(lut, min, max);
    return { size, lut, domainMin: min, domainMax: max };
  }

  function cloneLUT(lutObject) {
    return makeLut(
      lutObject.size,
      new Float32Array(lutObject.lut),
      lutObject.domainMin,
      lutObject.domainMax
    );
  }

  function parseVector(parts, directive) {
    if (parts.length !== 4) throw new Error(`Malformed ${directive}`);
    const values = parts.slice(1).map(Number);
    if (!values.every(Number.isFinite)) throw new Error(`Non-finite ${directive}`);
    return values;
  }

  function parseCubeSafe(source) {
    if (typeof source !== 'string') throw new Error('LUT source must be text');
    if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
    if (/\0/.test(source)) throw new Error('File is not plain text');

    let size = 0;
    let expectedEntries = 0;
    let data = null;
    let entryCount = 0;
    let domainMin = DEFAULT_DOMAIN_MIN.slice();
    let domainMax = DEFAULT_DOMAIN_MAX.slice();
    let sawDomainMin = false;
    let sawDomainMax = false;

    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#')) continue;

      const parts = line.split(/\s+/);
      const directive = parts[0].toUpperCase();

      if (directive === 'TITLE') continue;
      if (directive === 'LUT_1D_SIZE') throw new Error('1D LUT is not supported');

      if (directive === 'LUT_3D_SIZE') {
        if (size) throw new Error('Duplicate LUT_3D_SIZE');
        if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
          throw new Error('Malformed LUT_3D_SIZE');
        }
        size = Number(parts[1]);
        if (size < 2 || size > MAX_LUT_SIZE) {
          throw new Error(`LUT_3D_SIZE out of range (2..${MAX_LUT_SIZE})`);
        }
        expectedEntries = size ** 3;
        data = new Float32Array(expectedEntries * 3);
        continue;
      }

      if (directive === 'DOMAIN_MIN') {
        if (sawDomainMin) throw new Error('Duplicate DOMAIN_MIN');
        domainMin = parseVector(parts, directive);
        sawDomainMin = true;
        continue;
      }

      if (directive === 'DOMAIN_MAX') {
        if (sawDomainMax) throw new Error('Duplicate DOMAIN_MAX');
        domainMax = parseVector(parts, directive);
        sawDomainMax = true;
        continue;
      }

      if (directive === 'LUT_3D_INPUT_RANGE') {
        if (sawDomainMin || sawDomainMax) throw new Error('Duplicate LUT input domain');
        if (parts.length !== 3 || !parts.slice(1).every(value => Number.isFinite(Number(value)))) {
          throw new Error('Malformed LUT_3D_INPUT_RANGE');
        }
        const min = Number(parts[1]), max = Number(parts[2]);
        if (!(max > min)) throw new Error('LUT_3D_INPUT_RANGE max must be greater than min');
        domainMin = [min, min, min];
        domainMax = [max, max, max];
        sawDomainMin = true;
        sawDomainMax = true;
        continue;
      }

      if (parts.length !== 3 || !parts.every(value => value !== '' && Number.isFinite(Number(value)))) {
        throw new Error(`Unsupported or malformed LUT line: ${parts[0]}`);
      }
      if (!data) throw new Error('Data rows before LUT_3D_SIZE');
      if (entryCount >= expectedEntries) {
        throw new Error(`Too many LUT entries; expected ${expectedEntries}`);
      }
      const offset = entryCount * 3;
      data[offset] = Number(parts[0]);
      data[offset + 1] = Number(parts[1]);
      data[offset + 2] = Number(parts[2]);
      entryCount += 1;
    }

    if (!size) throw new Error('Missing LUT_3D_SIZE');
    if (entryCount !== expectedEntries) {
      throw new Error(`Expected ${expectedEntries} entries, got ${entryCount}`);
    }
    for (let channel = 0; channel < 3; channel += 1) {
      if (!(domainMax[channel] > domainMin[channel])) {
        throw new Error('DOMAIN_MAX must be greater than DOMAIN_MIN');
      }
    }
    return makeLut(size, data, domainMin, domainMax);
  }

  function inputToLattice(value, channel, lut) {
    const min = lut.domainMin || DEFAULT_DOMAIN_MIN;
    const max = lut.domainMax || DEFAULT_DOMAIN_MAX;
    return clamp01((value - min[channel]) / (max[channel] - min[channel]));
  }

  function latticeIndex(red, green, blue, size) {
    return 3 * ((blue * size + green) * size + red);
  }

  function tetraInterp(red, green, blue, lut, size) {
    red = inputToLattice(red, 0, lut);
    green = inputToLattice(green, 1, lut);
    blue = inputToLattice(blue, 2, lut);
    const last = size - 1;
    const x = red * last;
    const y = green * last;
    const z = blue * last;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const x1 = Math.min(x0 + 1, last), y1 = Math.min(y0 + 1, last), z1 = Math.min(z0 + 1, last);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const sample = (r, g, b) => {
      const offset = latticeIndex(r, g, b, size);
      return [lut[offset], lut[offset + 1], lut[offset + 2]];
    };
    const c000 = sample(x0, y0, z0), c100 = sample(x1, y0, z0);
    const c010 = sample(x0, y1, z0), c110 = sample(x1, y1, z0);
    const c001 = sample(x0, y0, z1), c101 = sample(x1, y0, z1);
    const c011 = sample(x0, y1, z1), c111 = sample(x1, y1, z1);
    const out = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      if (fx >= fy && fy >= fz) out[channel] = c000[channel] + fx * (c100[channel] - c000[channel]) + fy * (c110[channel] - c100[channel]) + fz * (c111[channel] - c110[channel]);
      else if (fy >= fx && fx >= fz) out[channel] = c000[channel] + fy * (c010[channel] - c000[channel]) + fx * (c110[channel] - c010[channel]) + fz * (c111[channel] - c110[channel]);
      else if (fy >= fz && fz >= fx) out[channel] = c000[channel] + fy * (c010[channel] - c000[channel]) + fz * (c011[channel] - c010[channel]) + fx * (c111[channel] - c011[channel]);
      else if (fz >= fy && fy >= fx) out[channel] = c000[channel] + fz * (c001[channel] - c000[channel]) + fy * (c011[channel] - c001[channel]) + fx * (c111[channel] - c011[channel]);
      else if (fz >= fx && fx >= fy) out[channel] = c000[channel] + fz * (c001[channel] - c000[channel]) + fx * (c101[channel] - c001[channel]) + fy * (c111[channel] - c101[channel]);
      else out[channel] = c000[channel] + fx * (c100[channel] - c000[channel]) + fz * (c101[channel] - c100[channel]) + fy * (c111[channel] - c101[channel]);
    }
    return out;
  }

  function trilinearInterp(red, green, blue, lut, size) {
    red = inputToLattice(red, 0, lut);
    green = inputToLattice(green, 1, lut);
    blue = inputToLattice(blue, 2, lut);
    const last = size - 1;
    const x = red * last, y = green * last, z = blue * last;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const x1 = Math.min(x0 + 1, last), y1 = Math.min(y0 + 1, last), z1 = Math.min(z0 + 1, last);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const sample = (r, g, b, channel) => lut[latticeIndex(r, g, b, size) + channel];
    const out = [];
    for (let channel = 0; channel < 3; channel += 1) {
      const c00 = sample(x0, y0, z0, channel) * (1 - fx) + sample(x1, y0, z0, channel) * fx;
      const c10 = sample(x0, y1, z0, channel) * (1 - fx) + sample(x1, y1, z0, channel) * fx;
      const c01 = sample(x0, y0, z1, channel) * (1 - fx) + sample(x1, y0, z1, channel) * fx;
      const c11 = sample(x0, y1, z1, channel) * (1 - fx) + sample(x1, y1, z1, channel) * fx;
      const c0 = c00 * (1 - fy) + c10 * fy;
      const c1 = c01 * (1 - fy) + c11 * fy;
      out[channel] = c0 * (1 - fz) + c1 * fz;
    }
    return out;
  }

  function catmullRomInterp(red, green, blue, lut, size) {
    red = inputToLattice(red, 0, lut);
    green = inputToLattice(green, 1, lut);
    blue = inputToLattice(blue, 2, lut);
    const last = size - 1;
    const x = red * last, y = green * last, z = blue * last;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const cubic = (t, p0, p1, p2, p3) => {
      const t2 = t * t;
      return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
    };
    const sample = (r, g, b, channel) => {
      if (r < 0) return 2 * sample(0, g, b, channel) - sample(1, g, b, channel);
      if (r > last) return 2 * sample(last, g, b, channel) - sample(last - 1, g, b, channel);
      if (g < 0) return 2 * sample(r, 0, b, channel) - sample(r, 1, b, channel);
      if (g > last) return 2 * sample(r, last, b, channel) - sample(r, last - 1, b, channel);
      if (b < 0) return 2 * sample(r, g, 0, channel) - sample(r, g, 1, channel);
      if (b > last) return 2 * sample(r, g, last, channel) - sample(r, g, last - 1, channel);
      return lut[latticeIndex(r, g, b, size) + channel];
    };
    const out = [];
    for (let channel = 0; channel < 3; channel += 1) {
      const zValues = [];
      for (let dz = -1; dz <= 2; dz += 1) {
        const yValues = [];
        for (let dy = -1; dy <= 2; dy += 1) {
          const p = [];
          for (let dx = -1; dx <= 2; dx += 1) p.push(sample(x0 + dx, y0 + dy, z0 + dz, channel));
          yValues.push(cubic(fx, p[0], p[1], p[2], p[3]));
        }
        zValues.push(cubic(fy, yValues[0], yValues[1], yValues[2], yValues[3]));
      }
      out[channel] = cubic(fz, zValues[0], zValues[1], zValues[2], zValues[3]);
    }
    return out;
  }

  function buildDiagonalCurves(lutObject) {
    const { size, lut } = lutObject;
    const red = new Float32Array(size), green = new Float32Array(size);
    const blue = new Float32Array(size), y = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      const offset = latticeIndex(index, index, index, size);
      red[index] = lut[offset]; green[index] = lut[offset + 1]; blue[index] = lut[offset + 2];
      y[index] = 0.2126 * red[index] + 0.7152 * green[index] + 0.0722 * blue[index];
    }
    return { r: red, g: green, b: blue, y, maxI: size - 1 };
  }

  function applyLUTToImageData(imageData, lut, size) {
    for (let offset = 0; offset < imageData.data.length; offset += 4) {
      const output = tetraInterp(imageData.data[offset] / 255, imageData.data[offset + 1] / 255, imageData.data[offset + 2] / 255, lut, size);
      imageData.data[offset] = Math.round(255 * clamp01(output[0]));
      imageData.data[offset + 1] = Math.round(255 * clamp01(output[1]));
      imageData.data[offset + 2] = Math.round(255 * clamp01(output[2]));
    }
  }

  function domainValue(lutObject, channel, normalized) {
    const min = lutObject.domainMin || DEFAULT_DOMAIN_MIN;
    const max = lutObject.domainMax || DEFAULT_DOMAIN_MAX;
    return min[channel] + normalized * (max[channel] - min[channel]);
  }

  function resampleLUT(lutObject, targetSize, method) {
    if (!Number.isInteger(targetSize) || targetSize < 2 || targetSize > MAX_LUT_SIZE) throw new Error('Invalid target LUT size');
    const interpolation = method === 'trilinear' ? trilinearInterp : method === 'catmullrom' ? catmullRomInterp : tetraInterp;
    const output = new Float32Array(targetSize ** 3 * 3);
    const last = targetSize - 1;
    for (let blue = 0; blue < targetSize; blue += 1) {
      for (let green = 0; green < targetSize; green += 1) {
        for (let red = 0; red < targetSize; red += 1) {
          const result = interpolation(domainValue(lutObject, 0, red / last), domainValue(lutObject, 1, green / last), domainValue(lutObject, 2, blue / last), lutObject.lut, lutObject.size);
          const offset = latticeIndex(red, green, blue, targetSize);
          output[offset] = result[0]; output[offset + 1] = result[1]; output[offset + 2] = result[2];
        }
      }
    }
    return makeLut(targetSize, output, lutObject.domainMin, lutObject.domainMax);
  }

  function mapLUT(lutObject, mapper) {
    const output = new Float32Array(lutObject.lut.length);
    const last = lutObject.size - 1;
    for (let blue = 0; blue < lutObject.size; blue += 1) for (let green = 0; green < lutObject.size; green += 1) for (let red = 0; red < lutObject.size; red += 1) {
      const offset = latticeIndex(red, green, blue, lutObject.size);
      const input = [domainValue(lutObject, 0, red / last), domainValue(lutObject, 1, green / last), domainValue(lutObject, 2, blue / last)];
      const result = mapper(input, [lutObject.lut[offset], lutObject.lut[offset + 1], lutObject.lut[offset + 2]], red, green, blue);
      output[offset] = result[0]; output[offset + 1] = result[1]; output[offset + 2] = result[2];
    }
    return makeLut(lutObject.size, output, lutObject.domainMin, lutObject.domainMax);
  }

  function applyIntensity(lutObject, amount) {
    return mapLUT(lutObject, (input, output) => output.map((value, channel) => input[channel] + (value - input[channel]) * amount));
  }

  function preserveLuminance(lutObject, amount) {
    return mapLUT(lutObject, (input, output) => {
      const inputY = 0.2126 * input[0] + 0.7152 * input[1] + 0.0722 * input[2];
      const outputY = 0.2126 * output[0] + 0.7152 * output[1] + 0.0722 * output[2];
      if (Math.abs(outputY) < 1e-9) return output;
      const corrected = output.map(value => value * inputY / outputY);
      return output.map((value, channel) => value + (corrected[channel] - value) * amount);
    });
  }

  function rgbToHsv(red, green, blue) {
    const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;
    if (delta !== 0) {
      if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
      else if (max === green) hue = ((blue - red) / delta + 2) / 6;
      else hue = ((red - green) / delta + 4) / 6;
    }
    return [hue, max === 0 ? 0 : delta / max, max];
  }

  function hsvToRgb(hue, saturation, value) {
    const sector = Math.floor(6 * hue), fraction = 6 * hue - sector;
    const p = value * (1 - saturation), q = value * (1 - fraction * saturation), t = value * (1 - (1 - fraction) * saturation);
    switch ((sector % 6 + 6) % 6) {
      case 0: return [value, t, p]; case 1: return [q, value, p]; case 2: return [p, value, t];
      case 3: return [p, q, value]; case 4: return [t, p, value]; default: return [value, p, q];
    }
  }

  function protectSkinTones(lutObject, amount) {
    const targetHue = 25 / 360, hueWidth = 20 / 360;
    return mapLUT(lutObject, (input, output) => {
      const [hue, saturation] = rgbToHsv(input[0], input[1], input[2]);
      let distance = Math.abs(hue - targetHue); if (distance > 0.5) distance = 1 - distance;
      const weight = distance < hueWidth && saturation > 0.1 ? (1 - distance / hueWidth) * Math.min(1, 2 * saturation) * amount : 0;
      return output.map((value, channel) => value + (input[channel] - value) * weight);
    });
  }

  function smoothLUT(lutObject, passes) {
    let source = new Float32Array(lutObject.lut);
    const size = lutObject.size;
    const iterations = Math.max(0, Math.min(20, Math.round(passes)));
    const neighbors = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
    for (let pass = 0; pass < iterations; pass += 1) {
      const output = new Float32Array(source);
      for (let blue = 1; blue < size - 1; blue += 1) for (let green = 1; green < size - 1; green += 1) for (let red = 1; red < size - 1; red += 1) {
        const offset = latticeIndex(red, green, blue, size);
        for (let channel = 0; channel < 3; channel += 1) {
          let sum = 0;
          for (const [dr, dg, db] of neighbors) sum += source[latticeIndex(red + dr, green + dg, blue + db, size) + channel];
          const neighborAverage = sum / neighbors.length;
          output[offset + channel] = source[offset + channel] + 0.25 * (neighborAverage - source[offset + channel]);
        }
      }
      source = output;
    }
    return makeLut(size, source, lutObject.domainMin, lutObject.domainMax);
  }

  function gamutCompress(lutObject, amount) {
    return mapLUT(lutObject, (_input, output) => {
      if (output.every(value => value >= 0 && value <= 1)) return output;
      const neutral = clamp01(0.2126 * output[0] + 0.7152 * output[1] + 0.0722 * output[2]);
      let scale = 1;
      for (const value of output) {
        const direction = value - neutral;
        if (direction > 0) scale = Math.min(scale, (1 - neutral) / direction);
        else if (direction < 0) scale = Math.min(scale, (0 - neutral) / direction);
      }
      scale = clamp01(scale);
      const compressed = output.map(value => neutral + (value - neutral) * scale);
      return output.map((value, channel) => value + (compressed[channel] - value) * amount);
    });
  }

  function computeQualityReport(original, converted) {
    if (original.size !== converted.size) throw new Error('Quality comparison requires matching LUT sizes');
    const entries = original.size ** 3;
    let sumR = 0, sumG = 0, sumB = 0, sumDelta = 0, maxDelta = 0, outOfGamut = 0;
    const deltas = [];
    for (let index = 0; index < entries; index += 1) {
      const offset = 3 * index;
      const dr = converted.lut[offset] - original.lut[offset], dg = converted.lut[offset + 1] - original.lut[offset + 1], db = converted.lut[offset + 2] - original.lut[offset + 2];
      sumR += dr * dr; sumG += dg * dg; sumB += db * db;
      const delta = Math.hypot(dr, dg, db); deltas.push(delta); sumDelta += delta; maxDelta = Math.max(maxDelta, delta);
      if ([converted.lut[offset], converted.lut[offset + 1], converted.lut[offset + 2]].some(value => value < 0 || value > 1)) outOfGamut += 1;
    }
    deltas.sort((a, b) => a - b);
    let bandingRisk = 0;
    const step = 1 / (original.size - 1);
    for (let b = 0; b < original.size; b += 1) for (let g = 0; g < original.size; g += 1) for (let r = 0; r < original.size; r += 1) {
      for (const [dr, dg, db] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        if (r + dr >= original.size || g + dg >= original.size || b + db >= original.size) continue;
        const a = latticeIndex(r, g, b, original.size), next = latticeIndex(r + dr, g + dg, b + db, original.size);
        const distance = Math.hypot(converted.lut[next] - converted.lut[a], converted.lut[next + 1] - converted.lut[a + 1], converted.lut[next + 2] - converted.lut[a + 2]);
        bandingRisk = Math.max(bandingRisk, Math.abs(distance - step) / step);
      }
    }
    let neutralError = 0;
    for (let value = 0; value < original.size; value += 1) {
      const offset = latticeIndex(value, value, value, original.size);
      const mean = (converted.lut[offset] + converted.lut[offset + 1] + converted.lut[offset + 2]) / 3;
      neutralError = Math.max(neutralError, Math.abs(converted.lut[offset] - mean), Math.abs(converted.lut[offset + 1] - mean), Math.abs(converted.lut[offset + 2] - mean));
    }
    const rmsR = Math.sqrt(sumR / entries), rmsG = Math.sqrt(sumG / entries), rmsB = Math.sqrt(sumB / entries);
    return { rmsR, rmsG, rmsB, rmsTotal: Math.hypot(rmsR, rmsG, rmsB), maxDelta, avgDelta: sumDelta / entries, medianDelta: deltas[Math.floor(entries / 2)], outOfGamut, outOfGamutPercent: 100 * outOfGamut / entries, bandingRisk, neutralError, entries };
  }

  function generateHaldCLUTImage(lutObject, level) {
    level = Number(level || Math.round(Math.sqrt(lutObject.size)));
    if (!Number.isInteger(level) || level < 2 || level > 8) throw new Error('HaldCLUT level must be 2..8');
    const cubeSize = level * level, side = cubeSize * level;
    const canvas = document.createElement('canvas'); canvas.width = side; canvas.height = side;
    const context = canvas.getContext('2d'), image = context.createImageData(side, side);
    const source = lutObject.size === cubeSize ? lutObject : resampleLUT(lutObject, cubeSize, 'tetrahedral');
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
      const red = x % cubeSize, green = y % cubeSize, blue = Math.floor(y / cubeSize) * level + Math.floor(x / cubeSize);
      const sourceOffset = latticeIndex(red, green, blue, cubeSize), targetOffset = 4 * (y * side + x);
      image.data[targetOffset] = Math.round(255 * clamp01(source.lut[sourceOffset]));
      image.data[targetOffset + 1] = Math.round(255 * clamp01(source.lut[sourceOffset + 1]));
      image.data[targetOffset + 2] = Math.round(255 * clamp01(source.lut[sourceOffset + 2])); image.data[targetOffset + 3] = 255;
    }
    context.putImageData(image, 0, 0); return canvas;
  }

  function parseHaldCLUTImage(imageData) {
    if (imageData.width !== imageData.height) throw new Error('HaldCLUT 图片必须为正方形');
    const side = imageData.width, level = Math.round(Math.cbrt(side));
    if (level ** 3 !== side) throw new Error(`无效的 HaldCLUT 尺寸: ${side}（需为 level³）`);
    const size = level * level, lut = new Float32Array(size ** 3 * 3);
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
      const red = x % size, green = y % size, blue = Math.floor(y / size) * level + Math.floor(x / size);
      const target = latticeIndex(red, green, blue, size), source = 4 * (y * side + x);
      lut[target] = imageData.data[source] / 255; lut[target + 1] = imageData.data[source + 1] / 255; lut[target + 2] = imageData.data[source + 2] / 255;
    }
    return makeLut(size, lut);
  }

  function analyzeLUT(lutObject, fileSize) {
    const { size, lut } = lutObject, last = size - 1, entries = size ** 3;
    let rPeak = -Infinity, gPeak = -Infinity, bPeak = -Infinity, rMin = Infinity, gMin = Infinity, bMin = Infinity;
    let maxLuminance = -Infinity, minLuminance = Infinity, contrast = 0, saturation = 0, satBoost = 0, satReduce = 0;
    for (let blue = 0; blue < size; blue += 1) for (let green = 0; green < size; green += 1) for (let red = 0; red < size; red += 1) {
      const offset = latticeIndex(red, green, blue, size), outR = lut[offset], outG = lut[offset + 1], outB = lut[offset + 2];
      rPeak = Math.max(rPeak, outR); gPeak = Math.max(gPeak, outG); bPeak = Math.max(bPeak, outB);
      rMin = Math.min(rMin, outR); gMin = Math.min(gMin, outG); bMin = Math.min(bMin, outB);
      const inR = domainValue(lutObject, 0, red / last), inG = domainValue(lutObject, 1, green / last), inB = domainValue(lutObject, 2, blue / last);
      const inputY = 0.2126 * inR + 0.7152 * inG + 0.0722 * inB, outputY = 0.2126 * outR + 0.7152 * outG + 0.0722 * outB;
      contrast += Math.abs(outputY - inputY); maxLuminance = Math.max(maxLuminance, outputY); minLuminance = Math.min(minLuminance, outputY);
      const inputChroma = Math.max(inR, inG, inB) - Math.min(inR, inG, inB), outputChroma = Math.max(outR, outG, outB) - Math.min(outR, outG, outB);
      saturation += Math.abs(outputChroma - inputChroma); if (outputChroma > inputChroma + 1e-9) satBoost += 1; else if (outputChroma < inputChroma - 1e-9) satReduce += 1;
    }
    const diagonal = buildDiagonalCurves(lutObject), yPeak = Math.max(...diagonal.y), yMin = Math.min(...diagonal.y);
    const percent = value => `${(100 * value).toFixed(1)}%`;
    return { size: `${size}x${size}x${size}`, entries: entries.toLocaleString(), fileSize: formatFileSize(fileSize || 0), yPeak: percent(yPeak), yMin: percent(yMin), rPeak: percent(rPeak), gPeak: percent(gPeak), bPeak: percent(bPeak), rMin: percent(rMin), gMin: percent(gMin), bMin: percent(bMin), contrast: `${(100 * contrast / entries).toFixed(2)}%`, maxLuminance: percent(maxLuminance), minLuminance: percent(minLuminance), saturation: `${(100 * saturation / entries).toFixed(2)}%`, satBoost: percent(satBoost / entries), satReduce: percent(satReduce / entries), dynamicRange: percent(maxLuminance - minLuminance) };
  }

  function analyzeQuality(lutObject) {
    const { size, lut } = lutObject, entries = size ** 3, last = size - 1;
    let inGamut = 0, identity = 0, maxCast = 0, maxStepRatio = 0;
    for (let blue = 0; blue < size; blue += 1) for (let green = 0; green < size; green += 1) for (let red = 0; red < size; red += 1) {
      const offset = latticeIndex(red, green, blue, size), values = [lut[offset], lut[offset + 1], lut[offset + 2]];
      if (values.every(value => value >= 0 && value <= 1)) inGamut += 1;
      const expected = [domainValue(lutObject, 0, red / last), domainValue(lutObject, 1, green / last), domainValue(lutObject, 2, blue / last)];
      if (values.every((value, channel) => Math.abs(value - expected[channel]) < 0.001)) identity += 1;
      if (red === green && green === blue) {
        const mean = (values[0] + values[1] + values[2]) / 3;
        maxCast = Math.max(maxCast, ...values.map(value => Math.abs(value - mean)));
      }
      for (const [dr, dg, db] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        if (red + dr >= size || green + dg >= size || blue + db >= size) continue;
        const next = latticeIndex(red + dr, green + dg, blue + db, size);
        maxStepRatio = Math.max(maxStepRatio, Math.hypot(lut[next] - values[0], lut[next + 1] - values[1], lut[next + 2] - values[2]) / (1 / last));
      }
    }
    const black = [lut[0], lut[1], lut[2]], whiteOffset = latticeIndex(last, last, last, size), white = [lut[whiteOffset], lut[whiteOffset + 1], lut[whiteOffset + 2]];
    const blackLift = Math.max(0, ...black), whiteDrop = Math.max(0, 1 - Math.min(...white)), srgb = 100 * inGamut / entries;
    let score = 100; if (srgb < 99) score -= 10; if (blackLift > 0.01) score -= 5; if (whiteDrop > 0.01) score -= 5; if (maxCast > 0.02) score -= 5; if (maxStepRatio > 3) score -= 10;
    score = Math.max(0, score); const rating = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : 'Poor';
    return { score, rating, srgbPercent: `${srgb.toFixed(1)}%`, blackLift: `${(100 * blackLift).toFixed(1)}%`, whiteDrop: `${(100 * whiteDrop).toFixed(1)}%`, maxCast: `${(100 * maxCast).toFixed(2)}%`, stepRatio: maxStepRatio.toFixed(2), identityPercent: `${(100 * identity / entries).toFixed(1)}%` };
  }

  function analyzeHueLinearity(lutObject) {
    const data = [];
    for (let index = 0; index <= 180; index += 1) {
      const hue = index / 180, input = hsvToRgb(hue, 1, 0.8), output = tetraInterp(input[0], input[1], input[2], lutObject.lut, lutObject.size);
      let shift = rgbToHsv(output[0], output[1], output[2])[0] - hue; while (shift < -0.5) shift += 1; while (shift > 0.5) shift -= 1;
      data.push({ hue: 360 * hue, shift: 360 * shift });
    }
    return { data, maxShift: Math.max(...data.map(item => Math.abs(item.shift))).toFixed(2), avgShift: (data.reduce((sum, item) => sum + Math.abs(item.shift), 0) / data.length).toFixed(2) };
  }

  function analyzeSaturationHeatmap(lutObject) {
    const result = [];
    for (let hueIndex = 0; hueIndex < 36; hueIndex += 1) {
      const row = [];
      for (let valueIndex = 0; valueIndex < 10; valueIndex += 1) {
        const input = hsvToRgb(hueIndex / 36, 1, (valueIndex + 0.5) / 10), output = tetraInterp(input[0], input[1], input[2], lutObject.lut, lutObject.size);
        const inputSaturation = rgbToHsv(...input)[1], outputSaturation = rgbToHsv(...output)[1]; row.push(inputSaturation > 0.001 ? outputSaturation / inputSaturation : 1);
      }
      result.push(row);
    }
    return result;
  }

  function analyzeSaturationVectorscope(lutObject) {
    const result = [];
    for (let level = 0; level <= 6; level += 1) {
      const ring = [];
      for (let degree = 0; degree <= 360; degree += 1) {
        const input = hsvToRgb(degree / 360, level / 6, 0.8), output = tetraInterp(input[0], input[1], input[2], lutObject.lut, lutObject.size);
        const inputHsv = rgbToHsv(...input), outputHsv = rgbToHsv(...output); let shift = outputHsv[0] - inputHsv[0]; while (shift < -0.5) shift += 1; while (shift > 0.5) shift -= 1;
        ring.push({ inputAngle: inputHsv[0] * 2 * Math.PI, inputRadius: inputHsv[1], outputAngle: outputHsv[0] * 2 * Math.PI, outputRadius: outputHsv[1], hueShift: 360 * shift });
      }
      result.push(ring);
    }
    return result;
  }

  function downloadFile(content, filename, mimeType) {
    const isDataUrl = typeof content === 'string' && content.startsWith('data:');
    const url = isDataUrl ? content : URL.createObjectURL(new Blob([content], { type: mimeType }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    if (!isDataUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportToCube(lutObject, filename) {
    const safeName = String(filename || 'exported').replace(/\.cube$/i, '');
    let text = `TITLE "${safeName.replace(/["\r\n]/g, '_')}"\nLUT_3D_SIZE ${lutObject.size}\n`;
    const min = lutObject.domainMin || DEFAULT_DOMAIN_MIN, max = lutObject.domainMax || DEFAULT_DOMAIN_MAX;
    text += `DOMAIN_MIN ${min.join(' ')}\nDOMAIN_MAX ${max.join(' ')}\n`;
    for (let offset = 0; offset < lutObject.lut.length; offset += 3) text += `${lutObject.lut[offset].toFixed(6)} ${lutObject.lut[offset + 1].toFixed(6)} ${lutObject.lut[offset + 2].toFixed(6)}\n`;
    downloadFile(text, `${safeName}.cube`, 'text/plain');
  }

  function exportToPNG(lutObject, filename, level) {
    downloadFile(generateHaldCLUTImage(lutObject, level).toDataURL('image/png'), `${filename || 'exported'}.png`, 'image/png');
  }

  function estimateCubeFileSize(size) { return 30 * size ** 3; }
  function estimatePngFileSize(size) { const level = Math.round(Math.sqrt(size)), side = level ** 3; return side * side * 4 * 0.4; }
  function formatFileSize(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }

  const api = { MAX_LUT_SIZE, FILE_CAP_BYTES, clamp01, cloneLUT, parseCubeSafe, tetraInterp, trilinearInterp, catmullRomInterp, buildDiagonalCurves, applyLUTToImageData, exportToCube, exportToPNG, downloadFile, resampleLUT, applyIntensity, preserveLuminance, protectSkinTones, smoothLUT, gamutCompress, computeQualityReport, generateHaldCLUTImage, parseHaldCLUTImage, estimateCubeFileSize, estimatePngFileSize, analyzeLUT, analyzeQuality, analyzeHueLinearity, analyzeSaturationHeatmap, analyzeSaturationVectorscope, rgbToHsv, hsvToRgb, formatFileSize };
  root.LUTUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
