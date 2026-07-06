# aca-sandboxes-sdk

## 0.2.0

### Minor Changes

- ad70ee8: Redesign the public API for 0.2.0: clients now use options-bag constructors, long-running operations return awaitable pollers from short verb methods, lists return re-iterable paged results with `toArray()`, and `fromEnv()` helpers simplify setup.

  Rework the Effect implementation around shared tagged SDK errors, Effect-native HTTP/poller internals, scoped sandbox acquisition, stream helpers for paged results, and Context/Layer services with Config-backed construction.

## 0.1.2

### Patch Changes

- 582dd46: Test the automated release pipeline.

## 0.1.1

### Patch Changes

- 9713548: Add Changesets-based npm publishing.
