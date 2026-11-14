const html = document.documentElement;
html.classList.add('js');
let preference = null;
try { const saved = localStorage.getItem('gauss-theme'); if (saved === 'dark' || saved === 'light') preference = saved; } catch { /* A blocked preference store does not affect the site. */ }
const darkMedia = matchMedia('(prefers-color-scheme: dark)');
const themeButton = document.querySelector('.theme-toggle');
function applyTheme(theme) {
  html.dataset.theme = theme;
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
  themeButton?.setAttribute('aria-label', label);
  themeButton?.setAttribute('title', label);
}
applyTheme(preference || (darkMedia.matches ? 'dark' : 'light'));
themeButton?.addEventListener('click', () => {
  preference = html.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(preference);
  try { localStorage.setItem('gauss-theme', preference); } catch { /* Theme still works without storage. */ }
});
darkMedia.addEventListener('change', () => { if (!preference) applyTheme(darkMedia.matches ? 'dark' : 'light'); });

const menu = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-nav');
function closeMenu() { menu?.setAttribute('aria-expanded', 'false'); menu?.setAttribute('aria-label', 'Open navigation'); navigation?.classList.remove('is-open'); }
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  navigation.classList.toggle('is-open', open);
});
navigation?.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });

if (!matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); } }, { threshold: .12 });
  document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
}

if (document.querySelector('#preview-plot')) {
  try {
    const { posterior } = await import('/tools/gaussian-process/gp.mjs');
    const query = Array.from({ length: 121 }, (_, i) => -4 + i / 15);
    const points = [{ x: -2.8, y: -.6 }, { x: -1.4, y: .9 }, { x: 0, y: .25 }, { x: 1.5, y: -.8 }, { x: 2.8, y: .6 }];
    const x = value => 24 + (value + 4) * 50;
    const y = value => 114 - value * 43;
    const line = values => values.map((v, i) => `${i ? 'L' : 'M'}${x(query[i]).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    function showPreview(mode) {
      const trained = mode === 'posterior';
      const result = posterior(trained ? points : [], query, { lengthScale: 1, signalStd: 1, noiseStd: .16 });
      const band = line(result.upper) + ' ' + result.lower.map((_, n, a) => { const i = a.length - 1 - n; return `L${x(query[i]).toFixed(2)},${y(a[i]).toFixed(2)}`; }).join(' ') + ' Z';
      document.querySelector('#preview-band').setAttribute('d', band);
      document.querySelector('#preview-mean').setAttribute('d', line(result.mean));
      document.querySelector('#preview-points').setAttribute('display', trained ? 'inline' : 'none');
      document.querySelector('#preview-title').textContent = trained ? 'A Gaussian process after five observations' : 'A Gaussian process before observing data';
      document.querySelector('#preview-summary').textContent = trained ? 'Five observations bring the possible functions into focus.' : 'Before data, the mean is zero and the uncertainty is broad.';
      document.querySelectorAll('[data-model]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.model === mode)));
    }
    document.querySelectorAll('[data-model]').forEach(button => button.addEventListener('click', () => showPreview(button.dataset.model)));
  } catch { document.querySelector('.preview-controls')?.setAttribute('hidden', ''); }
}

function approvedVideo(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const params = [...url.searchParams.entries()];
    if (url.hostname === 'www.blogger.com' && url.pathname === '/video.g') {
      const token = url.searchParams.get('token') || '';
      return params.length === 1 && /^[A-Za-z0-9_.~=-]{10,4096}$/.test(token) ? url : null;
    }
    if (url.hostname === 'www.youtube-nocookie.com' && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) {
      if (!params.length) return url;
      const start = url.searchParams.get('start') || '';
      return params.length === 1 && /^\d{1,5}$/.test(start) && Number(start) <= 86400 ? url : null;
    }
  } catch { /* Unsupported media keeps its ordinary link. */ }
  return null;
}

document.querySelectorAll('.article-body a.article-video').forEach(link => {
  const source = approvedVideo(link.href);
  if (!source) return;
  const panel = document.createElement('div');
  panel.className = 'video-consent';
  const explanation = document.createElement('p');
  const provider = source.hostname === 'www.blogger.com' ? 'Blogger' : 'YouTube';
  explanation.textContent = `Loading this video shares the site’s domain with ${provider}, which may use cookies.`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary';
  button.textContent = 'Load video';
  button.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.src = source.href;
    frame.title = `${provider} video`;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    panel.className = 'video-frame';
    panel.replaceChildren(frame);
    frame.focus();
  });
  panel.append(explanation, button);
  link.replaceWith(panel);
});
