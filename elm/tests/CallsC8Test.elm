module CallsC8Test exposing (suite)

{-| v3/calls-c8 — calls slices C8 (live captions + reactions) and C9
(voice settings + push to talk) per `elm/design/calls/CALLS_DESIGN.md`
§6. Oracle vectors from `VoiceOverlays.test.tsx`
(`CaptionsOverlay` / `ReactionsOverlay`), `VoiceBar.tsx` (quick
reactions, roving keys, hand / captions toggles),
`VoiceSettings.test.tsx` and `voiceSettingsPersistence.test.ts`.
-}

import App exposing (..)
import CallCaptions
import Dict
import Expect
import Html
import Html.Attributes as Attr
import Json.Decode
import Json.Encode as Encode
import Media exposing (CallLifecycle(..))
import Set
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View
import VoiceSettings


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
        |> step (snapshot [])


step : Msg -> Model -> Model
step msg model =
    Tuple.first (update msg model)


outs : Msg -> Model -> List Outbound
outs msg model =
    Tuple.second (update msg model)


line : String -> Msg
line raw =
    WsLineReceived raw


aria : String -> Selector.Selector
aria label =
    Selector.attribute (Attr.attribute "aria-label" label)


testid : String -> Selector.Selector
testid id =
    Selector.attribute (Attr.attribute "data-testid" id)


attr : String -> String -> Selector.Selector
attr name value =
    Selector.attribute (Attr.attribute name value)


withCaptions : List ( String, String ) -> Model -> Model
withCaptions entries model =
    let
        media0 =
            model.media
    in
    { model
        | media =
            { media0
                | transcripts =
                    Dict.fromList
                        [ ( "#harbor"
                          , List.indexedMap
                                (\i ( nick, text ) -> { nick = nick, text = text, time = Just ("2026-10-10T12:0" ++ String.fromInt i ++ ":00.000Z") })
                                entries
                          )
                        ]
            }
    }


suite : Test
suite =
    describe "calls C8–C9"
        [ captions
        , contrast
        , reactions
        , hand
        , settingsPrefs
        , settingsSheet
        , pushToTalk
        ]



-- C8 · CAPTIONS


