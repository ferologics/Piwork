# scripts/lab

Experimental one-off scripts that are **not** part of normal dev/test gates (`mise run check`, CI, hooks).

Current contents:

- MITM/network spike helpers (`run-mitm-*`, `mitm-*`) referenced by `docs/research/network-mitm-spike.md`

If a script becomes part of the normal workflow, promote it to a first-class `mise` task and move it out of `scripts/lab`.
