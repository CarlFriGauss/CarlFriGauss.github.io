# Gaussian Process Explorer

A self-contained static browser tool. Serve this directory over HTTP/HTTPS and open its `index.html`; ES modules do not run reliably from a `file:` URL. No package installation or backend is needed.

`gp.mjs` implements zero-mean Gaussian process regression with an RBF kernel. Observation noise is squared and added to the training covariance diagonal. A bounded Cholesky/jitter routine solves the system without a matrix inverse. Returned intervals are mean ± 1.96 standard deviations of the **latent function**, pointwise; they exclude future observation noise.

The interface supports up to 40 observations, with x in [−5, 5] and y in [−10, 10]. Repeated inputs with zero noise may require a reported numerical jitter. Use positive observation noise to model conflicting repeated observations.

The full-width plot is the observation input surface: click or tap to add a point, or click an existing point to remove it. It opens without observations, showing eight prior function draws, the mean, and the pointwise interval on the same axes. Keyboard coordinate entry, observation removal buttons, and numerical values are also available. After each update the vertical range fits the mean, both interval bounds, every displayed sample, observations, and the density shading, with 10% headroom. The observation entry limits do not cap the plotted range. Click coordinates use the axes visible before the update; existing data coordinates remain unchanged when the view rescales.

The green shading follows the Gaussian density relative to its peak at each x: `exp(-0.5 * ((y - mean) / std) ** 2)`. Removing the `1 / (std * sqrt(2π))` factor makes both narrow and wide distributions visible; colour intensity therefore compares relative density within an x slice, not absolute densities across x. The shading fades through 84 ribbons over ±3.5 standard deviations, and thin dashed curves mark the unchanged mean ±1.96 standard deviation interval. A zero-variance distribution collapses to the mean rather than dividing by zero. `plot.mjs` contains the display range and relative-density calculations; it does not change inference or sampling.

`sampleFunctions` draws the latent function jointly at the plot and observation locations, then uses Matheron's rule to condition each draw, including independent observation noise. A fixed seed keeps the underlying prior draws stable while observations are added; “Draw new functions” changes the seed. A bounded Cholesky jitter also stabilizes the joint sampling covariance, including duplicate locations. This introduces a small numerical approximation at otherwise singular locations. The sampling controls allow 1–30 functions or hide the curves. The original Python source is preserved separately.

Run the numerical checks from the repository root:

```sh
node --test tools/gaussian-process/gp.test.mjs
```

Points remain in page memory. There is no upload, account, persistence, tracking, or network API. The page's content security policy permits only local scripts/styles and blocks connections and form submissions.
