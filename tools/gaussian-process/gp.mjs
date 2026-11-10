// Zero-mean, one-dimensional Gaussian process with a squared-exponential kernel.
// The posterior variance is for the latent function f, excluding new-observation noise.
export const MAX_OBSERVATIONS = 40;
export const MAX_QUERIES = 401;
export const X_LIMIT = 5;
export const Y_LIMIT = 10;
export const DEFAULT_PARAMETERS = Object.freeze({ lengthScale: 1, signalStd: 1, noiseStd: 0.15 });
export const PARAMETER_LIMITS = Object.freeze({
  lengthScale: Object.freeze([0.1, 5]),
  signalStd: Object.freeze([0.1, 3]),
  noiseStd: Object.freeze([0, 2]),
});

function finiteWithin(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a finite number between ${min} and ${max}.`);
  }
}

export function validateParameters(parameters = {}) {
  const result = { ...DEFAULT_PARAMETERS, ...parameters };
  for (const [name, [min, max]] of Object.entries(PARAMETER_LIMITS)) {
    finiteWithin(result[name], min, max, name);
  }
  return result;
}

export function validateObservations(points) {
  if (!Array.isArray(points) || points.length > MAX_OBSERVATIONS) {
    throw new RangeError(`Use at most ${MAX_OBSERVATIONS} observations.`);
  }
  for (const point of points) {
    if (!point || typeof point !== 'object') throw new TypeError('Each observation needs x and y.');
    finiteWithin(point.x, -X_LIMIT, X_LIMIT, 'Observation x');
    finiteWithin(point.y, -Y_LIMIT, Y_LIMIT, 'Observation y');
  }
}

function kernel(x, other, parameters) {
  const distance = (x - other) / parameters.lengthScale;
  return parameters.signalStd ** 2 * Math.exp(-0.5 * distance * distance);
}

export function rbfKernel(x, other, parameters = {}) {
  finiteWithin(x, -X_LIMIT, X_LIMIT, 'x');
  finiteWithin(other, -X_LIMIT, X_LIMIT, 'other x');
  return kernel(x, other, validateParameters(parameters));
}

// Noise variance is added to the diagonal once, including for repeated input values.
export function observationCovariance(points, parameters = {}) {
  validateObservations(points);
  const options = validateParameters(parameters);
  return points.map((point, row) => points.map((other, column) =>
    kernel(point.x, other.x, options) + (row === column ? options.noiseStd ** 2 : 0)));
}

function factorWithJitter(matrix) {
  const size = matrix.length;
  const scale = Math.max(1, ...matrix.map((row, index) => row[index]));
  // A bounded retry sequence; no matrix inverse or unbounded numerical retry loop.
  for (const relativeJitter of [0, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5]) {
    const jitter = relativeJitter * scale;
    const lower = Array.from({ length: size }, () => new Float64Array(size));
    let valid = true;
    for (let row = 0; row < size && valid; row += 1) {
      for (let column = 0; column <= row; column += 1) {
        let value = matrix[row][column] + (row === column ? jitter : 0);
        for (let index = 0; index < column; index += 1) value -= lower[row][index] * lower[column][index];
        if (row === column) {
          if (!Number.isFinite(value) || value <= scale * 1e-12) { valid = false; break; }
          lower[row][column] = Math.sqrt(value);
        } else {
          lower[row][column] = value / lower[column][column];
          if (!Number.isFinite(lower[row][column])) { valid = false; break; }
        }
      }
    }
    if (valid) return { lower, jitter };
  }
  throw new Error('These observations could not be stabilized. Increase observation noise or remove repeated points.');
}

function solveLower(lower, values) {
  const result = new Float64Array(values.length);
  for (let row = 0; row < values.length; row += 1) {
    let value = values[row];
    for (let column = 0; column < row; column += 1) value -= lower[row][column] * result[column];
    result[row] = value / lower[row][row];
  }
  return result;
}

function solveTranspose(lower, values) {
  const result = new Float64Array(values.length);
  for (let row = values.length - 1; row >= 0; row -= 1) {
    let value = values[row];
    for (let column = row + 1; column < values.length; column += 1) value -= lower[column][row] * result[column];
    result[row] = value / lower[row][row];
  }
  return result;
}

export function posterior(points, queryX, parameters = {}) {
  validateObservations(points);
  const options = validateParameters(parameters);
  if (!Array.isArray(queryX) || queryX.length > MAX_QUERIES) {
    throw new RangeError(`Use at most ${MAX_QUERIES} query locations.`);
  }
  for (const x of queryX) finiteWithin(x, -X_LIMIT, X_LIMIT, 'Query x');
  const priorVariance = options.signalStd ** 2;
  const factor = points.length ? factorWithJitter(observationCovariance(points, options)) : null;
  const alpha = factor ? solveTranspose(factor.lower, solveLower(factor.lower, points.map(point => point.y))) : null;
  const mean = [], variance = [], lower = [], upper = [];
  for (const x of queryX) {
    let locationMean = 0, locationVariance = priorVariance;
    if (factor) {
      const cross = points.map(point => kernel(point.x, x, options));
      const projected = solveLower(factor.lower, cross);
      for (let index = 0; index < points.length; index += 1) {
        locationMean += cross[index] * alpha[index];
        locationVariance -= projected[index] ** 2;
      }
    }
    if (!Number.isFinite(locationMean) || !Number.isFinite(locationVariance) || locationVariance < -1e-7 * priorVariance) {
      throw new Error('The calculation lost numerical precision. Increase observation noise or remove repeated points.');
    }
    locationVariance = Math.max(0, locationVariance);
    const radius = 1.96 * Math.sqrt(locationVariance);
    mean.push(locationMean); variance.push(locationVariance);
    lower.push(locationMean - radius); upper.push(locationMean + radius);
  }
  return { x: [...queryX], mean, variance, lower, upper, jitter: factor?.jitter ?? 0, parameters: options };
}

function normalGenerator(seed) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

// Matheron's rule: condition joint prior draws using the same covariance solve
// as regression. Keeping the seed fixes the underlying draws as points are added.
export function sampleFunctions(points, queryX, parameters = {}, { count = 8, seed = 42 } = {}) {
  validateObservations(points);
  const options = validateParameters(parameters);
  if (!Array.isArray(queryX) || queryX.length > MAX_QUERIES) {
    throw new RangeError(`Use at most ${MAX_QUERIES} query locations.`);
  }
  for (const x of queryX) finiteWithin(x, -X_LIMIT, X_LIMIT, 'Query x');
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new RangeError('Use between 1 and 30 sampled functions.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Use a 32-bit unsigned seed.');
  if (!queryX.length) return Array.from({ length: count }, () => []);

  // Query locations come first, so adding observations preserves their prior draws.
  const locations = [...queryX, ...points.map(point => point.x)];
  const joint = factorWithJitter(locations.map(x => locations.map(other => kernel(x, other, options))));
  const training = points.length ? factorWithJitter(observationCovariance(points, options)) : null;
  const cross = queryX.map(x => points.map(point => kernel(x, point.x, options)));
  return Array.from({ length: count }, (_, sampleIndex) => {
    const pathSeed = (seed + Math.imul(sampleIndex, 0x9e3779b9)) >>> 0;
    const normal = normalGenerator(pathSeed);
    const noise = normalGenerator(pathSeed ^ 0x85ebca6b);
    const z = locations.map(() => normal());
    const prior = joint.lower.map((row, index) => {
      let value = 0;
      for (let column = 0; column <= index; column += 1) value += row[column] * z[column];
      return value;
    });
    if (!training) return prior;
    const residual = points.map((point, index) => point.y - prior[queryX.length + index]
      - Math.sqrt(options.noiseStd ** 2 + training.jitter) * noise());
    const correction = solveTranspose(training.lower, solveLower(training.lower, residual));
    return queryX.map((_, index) => prior[index] + cross[index].reduce((sum, value, column) => sum + value * correction[column], 0));
  });
}
