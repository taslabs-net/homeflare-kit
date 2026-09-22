# Security Policy

## Reporting a vulnerability

Email **security@homeflare.dev**. Please do not open a public issue for a security
vulnerability — a public report is a disclosure, and it reaches attackers at the same
moment it reaches us.

Include what you have:

- a description of the issue
- steps to reproduce
- affected version(s) or commit SHAs
- your assessment of severity

We acknowledge reports within 72 hours and aim to ship fixes for high-severity issues
within 30 days.

## Supported versions

The latest published release on npm is the only supported version. Older tags are
point-in-time references; fixes are not backported.

## What is in scope

This package is a **library**. It holds no credentials, opens no sockets, and reads no
files — `parseEnv` is handed a plain object by its caller and returns a plain object.
The realistic vulnerability classes here are:

- a parsing result that misrepresents its input (for example, a value that should have
  been rejected being returned as valid)
- a supply-chain issue in what we publish: the built `dist/`, the tarball's contents, or
  the release workflow that produces them

⚠️ **Configuration values are the caller's secrets, not ours.** Nothing in this package
logs a parsed value, and `EnvError` names only the offending key. If you find any path
where a value reaches a log, a message, or a stack trace, treat it as a vulnerability and
report it here.

## Disclosure

We follow coordinated disclosure. Once a fix ships, reporters are welcome to publish
their findings, and we are happy to credit you in the release notes — tell us how you
would like to be named, or if you would rather not be.
