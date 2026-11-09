# Security Policy

## Supported versions

The latest `2.1.x` release receives security fixes.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** through GitHub Security Advisories:

https://github.com/tibetty/osm2geojson-lite/security/advisories/new

Do not open a public issue for a security report. Include:

- the affected version,
- a minimal input and options that reproduce the issue,
- the expected and actual behaviour,
- any known impact or workaround.

## Scope

- The published runtime package has **no runtime dependencies**.
- Vulnerabilities in development tooling, benchmarks or the local `npm run valid` server are lower priority, but reports are welcome.
- `npm run valid` is a development-only static server: it binds to `127.0.0.1`, blocks dotfiles and symlink escapes, and must not be exposed publicly.
