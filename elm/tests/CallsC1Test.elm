module CallsC1Test exposing (suite)

{-| v3/calls-c1 — calls slices C1–C3 (`elm/design/calls/CALLS_DESIGN.md`
§6): presence + join banner, voice-only stage + bar v1 + announcer,
security chip + privacy sheet. Oracle vectors from
`PresenceRibbon.test.ts`, `CallStatusAnnouncer.tsx`,
`callSecurity.test.ts`, `callPrivacy.ts` and `sfuCascade.ts`.
-}

import App exposing (..)
import CallUi exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Media exposing (CallLifecycle(..), CallOutcome(..), HubPresentation(..))
import Prefs
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View


query : Model -> Query.Single Msg
query model =
    View.view model
        |> .body
        |> Html.div []
        |> Query.fromHtml


member : String -> List Char -> App.Member
member nick modes =
    { nick = nick, modes = Set.fromList modes, away = False }


harbor : App.Channel
harbor =
    { name = "#harbor"
    , topic = "weekly planning"
    , members =
        Dict.fromList
            [ ( "mara", member "Mara" [ 'o' ] )
            , ( "jun", member "jun" [] )
            , ( "tove", member "tove" [ 'v' ] )
            , ( "odalys", member "odalys" [ 'q' ] )
            ]
    , modes = ""
    , messages = []
    , lastSeen = Nothing
    , unread = 0
    , highlights = 0
    , createdAt = Nothing
    }


withVoice : List String -> Model -> Model
withVoice roster model =
    let
        media0 =
            model.media
    in
    { model | media = { media0 | participants = Dict.fromList [ ( "#harbor", roster ) ] } }


base : Model
base =
    { blank
        | ourNick = "odalys"
        , channels = Dict.fromList [ ( "#harbor", harbor ) ]
        , activeChannel = Just "#harbor"
    }


hubIn : CallLifecycle -> Maybe Int -> Media.CallHub
hubIn lifecycle startedAt =
    { lifecycle = lifecycle
    , channel = Just "#harbor"
    , withPeer = ""
    , startedAt = startedAt
    , outcome = Nothing
    }


mediaBlankHub : Media.CallHub
mediaBlankHub =
    Media.blankCallHub


inCall : Model
inCall =
    withVoice [ "odalys", "mara", "jun" ] { base | calls = hubIn InCall (Just 1000), nowMs = 725000 }


status : List String -> List String -> List String -> List String -> Bool -> Bool -> RoomStatus
status participants speaking raised muted current localMuted =
    roomStatus
        { participants = participants
        , speaking = Set.fromList speaking
        , raised = Set.fromList raised
        , muted = Set.fromList muted
        , currentCall = current
        , localMuted = localMuted
        }


aria : String -> Selector.Selector
aria label =
    Selector.attribute (Attr.attribute "aria-label" label)


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


suite : Test
suite =
    describe "calls C1–C3"
        [ presence
        , banner
        , stage
        , announcerVectors
        , securityVectors
        , privacySheetVectors
        ]


