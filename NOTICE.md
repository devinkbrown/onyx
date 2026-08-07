# Onyx notices

## Project boundary

This repository is the **Onyx browser client**. It is a SolidJS application
that connects to an Onyx Server network over IRC/IRCX WebSocket transport.

**Onyx Server** is the separate pure-Zig daemon and has its own repository,
source tree, operational configuration, and release notes:

<https://github.com/devinkbrown/onyx-server>

The hosted Onyx network at <https://eshmaki.me/> is a service operated from
this client and the separate daemon; using that service does not grant access
to its operational infrastructure or user data.

## License

The client source in this repository is released under the GNU Affero General
Public License, version 3 or any later version. The complete license text is in
[`LICENSE`](LICENSE).

The `private` field in `package.json` is an npm publication guard for this web
application. It prevents an accidental `npm publish`; it does not describe the
GitHub repository's visibility or the source license.

Third-party dependencies, fonts, WebAssembly components, and other bundled
materials may carry additional notices or licenses. Preserve their upstream
notices when redistributing a build and consult each package's metadata.

## Naming

- **Onyx** means the network and this first-party browser client.
- **Onyx Server** means the daemon/engine.
- **Cadence** means the browser media stack; `cadencevox` and `cadencevis` are
  wire codec identifiers.
- Historical wire literals such as `TSUMUGI1` may remain in compatibility code;
  they are not current product names.
