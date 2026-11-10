// Display calculations are separate from the Gaussian process model.
export const DENSITY_TAIL = 3.5;

export function relativeDensity(z) {
  return Math.exp(-0.5 * z * z);
}

export function plotExtent(model, points = [], samples = []) {
  let largest = 0;
  const include = value => { largest = Math.max(largest, Math.abs(value)); };
  for (let index = 0; index < model.mean.length; index++) {
    include(model.mean[index]);
    include(model.lower[index]);
    include(model.upper[index]);
    // Show the shading's faint tails as well as the labelled 95% interval.
    const tail = DENSITY_TAIL * Math.sqrt(model.variance[index]);
    include(model.mean[index] - tail);
    include(model.mean[index] + tail);
  }
  for (const point of points) include(point.y);
  for (const values of samples) for (const value of values) include(value);
  // Observation limits constrain data entry, never the displayed function range.
  return Math.max(3, largest * 1.1);
}