presence : Test
presence =
    describe "C1 presence"
        [ test "voice room status mirrors buildVoiceRoomStatus" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal { label = "Alice speaking", aria = "Alice is speaking" } (status [ "Alice" ] [ "alice" ] [] [] False False)
                    , \_ -> Expect.equal { label = "Bob raised", aria = "Bob has a hand raised" } (status [ "Bob" ] [] [ "bOB" ] [] False False)
                    , \_ -> Expect.equal { label = "1 muted", aria = "1 person is muted" } (status [ "Carol" ] [] [] [ "CAROL" ] False False)
                    , \_ -> Expect.equal "listening" (status [ "alice", "bob" ] [] [] [] True False).label
                    , \_ -> Expect.equal "2 speaking" (status [ "alice", "bob" ] [ "alice", "bob" ] [] [] False False).label
                    , \_ -> Expect.equal "2 raised" (status [ "alice", "bob" ] [] [ "alice", "bob" ] [] False False).label
                    , \_ -> Expect.equal { label = "alice speaking · muted", aria = "alice is speaking, your microphone is muted" } (status [ "alice", "bob" ] [ "alice" ] [] [] True True)
                    , \_ -> Expect.equal "" (status [ "alice" ] [] [] [] False False).label
                    ]
                    ()
        , test "chip label, aria and title" <|
            \_ ->
                let
                    s =
                        status [ "jun", "Mara", "tove" ] [ "mara" ] [] [] False False
                in
                Expect.all
                    [ \_ -> Expect.equal "3 in voice · Mara speaking" (chipLabel 3 s)
                    , \_ -> Expect.equal "3 people in voice in #harbor, Mara is speaking; join voice" (chipAria "#harbor" 3 False s)
                    , \_ -> Expect.equal "1 person in voice in #harbor, current call, you are listening" (chipAria "#harbor" 1 True (status [ "odalys" ] [] [] [] True False))
                    , \_ -> Expect.equal "jun, Mara, tove · Mara speaking" (chipTitle [ "jun", "Mara", "tove" ] s)
                    , \_ -> Expect.equal "2 in voice" (chipLabel 2 (status [ "a", "b" ] [] [] [] False False))
                    ]
                    ()
        , test "voice roster keeps room members, display case, sorted" <|
            \_ ->
                Expect.equal [ "jun", "Mara" ] (voiceRoster harbor.members [ "mara", "ghost", "jun", "mara" ])
        , test "sidebar count: none, faint, live, provisional" <|
            \_ ->
                let
                    m =
                        withVoice [ "mara", "jun", "tove" ] base

                    count model =
                        railPresence model.media model.calls "#harbor"
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (count base)
                    , \_ -> Expect.equal (Just { count = 3, pip = PipFaint, aria = "3 in voice" }) (count m)
                    , \_ -> Expect.equal (Just { count = 3, pip = PipLive, aria = "3 in voice, current call" }) (count { m | calls = hubIn InCall (Just 5) })
                    , \_ -> Expect.equal (Just { count = 3, pip = PipProvisional, aria = "3 in voice, current call" }) (count { m | calls = hubIn InCall Nothing })
                    , \_ -> Expect.equal (Just { count = 3, pip = PipFaint, aria = "3 in voice" }) (count { m | calls = { lifecycle = InCall, channel = Just "#elsewhere", withPeer = "", startedAt = Just 5, outcome = Nothing } })
                    ]
                    ()
        , test "sidebar row carries the voice count in its accessible name" <|
            \_ ->
                query (withVoice [ "mara", "jun", "tove" ] base)
                    |> Query.findAll [ testid "sidebar-voice-count" ]
                    |> Query.first
                    |> Query.has [ Selector.text "3" ]
        , test "header chip joins audio-only; in-call chip only navigates" <|
            \_ ->
                let
                    idle =
                        withVoice [ "mara", "jun", "tove" ] base
                in
                Expect.all
                    [ \_ ->
                        query idle
                            |> Query.find [ testid "ribbon-voice-chip" ]
                            |> Event.simulate Event.click
                            |> Event.expect (CallJoin { channel = "#harbor", video = False })
                    , \_ ->
                        query idle
                            |> Query.find [ testid "ribbon-voice-chip" ]
                            |> Query.has [ aria "3 people in voice in #harbor; join voice", Selector.attribute (Attr.attribute "data-active" "false") ]
                    , \_ ->
                        query inCall
                            |> Query.find [ testid "ribbon-voice-chip" ]
                            |> Event.simulate Event.click
                            |> Event.expect (CallsReturnToCall "#harbor")
                    , \_ ->
                        query inCall
                            |> Query.find [ testid "ribbon-voice-chip" ]
                            |> Query.has [ Selector.attribute (Attr.attribute "data-active" "true") ]
                    ]
                    ()
        , test "lifecycle pill and idle join button" <|
            \_ ->
                let
                    connecting =
                        { base | calls = hubIn InCall Nothing }

                    prefs0 =
                        base.prefs
                in
                Expect.all
                    [ \_ -> query connecting |> Query.find [ testid "ribbon-call-status" ] |> Query.has [ Selector.text "Connecting…" ]
                    , \_ -> query { base | calls = hubIn InCall (Just 1) } |> Query.find [ testid "ribbon-call-status" ] |> Query.has [ Selector.text "In call" ]
                    , \_ -> query { base | calls = hubIn RingingOut Nothing } |> Query.find [ testid "ribbon-call-status" ] |> Query.has [ Selector.text "Calling" ]
                    , \_ -> query base |> Query.find [ testid "ribbon-join-call" ] |> Query.has [ Selector.text "Call", aria "Join call" ]
                    , \_ -> query (withVoice [ "mara" ] base) |> Query.find [ testid "ribbon-join-call" ] |> Query.has [ Selector.text "Join call" ]
                    , \_ -> query base |> Query.find [ testid "ribbon-join-call" ] |> Event.simulate Event.click |> Event.expect (CallJoin { channel = "#harbor", video = False })
                    , \_ -> query { base | prefs = { prefs0 | voiceEntry = False } } |> Query.findAll [ testid "ribbon-join-call" ] |> Query.count (Expect.equal 0)
                    , \_ -> query connecting |> Query.findAll [ testid "ribbon-join-call" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "hub lists rooms with voice and only navigates" <|
            \_ ->
                query { base | callsOpen = True, media = (withVoice [ "mara" ] base).media }
                    |> Query.find [ testid "calls-hub-rooms" ]
                    |> Query.find [ Selector.tag "button" ]
                    |> Event.simulate Event.click
                    |> Event.expect (CallsReturnToCall "#harbor")
        ]


banner : Test
banner =
    describe "C1 join banner"
        [ test "invite banner when idle and people are in voice" <|
            \_ ->
                let
                    m =
                        withVoice [ "mara", "jun", "tove" ] base
                in
                Expect.all
                    [ \_ -> Expect.equal (Just (BannerInvite 3)) (bannerFor m "#harbor")
                    , \_ -> Expect.equal Nothing (bannerFor base "#harbor")
                    , \_ -> Expect.equal Nothing (bannerFor { m | calls = hubIn InCall Nothing } "#harbor")
                    , \_ -> Expect.equal "3 people are in voice." (inviteTitle 3)
                    , \_ -> Expect.equal "1 person is in voice." (inviteTitle 1)
                    , \_ -> query m |> Query.find [ testid "call-join-banner" ] |> Query.has [ Selector.text "3 people are in voice.", Selector.text "Join to listen; your microphone starts off until you unmute." ]
                    ]
                    ()
        , test "banner buttons map 1:1 to CallJoin" <|
            \_ ->
                let
                    local =
                        base.callLocal

                    q =
                        query (withVoice [ "mara" ] { base | callLocal = { local | cameraSupported = True } })
                in
                Expect.all
                    [ \_ -> q |> Query.find [ aria "Join call in #harbor" ] |> Event.simulate Event.click |> Event.expect (CallJoin { channel = "#harbor", video = False })
                    , \_ -> q |> Query.find [ aria "Join with video in #harbor" ] |> Event.simulate Event.click |> Event.expect (CallJoin { channel = "#harbor", video = True })
                    , \_ -> query (withVoice [ "mara" ] base) |> Query.findAll [ aria "Join with video in #harbor" ] |> Query.count (Expect.equal 0)
                    , \_ -> q |> Query.find [ aria "Hide voice banner" ] |> Event.simulate Event.click |> Event.expect (CallBannerDismiss "#harbor")
                    ]
                    ()
        , test "dismiss persists for the session, per room" <|
            \_ ->
                let
                    m =
                        withVoice [ "mara" ] base
                            |> step (CallBannerDismiss "#Harbor")
                            |> step CallMoreClose
                            |> step (ChannelSelect "#harbor")
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (bannerFor m "#harbor")
                    , \_ -> Expect.equal True (Set.member "#harbor" m.callBannerDismissed)
                    , \_ -> query m |> Query.findAll [ testid "call-join-banner" ] |> Query.count (Expect.equal 0)
                    , \_ -> query m |> Query.findAll [ testid "ribbon-voice-chip" ] |> Query.count (Expect.equal 1)
                    ]
                    ()
        , test "failed banner shows on CallFailed for the room that tried" <|
            \_ ->
                let
                    joined =
                        step (CallJoin { channel = "#harbor", video = False }) base

                    failed =
                        step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "idle" ), ( "outcome", Encode.string "failed" ) ])) joined
                in
                Expect.all
                    [ \_ -> Expect.equal (Just BannerFailed) (bannerFor failed "#harbor")
                    , \_ -> Expect.equal Nothing (bannerFor failed "#other")
                    , \_ -> query failed |> Query.find [ testid "call-join-banner" ] |> Query.has [ Selector.text "Couldn't join. Try again.", Selector.text "Your place in #harbor is kept.", Selector.attribute (Attr.attribute "role" "status") ]
                    , \_ -> query failed |> Query.find [ testid "call-join-retry" ] |> Event.simulate Event.click |> Event.expect (CallJoin { channel = "#harbor", video = False })
                    ]
                    ()
        , test "join muted is the default (provisional)" <|
            \_ ->
                let
                    ( m, outs ) =
                        update (CallJoin { channel = "#harbor", video = False }) base
                in
                Expect.all
                    [ \_ -> Expect.equal True joinMutedDefault
                    , \_ -> Expect.equal True m.callSelfMuted
                    , \_ -> Expect.equal [ VoiceJoin { channel = "#harbor", video = False }, VoiceMute { muted = True } ] outs
                    ]
                    ()
        ]


