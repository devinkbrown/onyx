// SPDX-License-Identifier: AGPL-3.0-or-later
//! Zig-native FreeBSD / OpenBSD desktop host for the Onyx SolidJS SPA.
//!
//! Separate from the Native SDK path (`desktop/main.zig` + runner):
//! this host is cross-compiled to `x86_64-freebsd` or `x86_64-openbsd`,
//! dynamically loads a **compatible** GTK + WebKitGTK pair at runtime
//! (no link-time WebKit), serves packaged SPA assets from a **loopback-only**
//! fixed-port HTTP server (`http://127.0.0.1:42691/…`), and loads
//! `http://127.0.0.1:42691/app` in the WebView.
//!
//! The product loopback port is fixed so localStorage / IndexedDB / session
//! resume share a stable origin across launches. Bind failures are fail-closed
//! (single instance / port in use) — never fall back to another port.
//!
//! Compatible toolkit pairs only (never mixed across major lines):
//!   * GTK 4 + webkitgtk-6.0
//!   * GTK 3 + webkit2gtk-4.1 / webkit2gtk-4.0
//!
//! GTK event loop: GtkApplication + g_application_run (GTK4 has no gtk_main).
//!
//! Runtime GUI is only meaningful on a real FreeBSD/OpenBSD machine with
//! the listed packages installed. Cross-building on Linux produces the
//! correct ELF and package layout; it does **not** prove GUI launch.

const std = @import("std");
const builtin = @import("builtin");
const posix = std.posix;
const net = std.Io.net;
const http = std.http;

const app_name = "Onyx";
const app_exe_name = "onyx";
const app_id = "me.eshmaki.onyx";
const spa_entry_path = "/app";
const max_asset_bytes: usize = 32 * 1024 * 1024;

/// Fixed product loopback port for the SPA asset server (high, unprivileged).
/// Bound only on 127.0.0.1. Never ephemeral and never substituted on conflict.
pub const product_loopback_port: u16 = 42691;

/// Target OS this binary is intended for (compile-time when cross-building).
pub const TargetOs = enum {
    freebsd,
    openbsd,
    /// Host used only for pure unit tests (never a ship target for this file).
    other,

    pub fn fromBuiltin() TargetOs {
        return switch (builtin.os.tag) {
            .freebsd => .freebsd,
            .openbsd => .openbsd,
            else => .other,
        };
    }

    pub fn label(self: TargetOs) []const u8 {
        return switch (self) {
            .freebsd => "FreeBSD",
            .openbsd => "OpenBSD",
            .other => "unsupported",
        };
    }

    pub fn zigTriple(self: TargetOs) []const u8 {
        return switch (self) {
            .freebsd => "x86_64-freebsd",
            .openbsd => "x86_64-openbsd",
            .other => "unknown",
        };
    }
};

/// Relative resource locations under the package root (parent of `bin/`).
pub const dist_rel_paths = [_][]const u8{
    "resources/dist",
    "dist",
};

pub const LaunchContract = struct {
    /// Basename of the host executable in the package.
    exe_name: []const u8 = app_exe_name,
    /// Preferred SPA root relative to package root.
    resources_dist: []const u8 = "resources/dist",
    /// Entry HTML under the SPA root (SPA fallback target).
    entry_html: []const u8 = "index.html",
    /// Window title shown in the native chrome.
    window_title: []const u8 = app_name,
    /// Product short name for diagnostics.
    product: []const u8 = app_name,
    /// Path loaded in the WebView (loopback HTTP, not file://).
    web_entry_path: []const u8 = spa_entry_path,
};

pub const default_launch_contract = LaunchContract{};

// ── Compatible toolkit pairs (never cross-major mix) ────────────────────────

pub const ToolkitPair = struct {
    label: []const u8,
    is_gtk4: bool,
    gtk_libs: []const []const u8,
    webkit_libs: []const []const u8,
};

/// Preference order: GTK4 + WebKitGTK 6, then GTK3 + WebKit2GTK 4.x.
pub const toolkit_pairs = [_]ToolkitPair{
    .{
        .label = "GTK4+webkitgtk-6.0",
        .is_gtk4 = true,
        .gtk_libs = &.{
            "libgtk-4.so",
            "libgtk-4.so.1",
        },
        .webkit_libs = &.{
            "libwebkitgtk-6.0.so",
            "libwebkitgtk-6.0.so.4",
        },
    },
    .{
        .label = "GTK3+webkit2gtk-4.x",
        .is_gtk4 = false,
        .gtk_libs = &.{
            "libgtk-3.so",
            "libgtk-3.so.0",
        },
        .webkit_libs = &.{
            "libwebkit2gtk-4.1.so",
            "libwebkit2gtk-4.1.so.0",
            "libwebkit2gtk-4.0.so",
            "libwebkit2gtk-4.0.so.37",
            "libwebkit2gtk-4.0.so.0",
        },
    },
};

pub fn gobjectLibraryCandidates() []const []const u8 {
    return &.{
        "libgobject-2.0.so",
        "libgobject-2.0.so.0",
    };
}

pub fn gioLibraryCandidates() []const []const u8 {
    return &.{
        "libgio-2.0.so",
        "libgio-2.0.so.0",
    };
}

/// True only for known-good major-line pairs (never GTK4+webkit2gtk-4.x etc.).
pub fn isCompatibleToolkitPair(gtk_name: []const u8, webkit_name: []const u8) bool {
    const gtk4 = std.mem.indexOf(u8, gtk_name, "gtk-4") != null;
    const gtk3 = std.mem.indexOf(u8, gtk_name, "gtk-3") != null;
    const wk6 = std.mem.indexOf(u8, webkit_name, "webkitgtk-6") != null;
    const wk2 = std.mem.indexOf(u8, webkit_name, "webkit2gtk-4") != null;
    if (gtk4 and wk6 and !wk2) return true;
    if (gtk3 and wk2 and !wk6) return true;
    return false;
}

/// Which preferred pair a library name belongs to (for diagnostics/tests).
pub fn pairLabelForGtkName(gtk_name: []const u8) ?[]const u8 {
    if (std.mem.indexOf(u8, gtk_name, "gtk-4") != null) return toolkit_pairs[0].label;
    if (std.mem.indexOf(u8, gtk_name, "gtk-3") != null) return toolkit_pairs[1].label;
    return null;
}

pub const DepKind = enum { gtk_webkit_pair, gobject, gio };