captions : Test
captions =
    describe "C8 live captions"
        [ test "toggle: aria-pressed and verb label; off by default" <|
            \_ ->
                let
                    on =
                        step CallToggleCaptions inCall
                in
                Expect.all
                    [ \_ -> query inCall |> Query.find [ testid "captions-button" ] |> Query.has [ aria "Show live captions", attr "aria-pressed" "false", Selector.text "Captions" ]
                    , \_ -> query on |> Query.find [ testid "captions-button" ] |> Query.has [ aria "Hide live captions", attr "aria-pressed" "true" ]
                    , \_ -> query inCall |> Query.findAll [ testid "captions-overlay" ] |> Query.count (Expect.equal 0)
                    , \_ -> query inCall |> Query.find [ testid "captions-button" ] |> Event.simulate Event.click |> Event.expect CallToggleCaptions
                    ]
                    ()
        , test "last 3 lines only, older lines dimmed, newest full" <|
            \_ ->
                let
                    model =
                        inCall
                            |> withCaptions [ ( "jun", "one" ), ( "mara", "two" ), ( "jun", "three" ), ( "mara", "four" ) ]
                            |> step CallToggleCaptions

                    lines =
                        query model |> Query.find [ testid "captions-log" ] |> Query.findAll [ Selector.class "onyx-call-caption" ]
                in
                Expect.all
                    [ \_ -> lines |> Query.count (Expect.equal 3)
                    , \_ -> query model |> Query.find [ testid "captions-log" ] |> Query.hasNot [ Selector.text "one" ]
                    , \_ -> lines |> Query.index 0 |> Query.has [ attr "data-old" "true", Selector.text "two" ]
                    , \_ -> lines |> Query.index 2 |> Query.has [ attr "data-old" "false", Selector.text "four" ]
                    , \_ -> query model |> Query.find [ testid "captions-log" ] |> Query.has [ attr "role" "log", attr "aria-live" "polite" ]
                    , \_ -> query model |> Query.find [ testid "captions-overlay" ] |> Query.has [ aria "Live captions", Selector.text "Live from this call" ]
                    ]
                    ()
        , test "source line while reconnecting" <|
            \_ ->
                let
                    model =
                        { inCall | connection = Offline } |> withCaptions [ ( "jun", "hi" ) ] |> step CallToggleCaptions
                in
                Expect.equal "Captions unavailable while reconnecting" (CallCaptions.captionSource (model.connection == Live))
        , test "captions are opt-in and absent while idle" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (CallCaptions.captionLines { captionsOn = False, lifecycle = InCall, channel = Just "#harbor", activeChannel = Nothing } (withCaptions [ ( "a", "b" ) ] inCall).media)
                    , \_ -> Expect.equal [] (CallCaptions.captionLines { captionsOn = True, lifecycle = Idle, channel = Just "#harbor", activeChannel = Nothing } (withCaptions [ ( "a", "b" ) ] inCall).media)
                    , \_ -> Expect.equal [] (outs CallToggleCaptions base)
                    ]
                    ()
        , test "copy transcript: every buffered line, oracle format, one copy at a time" <|
            \_ ->
                let
                    model =
                        inCall |> withCaptions [ ( "jun", "one" ), ( "mara", "two" ) ] |> step CallToggleCaptions

                    busy =
                        step CallCaptionsCopy model
                in
                Expect.all
                    [ \_ -> Expect.equal [ ClipboardCopy { text = "[12:00] jun: one\n[12:01] mara: two", tag = "call-captions" } ] (outs CallCaptionsCopy model)
                    , \_ -> Expect.equal [] (outs CallCaptionsCopy busy)
                    , \_ -> query (step (ClipboardResult { tag = "call-captions", ok = True }) busy) |> Query.find [ testid "captions-overlay" ] |> Query.has [ Selector.text "Copied" ]
                    , \_ -> query (step (ClipboardResult { tag = "call-captions", ok = False }) busy) |> Query.find [ testid "captions-overlay" ] |> Query.has [ Selector.text "Clipboard unavailable" ]
                    , \_ -> query model |> Query.find [ aria "Copy live caption transcript" ] |> Query.has [ Selector.text "Copy transcript" ]
                    ]
                    ()
        , test "transcript line without a server time drops the bracket" <|
            \_ ->
                Expect.equal "kit: hello" (CallCaptions.transcriptLine { nick = "kit", text = "hello", time = Nothing })
        , test "caption translate uses the shared translator, namespaced and bounded" <|
            \_ ->
                let
                    model =
                        { inCall | translationAvailable = True, translationTarget = "fr" }
                            |> withCaptions [ ( "jun", "hello there" ) ]
                            |> step CallToggleCaptions

                    ckey =
                        "2026-10-10T12:00:00.000Z|jun|hello there"

                    sent =
                        outs (CallCaptionTranslate ckey) model
                in
                Expect.all
                    [ \_ -> Expect.equal 1 (List.length sent)
                    , \_ -> Expect.equal True (Dict.member ("caption:" ++ ckey) (step (CallCaptionTranslate ckey) model).translations)
                    , \_ -> Expect.equal [] (outs (CallCaptionTranslate "gone|x|y") model)
                    , \_ -> query model |> Query.find [ aria "Translate jun's caption to French" ] |> Query.has [ Selector.text "Translate" ]
                    ]
                    ()
        ]



-- C8 · CONTRAST


hex : String -> ( Float, Float, Float )
hex raw =
    CallCaptions.parseHex raw |> Maybe.withDefault ( 0, 0, 0 )


contrast : Test
contrast =
    let
        bg =
            hex "#0b0e12"

        textC =
            hex "#e8e6e1"

        dim =
            hex "#9aa3ad"

        white =
            ( 255, 255, 255 )

        -- worst case: the 94% plate over a white video frame
        plate =
            CallCaptions.composite 0.94 bg white
    in
    describe "C8 caption contrast ≥ 4.5:1 on the token values"
        [ test "text on the plate over white" <|
            \_ -> CallCaptions.contrastRatio textC plate |> Expect.atLeast 4.5
        , test "75% older line on the plate" <|
            \_ -> CallCaptions.contrastRatio (CallCaptions.composite 0.75 textC plate) plate |> Expect.atLeast 4.5
        , test "dim speaker name on the plate" <|
            \_ -> CallCaptions.contrastRatio dim plate |> Expect.atLeast 4.5
        , test "older lines dim the text only (a 75% speaker name would fall to 4.3:1)" <|
            \_ ->
                Expect.all
                    [ \_ -> CallCaptions.contrastRatio (CallCaptions.composite 0.75 dim plate) plate |> Expect.lessThan 4.5
                    , \_ -> CallCaptions.contrastRatio dim plate |> Expect.atLeast 4.5
                    ]
                    ()
        , test "WCAG reference: black on white is 21:1" <|
            \_ -> CallCaptions.contrastRatio ( 0, 0, 0 ) white |> Expect.within (Expect.Absolute 0.01) 21
        , test "bad hex fails closed" <|
            \_ -> Expect.equal Nothing (CallCaptions.parseHex "#12345")
        ]



