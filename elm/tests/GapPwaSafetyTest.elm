module GapPwaSafetyTest exposing (suite)

{-| v3/gap-pwa-safety — closed-tab push reachable from the first-run
Turn on and the Notifications sheet (oracle `armClosedTabNotifications`
/ `YouNotifications`), the enable toggle settling when an active check
wins the race, and the page-restore reconcile (oracle
`installConnectPageLifecycle`). DM key-safety vectors live in
`DmSafetyTest`; the service-worker registration and push timeouts are
ports-side (`polish.smoke.mjs`, `webPush.smoke.mjs`).
-}

import App exposing (..)
import Expect
import Html
import Html.Attributes as Attr
import Isupport
import Notify
import Push
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


vapid : String
vapid =
    "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A"


{-| Signed in, live, on a server that advertises VAPID. -}
signedIn : Model
signedIn =
    { blank
        | accountName = Just "kai"
        , ourNick = "kai"
        , endpoint = Just "wss://irc.example"
        , isupport = Isupport.applyIsupportToken blank.isupport "VAPID" vapid
    }


{-| The first-run sheet's Turn on is waiting on the permission prompt. -}
asking : Model -> Model
asking model =
    let
        p =
            model.polish
    in
    { model | polish = { p | notifyBusy = True }, notifyPermission = Notify.Default }


query : Model -> Query.Single Msg
query model =
    View.view model |> .body |> Html.div [] |> Query.fromHtml


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


status : Bool -> Bool -> Maybe String -> String
status busy on error =
    Push.statusCopy { busy = busy, on = on, error = error }


suite : Test
suite =
    describe "v3/gap-pwa-safety"
        [ firstRun
        , notifySheet
        , toggleRace
        , pageRestore
        ]


firstRun : Test
firstRun =
    describe "first-run Turn on arms closed-tab push"
        [ test "a grant on a signed-in live session chains the WebPushToggle machine" <|
            \_ ->
                let
                    ( armed, out ) =
                        update (NotifyPermissionChanged "granted") (asking signedIn)
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member WebPushProbe out)
                    , \_ -> Expect.equal True armed.webPushBusy
                    , \_ -> Expect.equal False armed.polish.notifyBusy
                    , \_ -> Expect.equal True armed.polish.notifyDismissed
                    , -- the push result toast reports instead of the desktop-only one
                      \_ -> Expect.equal False (List.any (\t -> t.title == "Notifications allowed") armed.toasts)
                    ]
                    ()
        , test "the probe answer then enables push for the owner" <|
            \_ ->
                let
                    armed =
                        Tuple.first (update (NotifyPermissionChanged "granted") (asking signedIn))

                    ( _, out ) =
                        update (WebPushProbed { supported = True, permission = "granted" }) armed
                in
                Expect.equal [ WebPushEnable { serverUrl = "wss://irc.example", account = "kai", vapidKey = vapid } ] out
        , test "without VAPID (or signed out) the grant stays desktop-only" <|
            \_ ->
                let
                    noVapid =
                        update (NotifyPermissionChanged "granted") (asking { signedIn | isupport = blank.isupport })

                    guest =
                        update (NotifyPermissionChanged "granted") (asking blank)
                in
                Expect.all
                    [ \_ -> Expect.equal False (List.member WebPushProbe (Tuple.second noVapid))
                    , \_ -> Expect.equal (Just "Notifications allowed") (List.head (Tuple.first noVapid).toasts |> Maybe.map .title)
                    , \_ -> Expect.equal False (List.member WebPushProbe (Tuple.second guest))
                    ]
                    ()
        , test "a denial never touches push" <|
            \_ ->
                update (NotifyPermissionChanged "denied") (asking signedIn)
                    |> Tuple.second
                    |> List.member WebPushProbe
                    |> Expect.equal False
        ]


notifySheet : Test
notifySheet =
    describe "Notifications sheet closed-tab row"
        [ test "the toggle drives WebPushToggle for a signed-in owner" <|
            \_ ->
                query { signedIn | notifySheetOpen = True }
                    |> Query.find [ testid "notify-push-toggle" ]
                    |> Event.simulate Event.click
                    |> Event.expect WebPushToggle
        , test "status copy follows the push machine" <|
            \_ ->
                Expect.all
                    [ \_ -> query { signedIn | notifySheetOpen = True } |> Query.find [ testid "notify-push-status" ] |> Query.has [ Selector.text "Push is off." ]
                    , \_ -> query { signedIn | notifySheetOpen = True, webPushOn = True } |> Query.find [ testid "notify-push-status" ] |> Query.has [ Selector.text "Push is on for this browser." ]
                    , \_ -> query { signedIn | notifySheetOpen = True, webPushBusy = True } |> Query.find [ testid "notify-push-toggle" ] |> Query.has [ Selector.disabled True ]
                    , \_ ->
                        query { signedIn | notifySheetOpen = True, webPushOn = True }
                            |> Query.find [ testid "notify-push-toggle" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "aria-pressed" "true") ]
                    ]
                    ()
        , test "guests see why, not a dead toggle" <|
            \_ ->
                Expect.all
                    [ \_ -> query { blank | notifySheetOpen = True } |> Query.find [ testid "notify-push-toggle" ] |> Query.has [ Selector.disabled True ]
                    , \_ -> query { blank | notifySheetOpen = True } |> Query.has [ Selector.text "Sign in to get mentions, DMs, and calls when the tab is closed." ]
                    ]
                    ()
        , test "the Account panel and the sheet share one status line" <|
            \_ ->
                Expect.equal
                    [ status True False Nothing
                    , status True True Nothing
                    , status False False (Just "gone")
                    , status False True Nothing
                    , status False False Nothing
                    ]
                    [ "Turning on…", "Turning off…", "gone", "Push is on for this browser.", "Push is off." ]
        ]


toggleRace : Test
toggleRace =
    describe "enable vs active check"
        [ test "an active check that lands mid-enable settles the toggle instead of sticking" <|
            \_ ->
                let
                    ( settled, out ) =
                        update (WebPushProbed { supported = True, permission = "granted" }) { signedIn | webPushBusy = True, webPushOn = True }
                in
                Expect.all
                    [ \_ -> Expect.equal [] out
                    , \_ -> Expect.equal False settled.webPushBusy
                    , \_ -> Expect.equal True settled.webPushOn
                    ]
                    ()
        ]


pageRestore : Test
pageRestore =
    let
        offline =
            { signedIn | connection = Offline, autoReconnect = True }
    in
    describe "page restore (bfcache / freeze)"
        [ test "an offline session with auto-reconnect redials at once" <|
            \_ ->
                update (PageRestored { online = True }) { offline | reconnectAttempts = 3, reconnectDueMs = 99999 }
                    |> Expect.all
                        [ Tuple.second >> Expect.equal [ WsConnect { url = "wss://irc.example" } ]
                        , Tuple.first >> .reconnectAttempts >> Expect.equal 0
                        ]
        , test "live, mid-handshake, browser offline or a deliberate disconnect: nothing" <|
            \_ ->
                Expect.equal
                    [ Tuple.second (update (PageRestored { online = True }) { offline | connection = Live })
                    , Tuple.second (update (PageRestored { online = True }) { offline | connection = Registering })
                    , Tuple.second (update (PageRestored { online = False }) offline)
                    , Tuple.second (update (PageRestored { online = True }) { offline | autoReconnect = False })
                    ]
                    [ [], [], [], [] ]
        ]
