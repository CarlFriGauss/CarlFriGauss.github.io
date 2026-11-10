import { posterior, sampleFunctions, DEFAULT_PARAMETERS, MAX_OBSERVATIONS, X_LIMIT, Y_LIMIT } from './gp.mjs';
import { plotExtent, relativeDensity, DENSITY_TAIL } from './plot.mjs';

const byId = id => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const queryX = Array.from({ length: 321 }, (_, index) => -X_LIMIT + index / 32);
const example = [{ x: -3, y: -0.8 }, { x: -1.5, y: 0.9 }, { x: 0, y: 0.3 }, { x: 1.7, y: -0.7 }, { x: 3.2, y: 0.8 }];
let points = [];
let model = null;
let samples = [];
let sampleSeed = 42;
let geometry = null;
let pendingFrame = null;
let calculationFailed = false;

const parameters = [
  ['lengthScale', 'length-scale', 'length-value'],
  ['signalStd', 'signal-std', 'signal-value'],
  ['noiseStd', 'noise-std', 'noise-value'],
];

function format(value, precision = 3) {
  if (Math.abs(value) < 1e-12) return '0';
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) return value.toExponential(2);
  return Number(value.toFixed(precision)).toString();
}

function svgElement(name, attributes = {}, text = null) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== null) element.textContent = text;
  return element;
}