-- C8 · REACTIONS


reactions : Test
reactions =
    describe "C8 reactions"
        [ test "React menu: 8 oracle items, one tab stop, roving keys" <|
            \_ ->
                let
                    opened =
                        step CallReactToggle inCall

                    items =
                        query opened |> Query.find [ testid "call-react-menu" ] |> Query.findAll [ attr "role" "menuitem" ]
                in
                Expect.all
                    [ \_ -> items |> Query.count (Expect.equal 8)
                    , \_ -> query opened |> Query.find [ testid "call-react-menu" ] |> Query.has [ attr "role" "menu", aria "Send a reaction" ]
                    , \_ -> items |> Query.index 0 |> Query.has [ Selector.attribute (Attr.tabindex 0), aria "React with 👍" ]
                    , \_ -> items |> Query.index 1 |> Query.has [ Selector.attribute (Attr.tabindex -1) ]
                    , \_ -> query opened |> Query.find [ testid "reactions-button" ] |> Query.has [ attr "aria-haspopup" "menu", attr "aria-expanded" "true" ]
                    , \_ -> Expect.equal (Just 1) (CallCaptions.rovingIndex "ArrowRight" 0 8)
                    , \_ -> Expect.equal (Just 7) (CallCaptions.rovingIndex "ArrowLeft" 0 8)
                    , \_ -> Expect.equal (Just 0) (CallCaptions.rovingIndex "ArrowDown" 7 8)
                    , \_ -> Expect.equal (Just 0) (CallCaptions.rovingIndex "Home" 5 8)
                    , \_ -> Expect.equal (Just 7) (CallCaptions.rovingIndex "End" 2 8)
                    , \_ -> Expect.equal Nothing (CallCaptions.rovingIndex "a" 2 8)
                    , \_ -> Expect.equal [ PrefsFocus { id = "call-react-3" } ] (outs (CallReactFocus 3) opened)
                    ]
                    ()
        , test "the menu is in the Escape stack and closes" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just CallReactClose) (escapeMsg (step CallReactToggle inCall))
                    , \_ -> Expect.equal False (step CallReactClose (step CallReactToggle inCall)).callOverlay.reactOpen
                    ]
                    ()
        , test "sending: MEDIA REACT via the wire builder, local echo, menu closes" <|
            \_ ->
                let
                    opened =
                        step CallReactToggle inCall

                    sent =
                        step (CallReact "🎉") opened
                in
                Expect.all
                    [ \_ -> Expect.equal [ SendLine "MEDIA REACT #harbor 🎉\r\n" ] (outs (CallReact "🎉") opened)
                    , \_ -> Expect.equal False sent.callOverlay.reactOpen
                    , \_ -> Expect.equal [ ( "odalys", "🎉" ) ] (List.map (\c -> ( c.key, c.emoji )) sent.callOverlay.chips)
                    , \_ -> Expect.equal [] (outs (CallReact "  ") opened)
                    ]
                    ()
        , test "no reactions outside a live room call" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [] (outs (CallReact "👍") base)
                    , \_ -> Expect.equal False (step CallReactToggle base).callOverlay.reactOpen
                    ]
                    ()
        , test "incoming reaction becomes a chip, expires after 2600ms" <|
            \_ ->
                let
                    got =
                        inCall |> step (line ":irc.example NOTE MEDIA #harbor REACT mara :👏")

                    at =
                        max got.nowMs got.callClockMs
                in
                Expect.all
                    [ \_ -> Expect.equal [ ( "mara", "👏" ) ] (List.map (\c -> ( c.key, c.emoji )) got.callOverlay.chips)
                    , \_ -> query got |> Query.find [ testid "voice-reactions-overlay" ] |> Query.has [ attr "aria-hidden" "true", Selector.text "Mara", Selector.text "👏" ]
                    , \_ -> Expect.equal 1 (List.length (step (CallClock (at + 2599)) got).callOverlay.chips)
                    , \_ -> Expect.equal [] (step (CallClock (at + 2600)) got).callOverlay.chips
                    ]
                    ()
        , test "max 3 chips stacked, newest kept" <|
            \_ ->
                let
                    got =
                        inCall
                            |> step (line ":irc.example NOTE MEDIA #harbor REACT mara :👍")
                            |> step (line ":irc.example NOTE MEDIA #harbor REACT jun :🔥")
                            |> step (line ":irc.example NOTE MEDIA #harbor REACT mara :😮")
                            |> step (line ":irc.example NOTE MEDIA #harbor REACT jun :🎉")
                in
                Expect.equal [ "🔥", "😮", "🎉" ] (List.map .emoji got.callOverlay.chips)
        , test "our own echo from the server does not double the local chip" <|
            \_ ->
                let
                    got =
                        inCall
                            |> step (CallReact "👍")
                            |> step (line ":irc.example NOTE MEDIA #harbor REACT odalys :👍")
                in
                Expect.equal 1 (List.length got.callOverlay.chips)
        , test "a peer ✋ raises their hand with the verb chip, auto-clears after 15s" <|
            \_ ->
                let
                    got =
                        inCall |> step (line ":irc.example NOTE MEDIA #harbor REACT jun :✋")

                    at =
                        max got.nowMs got.callClockMs
                in
                Expect.all
                    [ \_ -> Expect.equal True (Set.member "jun" got.media.hands)
                    , \_ -> query got |> Query.find [ testid "voice-reactions-overlay" ] |> Query.has [ Selector.text "raised a hand" ]
                    , \_ -> Expect.equal True (Set.member "jun" (step (CallClock (at + 14999)) got).media.hands)
                    , \_ -> Expect.equal False (Set.member "jun" (step (CallClock (at + 15000)) got).media.hands)
                    ]
                    ()
        , test "leaving the call drops chips, captions and the menu" <|
            \_ ->
                let
                    busy =
                        inCall |> step CallToggleCaptions |> step (CallReact "👍") |> step CallReactToggle

                    idle =
                        step (CallHubSnapshot (Encode.object [ ( "state", Encode.string "idle" ) ])) busy
                in
                Expect.equal CallCaptions.blankOverlay idle.callOverlay
        ]


