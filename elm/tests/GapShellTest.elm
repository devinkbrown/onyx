module GapShellTest exposing (suite)

{-| v3/gap-shell vectors (wire lines in, model + outbound out):
sign-in failures (wrong password, registered name, taken name with the
onyx-server post-001 collision), server ERROR/KILL reasons, the Activity
log, unknown standard replies and error numerics, join denials,
browser lifecycle, join focus, Leave with confirm and the room More
actions. Server shapes are from onyx-server `src/daemon/server.zig`
(`registerConnNick`, `performKillDisconnect`, `handleWelcome`) and
`dispatch.zig` (`saslFail`).
-}

import App exposing (..)
import Dict
import Expect
import GapShell exposing (ActivityFilter(..), ConnectFailure(..), EntryKind(..))
import Html
import Html.Attributes
import Time
import Json.Encode as Encode
import Route
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import Wire


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


feedM : String -> Model -> Model
feedM line model =
    Tuple.first (feed model line)


run : List Msg -> Model -> ( Model, List Outbound )
run msgs model =
    List.foldl
        (\msg ( m, outs ) ->
            let
                ( next, out ) =
                    update msg m
            in
            ( next, outs ++ out )
        )
        ( model, [] )
        msgs


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


{-| The connect gate, armed, before any dial. -}
gate : Model
gate =
    { blank
        | connectGate = True
        , route = Route.App
        , connection = Offline
        , autoReconnect = False
        , ourNick = "kai"
        , endpoint = Just "wss://x"
        , nowMs = 1000
    }
        |> (\m -> { m | connectForm = { blankConnectForm | nick = "kai", attempted = True } })


{-| A session that has been live a while (reconnect semantics). -}
settledLive : Model
settledLive =
    let
        gs =
            blank.gapShell
    in
    { blank
        | connectGate = True
        , ourNick = "kai"
        , autoReconnect = True
        , endpoint = Just "wss://x"
        , nowMs = 50000
        , gapShell = { gs | everLive = True, liveSinceMs = 1000 }
    }


hasWsConnect : List Outbound -> Bool
hasWsConnect =
    List.any
        (\o ->
            case o of
                WsConnect _ ->
                    True

                _ ->
                    False
        )


errorTexts : Model -> List String
errorTexts model =
    List.filterMap
        (\n ->
            if n.kind == NotifError then
                Just n.text

            else
                Nothing
        )
        model.notifications


toastTitles : Model -> List String
toastTitles model =
    List.map .title model.toasts


withRoom : String -> Model -> Model
withRoom room model =
    feedM (":" ++ model.ourNick ++ "!u@h JOIN " ++ room) model


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


suite : Test
suite =
    describe "v3/gap-shell"
        [ signIn
        , nickCollision
        , serverClose
        , activity
        , replies
        , lifecycle
        , joinFocus
        , roomActions
        , views
        , pure
        ]


