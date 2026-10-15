# Assessment startup bundle measurement

Measured with the same installed dependencies, Vite production settings, and
`PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/clean-core build`
before and after the change. Sizes below use decimal KB, rounded by Vite.

| Asset / request group | Before raw | After raw | Before gzip | After gzip |
| --- | ---: | ---: | ---: | ---: |
| Initial entry JavaScript | 916.62 KB | 490.70 KB | 266.73 KB | 150.80 KB |
| Initial stylesheet | 114.91 KB | 114.91 KB | 18.86 KB | 18.86 KB |
| Initial JS + CSS | 1,031.53 KB | 605.61 KB | 285.59 KB | 169.66 KB |
| Deferred dashboard charts | included above | 410.76 KB | included above | 111.07 KB |
| Deferred Evidence tab | included above | 13.82 KB | included above | 4.84 KB |

Initial JavaScript is **46.5% smaller raw / 43.5% smaller gzipped**.
Initial JS + CSS is **41.3% smaller raw / 40.6% smaller gzipped**.
The 500 KB chunk warning is gone without raising its limit or disabling warnings.

These are production asset payload sizes, not a claim about measured network
latency. Gzip sizes estimate transferred bytes when gzip is negotiated; actual
transfers depend on hosting compression, cache state, and protocol overhead.
Unchanged HTML (1.68 KB / 0.60 KB gzip), logo, and externally hosted fonts are
excluded from the JS + CSS totals. Dev-server module transfers are not comparable
to production bundles.

## Profile and split decisions

A diagnostic production build with `--sourcemap` identified Recharts as the
largest deferrable source group (about 600 KB of original source, plus Lodash,
D3, react-smooth and decimal.js dependencies). Source lengths identify candidates,
not transferred bytes; the emitted before/after chunks above measure the savings.

Extracting the two existing charts alone reduced the entry to 503.93 KB /
154.30 KB gzip. The Evidence tab is not the initial tab and uniquely needs its
checkbox and evidence-quality UI. Extracting it removed a further 13.23 KB raw /
3.50 KB gzip from the entry. Other tab bodies share the shell's table, select,
tooltip and badge dependencies; they remain unchanged rather than introducing
more boundaries for small markup-only savings.

- An empty workspace requests neither new lazy chunk. Production HTML has no
  preload for either chunk, and lazy components are rendered only when needed.
- A populated/restored dashboard loads its chart chunk automatically. Its
  combined entry + charts + CSS payload is about 280.73 KB gzip, versus
  285.59 KB before. The large empty-workspace saving is therefore **deferral**,
  not elimination of the chart dependency.
- The Evidence tab downloads on first visit; React reuses the loaded module on
  later visits. Parent-owned assessment, evidence and persistence state stay in
  the page, so loading a tab does not recreate that state.
- PDF, PowerPoint and spreadsheet generators remain independently on demand.
- Loading messages have `role="status"`; the chart loading region reserves the
  existing 400 px chart height.

## Verification

- Production build and frontend TypeScript check pass.
- Source-equivalence checks confirm both chart JSX trees retain all data keys,
  colors, tooltip/legend configuration, dimensions, axes and animation defaults.
- The extracted Evidence JSX is identical except for the evidence-types prop;
  all other tab bodies are unchanged.
- Restarted preview renders the empty assessment and all six navigation items
  without browser errors.

No browser interaction regression suite was run for this extraction; the above
checks do not claim to exercise tooltip hover or upload/backup interactions.