stage : Test
stage =
    describe "C2 voice stage + bar"
        [ test "stage status strings" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Call is live" (stageStatus (hubIn InCall (Just 1)) Nothing)
                    , \_ -> Expect.equal "Connecting to the call…" (stageStatus (hubIn InCall Nothing) Nothing)
                    , \_ -> Expect.equal "Connecting to the call…" (stageStatus (hubIn RingingOut Nothing) Nothing)
                    , \_ -> Expect.equal "Call is live · Protected connection" (stageStatus (hubIn InCall (Just 1)) (Just "Protected connection"))
                    , \_ -> Expect.equal "Ready to join…" (stageStatus Media.blankCallHub (Just "x"))
                    , \_ -> Expect.equal "Call ended" (stageStatus { mediaBlankHub | outcome = Just CallEnded } Nothing)
                    ]
                    ()
        , test "people: self first, join order, muted beats speaking, roles as words" <|
            \_ ->
                let
                    media0 =
                        inCall.media

                    media =
                        { media0 | speaking = Set.fromList [ "jun", "odalys" ], muted = Set.fromList [ "jun" ], hands = Set.fromList [ "mara" ] }

                    people =
                        stagePeople
                            { ourNick = "odalys"
                            , roster = [ "mara", "jun", "odalys" ]
                            , media = media
                            , selfMuted = False
                            , displayName = \k -> Dict.get k harbor.members |> Maybe.map .nick |> Maybe.withDefault k
                            , roleOf = \k -> Dict.get k harbor.members |> Maybe.andThen (.modes >> roleWord)
                            }
                in
                Expect.all
                    [ \_ -> Expect.equal [ "odalys", "Mara", "jun" ] (List.map .name people)
                    , \_ -> Expect.equal [ "odalys (you), speaking", "Mara, hand raised", "jun, muted" ] (List.map personAria people)
                    , \_ -> Expect.equal [ Just "owner", Just "op", Nothing ] (List.map .role people)
                    ]
                    ()
        , test "self mute flag silences the self speaking ring" <|
            \_ ->
                let
                    media0 =
                        inCall.media

                    people =
                        stagePeople
                            { ourNick = "odalys"
                            , roster = []
                            , media = { media0 | speaking = Set.fromList [ "odalys" ] }
                            , selfMuted = True
                            , displayName = identity
                            , roleOf = \_ -> Nothing
                            }
                in
                Expect.equal [ "odalys (you), muted" ] (List.map personAria people)
        , test "density thresholds" <|
            \_ ->
                Expect.equal [ DensityFull, DensityFull, DensityCompact, DensityCompact, DensityCollapsed ] (List.map stageDensity [ 1, 12, 13, 24, 25 ])
        , test "timer from startedAt" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal { text = "12:04", aria = "Call duration: 12 minutes 04 seconds" } (formatDuration 724000)
                    , \_ -> Expect.equal { text = "1:02:18", aria = "Call duration: 1 hour 02 minutes 18 seconds" } (formatDuration 3738000)
                    , \_ -> Expect.equal { text = "03:40", aria = "Call duration: 3 minutes 40 seconds" } (formatDuration 220000)
                    , \_ -> Expect.equal { text = "00:00", aria = "Call duration: 0 minutes 00 seconds" } (formatDuration -5)
                    , \_ -> query inCall |> Query.find [ testid "call-timer" ] |> Query.has [ Selector.text "12:04", aria "Call duration: 12 minutes 04 seconds", Selector.attribute (Attr.attribute "role" "timer") ]
                    , \_ -> query { inCall | calls = hubIn InCall Nothing } |> Query.findAll [ testid "call-timer" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "people label" <|
            \_ -> Expect.equal [ "1 person", "4 people" ] [ peopleLabel 1, peopleLabel 4 ]
        , test "stage renders in the room with toolbar, status and cells" <|
            \_ ->
                let
                    q =
                        query inCall
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "voice-stage" ] |> Query.has [ aria "Voice call participants", Selector.attribute (Attr.attribute "role" "region") ]
                    , \_ -> q |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Call is live · Protected connection" ]
                    , \_ -> q |> Query.find [ testid "voice-bar" ] |> Query.has [ aria "Voice call controls", Selector.attribute (Attr.attribute "role" "toolbar"), Selector.text "· 3 people" ]
                    , \_ -> q |> Query.findAll [ Selector.class "onyx-call-person" ] |> Query.count (Expect.equal 3)
                    , \_ -> q |> Query.findAll [ testid "call-join-banner" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "speaking ring is static when scene motion is off" <|
            \_ ->
                Expect.all
                    [ \_ -> query { inCall | sceneMotion = Prefs.SceneOff } |> Query.find [ testid "voice-stage" ] |> Query.has [ Selector.attribute (Attr.attribute "data-motion" "still") ]
                    , \_ -> query { inCall | sceneMotion = Prefs.SceneAnimated } |> Query.find [ testid "voice-stage" ] |> Query.has [ Selector.attribute (Attr.attribute "data-motion" "full") ]
                    ]
                    ()
        , test "mute button reflects the flag; leave resets it" <|
            \_ ->
                let
                    muted =
                        { inCall | callSelfMuted = True, callMoreOpen = True }

                    ( left, outs ) =
                        update CallLeave muted
                in
                Expect.all
                    [ \_ -> query muted |> Query.find [ testid "call-mute" ] |> Query.has [ aria "Unmute microphone", Selector.attribute (Attr.attribute "aria-pressed" "true"), Selector.text "Unmute" ]
                    , \_ -> query inCall |> Query.find [ testid "call-mute" ] |> Query.has [ aria "Mute microphone", Selector.attribute (Attr.attribute "aria-pressed" "false") ]
                    , \_ -> query inCall |> Query.find [ testid "call-mute" ] |> Event.simulate Event.click |> Event.expect CallToggleMute
                    , \_ -> query inCall |> Query.find [ aria "Leave voice call" ] |> Event.simulate Event.click |> Event.expect CallLeave
                    , \_ -> Expect.equal False left.callSelfMuted
                    , \_ -> Expect.equal [ VoiceLeave { channel = "#harbor" } ] outs
                    ]
                    ()
        , test "More opens the tools dialog with the settings stub; idle refuses" <|
            \_ ->
                let
                    opened =
                        step CallMoreToggle inCall
                in
                Expect.all
                    [ \_ -> Expect.equal True opened.callMoreOpen
                    , \_ -> Expect.equal False (step CallMoreToggle base).callMoreOpen
                    , \_ -> Expect.equal False (step CallMoreClose opened).callMoreOpen
                    , \_ -> query opened |> Query.find [ testid "call-more-tools" ] |> Query.has [ aria "More call tools", Selector.attribute (Attr.attribute "role" "dialog"), Selector.text "Open voice settings" ]
                    , \_ -> query opened |> Query.find [ testid "call-more" ] |> Query.has [ Selector.attribute (Attr.attribute "aria-expanded" "true"), Selector.attribute (Attr.attribute "aria-haspopup" "dialog") ]
                    , \_ -> query opened |> Query.find [ testid "call-more-tools" ] |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Escape" ) ])) |> Event.expect CallMoreClose
                    , \_ -> Expect.equal False (step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "idle" ) ])) opened).callMoreOpen
                    ]
                    ()
        , test "established hub shows the stage inline" <|
            \_ ->
                query { inCall | callsOpen = True }
                    |> Query.findAll [ testid "voice-stage" ]
                    |> Query.count (Expect.equal 1)
        ]