signIn : Test
signIn =
    describe "sign-in failures"
        [ test "a refused password reaches the inbox and the gate, and disarms reconnect" <|
            \_ ->
                let
                    pending =
                        { gate | connection = Registering, capNegotiating = True, sasl = SaslPending Wire.Plain, saslAccount = Just "kai", autoReconnect = True }

                    ( failed, out ) =
                        feed pending ":s 904 kai :SASL authentication failed"

                    ( closed, closeOut ) =
                        update (WsClosed { clean = False, reason = "" }) failed
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member WsDisconnect out)
                    , \_ -> Expect.equal False failed.autoReconnect
                    , \_ -> Expect.equal (Just FailPassword) failed.gapShell.connectFailure
                    , \_ -> Expect.equal [ "Sign-in failed. That name and password didn’t match an account. Check them and sign in again." ] (errorTexts failed)
                    , \_ -> Expect.equal 0 closed.reconnectDueMs
                    , \_ -> Expect.equal False (hasWsConnect closeOut)
                    , \_ -> Expect.equal True (connectGateVisible closed)
                    , \_ -> Expect.equal "That name and password didn’t match an account. Check them and sign in again." (connectStatusMessage closed)
                    ]
                    ()
        , test "the server's two-step 904 reason is kept" <|
            \_ ->
                let
                    pending =
                        { gate | connection = Registering, sasl = SaslPending Wire.Plain }

                    ( failed, _ ) =
                        feed pending ":s 904 kai :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>"
                in
                Expect.equal (Just FailTwoStep) failed.gapShell.connectFailure
        , test "a sign-in timeout says so" <|
            \_ ->
                Expect.equal (Just FailSaslTimeout)
                    (step SaslTimeout { gate | connection = Registering, sasl = SaslPending Wire.Plain }).gapShell.connectFailure
        , test "a stray 904 (no exchange) neither disarms nor blames the password" <|
            \_ ->
                let
                    ( m, out ) =
                        feed settledLive ":s 904 kai :whatever"
                in
                Expect.all
                    [ \_ -> Expect.equal True m.autoReconnect
                    , \_ -> Expect.equal Nothing m.gapShell.connectFailure
                    , \_ -> Expect.equal [] out
                    ]
                    ()
        , test "a registered name: guidance, close, no reconnect, and Sign in as" <|
            \_ ->
                let
                    registering =
                        { gate | connection = Registering }

                    ( refused, out ) =
                        feed registering ":s 432 kai kai :Nickname is registered; authenticate as this account before using it"

                    closed =
                        step (WsClosed { clean = True, reason = "" }) refused

                    signIn_ =
                        step ConnectSignInAs closed
                in
                Expect.all
                    [ \_ -> Expect.equal [ WsDisconnect ] out
                    , \_ -> Expect.equal [ "That nickname is registered. Sign in as its account before using it." ] (errorTexts refused)
                    , \_ -> Expect.equal (Just (FailRegisteredNick "kai")) refused.gapShell.connectFailure
                    , \_ -> Expect.equal "“kai” belongs to an account. Sign in to use it, or pick another name." (connectStatusMessage closed)
                    , \_ -> Expect.equal ConnectSignIn signIn_.connectForm.mode
                    , \_ -> Expect.equal "kai" signIn_.connectForm.nick
                    , \_ -> Expect.equal ConnectIdle (connectPhase signIn_)
                    ]
                    ()
        , test "a live /nick to a registered name says it is registered" <|
            \_ ->
                Expect.equal [ "“Admin” belongs to an account. Sign in as it to use that name." ]
                    (errorTexts (feedM ":s 432 kai Admin :Nickname is registered; authenticate as this account before using it" settledLive))
        , test "a fresh submit clears the last attempt's failure" <|
            \_ ->
                let
                    gs =
                        gate.gapShell

                    failed =
                        { gate | gapShell = { gs | connectFailure = Just FailPassword, nickRetries = 2 } }
                in
                Expect.equal Nothing (step ConnectSubmit failed).gapShell.connectFailure
        ]


nickCollision : Test
nickCollision =
    describe "taken name (onyx-server checks it after 001, then closes)"
        [ test "433 for our own name right after 001 redials as nick_ with the gate up" <|
            \_ ->
                let
                    ( opened, _ ) =
                        update (WsOpened { url = "wss://x" }) gate

                    welcomed =
                        feedM ":s 001 kai :Welcome to the Onyx network, kai" opened

                    ( collided, out ) =
                        feed welcomed ":s 433 kai kai :Nickname is already in use"

                    ( closed, closeOut ) =
                        update (WsClosed { clean = False, reason = "" }) collided

                    ( reopened, openOut ) =
                        update (WsOpened { url = "wss://x" }) closed
                in
                Expect.all
                    [ \_ -> Expect.equal [ WsDisconnect ] out
                    , \_ -> Expect.equal "kai_" collided.ourNick
                    , \_ -> Expect.equal False collided.autoReconnect
                    , \_ -> Expect.equal [] (errorTexts collided)
                    , \_ -> Expect.equal True (List.member (WsConnect { url = "wss://x" }) closeOut)
                    , \_ -> Expect.equal ConnectConnecting (connectPhase closed)
                    , \_ -> Expect.equal True (connectGateVisible closed)
                    , \_ -> Expect.equal 0 closed.reconnectDueMs
                    , \_ -> Expect.equal True (List.member (SendLine "NICK kai_\r\n") openOut)
                    , \_ -> Expect.equal False reopened.gapShell.redialing
                    ]
                    ()
        , test "001 and 433 in one frame batch behave the same" <|
            \_ ->
                let
                    ( opened, _ ) =
                        update (WsOpened { url = "wss://x" }) gate

                    ( collided, out ) =
                        update (WsBatchReceived { at = 2000, lines = [ ":s 001 kai :Welcome", ":s 433 kai kai :Nickname is already in use" ] }) opened
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member WsDisconnect out)
                    , \_ -> Expect.equal "kai_" collided.ourNick
                    , \_ -> Expect.equal True collided.gapShell.redialOnClose
                    ]
                    ()
        , test "success on the suffix: the welcome settles, a toast explains, counters reset" <|
            \_ ->
                let
                    gs =
                        gate.gapShell

                    retrying =
                        { gate | connection = Registering, ourNick = "kai_", gapShell = { gs | nickRetries = 1, nickRetryBase = Just "kai" } }

                    settled =
                        retrying
                            |> feedM ":s 001 kai_ :Welcome"
                            |> feedM ":s 376 kai_ :End of /MOTD command."
                in
                Expect.all
                    [ \_ -> Expect.equal [ "“kai” is taken right now" ] (toastTitles settled)
                    , \_ -> Expect.equal 0 settled.gapShell.nickRetries
                    , \_ -> Expect.equal True settled.gapShell.everLive
                    , \_ -> Expect.equal True settled.autoReconnect
                    ]
                    ()
        , test "four suffixes taken: fail with a clear reason, no more dials" <|
            \_ ->
                let
                    gs =
                        gate.gapShell

                    exhausted =
                        { gate | connection = Live, ourNick = "kai____", gapShell = { gs | nickRetries = 4, nickRetryBase = Just "kai" } }

                    ( failed, out ) =
                        feed exhausted ":s 433 kai____ kai____ :Nickname is already in use"

                    ( closed, closeOut ) =
                        update (WsClosed { clean = False, reason = "" }) failed
                in
                Expect.all
                    [ \_ -> Expect.equal [ WsDisconnect ] out
                    , \_ -> Expect.equal (Just (FailNickTaken "kai")) failed.gapShell.connectFailure
                    , \_ -> Expect.equal False (hasWsConnect closeOut)
                    , \_ -> Expect.equal "Someone is using “kai” right now, and the nearby names are taken too. Pick another name." (connectStatusMessage closed)
                    ]
                    ()
        , test "a reconnect collision keeps the shell and auto-reconnect" <|
            \_ ->
                let
                    ( collided, out ) =
                        feed settledLive ":s 433 kai kai :Nickname is already in use"
                in
                Expect.all
                    [ \_ -> Expect.equal [ WsDisconnect ] out
                    , \_ -> Expect.equal True collided.autoReconnect
                    , \_ -> Expect.equal "kai_" collided.ourNick
                    ]
                    ()
        , test "437 (nick delay) in the tail retries too" <|
            \_ ->
                Expect.equal "kai_" (feedM ":s 437 kai kai :Nick is held (nick delay); try again shortly" settledLive).ourNick
        , test "a reserved name in the tail fails without retrying" <|
            \_ ->
                let
                    ( failed, out ) =
                        feed settledLive ":s 432 kai kai :Nickname is reserved"
                in
                Expect.all
                    [ \_ -> Expect.equal [ WsDisconnect ] out
                    , \_ -> Expect.equal (Just (FailNickRefused "kai" "Nickname is reserved")) failed.gapShell.connectFailure
                    , \_ -> Expect.equal False failed.autoReconnect
                    ]
                    ()
        ]


