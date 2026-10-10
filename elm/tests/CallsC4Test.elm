module CallsC4Test exposing (suite)

{-| v3/calls-c4 — calls slices C4 (camera / share / deafen commands +
connection quality) and C5 (video grid, tiles, layouts, dominant
speaker, paging) per `elm/design/calls/CALLS_DESIGN.md` §6. Oracle
vectors from `connectionQualityAction.test.ts`,
`bandwidthLadderFeedback.test.ts`, `activeSpeaker.test.ts`,
`ParticipantTile.tsx` and `VoiceBar.tsx`.
-}

import App exposing (..)
import CallMedia exposing (..)
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Encode as Encode
import Media exposing (CallLifecycle(..))
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
            , ( "kit", member "kit" [] )
            , ( "odalys", member "odalys" [ 'q' ] )
            ]
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
        , channels = Dict.fromList [ ( "#harbor", harbor ) ]
        , activeChannel = Just "#harbor"
        , nowMs = 100000
    }


withRoster : List String -> Model -> Model
withRoster roster model =
    let
        media0 =
            model.media
    in
    { model | media = { media0 | participants = Dict.fromList [ ( "#harbor", roster ) ] } }


snapshot : List ( String, Encode.Value ) -> Msg
snapshot fields =
    CallHubSnapshot
        (Encode.object
            ([ ( "state", Encode.string "in_call" )
             , ( "channel", Encode.string "#harbor" )
             , ( "startedAt", Encode.int 1000 )
             ]
                ++ fields
            )
        )


inCall : Model
inCall =
    base
        |> withRoster [ "odalys", "mara", "jun" ]
        |> step (snapshot [ ( "shareSupported", Encode.bool True ), ( "pipSupported", Encode.bool True ) ])


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


aria : String -> Selector.Selector
aria label =
    Selector.attribute (Attr.attribute "aria-label" label)


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


peersMsg : List ( String, String, Bool ) -> Msg
peersMsg list =
    CallPeerState
        (Encode.object
            [ ( "peers"
              , Encode.list
                    (\( nick, kind, video ) ->
                        Encode.object
                            [ ( "nick", Encode.string nick )
                            , ( "kind", Encode.string kind )
                            , ( "hasVideo", Encode.bool video )
                            ]
                    )
                    list
              )
            ]
        )


suite : Test
suite =
    describe "calls C4–C5"
        [ commands
        , quality
        , layout
        , speaker
        , tilesAndView
        ]



-- C4 · COMMANDS