/// Human-readable install hint when a dependency class cannot be loaded.
pub fn dependencyInstallHint(os: TargetOs, kind: DepKind) []const u8 {
    return switch (os) {
        .freebsd => switch (kind) {
            // Flavors: webkit2-gtk_60 (GTK4) or webkit2-gtk_41 (GTK3).
            .gtk_webkit_pair => "pkg install gtk4 webkit2-gtk_60  (or gtk3 webkit2-gtk_41) — matching pair only",
            .gobject => "pkg install glib  (libgobject-2.0)",
            .gio => "pkg install glib  (libgio-2.0)",
        },
        .openbsd => switch (kind) {
            // OpenBSD: gtk+4 + webkitgtk60, or gtk+3 + webkitgtk4.
            .gtk_webkit_pair => "pkg_add gtk+4 webkitgtk60  (or gtk+3 webkitgtk4) — matching pair only",
            .gobject => "pkg_add glib2  (libgobject-2.0)",
            .gio => "pkg_add glib2  (libgio-2.0)",
        },
        .other => switch (kind) {
            .gtk_webkit_pair => "install a matching pair: GTK4+webkitgtk-6.0 or GTK3+webkit2gtk-4.x",
            .gobject => "install GLib/GObject runtime libraries",
            .gio => "install GLib/GIO runtime libraries",
        },
    };
}

/// Fail-closed stderr body when dynamic libraries are missing.
pub fn formatMissingDependencyError(
    allocator: std.mem.Allocator,
    os: TargetOs,
    kind: DepKind,
    tried: []const []const u8,
) ![]u8 {
    var list: std.ArrayList(u8) = .empty;
    errdefer list.deinit(allocator);
    try list.appendSlice(allocator, "error: Onyx native ");
    try list.appendSlice(allocator, os.label());
    try list.appendSlice(allocator, " desktop host could not load required ");
    try list.appendSlice(allocator, @tagName(kind));
    try list.appendSlice(allocator,
        \\ libraries.
        \\
        \\This is a Zig-native GTK/WebKitGTK host (not a portable-web/PWA bundle).
        \\Install a matching toolkit pair only:
        \\  GTK4 + webkitgtk-6.0   OR   GTK3 + webkit2gtk-4.1/4.0
        \\Never mix GTK4 with webkit2gtk-4.x, or GTK3 with webkitgtk-6.0.
        \\
        \\Hint: 
    );
    try list.appendSlice(allocator, dependencyInstallHint(os, kind));
    try list.appendSlice(allocator, "\n\nTried:\n");
    for (tried) |name| {
        try list.appendSlice(allocator, "  - ");
        try list.appendSlice(allocator, name);
        try list.appendSlice(allocator, "\n");
    }
    try list.appendSlice(allocator,
        \\
        \\No silent fallback to a browser-only launcher is provided.
        \\
    );
    return try list.toOwnedSlice(allocator);
}

/// Flat list of all library names tried for pair loading (diagnostics).
pub fn allPairLibraryNames(allocator: std.mem.Allocator) ![]const []const u8 {
    var list: std.ArrayList([]const u8) = .empty;
    errdefer list.deinit(allocator);
    for (toolkit_pairs) |pair| {
        for (pair.gtk_libs) |n| try list.append(allocator, n);
        for (pair.webkit_libs) |n| try list.append(allocator, n);
    }
    return try list.toOwnedSlice(allocator);
}

/// Resolve package root from the executable path: `.../bin/onyx` → `.../`.
pub fn packageRootFromExePath(exe_path: []const u8) ?[]const u8 {
    const dir = std.fs.path.dirname(exe_path) orelse return null;
    const base = std.fs.path.basename(dir);
    if (std.mem.eql(u8, base, "bin")) {
        return std.fs.path.dirname(dir);
    }
    // Dev / bare layout: resources next to the binary.
    return dir;
}

/// Join package root + relative dist candidate; returns path if `index.html` exists.
pub fn resolveDistDir(
    allocator: std.mem.Allocator,
    package_root: []const u8,
    access_fn: *const fn (path: []const u8) bool,
) !?[]u8 {
    for (dist_rel_paths) |rel| {
        const candidate = try std.fs.path.join(allocator, &.{ package_root, rel });
        defer allocator.free(candidate);
        const index = try std.fs.path.join(allocator, &.{ candidate, "index.html" });
        defer allocator.free(index);
        if (access_fn(index)) {
            return try allocator.dupe(u8, candidate);
        }
    }
    return null;
}

pub fn formatMissingDistError(allocator: std.mem.Allocator, package_root: []const u8) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        \\error: Onyx SPA resources missing under package root:
        \\  {s}
        \\
        \\Expected one of:
        \\  {s}/resources/dist/index.html
        \\  {s}/dist/index.html
        \\
        \\Package with: pnpm build && pnpm desktop:release:freebsd|openbsd
        \\(or zig build bsd-host -Dbsd-os=… then stage resources/dist).
        \\
    ,
        .{ package_root, package_root, package_root },
    );
}

pub fn unsupportedOsMessage(os: TargetOs) []const u8 {
    _ = os;
    return
        \\error: this Onyx binary is the FreeBSD/OpenBSD native desktop host.
        \\It was cross-compiled for x86_64-freebsd or x86_64-openbsd.
        \\Run the matching package on that OS with a matching GTK+WebKit pair installed.
        \\Do not expect GUI launch on Linux from this host binary.
        \\
    ;
}

// ── Loopback origin + HTTP asset mapping (pure) ─────────────────────────────

/// Fail-closed stderr when the fixed product loopback port cannot be bound.
/// Never suggests an alternate port (origin must stay stable for web storage).
pub fn formatLoopbackBindError(allocator: std.mem.Allocator) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        \\error: could not bind Onyx loopback SPA asset server on 127.0.0.1:{d}.
        \\Only one Onyx desktop host instance may use this product port.
        \\If another Onyx is already running, quit it first.
        \\If something else holds 127.0.0.1:{d}, free that port.
        \\No alternate port is chosen (localStorage/IndexedDB/session-resume origin must stay stable).
        \\
    ,
        .{ product_loopback_port, product_loopback_port },
    );
}

/// `http://127.0.0.1:<port>` — loopback IPv4 only (never 0.0.0.0 / localhost).
pub fn formatLoopbackOrigin(buf: []u8, port: u16) ![]u8 {
    if (port == 0) return error.InvalidPort;
    return std.fmt.bufPrint(buf, "http://127.0.0.1:{d}", .{port});
}

/// WebView entry URL: `http://127.0.0.1:<port>/app`.
pub fn formatAppEntryUrl(buf: []u8, port: u16) ![]u8 {
    if (port == 0) return error.InvalidPort;
    return std.fmt.bufPrint(buf, "http://127.0.0.1:{d}{s}", .{ port, spa_entry_path });
}

/// Contract checks for the loopback origin string (pure).
pub fn isLoopbackOrigin(origin: []const u8) bool {
    if (!std.mem.startsWith(u8, origin, "http://127.0.0.1:")) return false;
    const rest = origin["http://127.0.0.1:".len..];
    if (rest.len == 0) return false;
    // port only — no path, no trailing slash
    for (rest) |c| {
        if (c < '0' or c > '9') return false;
    }
    const port = std.fmt.parseInt(u16, rest, 10) catch return false;
    return port != 0;
}