serverClose : Test
serverClose =
    describe "server ERROR / KILL"
        [ test "a kill stops reconnecting, keeps the shell and says why" <|
            \_ ->
                let
                    ( killed, _ ) =
                        feed settledLive ":s ERROR :Closing Link: kai (Killed (opr (spamming)))"

                    closed =
                        step (WsClosed { clean = True, reason = "" }) killed
                in
                Expect.all
                    [ \_ -> Expect.equal False killed.autoReconnect
                    , \_ -> Expect.equal (Just "An operator disconnected you: spamming (opr).") killed.gapShell.halt
                    , \_ -> Expect.equal [ "An operator disconnected you: spamming (opr)." ] (errorTexts killed)
                    , \_ -> Expect.equal [ "Disconnected by the server" ] (toastTitles killed)
                    , \_ -> Expect.equal 0 closed.reconnectDueMs
                    , \_ -> Expect.equal False (connectGateVisible closed)
                    , \_ -> Expect.equal (Just "Disconnected by the server") (Maybe.map .title (reconnectBanner closed))
                    , \_ -> Expect.equal "Server error: Closing Link: kai (Killed (opr (spamming)))" (Maybe.withDefault "" (List.head killed.serviceLog))
                    ]
                    ()
        , test "the KILL line notifies once; the following ERROR does not repeat it" <|
            \_ ->
                let
                    killed =
                        settledLive
                            |> feedM ":opr!o@staff KILL kai :spamming"
                            |> feedM ":s ERROR :Closing Link: kai (Killed (opr (spamming)))"
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (List.length (errorTexts killed))
                    , \_ -> Expect.equal True killed.gapShell.killed
                    , \_ -> Expect.equal False killed.autoReconnect
                    ]
                    ()
        , test "a KILL for someone else is ignored" <|
            \_ ->
                Expect.equal True (feedM ":opr!o@staff KILL zed :bye" settledLive).autoReconnect
        , test "a ban on first connect explains on the gate" <|
            \_ ->
                let
                    registering =
                        { gate | connection = Registering }

                    closed =
                        registering
                            |> feedM ":s ERROR :Closing Link: kai (Banned: raid)"
                            |> step (WsClosed { clean = True, reason = "" })
                in
                Expect.all
                    [ \_ -> Expect.equal True (connectGateVisible closed)
                    , \_ -> Expect.equal "This connection is banned from Onyx: raid." (connectStatusMessage closed)
                    ]
                    ()
        , test "a ping timeout still reconnects, with the reason in the banner" <|
            \_ ->
                let
                    closed =
                        settledLive
                            |> feedM ":s ERROR :Ping timeout"
                            |> step (WsClosed { clean = False, reason = "" })
                in
                Expect.all
                    [ \_ -> Expect.equal True closed.autoReconnect
                    , \_ -> Expect.equal True (closed.reconnectDueMs > 0)
                    , \_ ->
                        Expect.equal True
                            (Maybe.map (.detail >> String.startsWith "The server closed the connection: Ping timeout.") (reconnectBanner closed) == Just True)
                    ]
                    ()
        , test "the halt clears on Try again and a new session" <|
            \_ ->
                let
                    halted =
                        settledLive
                            |> feedM ":s ERROR :Closing Link: kai (Banned: raid)"
                            |> step (WsClosed { clean = True, reason = "" })

                    ( retried, out ) =
                        update ReconnectNow halted
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing retried.gapShell.halt
                    , \_ -> Expect.equal True (hasWsConnect out)
                    ]
                    ()
        ]