commands : Test
commands =
    describe "C4 camera / share / deafen"
        [ test "camera toggle: aria-pressed, verb label, one command" <|
            \_ ->
                let
                    on =
                        step CallToggleCamera inCall
                in
                Expect.all
                    [ \_ -> query inCall |> Query.find [ testid "camera-button" ] |> Query.has [ aria "Turn on camera", attr "aria-pressed" "false", Selector.text "Camera" ]
                    , \_ -> query on |> Query.find [ testid "camera-button" ] |> Query.has [ aria "Turn off camera", attr "aria-pressed" "true", Selector.text "Camera" ]
                    , \_ -> Expect.equal [ VoiceCommand { verb = "camera", on = True, channel = "#harbor", tile = "" } ] (outs CallToggleCamera inCall)
                    , \_ -> query inCall |> Query.find [ testid "camera-button" ] |> Event.simulate Event.click |> Event.expect CallToggleCamera
                    ]
                    ()
        , test "camera switched off by the engine: no camera button, flag survives idle" <|
            \_ ->
                let
                    off =
                        { inCall | callLocal = CallMedia.decodeLocal Media.InCall (Encode.object [ ( "cameraSupported", Encode.bool False ) ]) inCall.callLocal }

                    idleAgain =
                        CallMedia.decodeLocal Media.Idle (Encode.object [ ( "state", Encode.string "idle" ) ]) off.callLocal
                in
                Expect.all
                    [ \_ -> query off |> Query.findAll [ testid "camera-button" ] |> Query.count (Expect.equal 0)
                    , \_ -> Expect.equal False idleAgain.cameraSupported
                    , \_ -> Expect.equal True (CallMedia.decodeLocal Media.InCall (Encode.object []) inCall.callLocal).cameraSupported
                    ]
                    ()
        , test "the engine answer overrides the optimistic camera flag" <|
            \_ ->
                let
                    refused =
                        inCall |> step CallToggleCamera |> step (snapshot [ ( "camera", Encode.bool False ) ])
                in
                Expect.equal False refused.callLocal.camera
        , test "no media commands outside a live call" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (outs CallToggleCamera base)
                    , \_ -> Expect.equal [] (outs CallToggleDeafen base)
                    , \_ -> Expect.equal [] (outs CallToggleShare base)
                    ]
                    ()
        , test "join with video starts with the camera intent" <|
            \_ ->
                Expect.equal True (step (CallJoin { channel = "#harbor", video = True }) base).callLocal.camera
        -- v3/calls-engine: iPhone/iPad WebKit report shareSupported = False;
        -- the phone path to Share (More) must then not offer it at all.
        , test "share unavailable: More menu does not offer Share" <|
            \_ ->
                let
                    opened =
                        inCall |> step (snapshot [ ( "shareSupported", Encode.bool False ) ]) |> step CallMoreToggle
                in
                Expect.all
                    [ \_ -> query opened |> Query.findAll [ testid "call-more-share" ] |> Query.count (Expect.equal 0)
                    , \_ -> query opened |> Query.find [ testid "deafen-button" ] |> Query.has [ aria "Deafen" ]
                    ]
                    ()
        , test "share unavailable: disabled with its own label, toggle inert" <|
            \_ ->
                let
                    unsupported =
                        base |> withRoster [ "odalys" ] |> step (snapshot [ ( "shareSupported", Encode.bool False ) ])
                in
                Expect.all
                    [ \_ -> query unsupported |> Query.find [ testid "screenshare-button" ] |> Query.has [ aria "Screen sharing unavailable", Selector.disabled True, attr "aria-pressed" "false" ]
                    , \_ -> Expect.equal [] (outs CallToggleShare unsupported)
                    , \_ -> Expect.equal "Screen sharing unavailable" (shareLabel blankLocal)
                    ]
                    ()
        , test "share: pending, started, refused, stopped" <|
            \_ ->
                let
                    pending =
                        step CallToggleShare inCall

                    started =
                        step (snapshot [ ( "screen", Encode.bool True ) ]) pending

                    refused =
                        step (snapshot [ ( "screen", Encode.bool False ), ( "screenError", Encode.bool True ) ]) pending

                    stopped =
                        step CallToggleShare started
                in
                Expect.all
                    [ \_ -> Expect.equal [ VoiceCommand { verb = "share", on = True, channel = "#harbor", tile = "" } ] (outs CallToggleShare inCall)
                    , \_ -> query pending |> Query.find [ testid "screenshare-button" ] |> Query.has [ aria "Starting screen sharing", Selector.disabled True, attr "aria-busy" "true" ]
                    , \_ -> Expect.equal [] (outs CallToggleShare pending)
                    , \_ -> query started |> Query.find [ testid "screenshare-button" ] |> Query.has [ aria "Stop sharing screen", attr "aria-pressed" "true", Selector.text "Sharing" ]
                    , \_ -> query started |> Query.find [ testid "screenshare-status" ] |> Query.has [ Selector.text "Screen sharing started" ]
                    , \_ -> query refused |> Query.find [ testid "screenshare-status" ] |> Query.has [ Selector.text "Screen sharing did not start. Check browser permission and try again" ]
                    , \_ -> Expect.equal ShareOff refused.callLocal.share
                    , \_ -> Expect.equal [ VoiceCommand { verb = "share", on = False, channel = "#harbor", tile = "" } ] (outs CallToggleShare started)
                    , \_ -> Expect.equal "Screen sharing stopped" stopped.callLocal.shareStatus
                    ]
                    ()
        , test "deafen lives in More, is pressed, and reaches the engine" <|
            \_ ->
                let
                    opened =
                        step CallMoreToggle inCall

                    deaf =
                        step CallToggleDeafen opened
                in
                Expect.all
                    [ \_ -> query opened |> Query.find [ testid "deafen-button" ] |> Query.has [ aria "Deafen", attr "aria-pressed" "false", attr "data-initial-focus" "true" ]
                    , \_ -> query deaf |> Query.find [ testid "deafen-button" ] |> Query.has [ aria "Undeafen", attr "aria-pressed" "true" ]
                    , \_ -> Expect.equal [ VoiceCommand { verb = "deafen", on = True, channel = "#harbor", tile = "" } ] (outs CallToggleDeafen opened)
                    , \_ -> query opened |> Query.find [ testid "call-more-share" ] |> Query.has [ aria "Share screen" ]
                    ]
                    ()
        , test "chip local health adds deafened / sharing / video (+N)" <|
            \_ ->
                let
                    local =
                        { blankLocal | deafened = True, share = ShareOn, camera = True }

                    s =
                        CallMedia.roomStatus
                            { participants = [ "odalys" ]
                            , speaking = Set.empty
                            , raised = Set.empty
                            , muted = Set.empty
                            , currentCall = True
                            , localMuted = True
                            , local = local
                            }
                in
                Expect.all
                    [ \_ -> Expect.equal "listening · muted, deafened +2" s.label
                    , \_ -> Expect.equal "you are listening, your microphone is muted, you are deafened, you are sharing your screen, your camera is on" s.aria
                    ]
                    ()
        , test "local fields decode fail-closed; idle keeps only capabilities" <|
            \_ ->
                let
                    bad =
                        step (snapshot [ ( "camera", Encode.string "yes" ), ( "qualityTier", Encode.int 9 ) ]) (step CallToggleCamera inCall)

                    idle =
                        step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "idle" ) ])) (step CallToggleCamera inCall)
                in
                Expect.all
                    [ \_ -> Expect.equal False bad.callLocal.camera
                    , \_ -> Expect.equal Nothing bad.callLocal.tier
                    , \_ -> Expect.equal False idle.callLocal.camera
                    , \_ -> Expect.equal True idle.callLocal.shareSupported
                    ]
                    ()
        ]



