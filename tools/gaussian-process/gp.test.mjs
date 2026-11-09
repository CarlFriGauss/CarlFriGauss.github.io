import test from 'node:test';
import assert from 'node:assert/strict';
import { posterior, observationCovariance, rbfKernel, MAX_OBSERVATIONS } from './gp.mjs';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('zero observations give the zero-mean prior and the pointwise latent interval', () => {
  const result = posterior([], [-5, 0, 5], { signalStd: 2, noiseStd: 2 });
  assert.deepEqual(result.mean, [0, 0, 0]);
  assert.deepEqual(result.variance, [4, 4, 4]);
  assert.deepEqual(result.lower, [-3.92, -3.92, -3.92]);
  assert.deepEqual(result.upper, [3.92, 3.92, 3.92]);
  assert.equal(result.jitter, 0);
});

test('one noisy observation matches the analytic posterior at and away from its input', () => {
  const parameters = { lengthScale: 1.4, signalStd: 2, noiseStd: 0.5 };
  const result = posterior([{ x: 0, y: 3 }], [0, 1.2], parameters);
  for (const [index, x] of result.x.entries()) {
    const cross = 4 * Math.exp(-0.5 * (x / 1.4) ** 2);
    close(result.mean[index], cross / 4.25 * 3);
    close(result.variance[index], 4 - cross ** 2 / 4.25);
    close(result.upper[index] - result.mean[index], 1.96 * Math.sqrt(result.variance[index]));
  }
});

test('observation noise is squared and added only to the training diagonal', () => {
  const points = [{ x: 0, y: 1 }, { x: 1, y: -1 }];
  const options = { signalStd: 2, noiseStd: 0.5 };
  const covariance = observationCovariance(points, options);
  close(covariance[0][0], 4.25);
  close(covariance[1][1], 4.25);
  close(covariance[0][1], rbfKernel(0, 1, options));
  close(covariance[1][0], covariance[0][1]);
  close(posterior([{ x: 0, y: 1 }], [0], options).variance[0], 4 - 16 / 4.25);
});

test('a noiseless observation interpolates without adding test-observation noise', () => {
  const result = posterior([{ x: 0, y: 1.5 }], [0], { noiseStd: 0 });
  close(result.mean[0], 1.5);
  close(result.variance[0], 0);
});

test('repeated and nearly repeated inputs remain finite with bounded jitter', () => {
  const points = Array.from({ length: MAX_OBSERVATIONS }, (_, index) => ({ x: index % 2 ? 0 : 1e-12, y: 0.75 }));
  const result = posterior(points, [-5, 0, 5], { lengthScale: 5, noiseStd: 0 });
  assert.ok(result.jitter > 0 && result.jitter <= 1e-5);
  close(result.mean[1], 0.75, 1e-5);
  for (const values of [result.mean, result.variance, result.lower, result.upper]) {
    assert.ok(values.every(Number.isFinite));
  }
  assert.ok(result.variance.every(value => value >= 0));
});

test('conflicting duplicates stay finite; positive noise expresses inconsistent observations', () => {
  const points = [{ x: 0, y: -1 }, { x: 0, y: 1 }];
  const regularized = posterior(points, [0, 1], { noiseStd: 0 });
  assert.ok(regularized.jitter > 0);
  assert.ok(regularized.mean.every(Number.isFinite));
  const noisy = posterior(points, [0], { noiseStd: 0.3 });
  close(noisy.mean[0], 0);
  assert.ok(noisy.variance[0] > 0);
});

test('invalid, non-finite, out-of-range, and oversized inputs are rejected', () => {
  for (const value of [NaN, Infinity, -Infinity, '1', null]) {
    assert.throws(() => posterior([{ x: value, y: 0 }], [0]));
    assert.throws(() => posterior([{ x: 0, y: value }], [0]));
    assert.throws(() => posterior([], [value]));
    assert.throws(() => posterior([], [0], { signalStd: value }));
  }
  assert.throws(() => posterior(Array.from({ length: 41 }, () => ({ x: 0, y: 0 })), [0]));
  assert.throws(() => posterior([], Array(402).fill(0)));
  assert.throws(() => posterior([{ x: 6, y: 0 }], [0]));
  assert.throws(() => posterior([], [0], { lengthScale: 0 }));
  assert.throws(() => posterior([], [0], { noiseStd: -1 }));
});