pub fn isAppEntryUrl(url: []const u8) bool {
    if (!std.mem.startsWith(u8, url, "http://127.0.0.1:")) return false;
    const after_scheme = url["http://127.0.0.1:".len..];
    const slash = std.mem.indexOfScalar(u8, after_scheme, '/') orelse return false;
    const port_s = after_scheme[0..slash];
    if (port_s.len == 0) return false;
    for (port_s) |c| {
        if (c < '0' or c > '9') return false;
    }
    const port = std.fmt.parseInt(u16, port_s, 10) catch return false;
    if (port == 0) return false;
    return std.mem.eql(u8, after_scheme[slash..], spa_entry_path);
}

/// Normalize an HTTP request-target to a rooted path without `..`.
/// Rejects traversal, null bytes, backslashes, and non-origin-form targets.
pub fn normalizeRequestTarget(allocator: std.mem.Allocator, target: []const u8) error{ BadTarget, OutOfMemory }![]u8 {
    if (target.len == 0) return error.BadTarget;

    var path_end: usize = target.len;
    if (std.mem.indexOfScalar(u8, target, '?')) |q| path_end = @min(path_end, q);
    if (std.mem.indexOfScalar(u8, target, '#')) |h| path_end = @min(path_end, h);
    const path_raw = target[0..path_end];
    if (path_raw.len == 0 or path_raw[0] != '/') return error.BadTarget;

    // Percent-decode into a temporary buffer (worst case = path length).
    var decoded = try allocator.alloc(u8, path_raw.len);
    defer allocator.free(decoded);
    var di: usize = 0;
    var i: usize = 0;
    while (i < path_raw.len) {
        const c = path_raw[i];
        if (c == 0 or c == '\\') return error.BadTarget;
        if (c == '%' and i + 2 < path_raw.len) {
            const byte = std.fmt.parseInt(u8, path_raw[i + 1 .. i + 3], 16) catch return error.BadTarget;
            if (byte == 0 or byte == '\\') return error.BadTarget;
            decoded[di] = byte;
            di += 1;
            i += 3;
            continue;
        }
        if (c == '%') return error.BadTarget;
        decoded[di] = c;
        di += 1;
        i += 1;
    }
    const decoded_path = decoded[0..di];

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    try out.append(allocator, '/');
    var started = false;
    var it = std.mem.splitScalar(u8, decoded_path, '/');
    while (it.next()) |comp| {
        if (comp.len == 0 or std.mem.eql(u8, comp, ".")) continue;
        if (std.mem.eql(u8, comp, "..")) return error.BadTarget;
        if (std.mem.indexOfScalar(u8, comp, 0) != null) return error.BadTarget;
        if (started) try out.append(allocator, '/');
        try out.appendSlice(allocator, comp);
        started = true;
    }
    return try out.toOwnedSlice(allocator);
}

/// Strip leading `/` for joining under dist root; `"/"` → `""`.
pub fn relativePathFromNormalized(normalized: []const u8) []const u8 {
    if (normalized.len == 0 or std.mem.eql(u8, normalized, "/")) return "";
    if (normalized[0] == '/') return normalized[1..];
    return normalized;
}

/// True when the last path segment has a non-empty file extension.
pub fn hasFileExtension(rel_path: []const u8) bool {
    const base = std.fs.path.basename(rel_path);
    const dot = std.mem.lastIndexOfScalar(u8, base, '.') orelse return false;
    return dot > 0 and dot + 1 < base.len;
}

pub fn mimeTypeForPath(path: []const u8) []const u8 {
    if (std.mem.endsWith(u8, path, ".html") or std.mem.endsWith(u8, path, ".htm"))
        return "text/html; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".js") or std.mem.endsWith(u8, path, ".mjs"))
        return "text/javascript; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".css")) return "text/css; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".json") or std.mem.endsWith(u8, path, ".map"))
        return "application/json; charset=utf-8";
    if (std.mem.endsWith(u8, path, ".svg")) return "image/svg+xml";
    if (std.mem.endsWith(u8, path, ".png")) return "image/png";
    if (std.mem.endsWith(u8, path, ".jpg") or std.mem.endsWith(u8, path, ".jpeg"))
        return "image/jpeg";
    if (std.mem.endsWith(u8, path, ".webp")) return "image/webp";
    if (std.mem.endsWith(u8, path, ".gif")) return "image/gif";
    if (std.mem.endsWith(u8, path, ".ico")) return "image/x-icon";
    if (std.mem.endsWith(u8, path, ".woff2")) return "font/woff2";
    if (std.mem.endsWith(u8, path, ".woff")) return "font/woff";
    if (std.mem.endsWith(u8, path, ".ttf")) return "font/ttf";
    if (std.mem.endsWith(u8, path, ".wasm")) return "application/wasm";
    if (std.mem.endsWith(u8, path, ".txt")) return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

pub const AssetDecision = union(enum) {
    forbidden,
    not_found,
    file: []const u8,
    spa_fallback: []const u8,
};

/// Map a normalized request path to a serve decision (pure; `exists` is injected).
pub fn decideAsset(
    normalized: []const u8,
    entry_html: []const u8,
    exists: *const fn (rel: []const u8) bool,
) AssetDecision {
    const rel = relativePathFromNormalized(normalized);
    if (rel.len == 0) {
        if (exists(entry_html)) return .{ .spa_fallback = entry_html };
        return .not_found;
    }
    // Defense in depth: never allow absolute or parent segments through join.
    if (std.mem.indexOf(u8, rel, "..") != null) return .forbidden;
    if (std.mem.startsWith(u8, rel, "/") or std.mem.indexOfScalar(u8, rel, 0) != null)
        return .forbidden;

    if (exists(rel)) return .{ .file = rel };
    if (hasFileExtension(rel)) return .not_found;
    if (exists(entry_html)) return .{ .spa_fallback = entry_html };
    return .not_found;
}

// ── Loopback HTTP asset server ──────────────────────────────────────────────

