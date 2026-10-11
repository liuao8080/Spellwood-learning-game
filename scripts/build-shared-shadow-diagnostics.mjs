// Explicit experiment builder; never writes src/ or client-dist/. The original
// production bundle/hash and every copied source are recorded for attribution.
await import('../tests/diagnostics/shared-shadow/build.mjs');
