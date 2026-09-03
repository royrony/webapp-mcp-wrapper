# Experimental runtime — not supported

Per the project constitution (v1.3.0, Principle VI: *Single Supported Runtime with Optional
Experimental Runtimes*), **Node.js/TypeScript is the only supported generated-server runtime.**

This Python runtime is **optional and experimental**:

- It carries **no behavioral-parity obligation** with the supported Node runtime.
- It is **not** covered by the project's completeness, safety, reliability, or dependency-currency
  claims.
- It may be incomplete or lag the supported runtime; that is expected, not a defect.
- Do not treat it as an equivalent choice to the Node runtime.

Promoting this runtime to *supported* (which would re-impose the safety/behavior guarantees of the
constitution's Principles II–V) requires an explicit constitution amendment. Until then, the
per-tool `baseUrl` dispatch and pluggable auth strategies (OAuth / CDP session-reuse / API-key) that
the Node runtime implements are **not** ported here (see deferred tasks T086/T088).