const AssetServer = struct {
    io: std.Io,
    allocator: std.mem.Allocator,
    dist_dir: []const u8,
    entry_html: []const u8,
    server: net.Server,
    port: u16,
    stop: std.atomic.Value(bool) = .init(false),
    accept_future: ?std.Io.Future(void) = null,

    /// Heap-allocated so the accept thread has a stable pointer.
    /// Binds only `127.0.0.1:product_loopback_port` — never ephemeral, never another port.
    fn start(
        io: std.Io,
        allocator: std.mem.Allocator,
        dist_dir: []const u8,
        entry_html: []const u8,
    ) !*AssetServer {
        const addr: net.IpAddress = .{ .ip4 = .loopback(product_loopback_port) };
        // SO_REUSEADDR permits immediate restart after accepted connections
        // enter TIME_WAIT. SO_REUSEPORT stays disabled, so a second live
        // instance still fails closed on this product origin.
        var server = try addr.listen(io, .{
            .reuse_address = true,
            .kernel_backlog = 16,
        });
        errdefer server.deinit(io);

        const port = server.socket.address.getPort();
        if (port != product_loopback_port) return error.UnexpectedBoundPort;

        const self = try allocator.create(AssetServer);
        errdefer allocator.destroy(self);
        self.* = .{
            .io = io,
            .allocator = allocator,
            .dist_dir = dist_dir,
            .entry_html = entry_html,
            .server = server,
            .port = port,
        };

        self.accept_future = try std.Io.concurrent(io, serveLoop, .{self});
        return self;
    }

    fn shutdown(self: *AssetServer) void {
        const allocator = self.allocator;
        self.stop.store(true, .release);
        // Cancellation is the std.Io contract for interrupting a blocked
        // accept. Closing the descriptor from a foreign OS thread is not
        // sufficient on every backend and can hang application shutdown.
        if (self.accept_future) |*future| {
            future.cancel(self.io);
            self.accept_future = null;
        }
        self.server.deinit(self.io);
        allocator.destroy(self);
    }

    fn serveLoop(self: *AssetServer) void {
        while (!self.stop.load(.acquire)) {
            const stream = self.server.accept(self.io) catch {
                if (self.stop.load(.acquire)) return;
                continue;
            };
            self.handleConnection(stream);
        }
    }

    fn handleConnection(self: *AssetServer, stream: net.Stream) void {
        defer stream.close(self.io);

        var in_buf: [16 * 1024]u8 = undefined;
        var out_buf: [16 * 1024]u8 = undefined;
        var stream_reader = stream.reader(self.io, &in_buf);
        var stream_writer = stream.writer(self.io, &out_buf);
        var http_server = http.Server.init(&stream_reader.interface, &stream_writer.interface);

        const request = http_server.receiveHead() catch return;
        // Local mutable copy for respond (API takes *Request).
        var req = request;
        self.respondTo(&req) catch {
            req.respond("Internal Server Error\n", .{
                .status = .internal_server_error,
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/plain; charset=utf-8" },
                    .{ .name = "Connection", .value = "close" },
                },
            }) catch {};
        };
    }

    fn respondTo(self: *AssetServer, request: *http.Server.Request) !void {
        if (request.head.method != .GET and request.head.method != .HEAD) {
            try request.respond("Method Not Allowed\n", .{
                .status = .method_not_allowed,
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/plain; charset=utf-8" },
                    .{ .name = "Allow", .value = "GET, HEAD" },
                    .{ .name = "Connection", .value = "close" },
                },
            });
            return;
        }

        const normalized = normalizeRequestTarget(self.allocator, request.head.target) catch {
            try request.respond("Bad Request\n", .{
                .status = .bad_request,
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/plain; charset=utf-8" },
                    .{ .name = "Connection", .value = "close" },
                },
            });
            return;
        };
        defer self.allocator.free(normalized);

        const rel = relativePathFromNormalized(normalized);
        if (std.mem.indexOf(u8, rel, "..") != null or std.mem.startsWith(u8, rel, "/")) {
            try request.respond("Forbidden\n", .{
                .status = .forbidden,
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/plain; charset=utf-8" },
                    .{ .name = "Connection", .value = "close" },
                },
            });
            return;
        }

        const serve_rel: ?[]const u8 = blk: {
            if (rel.len == 0) {
                if (fileExistsUnder(self.dist_dir, self.entry_html)) break :blk self.entry_html;
                break :blk null;
            }
            if (fileExistsUnder(self.dist_dir, rel)) break :blk rel;
            if (hasFileExtension(rel)) break :blk null;
            if (fileExistsUnder(self.dist_dir, self.entry_html)) break :blk self.entry_html;
            break :blk null;
        };

        const path_rel = serve_rel orelse {
            try request.respond("Not Found\n", .{
                .status = .not_found,
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/plain; charset=utf-8" },
                    .{ .name = "Connection", .value = "close" },
                },
            });
            return;
        };

        const body = try readFileUnder(self.allocator, self.dist_dir, path_rel);
        defer self.allocator.free(body);

        const mime = mimeTypeForPath(path_rel);
        try request.respond(body, .{
            .status = .ok,
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = mime },
                .{ .name = "Cache-Control", .value = "no-cache" },
                .{ .name = "Connection", .value = "close" },
                .{ .name = "X-Content-Type-Options", .value = "nosniff" },
            },
        });
    }
};

fn fileExistsUnder(dist_dir: []const u8, rel: []const u8) bool {
    var path_buf: [std.Io.Dir.max_path_bytes]u8 = undefined;
    const path = if (rel.len == 0)
        dist_dir
    else
        std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ dist_dir, rel }) catch return false;
    const fd = posix.openat(posix.AT.FDCWD, path, .{ .ACCMODE = .RDONLY }, 0) catch return false;
    _ = posix.system.close(fd);
    return true;
}

fn readFileUnder(allocator: std.mem.Allocator, dist_dir: []const u8, rel: []const u8) ![]u8 {
    var path_buf: [std.Io.Dir.max_path_bytes]u8 = undefined;
    const path = try std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ dist_dir, rel });
    const fd = try posix.openat(posix.AT.FDCWD, path, .{ .ACCMODE = .RDONLY }, 0);
    defer _ = posix.system.close(fd);

    var list: std.ArrayList(u8) = .empty;
    errdefer list.deinit(allocator);
    var chunk: [64 * 1024]u8 = undefined;
    while (true) {
        const n = posix.read(fd, &chunk) catch |err| switch (err) {
            error.WouldBlock => continue,
            else => |e| return e,
        };
        if (n == 0) break;
        if (list.items.len + n > max_asset_bytes) return error.StreamTooLong;
        try list.appendSlice(allocator, chunk[0..n]);
    }
    return try list.toOwnedSlice(allocator);
}

// ── Dynamic GTK / WebKit loading (runtime only) ─────────────────────────────