activity : Test
activity =
    describe "Activity log"
        [ test "server notices, MOTD and errors are stamped with time and kind" <|
            \_ ->
                let
                    m =
                        { settledLive | nowMs = 7000 }
                            |> feedM ":irc.onyx.test NOTICE kai :mesh: 2 nodes linked"
                            |> feedM ":s ERROR :Ping timeout"
                in
                Expect.equal
                    [ { atMs = 7000, text = "Server error: Ping timeout", kind = Connection }
                    , { atMs = 7000, text = "mesh: 2 nodes linked", kind = Notice }
                    ]
                    (List.take 2 m.gapShell.activity)
        , test "the Problems filter keeps problems and connection events" <|
            \_ ->
                let
                    entries =
                        [ { atMs = 1, text = "a", kind = Notice }, { atMs = 2, text = "b", kind = Problem }, { atMs = 3, text = "c", kind = Connection } ]
                in
                Expect.equal [ "b", "c" ] (List.map .text (GapShell.activityRows ActivityProblems entries))
        , test "opening marks problems seen and closes the You hub" <|
            \_ ->
                let
                    m =
                        { settledLive | youHubOpen = True, nowMs = 9000 }
                            |> feedM ":s ERROR :Ping timeout"

                    opened =
                        step (GapShellMsg GapShell.ActivityOpen) m
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (GapShell.unseenProblems m.gapShell)
                    , \_ -> Expect.equal 0 (GapShell.unseenProblems opened.gapShell)
                    , \_ -> Expect.equal False opened.youHubOpen
                    , \_ -> Expect.equal (Just (GapShellMsg GapShell.ActivityClose)) (escapeMsg opened)
                    ]
                    ()
        , test "the onboarding welcome pack is collected once" <|
            \_ ->
                let
                    m =
                        settledLive
                            |> feedM ":irc.onyx.test NOTICE kai :WELCOME :Say hi in #lounge"
                            |> feedM ":irc.onyx.test NOTICE kai :WELCOME :Read the house rules"
                            |> feedM ":irc.onyx.test NOTICE kai :WELCOME: end of pack"
                            |> feedM ":irc.onyx.test NOTICE kai :WELCOME :Say hi in #lounge"
                            |> feedM ":irc.onyx.test NOTICE kai :[Welcome] Glad you're here"
                in
                Expect.equal [ "Say hi in #lounge", "Read the house rules", "Glad you're here" ] m.gapShell.welcomePack
        , test "dismissing the MOTD hides it for the day and stores the time" <|
            \_ ->
                let
                    m =
                        { settledLive | motd = Just "Good evening, kai!", showMotd = True, nowMs = 100000 }

                    ( dismissed, out ) =
                        update (GapShellMsg GapShell.MotdDismiss) m
                in
                Expect.all
                    [ \_ -> Expect.equal [ ShellStore { key = "motd-dismissed-at", value = "100000" } ] out
                    , \_ -> Expect.equal False dismissed.showMotd
                    , \_ -> Expect.equal False (GapShell.motdVisible 200000 dismissed.gapShell)
                    , \_ -> Expect.equal True (GapShell.motdVisible (100000 + GapShell.motdHideMs + 1) dismissed.gapShell)
                    ]
                    ()
        ]