-- C4 · QUALITY


sample : Float -> Int -> Bool -> Quality -> ( Quality, Maybe Notice )
sample now tier camera q =
    advanceQuality { nowMs = now, tier = Just tier, camera = camera } q


run : List ( Float, Int ) -> Bool -> Quality -> Quality
run samples camera q =
    List.foldl (\( now, tier ) acc -> Tuple.first (sample now tier camera acc)) q samples


notices : List ( Float, Int ) -> List Notice
notices samples =
    List.foldl
        (\( now, tier ) ( q, acc ) ->
            let
                ( next, n ) =
                    sample now tier False q
            in
            ( next, acc ++ List.filterMap identity [ n ] )
        )
        ( blankQuality, [] )
        samples
        |> Tuple.second


quality : Test
quality =
    describe "C4 connection quality"
        [ test "prompt only after 2.5s stable tier 3 with the camera on" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal False (run [ ( 0, 3 ) ] True blankQuality).show
                    , \_ -> Expect.equal False (run [ ( 0, 3 ), ( 2499, 3 ) ] True blankQuality).show
                    , \_ -> Expect.equal True (run [ ( 0, 3 ), ( 2500, 3 ) ] True blankQuality).show
                    , \_ -> Expect.equal False (run [ ( 0, 3 ), ( 2500, 3 ) ] False blankQuality).show
                    , \_ -> Expect.equal False (run [ ( 0, 3 ), ( 1000, 2 ), ( 2600, 3 ) ] True blankQuality).show
                    , \_ -> Expect.equal qualityHoldMs 2500
                    ]
                    ()
        , test "consumed stays down through the poor stretch, re-arms after recovery" <|
            \_ ->
                let
                    shown =
                        run [ ( 0, 3 ), ( 2500, 3 ) ] True blankQuality

                    consumed =
                        consumePrompt shown

                    stillPoor =
                        run [ ( 4000, 3 ), ( 9000, 3 ) ] True consumed

                    recovered =
                        run [ ( 10000, 2 ) ] True stillPoor

                    again =
                        run [ ( 10000, 2 ), ( 12500, 2 ), ( 13000, 3 ), ( 15500, 3 ) ] True stillPoor
                in
                Expect.all
                    [ \_ -> Expect.equal False consumed.show
                    , \_ -> Expect.equal False stillPoor.show
                    , \_ -> Expect.equal False recovered.consumed
                    , \_ -> Expect.equal True again.show
                    ]
                    ()
        , test "ladder notices: silent first tier, once per depth, re-arm on recovery" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (notices [ ( 0, 2 ), ( 2500, 2 ) ])
                    , \_ -> Expect.equal [ NoticeLowering ] (notices [ ( 0, 0 ), ( 2500, 0 ), ( 3000, 2 ), ( 5500, 2 ), ( 9000, 2 ) ])
                    , \_ -> Expect.equal [ NoticeLowering, NoticeAudioPriority ] (notices [ ( 0, 0 ), ( 2500, 0 ), ( 3000, 2 ), ( 5500, 2 ), ( 6000, 3 ), ( 8500, 3 ) ])
                    , \_ -> Expect.equal [] (notices [ ( 0, 0 ), ( 2500, 0 ), ( 3000, 1 ), ( 5500, 1 ) ])
                    , \_ ->
                        Expect.equal [ NoticeLowering, NoticeLowering ]
                            (notices [ ( 0, 0 ), ( 2500, 0 ), ( 3000, 2 ), ( 5500, 2 ), ( 6000, 1 ), ( 8500, 1 ), ( 9000, 2 ), ( 11500, 2 ) ])
                    , \_ -> Expect.equal [] (notices [ ( 0, 0 ), ( 2500, 0 ), ( 3000, 2 ), ( 4000, 0 ) ])
                    ]
                    ()
        , test "copy and labels are the oracle strings" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal { title = "Protecting audio", description = "Connection is weak — reducing video to keep audio clear." } (noticeCopy NoticeAudioPriority)
                    , \_ -> Expect.equal { title = "Adjusting video quality", description = "Lowering video quality to keep audio clear." } (noticeCopy NoticeLowering)
                    , \_ -> Expect.equal [ "Excellent", "Good", "Fair", "Poor" ] (List.map qualityLabel [ 0, 1, 2, 3 ])
                    , \_ -> Expect.equal [ 4, 3, 2, 1 ] (List.map qualityBars [ 0, 1, 2, 3 ])
                    ]
                    ()
        , test "in the shell: pip, prompt after the clock holds, act turns the camera off" <|
            \_ ->
                let
                    poor =
                        inCall
                            |> step CallToggleCamera
                            |> step (snapshot [ ( "camera", Encode.bool True ), ( "qualityTier", Encode.int 3 ) ])

                    held =
                        step (CallClock (base.nowMs + 2600)) poor
                in
                Expect.all
                    [ \_ -> query poor |> Query.find [ testid "connection-quality" ] |> Query.has [ aria "Connection: Poor", attr "role" "img", Selector.text "Poor", attr "data-tier" "3" ]
                    , \_ -> query poor |> Query.findAll [ testid "connection-quality-prompt" ] |> Query.count (Expect.equal 0)
                    , \_ -> query held |> Query.find [ testid "connection-quality-prompt" ] |> Query.has [ attr "role" "status", Selector.text "Poor connection — turn off camera to keep audio clear." ]
                    , \_ -> query held |> Query.find [ aria "Dismiss connection tip" ] |> Event.simulate Event.click |> Event.expect CallQualityPromptDismiss
                    , \_ -> Expect.equal [ VoiceCommand { verb = "camera", on = False, channel = "#harbor", tile = "" } ] (outs CallQualityPromptAct held)
                    , \_ -> Expect.equal False (step CallQualityPromptAct held).callQuality.show
                    , \_ -> Expect.equal False (step CallQualityPromptDismiss held).callQuality.show
                    , \_ -> query held |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Call is live · Protected connection · Protecting audio" ]
                    ]
                    ()
        , test "a stable degradation toasts once" <|
            \_ ->
                let
                    good =
                        inCall
                            |> step (snapshot [ ( "qualityTier", Encode.int 0 ) ])
                            |> step (CallClock (base.nowMs + 2600))

                    fair =
                        good
                            |> step (snapshot [ ( "qualityTier", Encode.int 2 ) ])
                            |> step (CallClock (base.nowMs + 5200))
                            |> step (CallClock (base.nowMs + 5400))
                in
                Expect.equal [ "Adjusting video quality" ] (List.map .title fair.toasts)
        ]



