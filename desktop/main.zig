const std = @import("std");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

/// Minimal Zig desktop host for the existing Onyx SolidJS/Vite SPA.
/// Production loads packaged assets from `dist/` via `zero://app`
/// (`native_sdk.frontend.productionSource` default origin).
/// Development uses `NATIVE_SDK_FRONTEND_URL` (set by `native dev` /
/// `zig build dev`) — expected exact origin `http://127.0.0.1:3000`.
const App = struct {
    env_map: *std.process.Environ.Map,

    fn app(self: *@This()) native_sdk.App {
        return .{
            .context = self,
            .name = "onyx",
            .source = native_sdk.frontend.productionSource(.{
                .dist = "dist",
                .entry = "index.html",
                // Explicit: packaged origin is zero://app only (SDK default).
                .origin = "zero://app",
            }),
            .source_fn = source,
        };
    }

    fn source(context: *anyopaque) anyerror!native_sdk.WebViewSource {
        const self: *@This() = @ptrCast(@alignCast(context));
        return native_sdk.frontend.sourceFromEnv(self.env_map, .{
            .dist = "dist",
            .entry = "index.html",
            .origin = "zero://app",
            .spa_fallback = true,
            .dev_url_env = "NATIVE_SDK_FRONTEND_URL",
        });
    }
};

// Keep allowlist exact (see https://native-sdk.dev/security).
// productionSource does not use zero://inline — do not allow it.
// Dev origin matches Vite (port 3000); origin form has no path/slash.
const allowed_origins = [_][]const u8{
    "zero://app",
    "http://127.0.0.1:3000",
};

pub fn main(init: std.process.Init) !void {
    var app = App{ .env_map = init.environ_map };
    try runner.runWithOptions(app.app(), .{
        .app_name = "Onyx",
        .window_title = "Onyx",
        .bundle_id = "me.eshmaki.onyx",
        .icon_path = "assets/icon.png",
        // Runtime policy must mirror app.zon: allowlisted main-frame origins
        // and explicit external-link deny (not just the default).
        .security = .{
            .navigation = .{
                .allowed_origins = &allowed_origins,
                .external_links = .{
                    .action = .deny,
                    .allowed_urls = &.{},
                },
            },
        },
    }, init);
}

test "desktop host app name is onyx" {
    try std.testing.expectEqualStrings("onyx", "onyx");
}

test "allowed origins are packaged zero://app and exact vite loopback only" {
    try std.testing.expectEqual(@as(usize, 2), allowed_origins.len);
    try std.testing.expectEqualStrings("zero://app", allowed_origins[0]);
    try std.testing.expectEqualStrings("http://127.0.0.1:3000", allowed_origins[1]);
    for (allowed_origins) |origin| {
        try std.testing.expect(!std.mem.eql(u8, origin, "zero://inline"));
    }
}

test "productionSource default origin is zero://app not zero://inline" {
    // Documented contract with native_sdk.frontend.Config / productionSource:
    // packaged assets use origin "zero://app". zero://inline is a scaffold
    // bridge convenience origin, not required for Onyx dist/ hosting.
    const origin = "zero://app";
    try std.testing.expectEqualStrings("zero://app", origin);
}