replies : Test
replies =
    describe "unclaimed replies are never silent"
        [ test "an unknown FAIL becomes an inbox error" <|
            \_ ->
                Expect.equal [ "FROBNICATE failed: Channel is not registered (CHANNEL_UNKNOWN)" ]
                    (errorTexts (feedM ":s FAIL FROBNICATE CHANNEL_UNKNOWN #x :Channel is not registered" settledLive))
        , test "an unknown NOTE goes to Activity only" <|
            \_ ->
                let
                    m =
                        feedM ":s NOTE SEEN INFO zed :zed was last seen 2h ago" settledLive
                in
                Expect.all
                    [ \_ -> Expect.equal [] (errorTexts m)
                    , \_ -> Expect.equal (Just "SEEN: zed was last seen 2h ago (INFO)") (List.head m.serviceLog)
                    ]
                    ()
        , test "Activity files FAIL and WARN under Problems and NOTE as a plain notice" <|
            \_ ->
                let
                    kindOf line =
                        feedM line settledLive |> .gapShell |> .activity |> List.head |> Maybe.map .kind
                in
                Expect.all
                    [ \_ -> Expect.equal (Just Problem) (kindOf ":s FAIL FROBNICATE CHANNEL_UNKNOWN #x :Channel is not registered")
                    , \_ -> Expect.equal (Just Problem) (kindOf ":s WARN SEEN SLOW :seen index is catching up")
                    , \_ -> Expect.equal (Just Notice) (kindOf ":s NOTE SEEN INFO zed :zed was last seen 2h ago")
                    ]
                    ()
        , test "an unknown WARN is an inbox error too" <|
            \_ ->
                Expect.equal [ "SEEN warning: seen index is catching up (SLOW)" ]
                    (errorTexts (feedM ":s WARN SEEN SLOW :seen index is catching up" settledLive))
        , test "an unhandled error numeric reaches the inbox; an info numeric does not" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "foo Help topic not found" ] (errorTexts (feedM ":s 524 kai foo :Help topic not found" settledLive))
                    , \_ -> Expect.equal [] (errorTexts (feedM ":s 315 kai #c :End of /WHO list." settledLive))
                    ]
                    ()
        , test "FAIL SESSION is an inbox error, except the calm resume refusals" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "no such session list" ] (errorTexts (feedM ":s FAIL SESSION LIST :no such session list" settledLive))
                    , \_ -> Expect.equal [] (errorTexts (feedM ":s FAIL SESSION INVALID_TOKEN :stale bearer" settledLive))
                    , \_ -> Expect.equal [] (errorTexts (feedM ":s FAIL SESSION NO_SESSION :nothing to resume" settledLive))
                    ]
                    ()
        , test "a +a room denial answers the join prompt" <|
            \_ ->
                let
                    m =
                        feedM ":s 477 kai #vip :Cannot join channel (+a) - you must be authenticated" settledLive
                in
                Expect.all
                    [ \_ -> Expect.equal (Just { channel = "#vip", error = "Sign in to an account to join this room." }) m.channelJoinPrompt
                    , \_ -> Expect.equal [ "#vip: Sign in to an account to join this room." ] (errorTexts m)
                    ]
                    ()
        , test "477 for a +R person is a plain error, not a join prompt" <|
            \_ ->
                let
                    m =
                        feedM ":s 477 kai zed :Cannot message this user (+R: identify to a registered account)" settledLive
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing m.channelJoinPrompt
                    , \_ -> Expect.equal [ "zed Cannot message this user (+R: identify to a registered account)" ] (errorTexts m)
                    ]
                    ()
        , test "operator-only and TLS-only rooms say so" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "Only network operators can join this room.") (Maybe.map .error (feedM ":s 520 kai #ops :Cannot join channel (+O) - IRC operator required" settledLive).channelJoinPrompt)
                    , \_ -> Expect.equal (Just "This room only allows secure connections.") (Maybe.map .error (feedM ":s 489 kai #tls :Cannot join channel (+S) - TLS required" settledLive).channelJoinPrompt)
                    ]
                    ()
        ]


shellEvent : String -> List ( String, Encode.Value ) -> Msg
shellEvent name fields =
    GapShellMsg (GapShell.ShellEventReceived (Encode.object (( "event", Encode.string name ) :: fields)))


