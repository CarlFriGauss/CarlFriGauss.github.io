# Gaussian Process Explorer

A self-contained static browser tool. Serve this directory over HTTP/HTTPS and open its `index.html`; ES modules do not run reliably from a `file:` URL. No package installation or backend is needed.

`gp.mjs` implements zero-mean Gaussian process regression with an RBF kernel. Observation noise is squared and added to the training covariance diagonal. A bounded Cholesky/jitter routine solves the system without a matrix inverse. Returned intervals are mean ± 1.96 standard deviations of the **latent function**, pointwise; they exclude future observation noise.

The interface supports up to 40 observations, with x in [−5, 5] and y in [−10, 10]. Repeated inputs with zero noise may require a reported numerical jitter. Use positive observation noise to model conflicting repeated observations.

Run the numerical checks from the repository root:

```sh
node --test tools/gaussian-process/gp.test.mjs
```

Points remain in page memory. There is no upload, account, persistence, tracking, or network API. The page's content security policy permits only local scripts/styles and blocks connections and form submissions.
