#!/usr/bin/env bash
# Patch a local elm-test install so its supervisor uses TCP loopback
# (127.0.0.1) instead of an AF_UNIX socket in /tmp.
#
# Why: some sandboxes forbid AF_UNIX bind (EPERM) while TCP loopback works.
# The patch is behavior-preserving everywhere else: non-loopback pipe names
# (Unix sockets, Windows named pipes) keep the original code path.
#
# Usage: ./tools/patch-elm-test-tcp.sh /tmp/elmtools/package
set -euo pipefail
PKG_DIR="${1:?usage: patch-elm-test-tcp.sh <elm-test-package-dir>}"

python3 - "$PKG_DIR" <<'EOF'
import sys

pkg = sys.argv[1]

# 1. RunTests.js: emit "127.0.0.1:PORT" instead of a /tmp socket path.
p = f"{pkg}/lib/RunTests.js"
s = open(p).read()
old = """function getPipeFilename(runsExecuted /*: number */) /*: string */ {
  return process.platform === 'win32'
    ? `\\\\\\\\.\\\\pipe\\\\elm_test-${process.pid}-${runsExecuted}`
    : `/tmp/elm_test-${process.pid}.sock`;
}"""
new = """function getPipeFilename(runsExecuted /*: number */) /*: string */ {
  // Sandbox note: AF_UNIX bind may be EPERM while TCP loopback works.
  // Workers parse the "127.0.0.1:PORT" form; anything else keeps the
  // original socket/pipe path.
  var port = 44000 + ((process.pid + runsExecuted) % 10000);
  return process.platform === 'win32'
    ? `\\\\\\\\.\\\\pipe\\\\elm_test-${process.pid}-${runsExecuted}`
    : `127.0.0.1:${port}`;
}"""
assert old in s, "RunTests.js pattern not found"
open(p, "w").write(s.replace(old, new))

# 2. Supervisor.js: listen on TCP when the name is host:port.
p = f"{pkg}/lib/Supervisor.js"
s = open(p).read()
old = "    server.listen(pipeFilename);"
new = """    var tcpMatch = /^127\\.0\\.0\\.1:(\\d+)$/.exec(pipeFilename);
    if (tcpMatch) {
      server.listen(parseInt(tcpMatch[1], 10), '127.0.0.1');
    } else {
      server.listen(pipeFilename);
    }"""
assert old in s, "Supervisor.js pattern not found"
open(p, "w").write(s.replace(old, new))

# 3. Worker template: connect via TCP when the name is host:port.
p = f"{pkg}/templates/after.js"
s = open(p).read()
old = """var net = require('net'),
  client = net.createConnection(pipeFilename);"""
new = """var net = require('net'),
  tcpPipe = /^127\\.0\\.0\\.1:(\\d+)$/.exec(pipeFilename),
  client = tcpPipe
    ? net.createConnection(parseInt(tcpPipe[1], 10), '127.0.0.1')
    : net.createConnection(pipeFilename);"""
assert old in s, "after.js pattern not found"
open(p, "w").write(s.replace(old, new))

print("elm-test TCP-loopback patch applied")
EOF