function cell(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function setStatus(message, error = false) {
  const status = byId('action-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function draw(current) {
  if (!current) return;
  const width = Math.max(260, Math.round(byId('plot-container').getBoundingClientRect().width));
  const height = width < 520 ? 340 : 460;
  const left = 58, right = width - 15, top = 18, bottom = height - 43;
  const extent = plotExtent(current, points, samples);
  const x = value => left + (value + X_LIMIT) / (2 * X_LIMIT) * (right - left);
  const y = value => top + (extent - value) / (2 * extent) * (bottom - top);
  geometry = { width, height, left, right, top, bottom, extent };
  const plot = byId('plot');
  plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
  plot.setAttribute('width', String(width));
  plot.setAttribute('height', String(height));
  const fragment = document.createDocumentFragment();
  fragment.append(
    svgElement('title', { id: 'chart-title' }, `${points.length ? 'Posterior' : 'Prior'} of a Gaussian process`),
    svgElement('desc', { id: 'chart-description' }, 'Click or tap this plot to add observations and condition the displayed functions. The vertical axis automatically fits every displayed curve. Thin curves: sampled functions. Thick teal line: mean of the latent function. Green shading: Gaussian density relative to its peak at each x, darker near the mean. Thin dashed lines: the 95% pointwise interval. Dark points: observations. Use the x and y fields to add points with a keyboard; numerical results and removal controls are in the tables below.'),
  );
  const defs = svgElement('defs');
  const clip = svgElement('clipPath', { id: 'plot-area-clip' });
  clip.append(svgElement('rect', { x: left, y: top, width: right - left, height: bottom - top }));
  defs.append(clip); fragment.append(defs);
  for (const value of [-5, -2.5, 0, 2.5, 5]) {
    fragment.append(svgElement('line', { x1: x(value), y1: top, x2: x(value), y2: bottom, class: 'grid-line' }));
    fragment.append(svgElement('text', { x: x(value), y: bottom + 21, 'text-anchor': 'middle', class: 'axis-text' }, format(value)));
  }
  for (const multiplier of [-1, -0.5, 0, 0.5, 1]) {
    const value = multiplier * extent;
    fragment.append(svgElement('line', { x1: left, y1: y(value), x2: right, y2: y(value), class: 'grid-line' }));
    fragment.append(svgElement('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end', class: 'axis-text' }, format(value, 1)));
  }
  fragment.append(svgElement('line', { x1: left, y1: top, x2: left, y2: bottom, class: 'axis-line' }));
  fragment.append(svgElement('line', { x1: left, y1: bottom, x2: right, y2: bottom, class: 'axis-line' }));
  fragment.append(svgElement('text', { x: (left + right) / 2, y: height - 4, 'text-anchor': 'middle', class: 'axis-label' }, 'x'));
  fragment.append(svgElement('text', { x: left, y: 11, class: 'axis-label' }, 'f(x), y'));
  const marks = svgElement('g', { 'clip-path': 'url(#plot-area-clip)' });
  const coordinates = (values, reverse = false) => {
    const indices = Array.from({ length: current.x.length }, (_, index) => index);
    if (reverse) indices.reverse();
    return indices.map(index => `${x(current.x[index]).toFixed(2)},${y(values[index]).toFixed(2)}`);
  };
  const deviations = current.variance.map(Math.sqrt);
  const density = svgElement('g', { class: 'density-shading', 'aria-hidden': 'true' });
  // Adjacent ribbons follow the mean and standard deviation across x. Their
  // intensity is the Gaussian density divided by its peak: exp(-z² / 2).
  // This removes the 1/(sigma sqrt(2 pi)) factor for visibility, as labelled.
  const bands = 84;
  for (let band = 0; band < bands; band++) {
    const lowZ = -DENSITY_TAIL + 2 * DENSITY_TAIL * band / bands;
    const highZ = -DENSITY_TAIL + 2 * DENSITY_TAIL * (band + 1) / bands;
    const low = current.mean.map((mean, index) => mean + lowZ * deviations[index]);
    const high = current.mean.map((mean, index) => mean + highZ * deviations[index]);
    density.append(svgElement('path', {
      d: `M${coordinates(high).join(' L')} L${coordinates(low, true).join(' L')} Z`,
      class: 'density-band', 'fill-opacity': (0.38 * relativeDensity((lowZ + highZ) / 2)).toFixed(5),
    }));
  }
  marks.append(density);
  for (const bound of [current.lower, current.upper]) {
    marks.append(svgElement('path', { d: `M${coordinates(bound).join(' L')}`, class: 'interval-boundary' }));
  }
  if (byId('show-samples').checked) {
    for (const [index, values] of samples.entries()) {
      marks.append(svgElement('path', { d: `M${coordinates(values).join(' L')}`, class: `sample-function sample-color-${index % 4}` }));
    }
  }
  marks.append(svgElement('path', { d: `M${coordinates(current.mean).join(' L')}`, class: 'posterior-mean' }));
  for (const [index, point] of points.entries()) {
    const group = svgElement('g', { 'data-point-index': index });
    group.append(svgElement('title', {}, `Observation ${index + 1}: x ${format(point.x)}, y ${format(point.y)}. Click to remove.`));
    group.append(svgElement('circle', { cx: x(point.x), cy: y(point.y), r: 18, class: 'point-target' }));
    group.append(svgElement('circle', { cx: x(point.x), cy: y(point.y), r: 5.5, class: 'observation' }));
    marks.append(group);
  }
  fragment.append(marks);
  plot.replaceChildren(fragment);
}

function renderObservations() {
  const fragment = document.createDocumentFragment();
  for (const [index, point] of points.entries()) {
    const row = document.createElement('tr');
    const heading = cell('th', String(index + 1)); heading.scope = 'row';
    row.append(heading, cell('td', format(point.x, 4)), cell('td', format(point.y, 4)));
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary'; button.id = `remove-${index}`;
    button.textContent = 'Remove'; button.dataset.remove = String(index);
    button.setAttribute('aria-label', `Remove observation ${index + 1}, x ${format(point.x)}, y ${format(point.y)}`);
    action.append(button); row.append(action); fragment.append(row);
  }
  if (!points.length) {
    const row = document.createElement('tr');
    const empty = cell('td', 'No observations. The plot shows the prior.');
    empty.colSpan = 4; row.append(empty); fragment.append(row);
  }
  byId('observation-rows').replaceChildren(fragment);
  byId('observation-count').textContent = `${points.length} / ${MAX_OBSERVATIONS} observations`;
  byId('add-point').disabled = points.length >= MAX_OBSERVATIONS;
  byId('plot-heading').textContent = points.length ? 'Posterior' : 'Prior';
  byId('sample-state').textContent = points.length ? 'Samples from the posterior' : 'Samples from the prior';
  byId('sample-key').hidden = !byId('show-samples').checked;
}

function renderPosteriorTable(current) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < current.x.length; index += 32) {
    const row = document.createElement('tr');
    const heading = cell('th', format(current.x[index])); heading.scope = 'row';
    row.append(heading, cell('td', format(current.mean[index])), cell('td', format(current.lower[index])), cell('td', format(current.upper[index])));
    fragment.append(row);
  }
  byId('posterior-rows').replaceChildren(fragment);
}

