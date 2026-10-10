module CallsC11Test exposing (suite)

{-| v3/calls-c11 — calls slices C11 (stage mode) and C12 (call chords +
a11y pass) per `elm/design/calls/CALLS_DESIGN.md` §2.16, §3.1, §6.
Oracle vectors from `store.stage.test.ts` (CTCP ownership, host
authority, bounds, lifecycle, nick tracking) and `StagePanel.tsx`
(copy, actions, invite alert, raised-hands queue).
-}

import App exposing (..)
import CallMedia
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Media exposing (CallLifecycle(..))
import Set
import Stage
import Switcher
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import Wire


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


member : String -> List Char -> App.Member
member nick modes =
    { nick = nick, modes = Set.fromList modes, away = False }


stageRoom : App.Channel
stageRoom =
    { name = "#stage"
    , topic = ""
    , members =
        Dict.fromList
            [ ( "alice", member "alice" [] )
            , ( "host", member "host" [ 'o' ] )
            , ( "mallory", member "mallory" [] )
            , ( "me", member "me" [] )
            ]
    , modes = "m"
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


other : App.Channel
other =
    { stageRoom | name = "#other", modes = "", members = Dict.fromList [ ( "mallory", member "mallory" [] ), ( "me", member "me" [] ) ] }


base : Model
base =
    { blank
        | ourNick = "me"
        , channels = Dict.fromList [ ( "#stage", stageRoom ), ( "#other", other ) ]
        , activeChannel = Just "#stage"
        , nowMs = 100000
    }


stageBlank : Stage.StageState
stageBlank =
    Stage.blank


withStage : (Stage.StageState -> Stage.StageState) -> Model -> Model
withStage f model =
    { model | stage = f model.stage }


audience : Model
audience =
    base |> withStage (\s -> { s | channel = Just "#stage" })


hosting : Model
hosting =
    base |> withStage (\s -> { s | channel = Just "#stage", isHost = True, isSpeaker = True })


feed : String -> Model -> Model
feed raw model =
    Tuple.first (update (WsLineReceived raw) model)


feedOut : String -> Model -> List Outbound
feedOut raw model =
    Tuple.second (update (WsLineReceived raw) model)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


line : String -> List String -> Outbound
line cmd params =
    SendLine (Wire.formatIrcLine cmd params)


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


inCallAt : List String -> Model -> Model
inCallAt roster model =
    let
        media0 =
            model.media
    in
    { model | media = { media0 | participants = Dict.fromList [ ( "#stage", roster ) ] } }
        |> step
            (CallHubSnapshot
                (Encode.object
                    [ ( "state", Encode.string "in_call" )
                    , ( "channel", Encode.string "#stage" )
                    , ( "startedAt", Encode.int 1000 )
                    ]
                )
            )


chord : String -> Model -> ( Model, List Outbound )
chord name model =
    update (ShortcutPressed (Switcher.shortcutFromString ("call-" ++ name))) model


suite : Test
suite =
    describe "calls C11–C12"
        [ ownership
        , lifecycle
        , panel
        , inCall
        , chords
        , a11y
        ]



-- C11 · STORE VECTORS (store.stage.test.ts)


ownership : Test
ownership =
    describe "STAGE CTCP ownership"
        [ test "accepts stage state only from the exact active channel" <|
            \_ ->
                let
                    ignored =
                        audience
                            |> feed ":mallory!u@h PRIVMSG #other :\u{0001}STAGE RAISE_HAND\u{0001}"
                            |> feed ":mallory!u@h PRIVMSG me :\u{0001}STAGE RAISE_HAND\u{0001}"
                            |> feed ":outsider!u@h PRIVMSG #stage :\u{0001}STAGE RAISE_HAND\u{0001}"
                            |> feed ":mallory!u@h PRIVMSG #other :\u{0001}STAGE INVITE_SPEAK me\u{0001}"
                            |> feed ":mallory!u@h PRIVMSG #stage :\u{0001}STAGE INVITE_SPEAK me\u{0001}"

                    accepted =
                        ignored
                            |> feed ":alice!u@h PRIVMSG #stage :\u{0001}STAGE RAISE_HAND\u{0001}"
                            |> feed ":host!u@h PRIVMSG #stage :\u{0001}STAGE INVITE_SPEAK me\u{0001}"
                in
                Expect.all
                    [ \_ -> Expect.equal [] ignored.stage.raisedHands
                    , \_ -> Expect.equal Nothing ignored.stage.pendingInvite
                    , \_ -> Expect.equal [ "alice" ] accepted.stage.raisedHands
                    , \_ -> Expect.equal (Just "host") accepted.stage.pendingInvite
                    ]
                    ()
        , test "a STAGE wrapper never files a transcript row" <|
            \_ ->
                let
                    after =
                        feed ":alice!u@h PRIVMSG #stage :\u{0001}STAGE RAISE_HAND\u{0001}" audience
                in
                Expect.equal (Maybe.map (.messages >> List.length) (Dict.get "#stage" audience.channels))
                    (Maybe.map (.messages >> List.length) (Dict.get "#stage" after.channels))
        , test "host voices only a queued hand on ACCEPT_SPEAK from the stage room" <|
            \_ ->
                let
                    queued =
                        hosting |> withStage (\s -> { s | raisedHands = [ "alice" ] })

                    stray =
                        queued
                            |> feed ":alice!u@h PRIVMSG #other :\u{0001}STAGE ACCEPT_SPEAK\u{0001}"
                            |> feed ":mallory!u@h PRIVMSG #stage :\u{0001}STAGE ACCEPT_SPEAK\u{0001}"
                in
                Expect.all
                    [ \_ -> Expect.equal [ "alice" ] stray.stage.raisedHands
                    , \_ -> Expect.equal [] (feedOut ":mallory!u@h PRIVMSG #stage :\u{0001}STAGE ACCEPT_SPEAK\u{0001}" queued)
                    , \_ ->
                        feedOut ":alice!u@h PRIVMSG #stage :\u{0001}STAGE ACCEPT_SPEAK\u{0001}" stray
                            |> List.member (line "MODE" [ "#stage", "+v", "alice" ])
                            |> Expect.equal True
                    , \_ -> Expect.equal [] (feed ":alice!u@h PRIVMSG #stage :\u{0001}STAGE ACCEPT_SPEAK\u{0001}" stray).stage.raisedHands
                    ]
                    ()
        , test "an audience member never voices anyone" <|
            \_ ->
                audience
                    |> withStage (\s -> { s | raisedHands = [ "alice" ] })
                    |> feedOut ":alice!u@h PRIVMSG #stage :\u{0001}STAGE ACCEPT_SPEAK\u{0001}"
                    |> List.filter (\o -> o == line "MODE" [ "#stage", "+v", "alice" ])
                    |> Expect.equal []
        , test "own echoes and LOWER/DECLINE clear the queue row" <|
            \_ ->
                let
                    up =
                        audience |> withStage (\s -> { s | raisedHands = [ "alice", "mallory" ] })
                in
                Expect.all
                    [ \_ -> Expect.equal [ "mallory" ] (feed ":alice!u@h PRIVMSG #stage :\u{0001}STAGE LOWER_HAND\u{0001}" up).stage.raisedHands
                    , \_ -> Expect.equal [ "alice" ] (feed ":mallory!u@h PRIVMSG #stage :\u{0001}STAGE DECLINE_SPEAK\u{0001}" up).stage.raisedHands
                    , \_ -> Expect.equal [] (feed ":me!u@h PRIVMSG #stage :\u{0001}STAGE RAISE_HAND\u{0001}" audience).stage.raisedHands
                    ]
                    ()
        , test "the raised-hand queue is bounded at 128" <|
            \_ ->
                let
                    filled =
                        List.foldl (\i s -> Stage.addRaisedHand ("guest" ++ String.fromInt i) s) Stage.blank (List.range 0 (Stage.maxRaisedHands + 7))
                in
                Expect.all
                    [ \_ -> Expect.equal Stage.maxRaisedHands (List.length filled.raisedHands)
                    , \_ -> Expect.equal (Just "guest127") (List.head (List.reverse filled.raisedHands))
                    , \_ -> Expect.equal Stage.maxRaisedHands (List.length (Stage.addRaisedHand "guest3" filled).raisedHands)
                    ]
                    ()
        , test "a host hears a new raised hand once" <|
            \_ ->
                (feed ":alice!u@h PRIVMSG #stage :\u{0001}STAGE RAISE_HAND\u{0001}" hosting).callAnnouncer.message
                    |> Expect.equal "alice raised a hand"
        ]


lifecycle : Test
lifecycle =
    describe "stage transient-state bounds and lifecycle"
        [ test "joining resets the previous stage and JOINs only when not a member" <|
            \_ ->
                let
                    dirty =
                        hosting |> withStage (\s -> { s | raisedHands = [ "alice" ], handRaised = True, pendingInvite = Just "host" })

                    ( joined, sent ) =
                        update (StageJoinAudience " #Next ") dirty
                in
                Expect.all
                    [ \_ -> Expect.equal { stageBlank | channel = Just "#Next" } joined.stage
                    , \_ -> Expect.equal [ line "JOIN" [ "#Next" ] ] sent
                    , \_ -> Expect.equal [] (outs (StageJoinAudience "#stage") base)
                    , \_ -> Expect.equal [] (outs (StageJoinAudience "bad,room") base)
                    ]
                    ()
        , test "starting needs op standing; it sends +m and PROP STAGE 1 and hosts" <|
            \_ ->
                let
                    asOp =
                        { base | channels = Dict.insert "#stage" { stageRoom | members = Dict.insert "me" (member "me" [ 'o' ]) stageRoom.members } base.channels }

                    ( started, sent ) =
                        update (StageStart "#stage") asOp
                in
                Expect.all
                    [ \_ -> Expect.equal [] (outs (StageStart "#stage") base)
                    , \_ -> Expect.equal [ line "MODE" [ "#stage", "+m" ], line "PROP" [ "#stage", "STAGE", "1" ] ] sent
                    , \_ -> Expect.equal { stageBlank | channel = Just "#stage", isHost = True, isSpeaker = True } started.stage
                    , \_ -> Expect.equal [] (outs (StageStart "#stage") { asOp | connection = Offline })
                    ]
                    ()
        , test "ending sends -m and PROP STAGE 0; leaving PARTs; both clear authority" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ line "MODE" [ "#stage", "-m" ], line "PROP" [ "#stage", "STAGE", "0" ] ] (outs StageEnd hosting)
                    , \_ -> Expect.equal Stage.blank (step StageEnd hosting).stage
                    , \_ -> Expect.equal [ line "PART" [ "#stage", "Left stage" ] ] (outs StageLeave audience)
                    , \_ -> Expect.equal Stage.blank (step StageLeave hosting).stage
                    , \_ -> Expect.equal [] (outs StageEnd audience)
                    ]
                    ()
        , test "self PART or KICK from the stage room clears it" <|
            \_ ->
                let
                    dirty =
                        hosting |> withStage (\s -> { s | raisedHands = [ "alice" ], pendingInvite = Just "host" })
                in
                Expect.all
                    [ \_ -> Expect.equal Stage.blank (feed ":me!u@h PART #stage :leaving" dirty).stage
                    , \_ -> Expect.equal Stage.blank (feed ":host!u@h KICK #stage me :bye" dirty).stage
                    , \_ -> Expect.equal dirty.stage (feed ":me!u@h PART #other :leaving" dirty).stage
                    ]
                    ()
        , test "raised-hand and invite identities follow a nick change" <|
            \_ ->
                let
                    after =
                        audience
                            |> withStage (\s -> { s | raisedHands = [ "alice" ], pendingInvite = Just "alice" })
                            |> feed ":alice!u@h NICK Alicia"
                in
                Expect.all
                    [ \_ -> Expect.equal [ "Alicia" ] after.stage.raisedHands
                    , \_ -> Expect.equal (Just "Alicia") after.stage.pendingInvite
                    ]
                    ()
        , test "hand, invite, accept and decline send the CTCP and move state" <|
            \_ ->
                let
                    invited =
                        audience |> withStage (\s -> { s | pendingInvite = Just "host" })
                in
                Expect.all
                    [ \_ -> Expect.equal [ line "PRIVMSG" [ "#stage", "\u{0001}STAGE RAISE_HAND\u{0001}" ] ] (outs StageHandToggle audience)
                    , \_ -> Expect.equal True (step StageHandToggle audience).stage.handRaised
                    , \_ -> Expect.equal [ line "PRIVMSG" [ "#stage", "\u{0001}STAGE LOWER_HAND\u{0001}" ] ] (outs StageHandToggle (step StageHandToggle audience))
                    , \_ -> Expect.equal [ line "PRIVMSG" [ "#stage", "\u{0001}STAGE INVITE_SPEAK alice\u{0001}" ] ] (outs (StageInvite "alice") hosting)
                    , \_ -> Expect.equal [] (outs (StageInvite "alice") audience)
                    , \_ -> Expect.equal [ line "PRIVMSG" [ "#stage", "\u{0001}STAGE ACCEPT_SPEAK\u{0001}" ] ] (outs StageAccept invited)
                    , \_ -> Expect.equal ( True, Nothing ) ((step StageAccept invited).stage |> (\s -> ( s.isSpeaker, s.pendingInvite )))
                    , \_ -> Expect.equal [ line "PRIVMSG" [ "#stage", "\u{0001}STAGE DECLINE_SPEAK\u{0001}" ] ] (outs StageDecline invited)
                    , \_ -> Expect.equal Nothing (step StageDecline invited).stage.pendingInvite
                    , \_ -> Expect.equal [] (outs StageHandToggle { audience | connection = Offline })
                    ]
                    ()
        , test "dismiss is local to the host's queue (no server verb)" <|
            \_ ->
                let
                    queued =
                        hosting |> withStage (\s -> { s | raisedHands = [ "alice", "mallory" ] })
                in
                Expect.all
                    [ \_ -> Expect.equal [] (outs (StageDismissHand "alice") queued)
                    , \_ -> Expect.equal [ "mallory" ] (step (StageDismissHand "alice") queued).stage.raisedHands
                    ]
                    ()
        ]