hand : Test
hand =
    describe "C8 hand"
        [ test "raise: aria-pressed, ✋ reaction on the wire, self in hands; lower sends nothing" <|
            \_ ->
                let
                    raised =
                        step CallToggleHand inCall

                    lowered =
                        step CallToggleHand raised
                in
                Expect.all
                    [ \_ -> query inCall |> Query.find [ testid "raise-hand-button" ] |> Query.has [ aria "Raise hand", attr "aria-pressed" "false", Selector.text "Hand" ]
                    , \_ -> query raised |> Query.find [ testid "raise-hand-button" ] |> Query.has [ aria "Lower hand", attr "aria-pressed" "true" ]
                    , \_ -> Expect.equal [ SendLine "MEDIA REACT #harbor ✋\r\n" ] (outs CallToggleHand inCall)
                    , \_ -> Expect.equal True (Set.member "odalys" raised.media.hands)
                    , \_ -> Expect.equal [] (outs CallToggleHand raised)
                    , \_ -> Expect.equal False (Set.member "odalys" lowered.media.hands)
                    ]
                    ()
        , test "our own hand never auto-clears" <|
            \_ ->
                let
                    raised =
                        step CallToggleHand inCall
                in
                Expect.equal True (Set.member "odalys" (step (CallClock 10000000) raised).media.hands)
        , test "bar order: Mute, Camera, Share, Hand, React, Captions, More, Leave" <|
            \_ ->
                let
                    buttons =
                        query inCall
                            |> Query.find [ attr "aria-label" "Call controls" ]
                            |> Query.findAll [ Selector.class "onyx-cbtn" ]
                in
                Expect.all
                    (List.indexedMap (\i label -> \_ -> buttons |> Query.index i |> Query.has [ aria label ])
                        [ "Mute microphone", "Turn on camera", "Screen sharing unavailable", "Raise hand", "Send a reaction", "Show live captions", "More call tools", "Leave voice call" ]
                    )
                    ()
        ]



-- C9 · PREFS