const GtkApis = struct {
    gtk: std.DynLib,
    webkit: std.DynLib,
    gobject: std.DynLib,
    gio: std.DynLib,
    gtk_name: []const u8,
    webkit_name: []const u8,
    pair_label: []const u8,
    is_gtk4: bool,

    gtk_application_new: *const fn (app_id_z: [*:0]const u8, flags: c_int) callconv(.c) ?*anyopaque,
    gtk_application_window_new: *const fn (app: ?*anyopaque) callconv(.c) ?*anyopaque,
    gtk_window_set_title: *const fn (window: ?*anyopaque, title: [*:0]const u8) callconv(.c) void,
    gtk_window_set_default_size: *const fn (window: ?*anyopaque, w: c_int, h: c_int) callconv(.c) void,
    gtk_widget_show: *const fn (widget: ?*anyopaque) callconv(.c) void,
    gtk_widget_show_all: ?*const fn (widget: ?*anyopaque) callconv(.c) void,
    gtk_window_present: ?*const fn (window: ?*anyopaque) callconv(.c) void,
    gtk_container_add: ?*const fn (container: ?*anyopaque, widget: ?*anyopaque) callconv(.c) void,
    gtk_window_set_child: ?*const fn (window: ?*anyopaque, child: ?*anyopaque) callconv(.c) void,
    webkit_web_view_new: *const fn () callconv(.c) ?*anyopaque,
    webkit_web_view_load_uri: *const fn (view: ?*anyopaque, uri: [*:0]const u8) callconv(.c) void,
    g_application_run: *const fn (app: ?*anyopaque, argc: c_int, argv: ?[*]?[*:0]u8) callconv(.c) c_int,
    g_application_quit: *const fn (app: ?*anyopaque) callconv(.c) void,
    g_object_unref: *const fn (object: ?*anyopaque) callconv(.c) void,
    g_signal_connect_data: *const fn (
        instance: ?*anyopaque,
        detailed_signal: [*:0]const u8,
        c_handler: ?*const fn () callconv(.c) void,
        data: ?*anyopaque,
        destroy_data: ?*anyopaque,
        connect_flags: c_int,
    ) callconv(.c) c_ulong,

    fn close(self: *GtkApis) void {
        self.webkit.close();
        self.gtk.close();
        self.gio.close();
        self.gobject.close();
    }
};

fn openFirstLib(names: []const []const u8) ?struct { lib: std.DynLib, name: []const u8 } {
    for (names) |name| {
        if (std.DynLib.open(name)) |lib| {
            return .{ .lib = lib, .name = name };
        } else |_| {}
    }
    return null;
}

fn lookupRequired(lib: *std.DynLib, comptime T: type, name: [:0]const u8) !T {
    return lib.lookup(T, name) orelse error.MissingSymbol;
}

fn loadGtkApis(os: TargetOs) !GtkApis {
    _ = os;
    const gobject_open = openFirstLib(gobjectLibraryCandidates()) orelse return error.MissingGObject;
    var gobject = gobject_open.lib;
    errdefer gobject.close();

    const gio_open = openFirstLib(gioLibraryCandidates()) orelse return error.MissingGio;
    var gio = gio_open.lib;
    errdefer gio.close();

    var loaded_gtk: ?std.DynLib = null;
    var loaded_webkit: ?std.DynLib = null;
    var gtk_name: []const u8 = "";
    var webkit_name: []const u8 = "";
    var pair_label: []const u8 = "";
    var is_gtk4 = false;

    for (toolkit_pairs) |pair| {
        const gtk_open = openFirstLib(pair.gtk_libs) orelse continue;
        var gtk = gtk_open.lib;
        const wk_open = openFirstLib(pair.webkit_libs) orelse {
            gtk.close();
            continue;
        };
        var webkit = wk_open.lib;
        if (!isCompatibleToolkitPair(gtk_open.name, wk_open.name)) {
            webkit.close();
            gtk.close();
            continue;
        }
        loaded_gtk = gtk;
        loaded_webkit = webkit;
        gtk_name = gtk_open.name;
        webkit_name = wk_open.name;
        pair_label = pair.label;
        is_gtk4 = pair.is_gtk4;
        break;
    }

    var gtk = loaded_gtk orelse return error.MissingGtkWebkitPair;
    errdefer gtk.close();
    var webkit = loaded_webkit orelse return error.MissingGtkWebkitPair;
    errdefer webkit.close();

    // GtkApplication path — no gtk_main / gtk_main_quit (absent on GTK4).
    const gtk_application_new = try lookupRequired(
        &gtk,
        *const fn ([*:0]const u8, c_int) callconv(.c) ?*anyopaque,
        "gtk_application_new",
    );
    const gtk_application_window_new = try lookupRequired(
        &gtk,
        *const fn (?*anyopaque) callconv(.c) ?*anyopaque,
        "gtk_application_window_new",
    );
    const gtk_window_set_title = try lookupRequired(
        &gtk,
        *const fn (?*anyopaque, [*:0]const u8) callconv(.c) void,
        "gtk_window_set_title",
    );
    const gtk_window_set_default_size = try lookupRequired(
        &gtk,
        *const fn (?*anyopaque, c_int, c_int) callconv(.c) void,
        "gtk_window_set_default_size",
    );
    const gtk_widget_show = try lookupRequired(
        &gtk,
        *const fn (?*anyopaque) callconv(.c) void,
        "gtk_widget_show",
    );
    const gtk_widget_show_all = gtk.lookup(*const fn (?*anyopaque) callconv(.c) void, "gtk_widget_show_all");
    const gtk_window_present = gtk.lookup(*const fn (?*anyopaque) callconv(.c) void, "gtk_window_present");
    const gtk_container_add = gtk.lookup(*const fn (?*anyopaque, ?*anyopaque) callconv(.c) void, "gtk_container_add");
    const gtk_window_set_child = gtk.lookup(*const fn (?*anyopaque, ?*anyopaque) callconv(.c) void, "gtk_window_set_child");
    const webkit_web_view_new = try lookupRequired(
        &webkit,
        *const fn () callconv(.c) ?*anyopaque,
        "webkit_web_view_new",
    );
    const webkit_web_view_load_uri = try lookupRequired(
        &webkit,
        *const fn (?*anyopaque, [*:0]const u8) callconv(.c) void,
        "webkit_web_view_load_uri",
    );
    const g_application_run = try lookupRequired(
        &gio,
        *const fn (?*anyopaque, c_int, ?[*]?[*:0]u8) callconv(.c) c_int,
        "g_application_run",
    );
    const g_application_quit = try lookupRequired(
        &gio,
        *const fn (?*anyopaque) callconv(.c) void,
        "g_application_quit",
    );
    const g_object_unref = try lookupRequired(
        &gobject,
        *const fn (?*anyopaque) callconv(.c) void,
        "g_object_unref",
    );
    const g_signal_connect_data = try lookupRequired(
        &gobject,
        *const fn (?*anyopaque, [*:0]const u8, ?*const fn () callconv(.c) void, ?*anyopaque, ?*anyopaque, c_int) callconv(.c) c_ulong,
        "g_signal_connect_data",
    );

    if (is_gtk4 and gtk_window_set_child == null) return error.MissingSymbol;
    if (!is_gtk4 and gtk_container_add == null) return error.MissingSymbol;

    return .{
        .gtk = gtk,
        .webkit = webkit,
        .gobject = gobject,
        .gio = gio,
        .gtk_name = gtk_name,
        .webkit_name = webkit_name,
        .pair_label = pair_label,
        .is_gtk4 = is_gtk4,
        .gtk_application_new = gtk_application_new,
        .gtk_application_window_new = gtk_application_window_new,
        .gtk_window_set_title = gtk_window_set_title,
        .gtk_window_set_default_size = gtk_window_set_default_size,
        .gtk_widget_show = gtk_widget_show,
        .gtk_widget_show_all = gtk_widget_show_all,
        .gtk_window_present = gtk_window_present,
        .gtk_container_add = gtk_container_add,
        .gtk_window_set_child = gtk_window_set_child,
        .webkit_web_view_new = webkit_web_view_new,
        .webkit_web_view_load_uri = webkit_web_view_load_uri,
        .g_application_run = g_application_run,
        .g_application_quit = g_application_quit,
        .g_object_unref = g_object_unref,
        .g_signal_connect_data = g_signal_connect_data,
    };
}