-- C11 · STAGE PANEL (StagePanel.tsx)


panel : Test
panel =
    describe "stage strip"
        [ test "hidden for a non-op in a room with no stage" <|
            \_ ->
                query { base | channels = Dict.insert "#stage" { stageRoom | modes = "" } base.channels }
                    |> Query.findAll [ testid "stage-panel" ]
                    |> Query.count (Expect.equal 0)
        , test "ops get the dormant strip with Start stage; offline copy is honest" <|
            \_ ->
                let
                    asOp =
                        { base | channels = Dict.insert "#stage" { stageRoom | modes = "", members = Dict.insert "me" (member "me" [ 'o' ]) stageRoom.members } base.channels }
                in
                Expect.all
                    [ \_ ->
                        query asOp
                            |> Query.find [ testid "stage-panel" ]
                            |> Query.has [ Selector.text "Stage is available here. Start one to host speakers with a raised-hand queue.", attr "data-active" "false" ]
                    , \_ -> query asOp |> Query.find [ testid "stage-start" ] |> Event.simulate Event.click |> Event.expect (StageStart "#stage")
                    , \_ ->
                        query { asOp | connection = Offline }
                            |> Query.find [ testid "stage-panel" ]
                            |> Query.has [ Selector.text "Stage is unavailable while Onyx reconnects. Your room is unchanged.", attr "data-availability" "unavailable" ]
                    ]
                    ()
        , test "a live (PROP STAGE) room offers Join as audience" <|
            \_ ->
                let
                    props0 =
                        base.props
                in
                query { base | props = { props0 | channelProps = Dict.fromList [ ( "#stage", Dict.fromList [ ( "STAGE", "1" ) ] ) ] } }
                    |> Query.find [ testid "stage-join" ]
                    |> Event.simulate Event.click
                    |> Event.expect (StageJoinAudience "#stage")
        , test "audience strip: hint, Raise hand, Leave stage" <|
            \_ ->
                Expect.all
                    [ \_ -> query audience |> Query.find [ testid "stage-panel" ] |> Query.has [ Selector.text "You are in the audience. Room is moderated (+m). Speaking role and microphone access are managed separately." ]
                    , \_ -> query audience |> Query.find [ testid "stage-panel-hand" ] |> Query.has [ Selector.text "Raise hand", attr "aria-pressed" "false", attr "aria-keyshortcuts" "Control+Shift+H Meta+Shift+H" ]
                    , \_ -> query audience |> Query.find [ testid "stage-leave" ] |> Event.simulate Event.click |> Event.expect StageLeave
                    , \_ -> query audience |> Query.findAll [ testid "stage-end" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "speak invite is an alert with Accept / Decline" <|
            \_ ->
                let
                    invited =
                        audience |> withStage (\s -> { s | pendingInvite = Just "host" })
                in
                Expect.all
                    [ \_ -> query invited |> Query.find [ testid "stage-invite" ] |> Query.has [ attr "role" "alert", Selector.text "host", Selector.text " invited you to speak." ]
                    , \_ -> query invited |> Query.find [ testid "stage-accept" ] |> Event.simulate Event.click |> Event.expect StageAccept
                    , \_ -> query invited |> Query.find [ testid "stage-decline" ] |> Event.simulate Event.click |> Event.expect StageDecline
                    ]
                    ()
        , test "host queue: Invite to speak + Dismiss per row, End stage, 375px opener + sheet" <|
            \_ ->
                let
                    queued =
                        hosting |> withStage (\s -> { s | raisedHands = [ "alice", "mallory" ] })

                    sheet =
                        step StageHandsOpen queued
                in
                Expect.all
                    [ \_ -> query queued |> Query.find [ testid "stage-hands" ] |> Query.has [ attr "aria-label" "Raised hands" ]
                    , \_ -> query queued |> Query.find [ testid "stage-invite-alice" ] |> Query.has [ attr "aria-label" "Invite alice to speak" ]
                    , \_ -> query queued |> Query.find [ testid "stage-invite-alice" ] |> Event.simulate Event.click |> Event.expect (StageInvite "alice")
                    , \_ -> query queued |> Query.find [ testid "stage-dismiss-mallory" ] |> Event.simulate Event.click |> Event.expect (StageDismissHand "mallory")
                    , \_ -> query queued |> Query.find [ testid "stage-end" ] |> Event.simulate Event.click |> Event.expect StageEnd
                    , \_ -> query queued |> Query.find [ testid "stage-hands-open" ] |> Query.has [ Selector.text "2 raised hands" ]
                    , \_ -> query sheet |> Query.find [ testid "stage-hands-sheet" ] |> Query.has [ attr "role" "dialog", Selector.text "Raised hands" ]
                    , \_ -> Expect.equal (Just ( "stage-hands", StageHandsClose )) (List.head (List.filter (\( k, _ ) -> k == "stage-hands") (overlayStack sheet)))
                    , \_ -> Expect.equal False (step (ShortcutPressed Switcher.Dismiss) sheet).stageHandsOpen
                    , \_ -> Expect.equal False (sheet |> step (StageDismissHand "alice") |> step (StageDismissHand "mallory")).stageHandsOpen
                    ]
                    ()
        ]



-- C11 · STAGE IN THE CALL


inCall : Test
inCall =
    describe "stage inside the call"
        [ test "audience: no cell, facepile line, audience status, broadcast chip" <|
            \_ ->
                let
                    m =
                        audience |> inCallAt [ "me", "host", "alice", "mallory" ]
                in
                Expect.all
                    [ \_ -> query m |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Stage is live · You are in the audience" ]
                    , \_ -> query m |> Query.findAll [ Selector.class "onyx-call-person" ] |> Query.count (Expect.equal 1)
                    , \_ -> query m |> Query.find [ Selector.class "onyx-call-person" ] |> Query.has [ attr "data-nick" "host" ]
                    , \_ -> query m |> Query.find [ testid "stage-audience" ] |> Query.has [ Selector.text "Audience · 3 listening · 0 raised hands" ]
                    , \_ -> query m |> Query.find [ testid "call-security-chip" ] |> Query.has [ attr "data-level" "stage", Selector.text "Stage broadcast" ]
                    ]
                    ()
        , test "audience bar swaps to Raise hand / Leave stage / Leave" <|
            \_ ->
                let
                    m =
                        audience |> inCallAt [ "me", "host" ]
                in
                Expect.all
                    [ \_ -> query m |> Query.findAll [ testid "call-mute" ] |> Query.count (Expect.equal 0)
                    , \_ -> query m |> Query.find [ testid "stage-hand" ] |> Query.has [ attr "aria-pressed" "false", Selector.text "Raise hand" ]
                    , \_ -> query m |> Query.find [ testid "stage-bar-leave" ] |> Event.simulate Event.click |> Event.expect StageLeave
                    , \_ -> query m |> Query.find [ testid "call-leave" ] |> Query.has [ attr "aria-keyshortcuts" "Control+Shift+L Meta+Shift+L" ]
                    ]
                    ()
        , test "host keeps the full bar plus End stage and counts as a speaker" <|
            \_ ->
                let
                    m =
                        hosting |> withStage (\s -> { s | raisedHands = [ "alice" ] }) |> inCallAt [ "me", "host", "alice" ]
                in
                Expect.all
                    [ \_ -> query m |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Stage is live · You are a speaker" ]
                    , \_ -> query m |> Query.findAll [ testid "call-mute" ] |> Query.count (Expect.equal 1)
                    , \_ -> query m |> Query.find [ testid "stage-bar-end" ] |> Event.simulate Event.click |> Event.expect StageEnd
                    , \_ -> query m |> Query.find [ testid "stage-audience" ] |> Query.has [ Selector.text "Audience · 1 listening · 1 raised hand" ]
                    ]
                    ()
        , test "outside a stage nothing changes" <|
            \_ ->
                let
                    plain =
                        { base | channels = Dict.insert "#stage" { stageRoom | modes = "" } base.channels } |> inCallAt [ "me", "host", "alice" ]
                in
                Expect.all
                    [ \_ -> query plain |> Query.findAll [ Selector.class "onyx-call-person" ] |> Query.count (Expect.equal 3)
                    , \_ -> query plain |> Query.findAll [ testid "stage-audience" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "a PROP STAGE=1 room is live even before joining the stage" <|
            \_ ->
                let
                    props0 =
                        base.props

                    propped =
                        { base | props = { props0 | channelProps = Dict.fromList [ ( "#stage", Dict.fromList [ ( "STAGE", "1" ) ] ) ] } }
                in
                query propped |> Query.find [ testid "stage-panel" ] |> Query.has [ attr "data-active" "true" ]
        ]



-- C12 · CHORDS


chords : Test
chords =
    describe "call chords"
        [ test "ports names decode to chords; unknown names stay unknown" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Switcher.CallChord "mute") (Switcher.shortcutFromString "call-mute")
                    , \_ -> Expect.equal (Just Stage.ChordLayout) (Stage.chordFromName "layout")
                    , \_ -> Expect.equal Nothing (Stage.chordFromName "captions")
                    , \_ -> Expect.equal Switcher.UnknownShortcut (Switcher.shortcutFromString "mute")
                    ]
                    ()
        , test "mute and camera chords toggle only in a live call" <|
            \_ ->
                let
                    m =
                        base |> withStage (always Stage.blank) |> (\x -> { x | channels = Dict.insert "#stage" { stageRoom | modes = "" } x.channels }) |> inCallAt [ "me", "host" ]
                in
                Expect.all
                    [ \_ -> Expect.equal ( True, [ VoiceMute { muted = True } ] ) (chord "mute" m |> Tuple.mapFirst .callSelfMuted)
                    , \_ -> Expect.equal True (Tuple.first (chord "camera" m)).callLocal.camera
                    , \_ -> Expect.equal [] (Tuple.second (chord "mute" base))
                    , \_ -> Expect.equal base.callSelfMuted (Tuple.first (chord "mute" base)).callSelfMuted
                    ]
                    ()
        , test "reconnecting leaves only Leave" <|
            \_ ->
                let
                    m =
                        audience |> inCallAt [ "me", "host" ] |> (\x -> { x | connection = Offline })
                in
                Expect.all
                    [ \_ -> Expect.equal [] (Tuple.second (chord "mute" m))
                    , \_ -> Expect.equal [ VoiceLeave { channel = "#stage" } ] (Tuple.second (chord "leave" m))
                    ]
                    ()
        , test "leave with more than two people asks first; Escape stays, confirm leaves" <|
            \_ ->
                let
                    crowd =
                        audience |> inCallAt [ "me", "host", "alice" ]

                    asked =
                        Tuple.first (chord "leave" crowd)
                in
                Expect.all
                    [ \_ -> Expect.equal [] (Tuple.second (chord "leave" crowd))
                    , \_ -> Expect.equal True asked.callLeaveConfirm
                    , \_ -> query asked |> Query.find [ testid "call-leave-confirm" ] |> Query.has [ attr "role" "dialog", Selector.text "Leave the call?", Selector.text "2 other people are still in #stage. You can rejoin from the room." ]
                    , \_ -> query asked |> Query.find [ testid "call-leave-stay" ] |> Query.has [ attr "data-onyx-autofocus" "call-leave-confirm" ]
                    , \_ -> Expect.equal False (step (ShortcutPressed Switcher.Dismiss) asked).callLeaveConfirm
                    , \_ -> Expect.equal [ VoiceLeave { channel = "#stage" } ] (outs CallLeaveConfirmed asked)
                    , \_ -> Expect.equal [ VoiceLeave { channel = "#stage" } ] (Tuple.second (chord "leave" (audience |> inCallAt [ "me", "host" ])))
                    ]
                    ()
        , test "hand chord drives the stage hand for the audience only" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ line "PRIVMSG" [ "#stage", "\u{0001}STAGE RAISE_HAND\u{0001}" ] ] (Tuple.second (chord "hand" (audience |> inCallAt [ "me", "host" ])))
                    , \_ -> Expect.equal [] (Tuple.second (chord "hand" (hosting |> inCallAt [ "me", "host" ])))
                    ]
                    ()
        , test "layout chord cycles grid → spotlight → grid; size chord cycles the stage" <|
            \_ ->
                let
                    m =
                        audience |> inCallAt [ "me", "host" ]

                    once =
                        Tuple.first (chord "layout" m)
                in
                Expect.all
                    [ \_ -> Expect.equal CallMedia.LayoutSpotlight once.callLayout
                    , \_ -> Expect.equal CallMedia.LayoutGrid (Tuple.first (chord "layout" once)).callLayout
                    , \_ -> Expect.equal (CallMedia.nextStageSize m.callStageSize) (Tuple.first (chord "size" m)).callStageSize
                    ]
                    ()
        , test "who-is-speaking announces into the call announcer" <|
            \_ ->
                let
                    m =
                        audience |> inCallAt [ "me", "host", "alice" ]

                    media0 =
                        m.media

                    talking =
                        { m | media = { media0 | speaking = Set.fromList [ "host" ] } }
                in
                Expect.all
                    [ \_ -> Expect.equal "host is speaking" (Tuple.first (chord "speaker" talking)).callAnnouncer.message
                    , \_ -> Expect.equal "No one is speaking" (Tuple.first (chord "speaker" m)).callAnnouncer.message
                    , \_ -> Expect.equal "a and b are speaking" (Stage.speakingAnnouncement [ "a", "b" ])
                    , \_ -> Expect.equal "4 people are speaking" (Stage.speakingAnnouncement [ "a", "b", "c", "d" ])
                    ]
                    ()
        ]