lifecycle : Test
lifecycle =
    describe "browser lifecycle"
        [ test "offline drops the socket, holds the countdown; online reconnects at once" <|
            \_ ->
                let
                    live =
                        { settledLive | connection = Live }

                    ( offline, offOut ) =
                        update (shellEvent "offline" [ ( "online", Encode.bool False ) ]) live

                    closed =
                        step (WsClosed { clean = False, reason = "" }) offline

                    ( ticked, tickOut ) =
                        update (Tick (Time.millisToPosix 999999999)) closed

                    ( back, backOut ) =
                        update (shellEvent "online" [ ( "online", Encode.bool True ) ]) ticked
                in
                Expect.all
                    [ \_ -> Expect.equal [ WsDisconnect ] offOut
                    , \_ -> Expect.equal (Just "You’re offline") (Maybe.map .title (reconnectBanner closed))
                    , \_ -> Expect.equal False (hasWsConnect tickOut)
                    , \_ -> Expect.equal True (hasWsConnect backOut)
                    , \_ -> Expect.equal False back.gapShell.browserOffline
                    ]
                    ()
        , test "boot carries online state, the hang label and the MOTD dismissal" <|
            \_ ->
                let
                    booted =
                        step
                            (shellEvent "boot"
                                [ ( "online", Encode.bool False )
                                , ( "hangLabel", Encode.string "Saturday 4:00 PM" )
                                , ( "motdDismissedAt", Encode.float 12345 )
                                ]
                            )
                            blank
                in
                Expect.all
                    [ \_ -> Expect.equal True booted.gapShell.browserOffline
                    , \_ -> Expect.equal "Saturday 4:00 PM" booted.createHangLabel
                    , \_ -> Expect.equal 12345 booted.gapShell.motdDismissedAt
                    ]
                    ()
        , test "an offline gate says so" <|
            \_ ->
                let
                    gs =
                        gate.gapShell
                in
                Expect.equal "You’re offline. Connect to the internet, then try again."
                    (connectStatusMessage { gate | gapShell = { gs | browserOffline = True } })
        ]


joinFocus : Test
joinFocus =
    describe "joins the person asked for open the room"
        [ test "/join opens the room when the echo lands" <|
            \_ ->
                let
                    inLounge =
                        withRoom "#lounge" settledLive
                            |> step (ChannelSelect "#lounge")

                    ( sent, out ) =
                        update ComposerSend { inLounge | composer = "/join #fresh" }

                    joined =
                        feedM ":kai!u@h JOIN #fresh" sent
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (SendLine "JOIN #fresh\r\n") out)
                    , \_ -> Expect.equal [ "#fresh" ] sent.gapShell.focusJoins
                    , \_ -> Expect.equal (Just "#fresh") joined.activeChannel
                    , \_ -> Expect.equal [] joined.gapShell.focusJoins
                    ]
                    ()
        , test "a JOIN nobody asked for (rejoin, server-forced) never steals focus" <|
            \_ ->
                let
                    inLounge =
                        withRoom "#lounge" settledLive
                            |> step (ChannelSelect "#lounge")
                in
                Expect.equal (Just "#lounge") (feedM ":kai!u@h JOIN #other" inLounge).activeChannel
        , test "/join of a room already joined switches to it at once" <|
            \_ ->
                let
                    m =
                        settledLive
                            |> withRoom "#lounge"
                            |> withRoom "#design"
                            |> step (ChannelSelect "#lounge")
                in
                Expect.equal (Just "#design") (step ComposerSend { m | composer = "/join #design" }).activeChannel
        , test "opening an invite joins and focuses the room" <|
            \_ ->
                let
                    invited =
                        feedM ":opr!o@h INVITE kai #vip" settledLive

                    id =
                        Maybe.withDefault "" (Maybe.map .id (List.head invited.notifications))

                    ( accepted, out ) =
                        update (NotificationActivated id) invited

                    joined =
                        feedM ":kai!u@h JOIN #vip" accepted
                in
                Expect.all
                    [ \_ -> Expect.equal True (List.member (SendLine "JOIN #vip\r\n") out)
                    , \_ -> Expect.equal (Just "#vip") joined.activeChannel
                    ]
                    ()
        , test "the rail's join field: validates, opens known rooms, joins new ones" <|
            \_ ->
                let
                    base =
                        withRoom "#lounge" settledLive

                    bad =
                        base
                            |> step (GapShellMsg (GapShell.JoinNameInput "two words"))
                            |> step (GapShellMsg GapShell.JoinNameSubmit)

                    known =
                        base
                            |> step (GapShellMsg (GapShell.JoinNameInput "lounge"))
                            |> step (GapShellMsg GapShell.JoinNameSubmit)

                    ( fresh, freshOut ) =
                        base
                            |> step (GapShellMsg (GapShell.JoinNameInput "#new"))
                            |> update (GapShellMsg GapShell.JoinNameSubmit)
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "Room names have no spaces or commas.") bad.gapShell.joinError
                    , \_ -> Expect.equal (Just "#lounge") known.activeChannel
                    , \_ -> Expect.equal "" known.gapShell.joinName
                    , \_ -> Expect.equal [ SendLine "JOIN #new\r\n" ] freshOut
                    , \_ -> Expect.equal (Just "#new") (feedM ":kai!u@h JOIN #new" fresh).activeChannel
                    ]
                    ()
        ]


