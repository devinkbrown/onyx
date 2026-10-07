module NotifyTest exposing (suite)

{-| Vectors for the notification decision engine, mirroring
`src/lib/notifications/decision.test.ts` (base rules) and the
`decision.contract.test.ts` base-rule half: inactive grants, focus /
permission / dnd / self suppression, independent throttles, non-alert
kinds, mute axes, and the default throttle windows.
-}

import Expect
import Notify exposing (..)
import Test exposing (Test, describe, test)


base : NotifyDecisionInput
base =
    { kind = Mention
    , isSelf = False
    , muted = False
    , smartMuted = False
    , pushEnabled = True
    , soundEnabled = True
    , dnd = False
    , permission = Granted
    , pageVisible = False
    , appFocused = False
    , nowMs = 10000
    , lastDesktopAtMs = Nothing
    , lastSoundAtMs = Nothing
    , desktopThrottleMs = Nothing
    , soundThrottleMs = Nothing
    }


flags : NotifyDecision -> ( Bool, Bool )
flags d =
    ( d.desktop, d.sound )


reasons : NotifyDecision -> ( String, String )
reasons d =
    ( d.desktopReason, d.soundReason )


desk : NotifyDecision -> ( Bool, String )
desk d =
    ( d.desktop, d.desktopReason )


deskSoundReason : NotifyDecision -> ( Bool, String )
deskSoundReason d =
    ( d.desktop, d.soundReason )


suite : Test
suite =
    describe "Notify.shouldNotify"
        [ test "allows desktop and sound for mentions while the app is inactive" <|
            \_ ->
                Expect.equal
                    { desktop = True, sound = True, desktopReason = "ok", soundReason = "ok" }
                    (shouldNotify base)
        , test "allows DM, follow, and call alerts through the same inactive path" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal ( True, True )
                            (flags (shouldNotify { base | kind = Dm }))
                    , \_ ->
                        Expect.equal ( True, True )
                            (flags (shouldNotify { base | kind = Follow }))
                    , \_ ->
                        Expect.equal ( True, True )
                            (flags (shouldNotify { base | kind = Call }))
                    ]
                    ()
        , test "suppresses alerts while focused" <|
            \_ ->
                Expect.equal
                    { desktop = False, sound = False, desktopReason = "focused", soundReason = "focused" }
                    (shouldNotify { base | pageVisible = True, appFocused = True })
        , test "a half-visible app still alerts" <|
            \_ ->
                Expect.equal ( True, True )
                    (flags (shouldNotify { base | pageVisible = True }))
        , test "denied permission kills desktop but spares sound" <|
            \_ ->
                Expect.equal
                    { desktop = False, sound = True, desktopReason = "permission", soundReason = "ok" }
                    (shouldNotify { base | permission = Denied })
        , test "default permission kills desktop but spares sound" <|
            \_ ->
                Expect.equal ( "permission", True )
                    ((\d -> ( d.desktopReason, d.sound )) (shouldNotify { base | permission = Default }))
        , test "unsupported platform reports unsupported desktop" <|
            \_ ->
                Expect.equal ( False, "unsupported" )
                    (desk (shouldNotify { base | permission = Unsupported }))
        , test "dnd suppresses both channels" <|
            \_ ->
                Expect.equal
                    { desktop = False, sound = False, desktopReason = "dnd", soundReason = "dnd" }
                    (shouldNotify { base | dnd = True })
        , test "own echoed messages never alert" <|
            \_ ->
                Expect.equal
                    { desktop = False, sound = False, desktopReason = "self", soundReason = "self" }
                    (shouldNotify { base | isSelf = True })
        , test "muted and smart-muted axes both suppress" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal ( "muted", "muted" )
                            (reasons (shouldNotify { base | muted = True }))
                    , \_ ->
                        Expect.equal ( "muted", "muted" )
                            (reasons (shouldNotify { base | smartMuted = True }))
                    ]
                    ()
        , test "non-alert kinds never alert" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal ( False, "not-message-alert" )
                            (desk (shouldNotify { base | kind = System }))
                    , \_ ->
                        Expect.equal ( False, "not-message-alert" )
                            (desk (shouldNotify { base | kind = Error }))
                    ]
                    ()
        , test "disabled switches report disabled per channel" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal ( False, True )
                            (flags (shouldNotify { base | pushEnabled = False }))
                    , \_ ->
                        Expect.equal ( "disabled", "ok" )
                            (reasons (shouldNotify { base | pushEnabled = False }))
                    , \_ ->
                        Expect.equal ( True, "disabled" )
                            (deskSoundReason (shouldNotify { base | soundEnabled = False }))
                    ]
                    ()
        , test "desktop and sound throttle independently" <|
            \_ ->
                Expect.equal
                    { desktop = False, sound = False, desktopReason = "throttled", soundReason = "throttled" }
                    (shouldNotify
                        { base
                            | lastDesktopAtMs = Just 9500
                            , lastSoundAtMs = Just 9500
                            , desktopThrottleMs = Just 1000
                            , soundThrottleMs = Just 800
                        }
                    )
        , test "default throttle windows are 6000 and 1500" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal "ok"
                            (.desktopReason (shouldNotify { base | lastDesktopAtMs = Just 3000, nowMs = 10000 }))
                    , \_ ->
                        Expect.equal "throttled"
                            (.desktopReason (shouldNotify { base | lastDesktopAtMs = Just 5000, nowMs = 10999 }))
                    , \_ ->
                        Expect.equal "ok"
                            (.soundReason (shouldNotify { base | lastSoundAtMs = Just 8000, nowMs = 10000 }))
                    , \_ ->
                        Expect.equal "throttled"
                            (.soundReason (shouldNotify { base | lastSoundAtMs = Just 9000, nowMs = 10499 }))
                    ]
                    ()
        , test "a fresh throttle stamp passes at exactly the window" <|
            \_ ->
                Expect.equal ( "ok", "ok" )
                    (reasons (shouldNotify { base | lastDesktopAtMs = Just 4000, lastSoundAtMs = Just 8500, nowMs = 10000 }))
        ]
