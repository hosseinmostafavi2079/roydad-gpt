# Tenant admin visual comparison

`before/` contains the final Pilot Step 3.7 screenshots retained in `test-results/` before this overhaul. `after/` is captured from the populated Playwright tenant journey with `EVENTOS_VISUAL_CAPTURE=true` at 1440px and 390px.

The instructor portrait and program cover are fictional, generated images stored in `tests/fixtures/` for local automated UI tests. The screenshots contain disposable `example.test` identities. No real credentials or invitation tokens are included.

To refresh the after set, build and run Playwright with `EVENTOS_VISUAL_CAPTURE=true` against local disposable services. The E2E journey waits for the image and editor content before each capture.