roomActions : Test
roomActions =
    describe "room More actions"
        [ test "Leave asks first, then PARTs; the echo drops the room" <|
            \_ ->
                let
                    inLounge =
                        withRoom "#lounge" settledLive
                            |> step (ChannelSelect "#lounge")
                            |> step RoomMenuToggle

                    asked =
                        step (GapShellMsg (GapShell.LeaveAsk "#lounge")) inLounge

                    ( left, out ) =
                        update (GapShellMsg GapShell.LeaveConfirm) asked

                    parted =
                        feedM ":kai!u@h PART #lounge :Goodbye" left
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "#lounge") asked.gapShell.leaveAsk
                    , \_ -> Expect.equal False asked.roomMenuOpen
                    , \_ -> Expect.equal (Just (GapShellMsg GapShell.LeaveCancel)) (escapeMsg asked)
                    , \_ -> Expect.equal [ SendLine "PART #lounge Goodbye\r\n" ] out
                    , \_ -> Expect.equal [ "Left #lounge" ] (toastTitles left)
                    , \_ -> Expect.equal False (Dict.member "#lounge" parted.channels)
                    ]
                    ()
        , test "Stay keeps the room" <|
            \_ ->
                let
                    asked =
                        withRoom "#lounge" settledLive |> step (GapShellMsg (GapShell.LeaveAsk "#lounge"))

                    ( stayed, out ) =
                        update (GapShellMsg GapShell.LeaveCancel) asked
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing stayed.gapShell.leaveAsk
                    , \_ -> Expect.equal [] out
                    , \_ -> Expect.equal True (Dict.member "#lounge" stayed.channels)
                    ]
                    ()
        , test "leaving while offline drops the room locally (no rejoin later)" <|
            \_ ->
                let
                    offline =
                        (\r -> { r | connection = Offline }) (withRoom "#lounge" settledLive)

                    ( left, out ) =
                        offline
                            |> step (GapShellMsg (GapShell.LeaveAsk "#lounge"))
                            |> update (GapShellMsg GapShell.LeaveConfirm)
                in
                Expect.all
                    [ \_ -> Expect.equal [] out
                    , \_ -> Expect.equal False (Dict.member "#lounge" left.channels)
                    ]
                    ()
        , test "Mark as read clears the badges" <|
            \_ ->
                let
                    m =
                        withRoom "#lounge" settledLive
                            |> (\x -> { x | channels = Dict.update "#lounge" (Maybe.map (\c -> { c | unread = 3, highlights = 1 })) x.channels })

                    marked =
                        step (GapShellMsg (GapShell.MarkRead "#lounge")) m
                in
                Expect.equal (Just ( 0, 0 )) (Maybe.map (\c -> ( c.unread, c.highlights )) (Dict.get "#lounge" marked.channels))
        , test "Export transcript downloads and keeps the composer draft" <|
            \_ ->
                let
                    m =
                        withRoom "#lounge" settledLive
                            |> step (ChannelSelect "#lounge")
                            |> (\x -> { x | composer = "half a thought" })

                    ( exported, out ) =
                        update (GapShellMsg (GapShell.ExportTranscript "#lounge")) m
                in
                Expect.all
                    [ \_ -> Expect.equal "half a thought" exported.composer
                    , \_ ->
                        Expect.equal True
                            (List.any
                                (\o ->
                                    case o of
                                        TranscriptDownload _ ->
                                            True

                                        _ ->
                                            False
                                )
                                out
                            )
                    ]
                    ()
        ]


views : Test
views =
    describe "views"
        [ test "the room More menu carries the new actions" <|
            \_ ->
                withRoom "#lounge" settledLive
                    |> step (ChannelSelect "#lounge")
                    |> step RoomMenuToggle
                    |> query
                    |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "room-more-menu") ]
                    |> Expect.all
                        [ Query.has [ Selector.attribute (Html.Attributes.attribute "data-testid" "ribbon-leave-room") ]
                        , Query.has [ Selector.attribute (Html.Attributes.attribute "data-testid" "ribbon-export-transcript") ]
                        , Query.has [ Selector.attribute (Html.Attributes.attribute "data-testid" "ribbon-channel-ledger") ]
                        ]
        , test "the leave confirm names the room" <|
            \_ ->
                withRoom "#lounge" settledLive
                    |> step (GapShellMsg (GapShell.LeaveAsk "#lounge"))
                    |> query
                    |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "harbor-confirm") ]
                    |> Query.has [ Selector.text "Leave #lounge?" ]
        , test "the connect gate says the name is registered and offers Sign in as" <|
            \_ ->
                let
                    gateQuery =
                        { gate | connection = Registering }
                            |> feedM ":s 432 kai kai :Nickname is registered; authenticate as this account before using it"
                            |> step (WsClosed { clean = True, reason = "" })
                            |> query
                in
                Expect.all
                    [ \q -> Query.has [ Selector.text "belongs to an account" ] q
                    , \q -> Query.has [ Selector.attribute (Html.Attributes.attribute "data-testid" "conn-signin-as"), Selector.text "Sign in as kai" ] q
                    ]
                    gateQuery
        , test "the Activity sheet renders the log" <|
            \_ ->
                settledLive
                    |> feedM ":irc.onyx.test NOTICE kai :mesh: 2 nodes linked"
                    |> step (GapShellMsg GapShell.ActivityOpen)
                    |> query
                    |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "activity-list") ]
                    |> Query.has [ Selector.text "mesh: 2 nodes linked" ]
        , test "Home shows the network message until dismissed" <|
            \_ ->
                { settledLive | motd = Just "Good evening, kai!\nWelcome to Onyx.", showMotd = True }
                    |> query
                    |> Query.find [ Selector.attribute (Html.Attributes.attribute "data-testid" "home-motd") ]
                    |> Query.has [ Selector.text "Good evening, kai!" ]
        ]