announcerVectors : Test
announcerVectors =
    describe "C2 announcer"
        [ test "name lists: 1/2/3/N" <|
            \_ ->
                Expect.equal
                    [ "alice", "alice and bob", "alice, bob and carol", "4 people" ]
                    [ nameList [ "alice" ], nameList [ "alice", "bob" ], nameList [ "alice", "bob", "carol" ], nameList [ "a", "b", "c", "d" ] ]
        , test "baseline is silent; deltas announce with has/have; self never" <|
            \_ ->
                let
                    hub =
                        hubIn InCall (Just 1)

                    media rosterList =
                        let
                            m0 =
                                blank.media
                        in
                        { m0 | participants = Dict.fromList [ ( "#harbor", rosterList ) ] }

                    run rosterList prev =
                        announceStep identity "odalys" hub (media rosterList) prev

                    a0 =
                        run [ "odalys", "mara" ] blankAnnouncer

                    a1 =
                        run [ "odalys", "mara", "jun" ] a0

                    a2 =
                        run [ "odalys", "mara", "jun", "tove", "kit" ] a1

                    a3 =
                        run [ "odalys" ] a2

                    a4 =
                        run [ "odalys", "rafe" ] a3

                    a5 =
                        run [ "rafe" ] a4

                    a6 =
                        run [ "rafe", "a", "b", "c", "d" ] a5
                in
                Expect.all
                    [ \_ -> Expect.equal "" a0.message
                    , \_ -> Expect.equal "jun has joined the call" a1.message
                    , \_ -> Expect.equal "tove and kit have joined the call" a2.message
                    , \_ -> Expect.equal "4 people have left the call" a3.message
                    , \_ -> Expect.equal "rafe has joined the call" a4.message
                    , \_ -> Expect.equal a4 a5
                    , \_ -> Expect.equal "4 people have joined the call" a6.message
                    ]
                    ()
        , test "joins and leaves in one step; idle resets the baseline" <|
            \_ ->
                let
                    hub =
                        hubIn InCall (Just 1)

                    media rosterList =
                        let
                            m0 =
                                blank.media
                        in
                        { m0 | participants = Dict.fromList [ ( "#harbor", rosterList ) ] }

                    a0 =
                        announceStep identity "me" hub (media [ "mara" ]) blankAnnouncer

                    a1 =
                        announceStep identity "me" hub (media [ "jun" ]) a0

                    idle =
                        announceStep identity "me" Media.blankCallHub (media [ "jun" ]) a1

                    again =
                        announceStep identity "me" hub (media [ "jun", "kit" ]) idle
                in
                Expect.all
                    [ \_ -> Expect.equal "jun has joined the call. mara has left the call" a1.message
                    , \_ -> Expect.equal Nothing idle.baseline
                    , \_ -> Expect.equal a1.message again.message
                    , \_ -> Expect.equal (Just [ "jun", "kit" ]) again.baseline
                    ]
                    ()
        , test "a peer raising a hand is announced once" <|
            \_ ->
                let
                    hub =
                        hubIn InCall (Just 1)

                    m0 =
                        blank.media

                    plain =
                        { m0 | participants = Dict.fromList [ ( "#harbor", [ "mara" ] ) ] }

                    raised =
                        { plain | hands = Set.fromList [ "mara" ] }

                    a0 =
                        announceStep identity "me" hub plain blankAnnouncer

                    a1 =
                        announceStep identity "me" hub raised a0
                in
                Expect.all
                    [ \_ -> Expect.equal "mara raised a hand" a1.message
                    , \_ -> Expect.equal a1 (announceStep identity "me" hub raised a1)
                    ]
                    ()
        , test "update settles the announcer with display names" <|
            \_ ->
                let
                    first =
                        step CallMoreClose inCall

                    joined =
                        step CallMoreClose (withVoice [ "odalys", "mara", "jun", "tove" ] first)
                in
                Expect.all
                    [ \_ -> Expect.equal "" first.callAnnouncer.message
                    , \_ -> Expect.equal "tove has joined the call" joined.callAnnouncer.message
                    , \_ -> query joined |> Query.find [ testid "call-status-announcer" ] |> Query.has [ Selector.text "tove has joined the call", Selector.attribute (Attr.attribute "aria-live" "polite") ]
                    , \_ -> query blank |> Query.findAll [ testid "call-status-announcer" ] |> Query.count (Expect.equal 1)
                    ]
                    ()
        ]


