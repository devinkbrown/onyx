module CallsC6Test exposing (suite)

{-| v3/calls-c6 — calls slices C6 (DM ring overlays), C7 (mini voice
view) and C10 (reconnecting + classified errors), mirroring
`VoiceOverlays.test.tsx` (incoming / outgoing / PIP vectors) and the
spec §6 acceptance criteria.
-}

import App exposing (..)
import CallDock exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Media exposing (CallLifecycle(..), CallOutcome(..))
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Time
import View
import View.Calls


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


aria : String -> Selector.Selector
aria label =
    Selector.attribute (Attr.attribute "aria-label" label)


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


rings : List Outbound -> List Outbound
rings outs =
    List.filter
        (\o ->
            case o of
                VoiceRing _ ->
                    True

                _ ->
                    False
        )
        outs


member : String -> App.Member
member nick =
    { nick = nick, modes = Set.empty, away = False }


room : String -> App.Channel
room name =
    { name = name
    , topic = ""
    , members = Dict.fromList [ ( "mara", member "mara" ), ( "jun", member "jun" ), ( "odalys", member "odalys" ) ]
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


base : Model
base =
    { blank
        | ourNick = "odalys"
        , channels = Dict.fromList [ ( "#harbor", room "#harbor" ), ( "#builds", room "#builds" ) ]
        , activeChannel = Just "#harbor"
        , nowMs = 1000
    }


hub : CallLifecycle -> Maybe String -> String -> Maybe Int -> Media.CallHub
hub lifecycle channel peer startedAt =
    { lifecycle = lifecycle, channel = channel, withPeer = peer, startedAt = startedAt, outcome = Nothing }


ringingIn : Model
ringingIn =
    step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "ringing_in" ), ( "nick", Encode.string "mara" ) ])) base


ringingOut : Model
ringingOut =
    step (CallStart "jun") { base | activeChannel = Just "jun" }


inHarbor : Model
inHarbor =
    let
        media0 =
            base.media
    in
    { base
        | calls = hub InCall (Just "#harbor") "" (Just 500)
        , media = { media0 | participants = Dict.fromList [ ( "#harbor", [ "odalys", "mara", "jun" ] ) ], speaking = Set.fromList [ "jun" ] }
        , nowMs = 60000
    }


snapshot : List ( String, Encode.Value ) -> Msg
snapshot fields =
    CallHubSnapshot (Encode.object fields)


suite : Test
suite =
    describe "calls C6 / C7 / C10"
        [ ringTests
        , pipTests
        , recoveryTests
        ]



-- C6