settingsPrefs : Test
settingsPrefs =
    describe "C9 voice prefs"
        [ test "defaults: oracle defaults with Join muted on (provisional)" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True VoiceSettings.defaultPrefs.muteOnJoin
                    , \_ -> Expect.equal 80 VoiceSettings.defaultPrefs.outputVolume
                    , \_ -> Expect.equal False VoiceSettings.defaultPrefs.pushToTalk
                    , \_ -> Expect.equal VoiceSettings.defaultPrefs blank.voicePrefs
                    ]
                    ()
        , test "round-trip through JSON" <|
            \_ ->
                let
                    p =
                        { inputDeviceId = Just "mic-1"
                        , outputDeviceId = Nothing
                        , outputVolume = 35
                        , vadEnabled = False
                        , vadSensitivity = VoiceSettings.High
                        , noiseSuppression = False
                        , echoCancellation = True
                        , pushToTalk = True
                        , pushToTalkKey = Just "Space"
                        , cameraDeviceId = Just "cam-2"
                        , muteOnJoin = False
                        }
                in
                Expect.equal p (VoiceSettings.decodePrefs (VoiceSettings.encodePrefs p))
        , test "sanitiser: bad fields fall back alone; non-object is defaults" <|
            \_ ->
                let
                    raw =
                        Encode.object
                            [ ( "outputVolume", Encode.float 250 )
                            , ( "vadSensitivity", Encode.string "loud" )
                            , ( "pushToTalkKey", Encode.string (String.repeat 65 "k") )
                            , ( "inputDeviceId", Encode.string "" )
                            , ( "pushToTalk", Encode.string "yes" )
                            , ( "muteOnJoin", Encode.bool False )
                            ]

                    got =
                        VoiceSettings.decodePrefs raw
                in
                Expect.all
                    [ \_ -> Expect.equal 100 got.outputVolume
                    , \_ -> Expect.equal VoiceSettings.Medium got.vadSensitivity
                    , \_ -> Expect.equal Nothing got.pushToTalkKey
                    , \_ -> Expect.equal Nothing got.inputDeviceId
                    , \_ -> Expect.equal False got.pushToTalk
                    , \_ -> Expect.equal False got.muteOnJoin
                    , \_ -> Expect.equal VoiceSettings.defaultPrefs (VoiceSettings.decodePrefs (Encode.list Encode.int [ 1 ]))
                    ]
                    ()
        , test "a pref change persists under onyx:voice-settings" <|
            \_ ->
                let
                    out =
                        outs (VoiceSettingsMsg (VoiceSettings.SetMuteOnJoin False)) base
                in
                case out of
                    [ VoicePrefsSave { json } ] ->
                        Expect.equal False (VoiceSettings.decodePrefs (Encode.string json |> always (decodeJson json))).muteOnJoin

                    _ ->
                        Expect.fail ("unexpected " ++ Debug.toString out)
        , test "an unchanged pref stays silent" <|
            \_ ->
                Expect.equal [] (outs (VoiceSettingsMsg (VoiceSettings.SetMuteOnJoin True)) base)
        , test "boot feed loads the stored prefs" <|
            \_ ->
                let
                    loaded =
                        step (VoiceSettingsMsg (VoiceSettings.Feed (Encode.object [ ( "kind", Encode.string "prefs" ), ( "prefs", Encode.object [ ( "muteOnJoin", Encode.bool False ) ] ) ]))) base
                in
                Expect.equal False loaded.voicePrefs.muteOnJoin
        , test "Join muted off: joining sends no mute" <|
            \_ ->
                let
                    unmuted =
                        { base | voicePrefs = { blank | ourNick = "" }.voicePrefs |> (\p -> { p | muteOnJoin = False }) }
                in
                Expect.all
                    [ \_ -> Expect.equal [ VoiceJoin { channel = "#harbor", video = False } ] (outs (CallJoin { channel = "#harbor", video = False }) unmuted)
                    , \_ -> Expect.equal [ VoiceJoin { channel = "#harbor", video = False }, VoiceMute { muted = True } ] (outs (CallJoin { channel = "#harbor", video = False }) base)
                    ]
                    ()
        ]


decodeJson : String -> Encode.Value
decodeJson json =
    case Json.Decode.decodeString Json.Decode.value json of
        Ok v ->
            v

        Err _ ->
            Encode.null



-- C9 · SHEET


devicesFeed : List ( String, String, String ) -> List ( String, Bool ) -> Msg
devicesFeed devices caps =
    VoiceSettingsMsg
        (VoiceSettings.Feed
            (Encode.object
                [ ( "kind", Encode.string "devices" )
                , ( "devices"
                  , Encode.list
                        (\( i, k, l ) -> Encode.object [ ( "deviceId", Encode.string i ), ( "kind", Encode.string k ), ( "label", Encode.string l ) ])
                        devices
                  )
                , ( "caps", Encode.object (List.map (\( k, v ) -> ( k, Encode.bool v )) caps) )
                ]
            )
        )