-- C5 · LAYOUT


layout : Test
layout =
    describe "C5 layouts"
        [ test "grid columns by count" <|
            \_ ->
                Expect.equal [ 1, 2, 2, 2, 3, 3, 4, 4, 4 ] (List.map gridColumns [ 1, 2, 3, 4, 5, 9, 10, 16, 17 ])
        , test "pages of 16" <|
            \_ ->
                let
                    items =
                        List.range 1 20
                in
                Expect.all
                    [ \_ -> Expect.equal 2 (pageCount 20)
                    , \_ -> Expect.equal 1 (pageCount 16)
                    , \_ -> Expect.equal [ 17, 18, 19, 20 ] (pageSlice 1 items)
                    , \_ -> Expect.equal 1 (clampPage 20 9)
                    ]
                    ()
        , test "a share forces screenshare; the grid escape holds only for that share" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal ViewScreenshare (resolveView { layout = LayoutGrid, shareId = Just "screen:mara", optOut = Nothing })
                    , \_ -> Expect.equal ViewGrid (resolveView { layout = LayoutGrid, shareId = Just "screen:mara", optOut = Just "screen:mara" })
                    , \_ -> Expect.equal ViewScreenshare (resolveView { layout = LayoutGrid, shareId = Just "screen:kit", optOut = Just "screen:mara" })
                    , \_ -> Expect.equal ViewSpotlight (resolveView { layout = LayoutSpotlight, shareId = Nothing, optOut = Nothing })
                    ]
                    ()
        , test "stable order: no reorder within page 1, promotion across the boundary" <|
            \_ ->
                let
                    roster =
                        List.map (\i -> "p" ++ String.padLeft 2 '0' (String.fromInt i)) (List.range 1 17)

                    first =
                        reconcileOrder { selfKey = "me", roster = roster, dominant = Nothing, pinned = Nothing, speaking = Set.empty } []

                    speakingOnPage1 =
                        reconcileOrder { selfKey = "me", roster = roster, dominant = Just "p03", pinned = Nothing, speaking = Set.fromList [ "p03" ] } first

                    promoted =
                        reconcileOrder { selfKey = "me", roster = roster, dominant = Just "p17", pinned = Nothing, speaking = Set.fromList [ "p17" ] } first
                in
                Expect.all
                    [ \_ -> Expect.equal ("me" :: roster) first
                    , \_ -> Expect.equal first speakingOnPage1
                    , \_ -> Expect.equal (Just "p17") (List.head (List.drop 15 promoted))
                    , \_ -> Expect.equal (Just "p15") (List.head (List.drop 17 promoted))
                    , \_ -> Expect.equal (List.take 15 first) (List.take 15 promoted)
                    , \_ -> Expect.equal [ "me", "b", "c" ] (reconcileOrder { selfKey = "me", roster = [ "c", "b" ], dominant = Nothing, pinned = Nothing, speaking = Set.empty } [ "me", "a", "b" ])
                    ]
                    ()
        , test "spotlight primary: pinned, dominant, self" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "jun" (spotlightPrimary { pinned = Just "jun", dominant = Just "mara", selfKey = "me", present = [ "me", "jun", "mara" ] })
                    , \_ -> Expect.equal "mara" (spotlightPrimary { pinned = Just "gone", dominant = Just "mara", selfKey = "me", present = [ "me", "mara" ] })
                    , \_ -> Expect.equal "me" (spotlightPrimary { pinned = Nothing, dominant = Nothing, selfKey = "me", present = [ "me" ] })
                    ]
                    ()
        , test "stage sizes cycle, Escape returns fullscreen to compact" <|
            \_ ->
                let
                    full =
                        inCall |> step CallStageSizeCycle |> step CallStageSizeCycle
                in
                Expect.all
                    [ \_ -> Expect.equal SizeFullscreen full.callStageSize
                    , \_ -> Expect.equal (Just (CallStageSizeSet SizeCompact)) (escapeMsg full)
                    , \_ -> Expect.equal [ "Expand call stage", "Fullscreen call stage", "Compact call stage" ] (List.map stageSizeLabel [ SizeCompact, SizeExpanded, SizeFullscreen ])
                    , \_ -> query full |> Query.find [ testid "voice-stage" ] |> Query.has [ attr "data-size" "fullscreen" ]
                    , \_ -> Expect.equal SizeCompact (step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "idle" ) ])) full).callStageSize
                    ]
                    ()
        ]



