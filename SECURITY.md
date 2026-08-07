# Security policy

Please do not disclose credentials, private keys, real user data, or an
exploitable security report in a public issue or pull request.

## Reporting

Use GitHub's private vulnerability-reporting or security-advisory flow for
`devinkbrown/onyx` when it is available. If that private channel is not enabled,
open a minimal public issue that says **private security contact needed** and
does not include exploit details, payloads, credentials, or user data.

Include the affected commit or route, the smallest reproduction you can safely
share, impact, prerequisites, and whether the issue affects the browser client,
the hosted deployment, or the separate Onyx Server daemon. The client and
daemon are separate scopes; do not assume a report in one repository applies to
the other.

There is no guaranteed response or remediation timeline. Reports are assessed
in good faith, and reporters will be credited when they want that credit.

## Sensitive areas

Please call out issues involving:

- plaintext or ciphertext disclosure in messages, vault, notifications, or
  browser storage;
- E2EE key substitution, downgrade, replay, or trust-boundary failures;
- XSS, unsafe URL handling, SSRF through preview/upload boundaries, or unsafe
  file parsing;
- authentication, session resume, passkey, recovery-code, or credential
  handling;
- media capture, recording, or security-state misrepresentation.

For general bugs, use a normal issue with sanitized reproduction details.