ringTests : Test
ringTests =
    describe "C6 DM ring overlays"
        [ test "ringFor names the peer or falls back to the oracle copy" <|
            \_ ->
                Expect.equal
                    [ Just (RingIncoming "mara"), Just (RingIncoming "Unknown caller"), Just (RingOutgoing "Unknown recipient"), Nothing ]
                    [ ringFor (hub RingingIn Nothing " mara " Nothing)
                    , ringFor (hub RingingIn Nothing "" Nothing)
                    , ringFor (hub RingingOut Nothing "  " Nothing)
                    , ringFor (hub InCall (Just "#harbor") "" (Just 1))
                    ]
        , test "incoming dialog: modal, labelled, described, oracle copy, Decline takes focus" <|
            \_ ->
                let
                    dialog =
                        query ringingIn |> Query.find [ testid "incoming-call-overlay" ]
                in
                Expect.all
                    [ \_ -> dialog |> Query.has [ attr "role" "dialog", attr "aria-modal" "true", attr "aria-labelledby" "onyx-sheet-call-ring-title", attr "aria-describedby" "call-ring-desc" ]
                    , \_ -> dialog |> Query.find [ Selector.id "onyx-sheet-call-ring-title" ] |> Query.has [ Selector.text "Incoming call" ]
                    , \_ -> dialog |> Query.has [ Selector.text "Incoming voice call", Selector.text "mara", Selector.text "Direct message", Selector.text "Your microphone stays muted if Join muted is enabled." ]
                    , \_ -> dialog |> Query.find [ Selector.id "call-ring-desc" ] |> Query.has [ Selector.text "A voice call is waiting. Accept to join with your current audio settings, or decline to dismiss it." ]
                    , \_ -> dialog |> Query.find [ testid "call-ring-decline" ] |> Query.has [ aria "Decline call from mara", attr "data-onyx-autofocus" "call-ring", Selector.text "Decline" ]
                    , \_ -> dialog |> Query.find [ testid "call-ring-accept" ] |> Query.has [ aria "Accept call from mara", Selector.text "Accept" ]
                    , \_ -> dialog |> Query.find [ testid "call-ring-alert" ] |> Query.has [ attr "role" "alert", Selector.text "Incoming call from mara" ]
                    ]
                    ()
        , test "backdrop click is a no-op; Escape declines; Escape order puts the ring first" <|
            \_ ->
                let
                    withSheet =
                        { ringingIn | callPrivacyOpen = True, prefsOpen = True }
                in
                Expect.all
                    [ \_ ->
                        query ringingIn
                            |> Query.find [ testid "call-ring-backdrop" ]
                            |> Event.simulate Event.click
                            |> Event.toResult
                            |> Result.toMaybe
                            |> Expect.equal Nothing
                    , \_ ->
                        query ringingIn
                            |> Query.find [ testid "incoming-call-overlay" ]
                            |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Escape" ) ]))
                            |> Event.expect CallDecline
                    , \_ -> Expect.equal (Just CallDecline) (escapeMsg withSheet)
                    , \_ -> Expect.equal (Just CallCancel) (escapeMsg ringingOut)
                    ]
                    ()
        , test "decline idles at once and rejects the caller; idle decline is a no-op" <|
            \_ ->
                let
                    ( declined, outs ) =
                        update CallDecline ringingIn
                in
                Expect.all
                    [ \_ -> Expect.equal Idle declined.calls.lifecycle
                    , \_ -> Expect.equal Nothing declined.calls.outcome
                    , \_ -> Expect.equal [ VoiceRing { verb = "reject", peer = "mara" } ] (rings outs)
                    , \_ -> Expect.equal [] (Tuple.second (update CallDecline base))
                    , \_ -> query declined |> Query.findAll [ testid "incoming-call-overlay" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "accept submits once, joins muted, and shows the busy state" <|
            \_ ->
                let
                    ( accepting, outs ) =
                        update CallAccept ringingIn

                    ( _, again ) =
                        update CallAccept accepting

                    dialog =
                        query accepting |> Query.find [ testid "incoming-call-overlay" ]
                in
                Expect.all
                    [ \_ -> Expect.equal [ VoiceRing { verb = "accept", peer = "mara" }, VoiceMute { muted = True } ] outs
                    , \_ -> Expect.equal [] again
                    , \_ -> Expect.equal True accepting.callSelfMuted
                    , \_ -> dialog |> Query.find [ testid "call-ring-accept" ] |> Query.has [ Selector.disabled True, Selector.text "Accepting…" ]
                    , \_ -> dialog |> Query.find [ testid "call-ring-accepting" ] |> Query.has [ attr "role" "status", Selector.text "Accepting call from mara…" ]
                    , \_ -> Expect.equal [] (Tuple.second (update CallAccept { ringingIn | connection = Offline }))
                    , \_ -> Expect.equal [] (Tuple.second (update CallAccept base))
                    ]
                    ()
        , test "a failed accept reports and allows a retry" <|
            \_ ->
                let
                    failed =
                        ringingIn
                            |> step CallAccept
                            |> step (snapshot [ ( "state", Encode.string "ringing_in" ), ( "nick", Encode.string "mara" ), ( "acceptFailed", Encode.bool True ) ])

                    ( _, retry ) =
                        update CallAccept failed
                in
                Expect.all
                    [ \_ -> Expect.equal ( False, True ) ( failed.callAccepting, failed.callAcceptError )
                    , \_ -> query failed |> Query.find [ testid "call-ring-error" ] |> Query.has [ attr "role" "alert", Selector.text "Could not accept the call from mara. Try again." ]
                    , \_ -> Expect.equal [ VoiceRing { verb = "accept", peer = "mara" } ] (rings retry)
                    ]
                    ()
        , test "a replacement caller resets the pending accept" <|
            \_ ->
                let
                    replaced =
                        ringingIn
                            |> step CallAccept
                            |> step (snapshot [ ( "state", Encode.string "ringing_in" ), ( "nick", Encode.string "jun" ) ])
                in
                Expect.equal ( False, False ) ( replaced.callAccepting, replaced.callAcceptError )
        , test "outgoing dialog: Calling, polite waiting line, Cancel takes focus and hangs up" <|
            \_ ->
                let
                    dialog =
                        query ringingOut |> Query.find [ testid "outgoing-call-overlay" ]

                    ( cancelled, outs ) =
                        update CallCancel ringingOut
                in
                Expect.all
                    [ \_ -> dialog |> Query.has [ attr "role" "dialog", Selector.text "Outgoing voice call", Selector.text "Calling", Selector.text "jun" ]
                    , \_ -> dialog |> Query.find [ attr "aria-live" "polite" ] |> Query.has [ Selector.text "Waiting for them to answer." ]
                    , \_ -> dialog |> Query.find [ Selector.id "call-ring-desc" ] |> Query.has [ Selector.text "The call request is being sent. You can cancel before they answer." ]
                    , \_ -> dialog |> Query.find [ testid "call-ring-cancel" ] |> Query.has [ aria "Cancel call to jun", attr "data-onyx-autofocus" "call-ring" ]
                    , \_ -> dialog |> Query.find [ testid "call-ring-cancel" ] |> Event.simulate Event.click |> Event.expect CallCancel
                    , \_ -> Expect.equal Idle cancelled.calls.lifecycle
                    , \_ -> Expect.equal [ VoiceRing { verb = "hangup", peer = "jun" } ] (rings outs)
                    ]
                    ()
        , test "start rings out optimistically; refuses channels, self, offline and busy" <|
            \_ ->
                let
                    ( started, outs ) =
                        update (CallStart "jun") { base | activeChannel = Just "jun", roomMenuOpen = True }
                in
                Expect.all
                    [ \_ -> Expect.equal ( RingingOut, "jun", Nothing ) ( started.calls.lifecycle, started.calls.withPeer, started.calls.channel )
                    , \_ -> Expect.equal False started.roomMenuOpen
                    , \_ -> Expect.equal [ VoiceRing { verb = "start", peer = "jun" } ] outs
                    , \_ -> Expect.equal [] (Tuple.second (update (CallStart "#harbor") base))
                    , \_ -> Expect.equal [] (Tuple.second (update (CallStart "Odalys") base))
                    , \_ -> Expect.equal [] (Tuple.second (update (CallStart "jun") { base | connection = Offline }))
                    , \_ -> Expect.equal [] (Tuple.second (update (CallStart "jun") inHarbor))
                    ]
                    ()
        , test "an unanswered outgoing ring times out at 30s with a provisional CallEnded" <|
            \_ ->
                let
                    tick ms =
                        update (Tick (Time.millisToPosix ms))

                    ( early, earlyOut ) =
                        tick 30999 ringingOut

                    ( late, lateOut ) =
                        tick 31000 ringingOut
                in
                Expect.all
                    [ \_ -> Expect.equal (Just 1000) ringingOut.callRingSince
                    , \_ -> Expect.equal RingingOut early.calls.lifecycle
                    , \_ -> Expect.equal [] (rings earlyOut)
                    , \_ -> Expect.equal ( Idle, Just CallEnded ) ( late.calls.lifecycle, late.calls.outcome )
                    , \_ -> Expect.equal [ VoiceRing { verb = "hangup", peer = "jun" } ] (rings lateOut)
                    , \_ -> Expect.equal 30000 ringTimeoutMs
                    ]
                    ()
        , test "an unanswered incoming ring closes as a missed call (reject, no outcome)" <|
            \_ ->
                let
                    ( late, outs ) =
                        update (Tick (Time.millisToPosix 31000)) ringingIn
                in
                Expect.all
                    [ \_ -> Expect.equal ( Idle, Nothing ) ( late.calls.lifecycle, late.calls.outcome )
                    , \_ -> Expect.equal [ VoiceRing { verb = "reject", peer = "mara" } ] (rings outs)
                    ]
                    ()
        , test "the Calls hub never answers a ring" <|
            \_ ->
                View.Calls.callsHub { ringingIn | callsOpen = True }
                    |> Query.fromHtml
                    |> Query.findAll [ Selector.containing [ Selector.text "Accept" ], Selector.tag "button" ]
                    |> Query.count (Expect.equal 0)
        , test "a DM's More menu offers Call; a room's does not" <|
            \_ ->
                let
                    dm =
                        { base | activeChannel = Just "jun", roomMenuOpen = True }
                in
                Expect.all
                    [ \_ -> query dm |> Query.find [ testid "ribbon-dm-call" ] |> Query.has [ aria "Start voice call with jun", Selector.text "Call" ]
                    , \_ -> query dm |> Query.find [ testid "ribbon-dm-call" ] |> Event.simulate Event.click |> Event.expect (CallStart "jun")
                    , \_ -> query { base | roomMenuOpen = True } |> Query.findAll [ testid "ribbon-dm-call" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        ]



-- C7


pipTests : Test
pipTests =
    let
        away =
            { inHarbor | activeChannel = Just "#builds" }
    in
    describe "C7 picture-in-picture"
        [ test "shows only in a call and off the call's target" <|
            \_ ->
                Expect.equal
                    [ True, False, False, False, False, True ]
                    [ pipVisible { hub = away.calls, activeChannel = Just "#builds", callsOpen = False }
                    , pipVisible { hub = away.calls, activeChannel = Just "#HARBOR", callsOpen = False }
                    , pipVisible { hub = hub RingingIn Nothing "mara" Nothing, activeChannel = Just "#builds", callsOpen = False }
                    , pipVisible { hub = away.calls, activeChannel = Just "#builds", callsOpen = True }
                    , pipVisible { hub = hub InCall Nothing "jun" (Just 1), activeChannel = Just "jun", callsOpen = False }
                    , pipVisible { hub = hub InCall Nothing "jun" (Just 1), activeChannel = Just "#harbor", callsOpen = False }
                    ]
        , test "renders the region with oracle labels; Return / Leave / Mute wire up" <|
            \_ ->
                let
                    card =
                        query away |> Query.find [ testid "voice-pip" ]
                in
                Expect.all
                    [ \_ -> card |> Query.has [ attr "role" "region", attr "tabindex" "0", aria "Mini voice view for #harbor", attr "data-corner" "bottom-right" ]
                    , \_ -> card |> Query.find [ aria "1 speaking" ] |> Query.has [ Selector.text "1 live" ]
                    , \_ -> card |> Query.find [ aria "3 voice participants" ] |> Query.findAll [ Selector.class "onyx-call-avatar" ] |> Query.count (Expect.equal 3)
                    , \_ -> card |> Query.find [ testid "voice-pip-return" ] |> Query.has [ aria "Return to call in #harbor" ]
                    , \_ -> card |> Query.find [ testid "voice-pip-return" ] |> Event.simulate Event.click |> Event.expect (CallsReturnToCall "#harbor")
                    , \_ -> card |> Query.find [ testid "voice-pip-leave" ] |> Event.simulate Event.click |> Event.expect CallLeave
                    , \_ -> card |> Query.find [ testid "voice-pip-mute" ] |> Query.has [ attr "aria-pressed" "false", aria "Mute microphone" ]
                    , \_ -> card |> Query.find [ testid "voice-pip-corner" ] |> Query.has [ aria "Move mini view to next corner" ]
                    , \_ -> query inHarbor |> Query.findAll [ testid "voice-pip" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "the corner button cycles all four corners and persists" <|
            \_ ->
                let
                    ( once, outs ) =
                        update CallPipCycle { away | callPip = { corner = BottomRight, x = 40, y = 8 } }
                in
                Expect.all
                    [ \_ -> Expect.equal [ BottomLeft, TopLeft, TopRight, BottomRight ] (List.map nextCorner [ BottomRight, BottomLeft, TopLeft, TopRight ])
                    , \_ -> Expect.equal { corner = BottomLeft, x = 0, y = 0 } once.callPip
                    , \_ -> Expect.equal [ VoicePipSave { corner = "bottom-left", x = 0, y = 0 } ] outs
                    , \_ -> query away |> Query.find [ testid "voice-pip-corner" ] |> Event.simulate Event.click |> Event.expect CallPipCycle
                    ]
                    ()
        , test "nudges move inward from the anchor and clamp to the viewport" <|
            \_ ->
                let
                    vp =
                        { width = 1000, height = 800 }
                in
                Expect.equal
                    [ { corner = BottomRight, x = 16, y = 0 }
                    , { corner = BottomRight, x = 0, y = 0 }
                    , { corner = BottomRight, x = 676, y = 0 }
                    , { corner = TopLeft, x = 0, y = 48 }
                    , { corner = TopLeft, x = 0, y = 606 }
                    ]
                    [ nudge { dx = -16, dy = 0 } vp defaultPip
                    , nudge { dx = 16, dy = 0 } vp defaultPip
                    , nudge { dx = -5000, dy = 0 } vp defaultPip
                    , nudge { dx = 0, dy = 48 } vp { defaultPip | corner = TopLeft }
                    , nudge { dx = 0, dy = 5000 } vp { defaultPip | corner = TopLeft }
                    ]
        , test "arrow keys step 16px (Shift 48px); Enter on the region returns" <|
            \_ ->
                let
                    key k shift target =
                        Event.custom "keydown"
                            (Encode.object
                                [ ( "key", Encode.string k )
                                , ( "shiftKey", Encode.bool shift )
                                , ( "target", Encode.object [ ( "dataset", Encode.object target ) ] )
                                , ( "view", Encode.object [ ( "innerWidth", Encode.int 1200 ), ( "innerHeight", Encode.int 900 ) ] )
                                ]
                            )

                    card =
                        query away |> Query.find [ testid "voice-pip" ]
                in
                Expect.all
                    [ \_ -> Expect.equal (Just { dx = 0, dy = -48 }) (keyStep { key = "ArrowUp", shift = True })
                    , \_ -> Expect.equal Nothing (keyStep { key = "a", shift = False })
                    , \_ -> card |> Event.simulate (key "ArrowLeft" False []) |> Event.expect (CallPipNudge { dx = -16, dy = 0, width = 1200, height = 900, persist = True })
                    , \_ -> card |> Event.simulate (key "Enter" False [ ( "voicePip", Encode.string "region" ) ]) |> Event.expect (CallsReturnToCall "#harbor")
                    , \_ ->
                        update (CallPipNudge { dx = -16, dy = 0, width = 1200, height = 900, persist = True }) away
                            |> Tuple.second
                            |> Expect.equal [ VoicePipSave { corner = "bottom-right", x = 16, y = 0 } ]
                    ]
                    ()
        , test "a primary-button drag moves without persisting; release persists" <|
            \_ ->
                let
                    handle =
                        query away |> Query.find [ Selector.class "onyx-call-pip-handle" ]

                    move buttons =
                        Event.custom "pointermove"
                            (Encode.object
                                [ ( "buttons", Encode.int buttons )
                                , ( "movementX", Encode.float -20 )
                                , ( "movementY", Encode.float -4 )
                                ]
                            )
                in
                Expect.all
                    [ \_ -> handle |> Event.simulate (move 1) |> Event.expect (CallPipNudge { dx = -20, dy = -4, width = 0, height = 0, persist = False })
                    , \_ -> handle |> Event.simulate (move 0) |> Event.toResult |> Result.toMaybe |> Expect.equal Nothing
                    , \_ -> Expect.equal [] (Tuple.second (update (CallPipNudge { dx = -20, dy = -4, width = 0, height = 0, persist = False }) away))
                    , \_ -> Expect.equal [ VoicePipSave { corner = "bottom-right", x = 0, y = 0 } ] (Tuple.second (update CallPipDragEnd away))
                    ]
                    ()
        , test "stored position decodes fail-closed and round-trips" <|
            \_ ->
                let
                    stored =
                        { corner = TopRight, x = 32, y = 64 }
                in
                Expect.all
                    [ \_ -> Expect.equal stored (decodePipPosition (encodePipPosition stored))
                    , \_ -> Expect.equal defaultPip (decodePipPosition (Encode.object [ ( "x", Encode.int 48 ), ( "y", Encode.int 64 ) ]))
                    , \_ -> Expect.equal defaultPip (decodePipPosition (Encode.object [ ( "corner", Encode.string "middle" ), ( "x", Encode.int 0 ), ( "y", Encode.int 0 ) ]))
                    , \_ -> Expect.equal defaultPip (decodePipPosition (Encode.object [ ( "corner", Encode.string "top-left" ), ( "x", Encode.float 1.0e100 ), ( "y", Encode.int 0 ) ]))
                    , \_ -> Expect.equal defaultPip (decodePipPosition (Encode.object [ ( "corner", Encode.string "top-left" ), ( "x", Encode.int -4 ), ( "y", Encode.int 0 ) ]))
                    , \_ -> Expect.equal stored (step (CallPipLoaded (encodePipPosition stored)) base).callPip
                    ]
                    ()
        , test "summary keeps faces bounded, speakers first, full totals" <|
            \_ ->
                let
                    roster =
                        "odalys" :: List.map (\i -> "p" ++ String.fromInt i) (List.range 1 12)

                    summary =
                        pipSummary
                            { ourNick = "odalys"
                            , selfMuted = True
                            , roster = roster ++ [ "P1" ]
                            , speaking = Set.fromList (List.map (\i -> "P" ++ String.fromInt i) (List.range 3 11))
                            , muted = Set.empty
                            }
                in
                Expect.all
                    [ \_ -> Expect.equal 13 summary.total
                    , \_ -> Expect.equal 9 summary.speaking
                    , \_ -> Expect.equal [ "p3", "p4", "p5", "p6", "p7" ] (List.map .key summary.visible)
                    , \_ -> Expect.equal ( "9 live", "9 speaking", "live" ) ( pipLiveLabel 9, pipLiveAria 9, pipLiveLabel 0 )
                    , \_ ->
                        pipSummary { ourNick = "odalys", selfMuted = True, roster = [ "mara" ], speaking = Set.empty, muted = Set.empty }
                            |> .visible
                            |> List.map (\f -> ( f.key, f.self, f.muted ))
                            |> Expect.equal [ ( "odalys", True, True ), ( "mara", False, False ) ]
                    ]
                    ()
        , test "leaving a DM call hangs up the peer" <|
            \_ ->
                let
                    dmCall =
                        { base | calls = hub InCall Nothing "jun" (Just 500), activeChannel = Just "#harbor" }

                    ( left, outs ) =
                        update CallLeave dmCall
                in
                Expect.all
                    [ \_ -> Expect.equal ( Idle, Just CallEnded ) ( left.calls.lifecycle, left.calls.outcome )
                    , \_ -> Expect.equal [ VoiceRing { verb = "hangup", peer = "jun" } ] outs
                    , \_ -> query dmCall |> Query.find [ testid "voice-pip" ] |> Query.has [ aria "Mini voice view for jun" ]
                    ]
                    ()
        ]



-- C10


recoveryTests : Test
recoveryTests =
    let
        lost =
            step CallMoreClose { inHarbor | connection = Offline, autoReconnect = True }
    in
    describe "C10 reconnecting + classified errors"
        [ test "reconnecting is derived from InCall ∧ connection ≠ Live" <|
            \_ ->
                Expect.equal
                    [ True, False, False ]
                    [ reconnecting inHarbor.calls False
                    , reconnecting inHarbor.calls True
                    , reconnecting (hub RingingIn Nothing "mara" Nothing) False
                    ]
        , test "the stage shows Reconnecting…, the lost banner, a dash timer and only Leave enabled" <|
            \_ ->
                let
                    q =
                        query lost
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Reconnecting…" ]
                    , \_ -> q |> Query.find [ testid "voice-stage" ] |> Query.has [ attr "data-reconnecting" "true" ]
                    , \_ -> q |> Query.find [ testid "call-connection-lost" ] |> Query.has [ attr "role" "alert", Selector.text "Connection lost.", Selector.text "Trying to rejoin #harbor — your place in the conversation is kept." ]
                    , \_ -> q |> Query.find [ testid "call-connection-lost-leave" ] |> Event.simulate Event.click |> Event.expect CallLeave
                    , \_ -> q |> Query.find [ testid "call-mute" ] |> Query.has [ Selector.disabled True ]
                    , \_ -> q |> Query.find [ testid "call-more" ] |> Query.has [ Selector.disabled True ]
                    , \_ -> q |> Query.find [ testid "call-leave" ] |> Query.hasNot [ Selector.disabled True ]
                    , \_ -> q |> Query.find [ testid "call-timer" ] |> Query.has [ Selector.text "—" ]
                    , \_ -> query inHarbor |> Query.findAll [ testid "call-connection-lost" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "recovery announces Reconnected once" <|
            \_ ->
                let
                    back =
                        step CallMoreClose { lost | connection = Live }

                    later =
                        step CallMoreClose back
                in
                Expect.all
                    [ \_ -> Expect.equal ( True, "" ) ( lost.callWasReconnecting, lost.callRecoveryNote )
                    , \_ -> Expect.equal ( False, "Reconnected" ) ( back.callWasReconnecting, back.callRecoveryNote )
                    , \_ -> query back |> Query.find [ testid "call-recovery-announcer" ] |> Query.has [ attr "aria-live" "polite", Selector.text "Reconnected" ]
                    , \_ -> Expect.equal "Reconnected" later.callRecoveryNote
                    , \_ -> query back |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Call is live · Protected connection" ]
                    ]
                    ()
        , test "a dropped call offers the rejoin banner in its room" <|
            \_ ->
                let
                    dropped =
                        step (snapshot [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "dropped" ) ]) inHarbor
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "#harbor") dropped.callRejoin
                    , \_ -> query dropped |> Query.find [ testid "call-join-banner" ] |> Query.has [ attr "data-variant" "failed", Selector.text "Couldn't join. Try again." ]
                    , \_ -> query { dropped | activeChannel = Just "#builds" } |> Query.findAll [ attr "data-variant" "failed" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "join failures classify the banner sub line" <|
            \_ ->
                let
                    failWith kind =
                        base
                            |> step (CallJoin { channel = "#harbor", video = False })
                            |> step (snapshot [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "failed" ), ( "errorKind", Encode.string kind ) ])

                    sub kind =
                        query (failWith kind) |> Query.find [ testid "call-join-failed-sub" ]
                in
                Expect.all
                    [ \_ -> Expect.equal (Just PermissionDenied) (failWith "permission").callJoinError
                    , \_ -> sub "permission" |> Query.has [ Selector.text "Onyx needs microphone access. Allow it in your browser's site settings, then try again." ]
                    , \_ -> sub "no_device" |> Query.has [ Selector.text "No microphone was found. Connect one or check Voice settings." ]
                    , \_ -> sub "other" |> Query.has [ Selector.text "Your place in #harbor is kept." ]
                    , \_ -> sub "bogus" |> Query.has [ Selector.text "Your place in #harbor is kept." ]
                    , \_ -> Expect.equal Nothing (step (CallJoin { channel = "#harbor", video = False }) (failWith "permission") |> step (snapshot [ ( "state", Encode.string "in_call" ), ( "channel", Encode.string "#harbor" ) ])).callJoinError
                    ]
                    ()
        -- v3/calls-engine: adapter-classified refusals (voice-core.ts).
        , test "account / encryption refusals classify; DM-unsupported toasts" <|
            \_ ->
                let
                    failWith kind =
                        base
                            |> step (CallJoin { channel = "#harbor", video = False })
                            |> step (snapshot [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "failed" ), ( "errorKind", Encode.string kind ) ])

                    sub kind =
                        query (failWith kind) |> Query.find [ testid "call-join-failed-sub" ]

                    toasted kind =
                        step (snapshot [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "failed" ), ( "errorKind", Encode.string kind ) ]) base
                            |> .toasts
                            |> List.map .title
                in
                Expect.all
                    [ \_ -> Expect.equal (Just AccountRequired) (failWith "account").callJoinError
                    , \_ -> sub "account" |> Query.has [ Selector.text "Calls are end-to-end encrypted and need an Onyx account. Sign in, then try again." ]
                    , \_ -> Expect.equal (Just EncryptionUnavailable) (failWith "encryption").callJoinError
                    , \_ -> sub "encryption" |> Query.has [ Selector.text "This browser couldn't set up call encryption. Make sure site storage isn't blocked, then try again." ]
                    , \_ -> Expect.equal [ "Direct calls aren't available yet" ] (toasted "unsupported")
                    ]
                    ()
        , test "codec and encoder failures toast with oracle copy" <|
            \_ ->
                let
                    toasted kind =
                        step (snapshot [ ( "state", Encode.string "in_call" ), ( "channel", Encode.string "#harbor" ), ( "errorKind", Encode.string kind ) ]) inHarbor
                            |> .toasts
                            |> List.map (\t -> ( t.title, t.description ))
                in
                Expect.all
                    [ \_ -> Expect.equal [ ( "Media codec unavailable", Just "Could not load the media codec. Video and enhanced audio are disabled in this browser." ) ] (toasted "codec")
                    , \_ -> Expect.equal [ ( "Camera could not start", Just "Video encoding failed after trying every quality. Your camera preview may show, but others cannot see you." ) ] (toasted "encoder")
                    , \_ -> Expect.equal [] (toasted "permission")
                    ]
                    ()
        ]