pure : Test
pure =
    describe "GapShell rules"
        [ test "new log lines: plain growth, capped prepends, untouched" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "c" ] (GapShell.newLogEntries 10 [ "b", "a" ] [ "c", "b", "a" ])
                    , \_ -> Expect.equal [ "d" ] (GapShell.newLogEntries 3 [ "c", "b", "a" ] [ "d", "c", "b" ])
                    , \_ -> Expect.equal [ "e", "d" ] (GapShell.newLogEntries 3 [ "c", "b", "a" ] [ "e", "d", "c" ])
                    , \_ -> Expect.equal [] (GapShell.newLogEntries 3 [ "c", "b", "a" ] [ "c", "b", "a" ])
                    , \_ -> Expect.equal [ "x" ] (GapShell.newLogEntries 3 [ "x", "x", "y" ] [ "x", "x", "x" ])
                    ]
                    ()
        , test "activity lines drop the MOTD margin and the end-of-list closers" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "Welcome to Onyx.") (GapShell.displayLine "- Welcome to Onyx.")
                    , \_ -> Expect.equal Nothing (GapShell.displayLine "-")
                    , \_ -> Expect.equal Nothing (GapShell.displayLine "   ")
                    , \_ -> Expect.equal Nothing (GapShell.displayLine "#lounge End of /WHO list.")
                    , \_ -> Expect.equal (Just "mesh: 2 nodes linked") (GapShell.displayLine "mesh: 2 nodes linked")
                    , \_ ->
                        Expect.equal [ "Hi" ]
                            (List.map .text (GapShell.recordEntries 5 [ "-", "- Hi" ] []))
                    ]
                    ()
        , test "close reasons: fatal vs transient" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal { text = "This connection is banned from Onyx: raid", fatal = True } (GapShell.closeReason "Closing Link: kai (Banned: raid)")
                    , \_ -> Expect.equal True (GapShell.closeReason "Ghosted by kai").fatal
                    , \_ -> Expect.equal True (GapShell.closeReason "Connection refused (reputation)").fatal
                    , \_ -> Expect.equal True (GapShell.closeReason "Access denied by SACCESS").fatal
                    , \_ -> Expect.equal True (GapShell.closeReason "Session reclaimed (newer login for kai elsewhere)").fatal
                    , \_ -> Expect.equal False (GapShell.closeReason "Ping timeout").fatal
                    , \_ -> Expect.equal False (GapShell.closeReason "Server is draining; try again later").fatal
                    , \_ -> Expect.equal False (GapShell.closeReason "Too many connections from your host").fatal
                    , \_ -> Expect.equal False (GapShell.closeReason "Excess Flood").fatal
                    ]
                    ()
        , test "SASL reasons classify" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal FailPassword (GapShell.classifySasl "SASL authentication failed")
                    , \_ -> Expect.equal FailNoMechanism (GapShell.classifySasl "Unsupported SASL mechanism")
                    , \_ -> Expect.equal (FailSignIn "Account storage requires recovery") (GapShell.classifySasl "Account storage requires recovery")
                    ]
                    ()
        , test "join names normalise" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Ok "#lounge") (GapShell.normalizeJoinName " lounge ")
                    , \_ -> Expect.equal (Ok "#lounge") (GapShell.normalizeJoinName "#lounge")
                    , \_ -> Expect.equal True (GapShell.normalizeJoinName "#a,b" |> Result.toMaybe |> (==) Nothing)
                    , \_ -> Expect.equal True (GapShell.normalizeJoinName "#" |> Result.toMaybe |> (==) Nothing)
                    ]
                    ()
        ]