const ActivateCtx = struct {
    apis: *GtkApis,
    uri_z: [:0]const u8,
    title_z: [:0]const u8,
    app: ?*anyopaque = null,
};

fn onActivate(app: ?*anyopaque, user_data: ?*anyopaque) callconv(.c) void {
    const ctx: *ActivateCtx = @ptrCast(@alignCast(user_data orelse return));
    const apis = ctx.apis;
    ctx.app = app;

    const window = apis.gtk_application_window_new(app) orelse return;
    apis.gtk_window_set_title(window, ctx.title_z.ptr);
    apis.gtk_window_set_default_size(window, 1280, 800);

    const view = apis.webkit_web_view_new() orelse return;
    if (apis.is_gtk4) {
        apis.gtk_window_set_child.?(window, view);
    } else {
        apis.gtk_container_add.?(window, view);
    }

    apis.webkit_web_view_load_uri(view, ctx.uri_z.ptr);

    // destroy: void (*)(GtkWidget *widget, gpointer user_data)
    _ = apis.g_signal_connect_data(
        window,
        "destroy",
        @ptrCast(&onWindowDestroy),
        ctx,
        null,
        0,
    );

    if (apis.gtk_widget_show_all) |show_all| {
        show_all(window);
    } else {
        apis.gtk_widget_show(view);
        apis.gtk_widget_show(window);
        if (apis.gtk_window_present) |present| present(window);
    }
}

fn onWindowDestroy(widget: ?*anyopaque, user_data: ?*anyopaque) callconv(.c) void {
    _ = widget;
    const ctx: *ActivateCtx = @ptrCast(@alignCast(user_data orelse return));
    if (ctx.app) |app| ctx.apis.g_application_quit(app);
}

fn dupeZ(allocator: std.mem.Allocator, s: []const u8) ![:0]u8 {
    return allocator.dupeSentinel(u8, s, 0);
}

fn writeDiag(io: std.Io, file: std.Io.File, msg: []const u8) void {
    file.writeStreamingAll(io, msg) catch {};
}

fn runNativeShell(init: std.process.Init, os: TargetOs, contract: LaunchContract) !void {
    const allocator = init.gpa;
    const io = init.io;
    const stderr = std.Io.File.stderr();
    const stdout = std.Io.File.stdout();

    if (os == .other) {
        writeDiag(io, stderr, unsupportedOsMessage(os));
        return error.UnsupportedOs;
    }

    const exe_path = std.process.executablePathAlloc(init.io, allocator) catch null;
    defer if (exe_path) |p| allocator.free(p);

    const package_root = if (exe_path) |p|
        packageRootFromExePath(p) orelse "."
    else
        ".";

    const Access = struct {
        fn exists(path: []const u8) bool {
            const fd = posix.openat(posix.AT.FDCWD, path, .{ .ACCMODE = .RDONLY }, 0) catch return false;
            _ = posix.system.close(fd);
            return true;
        }
    };

    const dist_dir = (try resolveDistDir(allocator, package_root, Access.exists)) orelse {
        const msg = try formatMissingDistError(allocator, package_root);
        defer allocator.free(msg);
        writeDiag(io, stderr, msg);
        return error.MissingDist;
    };
    defer allocator.free(dist_dir);

    var apis = loadGtkApis(os) catch |err| {
        const kind: DepKind = switch (err) {
            error.MissingGObject => .gobject,
            error.MissingGio => .gio,
            error.MissingGtkWebkitPair => .gtk_webkit_pair,
            else => .gtk_webkit_pair,
        };
        const tried = switch (kind) {
            .gobject => gobjectLibraryCandidates(),
            .gio => gioLibraryCandidates(),
            .gtk_webkit_pair => blk: {
                break :blk try allPairLibraryNames(allocator);
            },
        };
        defer if (kind == .gtk_webkit_pair) allocator.free(tried);
        const msg = try formatMissingDependencyError(allocator, os, kind, tried);
        defer allocator.free(msg);
        writeDiag(io, stderr, msg);
        return err;
    };
    defer apis.close();

    // Loopback-only asset server on fixed product port. No external launcher,
    // no ephemeral/alternate port (origin stability for web storage).
    const asset_server = AssetServer.start(io, allocator, dist_dir, contract.entry_html) catch {
        const msg = try formatLoopbackBindError(allocator);
        defer allocator.free(msg);
        writeDiag(io, stderr, msg);
        return error.LoopbackPortInUse;
    };
    defer asset_server.shutdown();

    var url_buf: [64]u8 = undefined;
    const entry_url = try formatAppEntryUrl(&url_buf, asset_server.port);
    if (!isAppEntryUrl(entry_url)) return error.InvalidEntryUrl;

    const uri_z = try dupeZ(allocator, entry_url);
    defer allocator.free(uri_z);
    const title_z = try dupeZ(allocator, contract.window_title);
    defer allocator.free(title_z);

    var act_ctx: ActivateCtx = .{
        .apis = &apis,
        .uri_z = uri_z,
        .title_z = title_z,
    };

    const app = apis.gtk_application_new(app_id, 0) orelse return error.ApplicationCreateFailed;
    defer apis.g_object_unref(app);

    _ = apis.g_signal_connect_data(
        app,
        "activate",
        @ptrCast(&onActivate),
        &act_ctx,
        null,
        0,
    );

    writeDiag(io, stdout, "onyx-bsd-host: pair ");
    writeDiag(io, stdout, apis.pair_label);
    writeDiag(io, stdout, " (");
    writeDiag(io, stdout, apis.gtk_name);
    writeDiag(io, stdout, " + ");
    writeDiag(io, stdout, apis.webkit_name);
    writeDiag(io, stdout, ")\nonyx-bsd-host: spa ");
    writeDiag(io, stdout, entry_url);
    writeDiag(io, stdout, "\n");

    _ = apis.g_application_run(app, 0, null);
}