function render() {
  if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
  pendingFrame = null;
  const options = {};
  for (const [name, control, output] of parameters) {
    options[name] = Number(byId(control).value);
    byId(output).textContent = options[name].toFixed(2);
  }
  renderObservations();
  try {
    model = posterior(points, queryX, options);
    samples = byId('show-samples').checked
      ? sampleFunctions(points, queryX, options, { count: Number(byId('sample-count').value), seed: sampleSeed }) : [];
    draw(model); renderPosteriorTable(model);
    const middle = 160;
    const state = points.length ? `Posterior from ${points.length} observation${points.length === 1 ? '' : 's'}.` : 'Prior with no observations.';
    let summary = `${state} At x = 0, the mean of f is ${format(model.mean[middle])}; its 95% pointwise interval is [${format(model.lower[middle])}, ${format(model.upper[middle])}].`;
    if (model.jitter > 0) summary += ` A diagonal jitter of ${model.jitter.toExponential(1)} was added for numerical stability. Consider positive noise for conflicting repeated observations.`;
    byId('model-summary').textContent = summary;
    if (calculationFailed) setStatus('Calculation restored.');
    calculationFailed = false;
    return true;
  } catch (error) {
    calculationFailed = true;
    model = null; geometry = null;
    byId('plot').replaceChildren(svgElement('text', { x: 25, y: 50, class: 'axis-text' }, 'Adjust the model controls to restore the plot.'));
    byId('posterior-rows').replaceChildren();
    byId('model-summary').textContent = `Calculation unavailable. ${error.message}`;
    setStatus(error.message, true);
    return false;
  }
}

function addPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > X_LIMIT || Math.abs(y) > Y_LIMIT) {
    setStatus('Enter finite values: x between −5 and 5, and y between −10 and 10.', true); return;
  }
  if (points.length >= MAX_OBSERVATIONS) {
    setStatus('The 40-point limit is reached. Remove a point before adding another.', true); return;
  }
  points.push({ x, y });
  if (render()) setStatus(`Added observation ${points.length}: x ${format(x)}, y ${format(y)}.${points.length === MAX_OBSERVATIONS ? ' The 40-point limit is reached.' : ''}`);
}

function removePoint(index, restoreFocus = false) {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) return;
  points.splice(index, 1);
  if (render()) setStatus(`Observation ${index + 1} removed. ${points.length} remaining.`);
  if (restoreFocus) (byId(`remove-${Math.min(index, points.length - 1)}`) || byId('add-point')).focus();
}

byId('observation-form').addEventListener('submit', event => {
  event.preventDefault();
  addPoint(byId('point-x').valueAsNumber, byId('point-y').valueAsNumber);
});

byId('observation-rows').addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('button[data-remove]') : null;
  if (button) removePoint(Number(button.dataset.remove), true);
});

byId('plot').addEventListener('click', event => {
  const mark = event.target instanceof Element ? event.target.closest('[data-point-index]') : null;
  if (mark) { removePoint(Number(mark.dataset.pointIndex)); return; }
  if (!geometry) return;
  const rect = byId('plot').getBoundingClientRect();
  const sx = (event.clientX - rect.left) / rect.width * geometry.width;
  const sy = (event.clientY - rect.top) / rect.height * geometry.height;
  if (sx < geometry.left || sx > geometry.right || sy < geometry.top || sy > geometry.bottom) return;
  const x = -X_LIMIT + (sx - geometry.left) / (geometry.right - geometry.left) * 2 * X_LIMIT;
  const y = geometry.extent - (sy - geometry.top) / (geometry.bottom - geometry.top) * 2 * geometry.extent;
  addPoint(Number(x.toFixed(4)), Number(y.toFixed(4)));
});

for (const [, control] of parameters) {
  byId(control).addEventListener('input', () => {
    if (pendingFrame === null) pendingFrame = requestAnimationFrame(() => { pendingFrame = null; render(); });
  });
}

byId('show-samples').addEventListener('change', () => {
  byId('sample-count').disabled = !byId('show-samples').checked;
  byId('resample').disabled = !byId('show-samples').checked;
  render();
});
byId('sample-count').addEventListener('input', () => {
  byId('sample-value').textContent = byId('sample-count').value;
  if (pendingFrame === null) pendingFrame = requestAnimationFrame(() => { pendingFrame = null; render(); });
});
byId('resample').addEventListener('click', () => {
  sampleSeed = (sampleSeed + 1) >>> 0;
  if (render()) setStatus(`Drew new functions from the ${points.length ? 'posterior' : 'prior'}. Observations are unchanged.`);
});

function defaults() {
  for (const [name, control] of parameters) byId(control).value = String(DEFAULT_PARAMETERS[name]);
}

byId('reset').addEventListener('click', () => {
  points = []; defaults(); render(); setStatus('Prior restored. All observations cleared; default parameters restored.');
});
byId('example').addEventListener('click', () => {
  points = example.map(point => ({ ...point })); defaults(); render(); setStatus('Loaded five example observations and the default parameters.');
});

new ResizeObserver(() => { if (model) draw(model); }).observe(byId('plot-container'));
byId('load-message').hidden = true;
render();