-- C5 · DOMINANT SPEAKER


crisp : SpeakerConfig
crisp =
    { defaultSpeakerConfig | smoothingMs = 0 }


advanceAll : List ( List ( String, Float ), Float ) -> Speaker
advanceAll steps =
    List.foldl (\( samples, dt ) s -> advanceSpeaker crisp samples dt s) blankSpeaker steps


speaker : Test
speaker =
    describe "C5 dominant speaker (400ms hold, 800ms release)"
        [ test "first talker claims focus at once" <|
            \_ ->
                Expect.equal (Just "a") (advanceAll [ ( [ ( "a", 1 ), ( "b", 0 ) ], 100 ) ]).dominant
        , test "silent dominant coasts until 800ms, then releases" <|
            \_ ->
                let
                    talking =
                        [ ( [ ( "a", 1 ), ( "b", 0 ) ], 100 ) ]

                    gap ms =
                        [ ( [ ( "a", 0 ), ( "b", 1 ) ], ms ) ]
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "a") (advanceAll (talking ++ gap 799)).dominant
                    , \_ -> Expect.equal (Just "b") (advanceAll (talking ++ gap 800)).dominant
                    , \_ -> Expect.equal (Just "a") (advanceAll (talking ++ gap 400 ++ gap 300)).dominant
                    , \_ -> Expect.equal (Just "b") (advanceAll (talking ++ gap 400 ++ gap 400)).dominant
                    ]
                    ()
        , test "a louder challenger must hold its lead 400ms" <|
            \_ ->
                let
                    start =
                        [ ( [ ( "a", 0.5 ), ( "b", 0 ) ], 100 ) ]

                    louder ms =
                        [ ( [ ( "a", 0.5 ), ( "b", 1 ) ], ms ) ]
                in
                Expect.all
                    [ \_ -> Expect.equal (Just "a") (advanceAll (start ++ louder 200 ++ louder 199)).dominant
                    , \_ -> Expect.equal (Just "b") (advanceAll (start ++ louder 200 ++ louder 200)).dominant
                    , \_ -> Expect.equal (Just "a") (advanceAll (start ++ [ ( [ ( "a", 0.5 ), ( "b", 0.55 ) ], 2000 ) ])).dominant
                    ]
                    ()
        , test "equal talkers never flip; leavers are evicted" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "a") (advanceAll [ ( [ ( "a", 1 ), ( "b", 1 ) ], 100 ), ( [ ( "a", 1 ), ( "b", 1 ) ], 5000 ) ]).dominant
                    , \_ -> Expect.equal (Just "b") (advanceAll [ ( [ ( "a", 1 ) ], 100 ), ( [ ( "b", 1 ) ], 100 ) ]).dominant
                    ]
                    ()
        , test "default smoothing: the call clock settles focus within a tick" <|
            \_ ->
                let
                    samples =
                        speakerSamples [ "me", "mara" ] (Set.fromList [ "mara" ]) Set.empty

                    s =
                        blankSpeaker |> stepSpeaker 1000 samples |> stepSpeaker 1200 samples
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing (stepSpeaker 1000 samples blankSpeaker).dominant
                    , \_ -> Expect.equal (Just "mara") s.dominant
                    , \_ -> Expect.equal s (stepSpeaker 1200 samples s)
                    , \_ -> Expect.equal [ ( "me", 0 ), ( "mara", 0 ) ] (speakerSamples [ "me", "mara" ] (Set.fromList [ "mara" ]) (Set.fromList [ "mara" ]))
                    ]
                    ()
        ]