pub fn main(init: std.process.Init) !void {
    const os = TargetOs.fromBuiltin();
    try runNativeShell(init, os, default_launch_contract);
}

// ── Tests (host-native; pure logic only — no fabricated BSD GUI claims) ─────

test "launch contract names onyx resources/dist and /app entry" {
    try std.testing.expectEqualStrings("onyx", default_launch_contract.exe_name);
    try std.testing.expectEqualStrings("resources/dist", default_launch_contract.resources_dist);
    try std.testing.expectEqualStrings("index.html", default_launch_contract.entry_html);
    try std.testing.expectEqualStrings(app_name, default_launch_contract.window_title);
    try std.testing.expectEqualStrings("/app", default_launch_contract.web_entry_path);
}

test "package root strips bin/ parent" {
    const root = packageRootFromExePath("/opt/onyx/bin/onyx") orelse unreachable;
    try std.testing.expectEqualStrings("/opt/onyx", root);
    const bare = packageRootFromExePath("/opt/onyx/onyx") orelse unreachable;
    try std.testing.expectEqualStrings("/opt/onyx", bare);
}

test "resolveDistDir prefers resources/dist" {
    const allocator = std.testing.allocator;
    const Fake = struct {
        fn access(path: []const u8) bool {
            return std.mem.endsWith(u8, path, "resources/dist/index.html");
        }
    };
    const got = try resolveDistDir(allocator, "/pkg", Fake.access);
    defer if (got) |p| allocator.free(p);
    try std.testing.expect(got != null);
    try std.testing.expectEqualStrings("/pkg/resources/dist", got.?);
}

test "resolveDistDir falls back to dist" {
    const allocator = std.testing.allocator;
    const Fake = struct {
        fn access(path: []const u8) bool {
            return std.mem.endsWith(u8, path, "/dist/index.html") and
                std.mem.indexOf(u8, path, "resources") == null;
        }
    };
    const got = try resolveDistDir(allocator, "/pkg", Fake.access);
    defer if (got) |p| allocator.free(p);
    try std.testing.expect(got != null);
    try std.testing.expectEqualStrings("/pkg/dist", got.?);
}

test "resolveDistDir fail-closed when missing" {
    const allocator = std.testing.allocator;
    const Fake = struct {
        fn access(_: []const u8) bool {
            return false;
        }
    };
    const got = try resolveDistDir(allocator, "/pkg", Fake.access);
    try std.testing.expect(got == null);
}

test "missing dependency error is fail-closed and not portable-web" {
    const allocator = std.testing.allocator;
    const tried = try allPairLibraryNames(allocator);
    defer allocator.free(tried);
    const msg = try formatMissingDependencyError(
        allocator,
        .freebsd,
        .gtk_webkit_pair,
        tried,
    );
    defer allocator.free(msg);
    try std.testing.expect(std.mem.indexOf(u8, msg, "could not load required gtk_webkit_pair") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "pkg install") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "portable-web") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "No silent fallback") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "Never mix GTK4") != null);
}

test "openbsd install hints differ from freebsd" {
    const obsd = dependencyInstallHint(.openbsd, .gtk_webkit_pair);
    const fbsd = dependencyInstallHint(.freebsd, .gtk_webkit_pair);
    try std.testing.expect(std.mem.indexOf(u8, obsd, "pkg_add") != null);
    try std.testing.expect(std.mem.indexOf(u8, obsd, "webkitgtk60") != null);
    try std.testing.expect(std.mem.indexOf(u8, obsd, "webkitgtk4") != null);
    try std.testing.expect(std.mem.indexOf(u8, obsd, "gtk+4") != null);
    try std.testing.expect(std.mem.indexOf(u8, fbsd, "pkg install") != null);
    try std.testing.expect(std.mem.indexOf(u8, fbsd, "webkit2-gtk_60") != null);
    try std.testing.expect(std.mem.indexOf(u8, fbsd, "webkit2-gtk_41") != null);
}

test "compatible lib pairing accepts only matched majors" {
    try std.testing.expect(isCompatibleToolkitPair("libgtk-4.so.1", "libwebkitgtk-6.0.so.4"));
    try std.testing.expect(isCompatibleToolkitPair("libgtk-3.so.0", "libwebkit2gtk-4.1.so.0"));
    try std.testing.expect(isCompatibleToolkitPair("libgtk-3.so", "libwebkit2gtk-4.0.so.37"));
    try std.testing.expect(!isCompatibleToolkitPair("libgtk-4.so", "libwebkit2gtk-4.1.so"));
    try std.testing.expect(!isCompatibleToolkitPair("libgtk-3.so", "libwebkitgtk-6.0.so"));
    try std.testing.expect(!isCompatibleToolkitPair("libgtk-4.so", "libwebkit2gtk-4.0.so"));
    try std.testing.expectEqualStrings("GTK4+webkitgtk-6.0", pairLabelForGtkName("libgtk-4.so.1").?);
    try std.testing.expectEqualStrings("GTK3+webkit2gtk-4.x", pairLabelForGtkName("libgtk-3.so.0").?);
    try std.testing.expect(toolkit_pairs.len == 2);
}

test "target os labels and triples" {
    try std.testing.expectEqualStrings("FreeBSD", TargetOs.freebsd.label());
    try std.testing.expectEqualStrings("OpenBSD", TargetOs.openbsd.label());
    try std.testing.expectEqualStrings("x86_64-freebsd", TargetOs.freebsd.zigTriple());
    try std.testing.expectEqualStrings("x86_64-openbsd", TargetOs.openbsd.zigTriple());
}

test "unsupported os message rejects linux execution claims" {
    const msg = unsupportedOsMessage(.other);
    try std.testing.expect(std.mem.indexOf(u8, msg, "Do not expect GUI launch on Linux") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "x86_64-freebsd") != null);
}

test "missing dist error mentions resources/dist" {
    const allocator = std.testing.allocator;
    const msg = try formatMissingDistError(allocator, "/pkg/root");
    defer allocator.free(msg);
    try std.testing.expect(std.mem.indexOf(u8, msg, "resources/dist/index.html") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "desktop:release") != null);
}

test "product loopback port is fixed high unprivileged constant" {
    try std.testing.expectEqual(@as(u16, 42691), product_loopback_port);
    // Unprivileged: above well-known (<1024) and typical ephemeral range start.
    try std.testing.expect(product_loopback_port > 1024);
}