settingsSheet : Test
settingsSheet =
    describe "C9 voice settings sheet"
        [ test "More → Open voice settings is live and opens the sheet, asking for devices" <|
            \_ ->
                let
                    more =
                        step CallMoreToggle inCall
                in
                Expect.all
                    [ \_ -> query more |> Query.find [ testid "call-more-settings" ] |> Query.hasNot [ attr "aria-disabled" "true" ]
                    , \_ -> query more |> Query.find [ testid "call-more-settings" ] |> Event.simulate Event.click |> Event.expect (VoiceSettingsMsg VoiceSettings.Open)
                    , \_ -> Expect.equal [ VoiceCommand { verb = "devices", on = True, channel = "", tile = "" } ] (outs (VoiceSettingsMsg VoiceSettings.Open) more)
                    , \_ -> Expect.equal False (step (VoiceSettingsMsg VoiceSettings.Open) more).callMoreOpen
                    ]
                    ()
        , test "sheet copy, dialog, loading status, Escape stack" <|
            \_ ->
                let
                    opened =
                        step (VoiceSettingsMsg VoiceSettings.Open) base

                    sheet =
                        query opened |> Query.find [ testid "voice-settings" ]
                in
                Expect.all
                    [ \_ -> sheet |> Query.has [ attr "role" "dialog", Selector.text "Voice settings", Selector.text "Devices, activation, and signal processing." ]
                    , \_ -> sheet |> Query.has [ Selector.text "Checking media devices…" ]
                    , \_ -> sheet |> Query.find [ aria "Close voice settings" ] |> Event.simulate Event.click |> Event.expect (VoiceSettingsMsg VoiceSettings.Close)
                    , \_ -> Expect.equal (Just (VoiceSettingsMsg VoiceSettings.Close)) (escapeMsg opened)
                    , \_ -> sheet |> Query.find [ Selector.id "voice-input-device" ] |> Query.has [ attr "data-onyx-autofocus" "voice-settings" ]
                    ]
                    ()
        , test "devices: labels fall back per kind, stale selection resets and saves" <|
            \_ ->
                let
                    stale =
                        { base | voicePrefs = { blank | ourNick = "" }.voicePrefs |> (\p -> { p | inputDeviceId = Just "gone" }) }
                            |> step (VoiceSettingsMsg VoiceSettings.Open)

                    feed =
                        devicesFeed [ ( "m1", "audioinput", "" ), ( "m2", "audioinput", "Headset" ), ( "s1", "audiooutput", "" ), ( "c1", "videoinput", "" ), ( "x", "other", "" ) ] []

                    loaded =
                        step feed stale
                in
                Expect.all
                    [ \_ -> Expect.equal [ "Microphone 1", "Headset", "Speaker 1", "Camera 1" ] (List.map .label loaded.voiceSettings.devices)
                    , \_ -> Expect.equal Nothing loaded.voicePrefs.inputDeviceId
                    , \_ -> Expect.equal 1 (List.length (outs feed stale))
                    , \_ -> query loaded |> Query.find [ Selector.id "voice-input-device" ] |> Query.children [ Selector.tag "option" ] |> Query.count (Expect.equal 3)
                    , \_ -> query loaded |> Query.find [ Selector.id "voice-input-device" ] |> Query.has [ Selector.text "System microphone" ]
                    ]
                    ()
        , test "enumeration errors are alerts with the oracle copy" <|
            \_ ->
                let
                    errFeed e =
                        VoiceSettingsMsg (VoiceSettings.Feed (Encode.object [ ( "kind", Encode.string "devices" ), ( "error", Encode.string e ) ]))

                    opened =
                        step (VoiceSettingsMsg VoiceSettings.Open) base
                in
                Expect.all
                    [ \_ -> query (step (errFeed "unavailable") opened) |> Query.find [ attr "role" "alert" ] |> Query.has [ Selector.text "Device enumeration is unavailable in this browser." ]
                    , \_ -> query (step (errFeed "failed") opened) |> Query.find [ attr "role" "alert" ] |> Query.has [ Selector.text "Device enumeration failed. Check media permissions." ]
                    ]
                    ()
        , test "processing toggles only when the engine / browser can honour them" <|
            \_ ->
                let
                    opened =
                        step (VoiceSettingsMsg VoiceSettings.Open) base

                    none =
                        step (devicesFeed [] []) opened

                    all =
                        step (devicesFeed [] [ ( "noiseSuppression", True ), ( "echoCancellation", True ), ( "voiceActivity", True ) ]) opened
                in
                Expect.all
                    [ \_ -> query none |> Query.findAll [ Selector.id "voice-noise-suppression" ] |> Query.count (Expect.equal 0)
                    , \_ -> query none |> Query.findAll [ Selector.id "voice-vad-enabled" ] |> Query.count (Expect.equal 0)
                    , \_ -> query none |> Query.find [ Selector.id "voice-mute-on-join" ] |> Query.has [ Selector.checked True ]
                    , \_ -> query all |> Query.findAll [ Selector.id "voice-noise-suppression" ] |> Query.count (Expect.equal 1)
                    , \_ -> query all |> Query.findAll [ Selector.id "voice-echo-cancellation" ] |> Query.count (Expect.equal 1)
                    , \_ -> query all |> Query.find [ Selector.id "voice-vad-sensitivity" ] |> Query.has [ Selector.text "Medium" ]
                    , \_ -> query all |> Query.findAll [ testid "voice-choose-speaker" ] |> Query.count (Expect.equal 0)
                    ]
                    ()
        , test "speaker chooser (selectAudioOutput): pending, chosen, aborted, errors" <|
            \_ ->
                let
                    ready =
                        base |> step (VoiceSettingsMsg VoiceSettings.Open) |> step (devicesFeed [] [ ( "selectAudioOutput", True ) ])

                    pending =
                        step (VoiceSettingsMsg VoiceSettings.ChooseSpeaker) ready

                    chosenFeed =
                        VoiceSettingsMsg (VoiceSettings.Feed (Encode.object [ ( "kind", Encode.string "output-chosen" ), ( "deviceId", Encode.string "bt-1" ), ( "label", Encode.string "" ) ]))

                    errFeed n =
                        VoiceSettingsMsg (VoiceSettings.Feed (Encode.object [ ( "kind", Encode.string "output-error" ), ( "name", Encode.string n ) ]))
                in
                Expect.all
                    [ \_ -> Expect.equal [ VoiceCommand { verb = "choose-speaker", on = True, channel = "", tile = "" } ] (outs (VoiceSettingsMsg VoiceSettings.ChooseSpeaker) ready)
                    , \_ -> query pending |> Query.find [ testid "voice-choose-speaker" ] |> Query.has [ Selector.text "Choosing speaker…", Selector.disabled True ]
                    , \_ -> Expect.equal [] (outs (VoiceSettingsMsg VoiceSettings.ChooseSpeaker) pending)
                    , \_ -> Expect.equal (Just "bt-1") (step chosenFeed pending).voicePrefs.outputDeviceId
                    , \_ -> query (step chosenFeed pending) |> Query.find [ Selector.id "voice-output-device" ] |> Query.has [ Selector.text "Speaker 1" ]
                    , \_ -> query (step chosenFeed pending) |> Query.find [ testid "voice-settings" ] |> Query.has [ Selector.text "Speaker access updated." ]
                    , \_ -> query (step (errFeed "NotAllowedError") pending) |> Query.find [ attr "role" "alert" ] |> Query.has [ Selector.text "Speaker selection was not allowed." ]
                    , \_ -> Expect.equal VoiceSettings.OutputIdle (step (errFeed "AbortError") pending).voiceSettings.output
                    ]
                    ()
        , test "You hub reaches the same sheet and closes behind it" <|
            \_ ->
                let
                    hub =
                        { base | youHubOpen = True }
                in
                Expect.all
                    [ \_ -> query hub |> Query.find [ testid "you-open-voice-settings" ] |> Event.simulate Event.click |> Event.expect (VoiceSettingsMsg VoiceSettings.Open)
                    , \_ -> Expect.equal False (step (VoiceSettingsMsg VoiceSettings.Open) hub).youHubOpen
                    ]
                    ()
        ]



