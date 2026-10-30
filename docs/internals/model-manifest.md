# Model manifest

The [bundled manifest](../../apps/server/src/provider/model-manifest.json) is the
only source of model metadata. This fork never fetches it from the upstream
repository, so a model change ships with a rebuild and the server has no
`model-manifest.json` disk cache.

Generic catalog data describes presentation and capabilities. Each provider owns
its adapter schema and dispatch mappings. Providers never read the manifest
itself: the server exposes each driver's entry through the
[`ModelCatalog`](../../packages/provider-core/src/server/ModelCatalog.ts) port,
and compatibility policies stay with the server. Adding a model with an existing
capability profile is a JSON edit; a new profile is needed only for a new
capability combination.

Model data is schema-validated configuration. Tests should cover resolver and
adapter semantics with synthetic model names, so adding a model never requires
tests that repeat the configuration.