test "loopback origin contract rejects non-loopback and requires port" {
    var buf: [64]u8 = undefined;
    const origin = try formatLoopbackOrigin(&buf, product_loopback_port);
    try std.testing.expectEqualStrings("http://127.0.0.1:42691", origin);
    try std.testing.expect(isLoopbackOrigin(origin));
    try std.testing.expect(!isLoopbackOrigin("http://localhost:42691"));
    try std.testing.expect(!isLoopbackOrigin("http://0.0.0.0:42691"));
    try std.testing.expect(!isLoopbackOrigin("http://127.0.0.1:42691/"));
    try std.testing.expect(!isLoopbackOrigin("http://127.0.0.1:0"));
    try std.testing.expect(!isLoopbackOrigin("file:///tmp/index.html"));
    try std.testing.expect(formatLoopbackOrigin(&buf, 0) == error.InvalidPort);

    const app_url = try formatAppEntryUrl(&buf, product_loopback_port);
    try std.testing.expectEqualStrings("http://127.0.0.1:42691/app", app_url);
    try std.testing.expect(isAppEntryUrl(app_url));
    try std.testing.expect(!isAppEntryUrl("http://127.0.0.1:42691/"));
    try std.testing.expect(!isAppEntryUrl("http://127.0.0.1:42691/app/"));
    try std.testing.expect(!isAppEntryUrl("file:///app"));
}

test "loopback bind error is fail-closed single-instance and names fixed port" {
    const allocator = std.testing.allocator;
    const msg = try formatLoopbackBindError(allocator);
    defer allocator.free(msg);
    try std.testing.expect(std.mem.indexOf(u8, msg, "127.0.0.1:42691") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "No alternate port") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "localStorage") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "IndexedDB") != null);
    try std.testing.expect(std.mem.indexOf(u8, msg, "session-resume") != null);
}

test "normalizeRequestTarget strips query and rejects traversal" {
    const allocator = std.testing.allocator;

    const a = try normalizeRequestTarget(allocator, "/app");
    defer allocator.free(a);
    try std.testing.expectEqualStrings("/app", a);

    const b = try normalizeRequestTarget(allocator, "/assets/foo.js?v=1");
    defer allocator.free(b);
    try std.testing.expectEqualStrings("/assets/foo.js", b);

    // ".." component must be rejected (including percent-encoded).
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, "/assets/../secret"));
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, "/assets/%2e%2e/secret"));
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, "/assets/%2E%2E/secret"));
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, "../etc/passwd"));
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, "app"));
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, "/assets\\x"));
    try std.testing.expectError(error.BadTarget, normalizeRequestTarget(allocator, ""));

    const root = try normalizeRequestTarget(allocator, "/");
    defer allocator.free(root);
    try std.testing.expectEqualStrings("/", root);

    const dotted = try normalizeRequestTarget(allocator, "/./foo/./bar");
    defer allocator.free(dotted);
    try std.testing.expectEqualStrings("/foo/bar", dotted);
}

test "MIME types for SPA assets" {
    try std.testing.expectEqualStrings("text/html; charset=utf-8", mimeTypeForPath("index.html"));
    try std.testing.expectEqualStrings("text/javascript; charset=utf-8", mimeTypeForPath("assets/index-abc.js"));
    try std.testing.expectEqualStrings("text/css; charset=utf-8", mimeTypeForPath("assets/index.css"));
    try std.testing.expectEqualStrings("application/wasm", mimeTypeForPath("codec.wasm"));
    try std.testing.expectEqualStrings("image/svg+xml", mimeTypeForPath("icon.svg"));
    try std.testing.expectEqualStrings("application/octet-stream", mimeTypeForPath("noext"));
}

test "SPA fallback vs static file vs missing extension" {
    const Exists = struct {
        fn exists(rel: []const u8) bool {
            return std.mem.eql(u8, rel, "index.html") or
                std.mem.eql(u8, rel, "assets/app.js");
        }
    };

    const root = decideAsset("/", "index.html", Exists.exists);
    try std.testing.expect(root == .spa_fallback);
    try std.testing.expectEqualStrings("index.html", root.spa_fallback);

    const app = decideAsset("/app", "index.html", Exists.exists);
    try std.testing.expect(app == .spa_fallback);

    const js = decideAsset("/assets/app.js", "index.html", Exists.exists);
    try std.testing.expect(js == .file);
    try std.testing.expectEqualStrings("assets/app.js", js.file);

    const missing_js = decideAsset("/assets/missing.js", "index.html", Exists.exists);
    try std.testing.expect(missing_js == .not_found);

    const deep_route = decideAsset("/settings/profile", "index.html", Exists.exists);
    try std.testing.expect(deep_route == .spa_fallback);

    try std.testing.expect(hasFileExtension("assets/x.js"));
    try std.testing.expect(!hasFileExtension("app"));
    try std.testing.expect(!hasFileExtension(".hidden"));
}

test "loopback asset server serves the packaged SPA on the stable origin" {
    const allocator = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    try tmp.dir.writeFile(std.testing.io, .{
        .sub_path = "index.html",
        .data = "<!doctype html><title>Onyx BSD native smoke</title>",
    });

    var dist_path_buf: [256]u8 = undefined;
    const dist_path = try std.fmt.bufPrint(
        &dist_path_buf,
        ".zig-cache/tmp/{s}",
        .{tmp.sub_path[0..]},
    );

    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    const server = try AssetServer.start(io, allocator, dist_path, "index.html");
    defer server.shutdown();
    try std.testing.expectEqual(product_loopback_port, server.port);

    const address: net.IpAddress = .{ .ip4 = .loopback(product_loopback_port) };
    const stream = try net.IpAddress.connect(&address, io, .{
        .mode = .stream,
        .protocol = .tcp,
    });
    defer stream.close(io);

    var write_buffer: [512]u8 = undefined;
    var writer = stream.writer(io, &write_buffer);
    try writer.interface.writeAll(
        "GET /app HTTP/1.1\r\nHost: 127.0.0.1:42691\r\nConnection: close\r\n\r\n",
    );
    try writer.interface.flush();

    var read_buffer: [4096]u8 = undefined;
    var response_storage: [4096]u8 = undefined;
    var reader = stream.reader(io, &read_buffer);
    const response_len = try reader.interface.readSliceShort(&response_storage);
    const response = response_storage[0..response_len];
    try std.testing.expect(std.mem.startsWith(u8, response, "HTTP/1.1 200"));
    try std.testing.expect(std.mem.indexOf(u8, response, "Onyx BSD native smoke") != null);
}

test "relativePathFromNormalized" {
    try std.testing.expectEqualStrings("", relativePathFromNormalized("/"));
    try std.testing.expectEqualStrings("app", relativePathFromNormalized("/app"));
    try std.testing.expectEqualStrings("assets/x.js", relativePathFromNormalized("/assets/x.js"));
}