feed : SecurityFeed
feed =
    blankSecurityFeed


securityVectors : Test
securityVectors =
    describe "C3 security"
        [ test "idle renders nothing" <|
            \_ -> Expect.equal Nothing (resolveSecurity Idle feed)
        , test "hop-protected in-call media: shield, no padlock" <|
            \_ ->
                case resolveSecurity InCall feed of
                    Just s ->
                        Expect.equal ( SecHopProtected, IconShield, False ) ( s.level, s.icon, s.usesPadlock )

                    Nothing ->
                        Expect.fail "expected a chip"
        , test "ringing shows connecting" <|
            \_ ->
                Expect.equal [ Just ( SecConnecting, IconSpinner ), Just ( SecConnecting, IconSpinner ) ]
                    (List.map (\l -> resolveSecurity l feed |> Maybe.map (\s -> ( s.level, s.icon ))) [ RingingIn, RingingOut ])
        , test "padlock only when E2EE is active in call" <|
            \_ ->
                let
                    s =
                        resolveSecurity InCall { feed | e2eeActive = True }
                in
                Expect.equal (Just ( SecE2ee, IconLock, True )) (Maybe.map (\x -> ( x.level, x.icon, x.usesPadlock )) s)
        , test "priority: stage > insecure > degraded > e2ee" <|
            \_ ->
                let
                    level f =
                        resolveSecurity InCall f |> Maybe.map (\s -> ( s.level, s.icon, s.usesPadlock ))
                in
                Expect.all
                    [ \_ -> Expect.equal (Just ( SecStage, IconStage, False )) (level { feed | stageMode = True, transportInsecure = True, e2eeActive = True, e2eeDegraded = True })
                    , \_ -> Expect.equal (Just ( SecInsecure, IconWarning, False )) (level { feed | transportInsecure = True, e2eeActive = True, e2eeDegraded = True })
                    , \_ -> Expect.equal (Just ( SecE2eeDegraded, IconLockOpen, False )) (level { feed | e2eeActive = True, e2eeDegraded = True })
                    ]
                    ()
        , test "honesty: E2EE while ringing never shows a closed padlock" <|
            \_ ->
                Expect.equal (Just ( SecE2ee, IconLockOpen, False ))
                    (resolveSecurity RingingOut { feed | e2eeActive = True } |> Maybe.map (\s -> ( s.level, s.icon, s.usesPadlock )))
        , test "copy and tones" <|
            \_ ->
                let
                    s f =
                        resolveSecurity InCall f |> Maybe.map (\x -> ( x.label, toneWord x.tone ))
                in
                Expect.all
                    [ \_ -> Expect.equal (Just ( "Protected connection", "ok" )) (s feed)
                    , \_ -> Expect.equal (Just ( "End-to-end encrypted", "ok" )) (s { feed | e2eeActive = True })
                    , \_ -> Expect.equal (Just ( "Not end-to-end", "warn" )) (s { feed | e2eeDegraded = True })
                    , \_ -> Expect.equal (Just ( "Not secure", "danger" )) (s { feed | transportInsecure = True })
                    , \_ -> Expect.equal (Just ( "Stage broadcast", "warn" )) (s { feed | stageMode = True })
                    ]
                    ()
        , test "privacy titles and media path" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "Call privacy", "Call privacy", "End-to-end encrypted call", "Call privacy", "Call not secure", "Stage broadcast" ] (List.map privacyTitle [ SecConnecting, SecHopProtected, SecE2ee, SecE2eeDegraded, SecInsecure, SecStage ])
                    , \_ -> Expect.equal "End-to-end — only people in this call can hear or see." (mediaPathCopy SecE2ee)
                    , \_ -> Expect.equal "Encrypted to this server — operators can access call media." (mediaPathCopy SecE2eeDegraded)
                    ]
                    ()
        , test "SFU cascade view" <|
            \_ ->
                Expect.equal
                    [ "SFU path unknown", "Local SFU", "Network relay · 3 hops", "Media path degraded", "SFU path unknown" ]
                    (List.map (sfuView >> .label)
                        [ Nothing
                        , Just { localSfu = True, remoteForwarders = 0, packetLoss = 0 }
                        , Just { localSfu = True, remoteForwarders = 2, packetLoss = 0.01 }
                        , Just { localSfu = True, remoteForwarders = 0, packetLoss = 0.2 }
                        , Just { localSfu = False, remoteForwarders = 0, packetLoss = 0 }
                        ]
                    )
        , test "fingerprints: 12 Base58 chars, grouped 3×4" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (validFingerprint "3Qm7Kx9P2bVe")
                    , \_ -> Expect.equal False (validFingerprint "3Qm7Kx9P2bV0")
                    , \_ -> Expect.equal False (validFingerprint "short")
                    , \_ -> Expect.equal "3Qm7 Kx9P 2bVe" (fingerprintGroups "3Qm7Kx9P2bVe")
                    ]
                    ()
        , test "snapshot trust fields decode fail-closed and merge" <|
            \_ ->
                let
                    decode fields prev =
                        decodeSecurityFeed InCall (Encode.object (( "state", Encode.string "in_call" ) :: fields)) prev

                    rich =
                        decode
                            [ ( "securityLevel", Encode.string "e2ee" )
                            , ( "localFingerprint", Encode.string "3Qm7Kx9P2bVe" )
                            , ( "peerFingerprints", Encode.object [ ( "Mara", Encode.string "8Hc2Tn4Q1zRw" ), ( "bad,nick", Encode.string "8Hc2Tn4Q1zRw" ), ( "jun", Encode.string "nope" ) ] )
                            , ( "sfu", Encode.object [ ( "localSfu", Encode.bool True ) ] )
                            ]
                            feed

                    kept =
                        decode [] rich

                    corrupt =
                        decode [ ( "e2eeActive", Encode.string "yes" ), ( "localFingerprint", Encode.string "0000" ) ] rich
                in
                Expect.all
                    [ \_ -> Expect.equal True rich.e2eeActive
                    , \_ -> Expect.equal (FpReady "3Qm7Kx9P2bVe") rich.localFingerprint
                    , \_ -> Expect.equal [ ( "mara", "8Hc2Tn4Q1zRw" ) ] (Dict.toList rich.peerFingerprints)
                    , \_ -> Expect.equal (Just { localSfu = True, remoteForwarders = 0, packetLoss = 0 }) rich.sfu
                    , \_ -> Expect.equal rich kept
                    , \_ -> Expect.equal False corrupt.e2eeActive
                    , \_ -> Expect.equal FpUnavailable corrupt.localFingerprint
                    , \_ -> Expect.equal FpLoading (decode [ ( "fingerprintPending", Encode.bool True ) ] feed).localFingerprint
                    , \_ -> Expect.equal blankSecurityFeed (decodeSecurityFeed Idle (Encode.object [ ( "e2eeActive", Encode.bool True ) ]) rich)
                    , \_ -> Expect.equal False (decode [ ( "securityLevel", Encode.string "hop_protected" ) ] rich).e2eeActive
                    ]
                    ()
        , test "snapshot feed reaches the model; idle clears it" <|
            \_ ->
                let
                    snap fields =
                        CallHubSnapshot (Encode.object fields)

                    live =
                        step (snap [ ( "state", Encode.string "in_call" ), ( "channel", Encode.string "#harbor" ), ( "startedAt", Encode.int 5 ), ( "e2eeActive", Encode.bool True ) ]) base

                    gone =
                        step (snap [ ( "state", Encode.string "idle" ) ]) live
                in
                Expect.all
                    [ \_ -> Expect.equal True live.callSecurityFeed.e2eeActive
                    , \_ -> Expect.equal blankSecurityFeed gone.callSecurityFeed
                    ]
                    ()
        ]