-- C9 · PUSH TO TALK


key : String -> VoiceSettings.KeyEvent
key k =
    { key = k, composing = False, keyCode = 0, repeat = False }


pushToTalk : Test
pushToTalk =
    describe "C9 push to talk"
        [ test "capture: next key binds and enables PTT; Space stored as Space" <|
            \_ ->
                let
                    capturing =
                        base |> step (VoiceSettingsMsg VoiceSettings.Open) |> step (VoiceSettingsMsg VoiceSettings.CaptureToggle)

                    bound =
                        step (VoiceSettingsMsg (VoiceSettings.CaptureKey (key " "))) capturing
                in
                Expect.all
                    [ \_ -> query capturing |> Query.find [ testid "voice-ptt-key" ] |> Query.has [ Selector.text "Press a key", attr "aria-live" "polite" ]
                    , \_ -> query capturing |> Query.find [ testid "voice-ptt-capture" ] |> Query.has [ aria "Cancel push-to-talk key capture", attr "aria-pressed" "true", Selector.text "Cancel capture" ]
                    , \_ -> Expect.equal (Just "Space") bound.voicePrefs.pushToTalkKey
                    , \_ -> Expect.equal True bound.voicePrefs.pushToTalk
                    , \_ -> Expect.equal False bound.voiceSettings.capturing
                    , \_ -> query bound |> Query.find [ testid "voice-ptt-key" ] |> Query.has [ Selector.text "Space" ]
                    , \_ -> Expect.equal True (List.member (PrefsFocus { id = "voice-ptt-capture" }) (outs (VoiceSettingsMsg (VoiceSettings.CaptureKey (key " "))) capturing))
                    ]
                    ()
        , test "capture ignores IME, repeat and bare modifiers; Escape cancels without binding" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (VoiceSettings.captureKey { key = "a", composing = True, keyCode = 0, repeat = False })
                    , \_ -> Expect.equal Nothing (VoiceSettings.captureKey { key = "a", composing = False, keyCode = 229, repeat = False })
                    , \_ -> Expect.equal Nothing (VoiceSettings.captureKey { key = "a", composing = False, keyCode = 0, repeat = True })
                    , \_ -> Expect.equal Nothing (VoiceSettings.captureKey (key "Shift"))
                    , \_ -> Expect.equal (Just Nothing) (VoiceSettings.captureKey (key "Escape"))
                    , \_ -> Expect.equal (Just (Just "F8")) (VoiceSettings.captureKey (key "F8"))
                    , \_ ->
                        let
                            capturing =
                                base |> step (VoiceSettingsMsg VoiceSettings.Open) |> step (VoiceSettingsMsg VoiceSettings.CaptureToggle)

                            cancelled =
                                step (VoiceSettingsMsg (VoiceSettings.CaptureKey (key "Escape"))) capturing
                        in
                        Expect.equal ( False, Nothing, True ) ( cancelled.voiceSettings.capturing, cancelled.voicePrefs.pushToTalkKey, cancelled.voiceSettings.open )
                    ]
                    ()
        , test "Clear drops the key; disabled when nothing is bound" <|
            \_ ->
                let
                    opened =
                        base |> step (VoiceSettingsMsg VoiceSettings.Open)

                    bound =
                        opened |> step (VoiceSettingsMsg VoiceSettings.CaptureToggle) |> step (VoiceSettingsMsg (VoiceSettings.CaptureKey (key "F8")))
                in
                Expect.all
                    [ \_ -> query opened |> Query.find [ aria "Clear push-to-talk key" ] |> Query.has [ Selector.disabled True ]
                    , \_ -> Expect.equal Nothing (step (VoiceSettingsMsg VoiceSettings.ClearKey) bound).voicePrefs.pushToTalkKey
                    , \_ -> query opened |> Query.find [ testid "voice-ptt-key" ] |> Query.has [ Selector.text "Not set" ]
                    ]
                    ()
        , test "runtime hold mirrors ptt-down / ptt-up from the shortcut port" <|
            \_ ->
                let
                    ptt =
                        { inCall | voicePrefs = inCall.voicePrefs |> (\p -> { p | pushToTalk = True, pushToTalkKey = Just "Space" }) }

                    down =
                        step (VoicePttShortcut "ptt-down") ptt
                in
                Expect.all
                    [ \_ -> query ptt |> Query.find [ testid "call-ptt" ] |> Query.has [ Selector.text "Hold Space to talk" ]
                    , \_ -> query down |> Query.find [ testid "call-ptt" ] |> Query.has [ Selector.text "Talking" ]
                    , \_ -> Expect.equal False (step (VoicePttShortcut "ptt-up") down).voiceSettings.pttHeld
                    , \_ -> Expect.equal False (step (VoicePttShortcut "ptt-down") inCall).voiceSettings.pttHeld
                    , \_ -> Expect.equal [] (outs (VoicePttShortcut "palette") ptt)
                    ]
                    ()
        ]