-- C12 · A11Y


a11y : Test
a11y =
    describe "a11y pass"
        [ test "every bar control advertises its chord" <|
            \_ ->
                let
                    m =
                        { base | channels = Dict.insert "#stage" { stageRoom | modes = "" } base.channels } |> inCallAt [ "me", "host" ]
                in
                Expect.all
                    [ \_ -> query m |> Query.find [ testid "call-mute" ] |> Query.has [ attr "aria-keyshortcuts" "Control+Shift+M Meta+Shift+M" ]
                    , \_ -> query m |> Query.find [ testid "camera-button" ] |> Query.has [ attr "aria-keyshortcuts" "Control+Shift+E Meta+Shift+E" ]
                    , \_ -> query m |> Query.find [ testid "call-leave" ] |> Query.has [ attr "aria-keyshortcuts" "Control+Shift+L Meta+Shift+L" ]
                    , \_ -> query (step CallMoreToggle m) |> Query.find [ testid "layout-button" ] |> Query.has [ attr "aria-keyshortcuts" "Control+Shift+G Meta+Shift+G" ]
                    , \_ -> query (step CallMoreToggle m) |> Query.find [ testid "stage-size-button" ] |> Query.has [ attr "aria-keyshortcuts" "Control+Shift+F Meta+Shift+F" ]
                    ]
                    ()
        , test "the announcer tells ports.js when call chords are live" <|
            \_ ->
                Expect.all
                    [ \_ -> query base |> Query.find [ testid "call-status-announcer" ] |> Query.has [ attr "data-call-keys" "off" ]
                    , \_ -> query (audience |> inCallAt [ "me" ]) |> Query.find [ testid "call-status-announcer" ] |> Query.has [ attr "data-call-keys" "on" ]
                    ]
                    ()
        , test "every chord is listed in the ? overlay under Voice & Video, all with a modifier" <|
            \_ ->
                let
                    group =
                        List.filter (\g -> g.group == "Voice & Video") Switcher.shortcutGroups

                    chordsListed =
                        List.concatMap (\g -> List.concatMap .chords g.rows) group

                    modifierless =
                        List.filter (\c -> c /= "Esc" && not (String.contains "Ctrl+Shift+" c || String.startsWith "⌘⇧" c)) chordsListed
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (List.length group)
                    , \_ -> Expect.equal [] modifierless
                    , \_ ->
                        Expect.equal True
                            (List.all (\c -> List.member c chordsListed)
                                [ "Ctrl+Shift+M", "Ctrl+Shift+E", "Ctrl+Shift+H", "Ctrl+Shift+L", "Ctrl+Shift+G", "Ctrl+Shift+F", "Ctrl+Shift+S" ]
                            )
                    , \_ -> query (step ShortcutsOpen base) |> Query.find [ testid "shortcuts-overlay" ] |> Query.has [ Selector.text "Voice & Video", Selector.text "Mute / unmute microphone" ]
                    ]
                    ()
        , test "stage copy vectors" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Audience · 23 listening · 2 raised hands" (Stage.audienceLine 23 2)
                    , \_ -> Expect.equal "Audience · 1 listening · 1 raised hand" (Stage.audienceLine 1 1)
                    , \_ -> Expect.equal "Stage is live · You are a speaker" (Stage.statusLine True)
                    ]
                    ()
        ]