privacySheetVectors : Test
privacySheetVectors =
    describe "C3 chip + privacy sheet"
        [ test "chip aria, tone and opener" <|
            \_ ->
                let
                    q =
                        query inCall
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "call-security-chip" ] |> Query.has [ aria "Protected connection — encrypted to this server. Server operators can access call media. Open call privacy details.", Selector.attribute (Attr.attribute "data-tone" "ok"), Selector.attribute (Attr.attribute "aria-haspopup" "dialog"), Selector.attribute (Attr.attribute "data-icon" "shield") ]
                    , \_ -> q |> Query.find [ testid "call-security-chip" ] |> Event.simulate Event.click |> Event.expect CallPrivacyOpen
                    , \_ -> query { inCall | callSecurityFeed = { feed | e2eeActive = True } } |> Query.find [ testid "call-security-chip" ] |> Query.has [ Selector.attribute (Attr.attribute "data-icon" "lock"), Selector.text "End-to-end encrypted" ]
                    ]
                    ()
        , test "sheet opens only for a live call and closes on idle" <|
            \_ ->
                let
                    opened =
                        step CallPrivacyOpen inCall
                in
                Expect.all
                    [ \_ -> Expect.equal True opened.callPrivacyOpen
                    , \_ -> Expect.equal False (step CallPrivacyOpen base).callPrivacyOpen
                    , \_ -> Expect.equal False (step CallPrivacyClose opened).callPrivacyOpen
                    , \_ -> Expect.equal False (step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "idle" ) ])) opened).callPrivacyOpen
                    ]
                    ()
        , test "sheet copy: title, reserved privacy code, fingerprints, peers" <|
            \_ ->
                let
                    m =
                        { inCall
                            | callPrivacyOpen = True
                            , callSecurityFeed =
                                { feed
                                    | e2eeActive = True
                                    , localFingerprint = FpReady "3Qm7Kx9P2bVe"
                                    , peerFingerprints = Dict.fromList [ ( "mara", "8Hc2Tn4Q1zRw" ) ]
                                }
                        }

                    sheet =
                        query m |> Query.find [ testid "call-privacy-sheet" ]
                in
                Expect.all
                    [ \_ -> sheet |> Query.has [ Selector.attribute (Attr.attribute "role" "dialog"), Selector.attribute (Attr.attribute "aria-modal" "true"), Selector.attribute (Attr.attribute "aria-labelledby" "call-privacy-title") ]
                    , \_ -> sheet |> Query.has [ Selector.text "End-to-end encrypted call", Selector.text "How this call is protected." ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-epoch" ] |> Query.has [ Selector.text "Available when end-to-end media encryption is active." ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-local-fingerprint" ] |> Query.has [ Selector.text "3Qm7 Kx9P 2bVe" ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-server-access" ] |> Query.has [ Selector.text "End-to-end — only people in this call can hear or see." ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-peers" ] |> Query.has [ Selector.text "Mara", Selector.text "8Hc2 Tn4Q 1zRw", Selector.text "jun", Selector.text "Loading…" ]
                    , \_ -> sheet |> Query.find [ aria "Close call privacy" ] |> Query.has [ Selector.attribute (Attr.attribute "data-initial-focus" "true") ]
                    , \_ -> sheet |> Query.find [ aria "Close call privacy" ] |> Event.simulate Event.click |> Event.expect CallPrivacyClose
                    , \_ -> sheet |> Event.simulate (Event.custom "keydown" (Encode.object [ ( "key", Encode.string "Escape" ) ])) |> Event.expect CallPrivacyClose
                    , \_ -> sheet |> Query.has [ Selector.text "Compare this code out of band to confirm your media identity. It does not prove end-to-end encryption by itself." ]
                    ]
                    ()
        , test "hop-only sheet never claims end-to-end; unavailable fingerprint" <|
            \_ ->
                let
                    sheet =
                        query { inCall | callPrivacyOpen = True } |> Query.find [ testid "call-privacy-sheet" ]
                in
                Expect.all
                    [ \_ -> sheet |> Query.has [ Selector.text "Call privacy", Selector.attribute (Attr.attribute "data-privacy-level" "hop_protected") ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-server-access" ] |> Query.has [ Selector.text "Encrypted to this server — operators can access call media." ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-local-fingerprint" ] |> Query.has [ Selector.text "Unavailable until the media engine is ready." ]
                    , \_ -> sheet |> Query.find [ testid "call-privacy-sfu-cascade" ] |> Query.has [ Selector.text "SFU path unknown" ]
                    ]
                    ()
        ]