-- C5 · TILES + VIEW


tilesAndView : Test
tilesAndView =
    describe "C5 tiles and video stage"
        [ test "tile aria in oracle order" <|
            \_ ->
                let
                    t =
                        { id = "self", key = "odalys", name = "odalys", kind = TilePerson, self = True, video = False, speaking = False, muted = True, hand = True, cameraOff = False, videoPaused = False, deafened = False, quality = Nothing, pinned = False, role = Nothing }
                in
                Expect.all
                    [ \_ -> Expect.equal "odalys, (you), hand raised, muted" (tileAria t)
                    , \_ -> Expect.equal "kit, speaking, camera off, Fair connection" (tileAria { t | name = "kit", self = False, hand = False, muted = False, speaking = True, cameraOff = True, quality = Just 2 })
                    , \_ -> Expect.equal "mara's screen" (tileAria { t | kind = TileScreen, name = "mara's screen" })
                    ]
                    ()
        , test "peer feed decodes fail-closed and is ignored while idle" <|
            \_ ->
                let
                    raw =
                        Encode.object
                            [ ( "peers"
                              , Encode.list identity
                                    [ Encode.object [ ( "nick", Encode.string "Mara" ), ( "kind", Encode.string "video" ), ( "hasVideo", Encode.bool True ), ( "quality", Encode.int 9 ) ]
                                    , Encode.object [ ( "nick", Encode.string "kit" ), ( "kind", Encode.string "hologram" ), ( "hasVideo", Encode.string "yes" ) ]
                                    , Encode.object [ ( "nick", Encode.string "" ) ]
                                    , Encode.string "junk"
                                    ]
                              )
                            ]

                    decoded =
                        decodePeers raw |> Maybe.withDefault Dict.empty
                in
                Expect.all
                    [ \_ -> Expect.equal [ "kit", "mara" ] (Dict.keys decoded)
                    , \_ -> Expect.equal (Just ( KindVideo, True, Nothing )) (Dict.get "mara" decoded |> Maybe.map (\p -> ( p.kind, p.hasVideo, p.quality )))
                    , \_ -> Expect.equal (Just ( KindVoice, False )) (Dict.get "kit" decoded |> Maybe.map (\p -> ( p.kind, p.hasVideo )))
                    , \_ -> Expect.equal Nothing (decodePeers (Encode.object []))
                    , \_ -> Expect.equal Dict.empty (step (CallPeerState raw) base).callPeers
                    ]
                    ()
        , test "camera on switches to the video grid with a bindable placeholder" <|
            \_ ->
                let
                    video =
                        inCall |> step CallToggleCamera |> step (peersMsg [ ( "mara", "video", True ), ( "jun", "voice", False ) ])

                    q =
                        query video
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "voice-stage" ] |> Query.has [ attr "data-mode" "video", aria "Video call participants", attr "data-layout" "grid" ]
                    , \_ -> q |> Query.find [ testid "video-grid" ] |> Query.has [ attr "data-columns" "2" ]
                    , \_ -> q |> Query.findAll [ Selector.tag "video" ] |> Query.count (Expect.equal 2)
                    , \_ -> q |> Query.find [ attr "data-voice-tile" "self" ] |> Query.has [ attr "aria-hidden" "true" ]
                    , \_ -> q |> Query.find [ attr "data-voice-tile" "peer:mara" ] |> Query.has [ testid "tile-video" ]
                    , \_ -> q |> Query.find [ attr "data-tile" "self" ] |> Query.has [ aria "odalys, (you)" ]
                    , \_ -> q |> Query.find [ attr "data-tile" "peer:mara" ] |> Query.find [ testid "native-pip-button" ] |> Event.simulate Event.click |> Event.expect (CallNativePip "peer:mara")
                    , \_ -> Expect.equal [ VoiceCommand { verb = "pip", on = True, channel = "", tile = "peer:mara" } ] (outs (CallNativePip "peer:mara") video)
                    ]
                    ()
        , test "voice-only calls keep the person cells" <|
            \_ ->
                query inCall |> Query.find [ testid "voice-stage" ] |> Query.has [ attr "data-mode" "audio", aria "Voice call participants" ]
        , test "pin moves the person to the spotlight primary" <|
            \_ ->
                let
                    video =
                        inCall |> step CallToggleCamera

                    pinned =
                        step (CallPin "jun") video
                in
                Expect.all
                    [ \_ -> query video |> Query.find [ aria "Pin jun to spotlight" ] |> Event.simulate Event.click |> Event.expect (CallPin "jun")
                    , \_ -> Expect.equal LayoutSpotlight pinned.callLayout
                    , \_ -> query pinned |> Query.find [ testid "spotlight-primary" ] |> Query.has [ attr "data-tile" "peer:jun" ]
                    , \_ -> query pinned |> Query.find [ aria "Other participants" ] |> Query.has [ attr "role" "list" ]
                    , \_ -> query pinned |> Query.find [ aria "Unpin jun" ] |> Query.has [ attr "aria-pressed" "true" ]
                    , \_ -> Expect.equal Nothing (step (CallPin "jun") pinned).callPinned
                    ]
                    ()
        , test "a remote screen share is honoured: primary, sharer first, grid escape" <|
            \_ ->
                let
                    sharing =
                        inCall |> step (peersMsg [ ( "mara", "screen", True ) ])

                    q =
                        query sharing
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "voice-stage" ] |> Query.has [ attr "data-layout" "screenshare" ]
                    , \_ -> q |> Query.find [ testid "spotlight-primary" ] |> Query.has [ aria "Mara's screen", attr "data-tile" "screen:mara" ]
                    , \_ -> q |> Query.find [ aria "Other participants" ] |> Query.children [] |> Query.first |> Query.has [ attr "data-tile" "peer:mara" ]
                    , \_ -> q |> Query.find [ testid "voice-stage-state" ] |> Query.has [ Selector.text "Mara is sharing their screen" ]
                    , \_ -> q |> Query.find [ testid "share-grid-button" ] |> Event.simulate Event.click |> Event.expect (CallShareGrid "screen:mara")
                    , \_ -> query (step (CallShareGrid "screen:mara") sharing) |> Query.find [ testid "voice-stage" ] |> Query.has [ attr "data-layout" "grid" ]
                    ]
                    ()
        , test "a local share is the primary tile" <|
            \_ ->
                let
                    sharing =
                        inCall |> step CallToggleShare |> step (snapshot [ ( "screen", Encode.bool True ) ])
                in
                query sharing
                    |> Query.find [ testid "spotlight-primary" ]
                    |> Query.has [ attr "data-tile" "self-screen", aria "odalys's screen" ]
        , test "more than 16 tiles page, with a pager" <|
            \_ ->
                let
                    roster =
                        "odalys" :: List.map (\i -> "p" ++ String.fromInt i) (List.range 1 19)

                    big =
                        base |> withRoster roster |> step (snapshot []) |> step CallToggleCamera

                    q =
                        query big
                in
                Expect.all
                    [ \_ -> q |> Query.find [ testid "video-grid" ] |> Query.has [ attr "data-columns" "4", attr "data-count" "16" ]
                    , \_ -> q |> Query.find [ aria "Next participants page" ] |> Event.simulate Event.click |> Event.expect (CallPageSet 1)
                    , \_ -> query (step (CallPageSet 1) big) |> Query.find [ testid "video-grid" ] |> Query.has [ attr "data-count" "4" ]
                    ]
                    ()
        ]
