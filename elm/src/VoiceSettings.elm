module VoiceSettings exposing
    ( Caps
    , Device
    , DeviceKind(..)
    , DeviceState(..)
    , Effect(..)
    , KeyEvent
    , Msg(..)
    , OutputChoice(..)
    , Prefs
    , Sensitivity(..)
    , State
    , blankState
    , captureKey

    , decodePrefs
    , defaultPrefs
    , devicesOf
    , encodePrefs
    , keyDisplay
    , maxDeviceIdLength
    , maxKeyLength
    , normalizeDevices
    , pruneSelections
    , sensitivityFromString
    , sensitivityToString
    , storageKey
    , update
    )

{-| v3/calls-c9 — calls slice C9: voice settings + push to talk
(`elm/design/calls/CALLS_DESIGN.md` §2.11, §3.1, §5), the pure half of
the oracle's `settings/VoiceSettings.tsx`,
`store/voiceSettingsPersistence.ts` and the PTT runtime in
`media/useCadenceMedia.ts`.

  - `Prefs` mirrors `StoredVoiceSettings` and persists as JSON under
    `onyx:voice-settings` (the oracle key), sanitised field by field
    on read exactly like `sanitizeStoredVoiceSettings`. One deliberate
    change: `muteOnJoin` defaults to **on** (spec §2.3 / §7.2,
    provisional) so the banner's "your microphone starts off" promise
    holds.
  - Devices come from a ports-side `enumerateDevices` bridge as a
    feed; labels fall back to "Microphone N" / "Speaker N" /
    "Camera N" and a selection whose device vanished resets to the
    system default (oracle `loadDevices`).
  - Processing toggles render only when the bridge reports the
    capability (`noiseSuppression` / `echoCancellation` from
    `getSupportedConstraints`, voice activity only when the engine
    exposes a gate) — the sheet never offers a switch that does
    nothing.
  - Talk-key capture: the next non-IME, non-repeat key; Escape
    cancels; Space is stored as "Space"; bare modifier keys are not a
    talk key (a PTT hold ignores Ctrl/Meta/Alt chords anyway).

-}

import Json.Decode as Decode
import Json.Encode as Encode



-- PREFS


type Sensitivity
    = Low
    | Medium
    | High


type alias Prefs =
    { inputDeviceId : Maybe String
    , outputDeviceId : Maybe String
    , outputVolume : Int
    , vadEnabled : Bool
    , vadSensitivity : Sensitivity
    , noiseSuppression : Bool
    , echoCancellation : Bool
    , pushToTalk : Bool
    , pushToTalkKey : Maybe String
    , cameraDeviceId : Maybe String
    , muteOnJoin : Bool
    }


{-| Oracle `DEFAULT_VOICE_SETTINGS`, except `muteOnJoin = True`
(spec §2.11 "Join muted (default on)", provisional — §7.2).
-}
defaultPrefs : Prefs
defaultPrefs =
    { inputDeviceId = Nothing
    , outputDeviceId = Nothing
    , outputVolume = 80
    , vadEnabled = True
    , vadSensitivity = Medium
    , noiseSuppression = True
    , echoCancellation = True
    , pushToTalk = False
    , pushToTalkKey = Nothing
    , cameraDeviceId = Nothing
    , muteOnJoin = True
    }


storageKey : String
storageKey =
    "onyx:voice-settings"


maxDeviceIdLength : Int
maxDeviceIdLength =
    512


maxKeyLength : Int
maxKeyLength =
    64


sensitivityToString : Sensitivity -> String
sensitivityToString s =
    case s of
        Low ->
            "low"

        Medium ->
            "medium"

        High ->
            "high"


sensitivityFromString : String -> Maybe Sensitivity
sensitivityFromString raw =
    case raw of
        "low" ->
            Just Low

        "medium" ->
            Just Medium

        "high" ->
            Just High

        _ ->
            Nothing


{-| Field-by-field sanitiser (oracle `sanitizeStoredVoiceSettings`):
a non-object is the defaults; each bad field falls back alone.
-}
decodePrefs : Decode.Value -> Prefs
decodePrefs raw =
    let
        field name decoder fallback =
            Decode.decodeValue (Decode.field name decoder) raw
                |> Result.toMaybe
                |> Maybe.withDefault fallback

        nullableString limit name =
            field name
                (Decode.string
                    |> Decode.map
                        (\s ->
                            if String.length s > 0 && String.length s <= limit then
                                Just s

                            else
                                Nothing
                        )
                )
                Nothing

        volume =
            field "outputVolume"
                (Decode.float
                    |> Decode.andThen
                        (\v ->
                            if isNaN v || isInfinite v then
                                Decode.fail "not finite"

                            else
                                Decode.succeed (round (clamp 0 100 v))
                        )
                )
                defaultPrefs.outputVolume

        isObject =
            case Decode.decodeValue (Decode.keyValuePairs Decode.value) raw of
                Ok _ ->
                    True

                Err _ ->
                    False
    in
    if not isObject then
        defaultPrefs

    else
        { inputDeviceId = nullableString maxDeviceIdLength "inputDeviceId"
        , outputDeviceId = nullableString maxDeviceIdLength "outputDeviceId"
        , outputVolume = volume
        , vadEnabled = field "vadEnabled" Decode.bool defaultPrefs.vadEnabled
        , vadSensitivity =
            field "vadSensitivity" (Decode.map sensitivityFromString Decode.string) Nothing
                |> Maybe.withDefault defaultPrefs.vadSensitivity
        , noiseSuppression = field "noiseSuppression" Decode.bool defaultPrefs.noiseSuppression
        , echoCancellation = field "echoCancellation" Decode.bool defaultPrefs.echoCancellation
        , pushToTalk = field "pushToTalk" Decode.bool defaultPrefs.pushToTalk
        , pushToTalkKey = nullableString maxKeyLength "pushToTalkKey"
        , cameraDeviceId = nullableString maxDeviceIdLength "cameraDeviceId"
        , muteOnJoin = field "muteOnJoin" Decode.bool defaultPrefs.muteOnJoin
        }


encodePrefs : Prefs -> Encode.Value
encodePrefs p =
    let
        nullable =
            Maybe.map Encode.string >> Maybe.withDefault Encode.null
    in
    Encode.object
        [ ( "inputDeviceId", nullable p.inputDeviceId )
        , ( "outputDeviceId", nullable p.outputDeviceId )
        , ( "outputVolume", Encode.int p.outputVolume )
        , ( "vadEnabled", Encode.bool p.vadEnabled )
        , ( "vadSensitivity", Encode.string (sensitivityToString p.vadSensitivity) )
        , ( "noiseSuppression", Encode.bool p.noiseSuppression )
        , ( "echoCancellation", Encode.bool p.echoCancellation )
        , ( "pushToTalk", Encode.bool p.pushToTalk )
        , ( "pushToTalkKey", nullable p.pushToTalkKey )
        , ( "cameraDeviceId", nullable p.cameraDeviceId )
        , ( "muteOnJoin", Encode.bool p.muteOnJoin )
        ]



-- DEVICES


type DeviceKind
    = AudioIn
    | AudioOut
    | VideoIn


type alias Device =
    { deviceId : String
    , kind : DeviceKind
    , label : String
    }


type DeviceState
    = DevicesIdle
    | DevicesLoading
    | DevicesReady
    | DevicesUnavailable
    | DevicesFailed


{-| What the browser / engine can honour. All false until the bridge
answers, so nothing is offered on a guess.
-}
type alias Caps =
    { selectAudioOutput : Bool
    , noiseSuppression : Bool
    , echoCancellation : Bool
    , voiceActivity : Bool
    }


type OutputChoice
    = OutputIdle
    | OutputPending
    | OutputChosen
    | OutputError String


type alias State =
    { open : Bool
    , devices : List Device
    , deviceState : DeviceState
    , caps : Caps
    , capturing : Bool
    , output : OutputChoice
    , pttHeld : Bool
    }


blankState : State
blankState =
    { open = False
    , devices = []
    , deviceState = DevicesIdle
    , caps = { selectAudioOutput = False, noiseSuppression = False, echoCancellation = False, voiceActivity = False }
    , capturing = False
    , output = OutputIdle
    , pttHeld = False
    }


kindFromString : String -> Maybe DeviceKind
kindFromString raw =
    case raw of
        "audioinput" ->
            Just AudioIn

        "audiooutput" ->
            Just AudioOut

        "videoinput" ->
            Just VideoIn

        _ ->
            Nothing


fallbackLabel : DeviceKind -> Int -> String
fallbackLabel kind index =
    (case kind of
        AudioIn ->
            "Microphone "

        AudioOut ->
            "Speaker "

        VideoIn ->
            "Camera "
    )
        ++ String.fromInt (index + 1)


{-| Oracle `normalizeDevices`: keep the three kinds, number blank
labels per kind, drop invalid / oversized ids and duplicates.
-}
normalizeDevices : List { deviceId : String, kind : String, label : String } -> List Device
normalizeDevices raw =
    raw
        |> List.foldl
            (\d ( counts, seen, acc ) ->
                case kindFromString d.kind of
                    Just kind ->
                        let
                            n =
                                countOf kind counts

                            id =
                                d.deviceId

                            dupKey =
                                d.kind ++ "\n" ++ id
                        in
                        if String.isEmpty id || String.length id > maxDeviceIdLength || List.member dupKey seen then
                            ( counts, seen, acc )

                        else
                            ( bump kind counts
                            , dupKey :: seen
                            , { deviceId = id
                              , kind = kind
                              , label =
                                    if String.isEmpty (String.trim d.label) then
                                        fallbackLabel kind n

                                    else
                                        String.left 256 (String.trim d.label)
                              }
                                :: acc
                            )

                    Nothing ->
                        ( counts, seen, acc )
            )
            ( ( 0, 0, 0 ), [], [] )
        |> (\( _, _, acc ) -> List.reverse acc)


countOf : DeviceKind -> ( Int, Int, Int ) -> Int
countOf kind ( a, b, c ) =
    case kind of
        AudioIn ->
            a

        AudioOut ->
            b

        VideoIn ->
            c


bump : DeviceKind -> ( Int, Int, Int ) -> ( Int, Int, Int )
bump kind ( a, b, c ) =
    case kind of
        AudioIn ->
            ( a + 1, b, c )

        AudioOut ->
            ( a, b + 1, c )

        VideoIn ->
            ( a, b, c + 1 )


devicesOf : DeviceKind -> List Device -> List Device
devicesOf kind =
    List.filter (\d -> d.kind == kind)


{-| A stored selection whose device is gone resets to the system
default (oracle `loadDevices` selection patch).
-}
pruneSelections : List Device -> Prefs -> Prefs
pruneSelections devices prefs =
    let
        keep kind selected =
            case selected of
                Just id ->
                    if List.any (\d -> d.kind == kind && d.deviceId == id) devices then
                        Just id

                    else
                        Nothing

                Nothing ->
                    Nothing
    in
    { prefs
        | inputDeviceId = keep AudioIn prefs.inputDeviceId
        , outputDeviceId = keep AudioOut prefs.outputDeviceId
        , cameraDeviceId = keep VideoIn prefs.cameraDeviceId
    }



-- TALK KEY


type alias KeyEvent =
    { key : String
    , composing : Bool
    , keyCode : Int
    , repeat : Bool
    }


{-| One keydown while capturing. `Nothing` = not ours, keep
capturing (IME, auto-repeat, a bare modifier, a dead key);
`Just Nothing` = cancel (Escape); `Just (Just k)` = bind `k`.
-}
captureKey : KeyEvent -> Maybe (Maybe String)
captureKey ev =
    if ev.composing || ev.keyCode == 229 || ev.repeat then
        Nothing

    else if ev.key == "Escape" then
        Just Nothing

    else if List.member ev.key [ "Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified", "" ] then
        Nothing

    else if ev.key == " " || ev.key == "Spacebar" then
        Just (Just "Space")

    else if String.length ev.key > maxKeyLength then
        Nothing

    else
        Just (Just ev.key)


{-| "Talk key" display: the bound key, "Not set", or "Press a key"
while capturing.
-}
keyDisplay : Bool -> Maybe String -> String
keyDisplay capturing key =
    if capturing then
        "Press a key"

    else
        Maybe.withDefault "Not set" key



-- FEED (ports -> Elm)


type Feed
    = FeedPrefs Prefs
    | FeedDevices (Result DeviceState { devices : List Device, caps : Caps })
    | FeedOutputChosen { deviceId : String, label : String }
    | FeedOutputError (Maybe String)


feedDecoder : Decode.Decoder Feed
feedDecoder =
    Decode.field "kind" Decode.string
        |> Decode.andThen
            (\kind ->
                case kind of
                    "prefs" ->
                        Decode.oneOf
                            [ Decode.field "prefs" Decode.value |> Decode.map (decodePrefs >> FeedPrefs)
                            , Decode.succeed (FeedPrefs defaultPrefs)
                            ]

                    "devices" ->
                        Decode.oneOf [ Decode.field "error" Decode.string, Decode.succeed "" ]
                            |> Decode.andThen
                                (\err ->
                                    if err == "unavailable" then
                                        Decode.succeed (FeedDevices (Err DevicesUnavailable))

                                    else if err /= "" then
                                        Decode.succeed (FeedDevices (Err DevicesFailed))

                                    else
                                        Decode.map2 (\ds caps -> FeedDevices (Ok { devices = normalizeDevices ds, caps = caps }))
                                            (Decode.field "devices"
                                                (Decode.list
                                                    (Decode.map3 (\i k l -> { deviceId = i, kind = k, label = l })
                                                        (Decode.oneOf [ Decode.field "deviceId" Decode.string, Decode.succeed "" ])
                                                        (Decode.oneOf [ Decode.field "kind" Decode.string, Decode.succeed "" ])
                                                        (Decode.oneOf [ Decode.field "label" Decode.string, Decode.succeed "" ])
                                                    )
                                                )
                                            )
                                            (Decode.oneOf [ Decode.field "caps" capsDecoder, Decode.succeed blankState.caps ])
                                )

                    "output-chosen" ->
                        Decode.map2 (\i l -> FeedOutputChosen { deviceId = i, label = l })
                            (Decode.field "deviceId" Decode.string)
                            (Decode.oneOf [ Decode.field "label" Decode.string, Decode.succeed "" ])

                    "output-error" ->
                        Decode.oneOf [ Decode.field "name" Decode.string, Decode.succeed "" ]
                            |> Decode.map (outputErrorCopy >> FeedOutputError)

                    _ ->
                        Decode.fail "unknown feed"
            )


capsDecoder : Decode.Decoder Caps
capsDecoder =
    let
        flag name =
            Decode.oneOf [ Decode.field name Decode.bool, Decode.succeed False ]
    in
    Decode.map4 Caps
        (flag "selectAudioOutput")
        (flag "noiseSuppression")
        (flag "echoCancellation")
        (flag "voiceActivity")


{-| Oracle `outputSelectionError`: AbortError is a silent cancel. -}
outputErrorCopy : String -> Maybe String
outputErrorCopy name =
    case name of
        "AbortError" ->
            Nothing

        "NotAllowedError" ->
            Just "Speaker selection was not allowed."

        "NotFoundError" ->
            Just "No selectable speaker was found."

        "invalid" ->
            Just "The browser returned an invalid speaker."

        _ ->
            Just "Speaker selection failed. Try again."


decodeFeed : Decode.Value -> Maybe Feed
decodeFeed raw =
    Decode.decodeValue feedDecoder raw |> Result.toMaybe



-- UPDATE


type Msg
    = Open
    | Close
    | SetInput String
    | SetOutput String
    | SetCamera String
    | SetVolume String
    | SetMuteOnJoin Bool
    | SetVad Bool
    | SetSensitivity String
    | SetNoise Bool
    | SetEcho Bool
    | SetPushToTalk Bool
    | CaptureToggle
    | CaptureKey KeyEvent
    | ClearKey
    | ChooseSpeaker
    | Feed Decode.Value
    | PttHeld Bool


{-| Effects `App` turns into outbounds: persist the prefs, ask the
bridge for devices, open the browser speaker chooser, or move focus.
-}
type Effect
    = SavePrefs
    | RequestDevices
    | RequestSpeakerChooser
    | FocusId String


selection : String -> Maybe String
selection raw =
    if String.isEmpty raw || String.length raw > maxDeviceIdLength then
        Nothing

    else
        Just raw


update : Msg -> { prefs : Prefs, state : State } -> ( { prefs : Prefs, state : State }, List Effect )
update msg ({ prefs, state } as model) =
    let
        set p =
            if p == prefs then
                ( model, [] )

            else
                ( { model | prefs = p }, [ SavePrefs ] )
    in
    case msg of
        Open ->
            ( { model | state = { state | open = True, deviceState = DevicesLoading, capturing = False, output = OutputIdle } }
            , [ RequestDevices ]
            )

        Close ->
            ( { model | state = { state | open = False, capturing = False } }, [] )

        SetInput raw ->
            set { prefs | inputDeviceId = selection raw }

        SetOutput raw ->
            set { prefs | outputDeviceId = selection raw }

        SetCamera raw ->
            set { prefs | cameraDeviceId = selection raw }

        SetVolume raw ->
            case String.toFloat raw of
                Just v ->
                    set { prefs | outputVolume = round (clamp 0 100 v) }

                Nothing ->
                    ( model, [] )

        SetMuteOnJoin on ->
            set { prefs | muteOnJoin = on }

        SetVad on ->
            set { prefs | vadEnabled = on }

        SetSensitivity raw ->
            case sensitivityFromString raw of
                Just s ->
                    set { prefs | vadSensitivity = s }

                Nothing ->
                    ( model, [] )

        SetNoise on ->
            set { prefs | noiseSuppression = on }

        SetEcho on ->
            set { prefs | echoCancellation = on }

        SetPushToTalk on ->
            set { prefs | pushToTalk = on }

        CaptureToggle ->
            -- Starting a capture pulls focus onto the capture button
            -- (it owns the keydown listener; Safari does not focus a
            -- clicked button). Cancelling leaves focus where it is.
            ( { model | state = { state | capturing = not state.capturing } }
            , if state.capturing then
                []

              else
                [ FocusId "voice-ptt-capture" ]
            )

        CaptureKey ev ->
            if not state.capturing then
                ( model, [] )

            else
                case captureKey ev of
                    Nothing ->
                        ( model, [] )

                    Just Nothing ->
                        ( { model | state = { state | capturing = False } }, [ FocusId "voice-ptt-capture" ] )

                    Just (Just key) ->
                        let
                            next =
                                { prefs | pushToTalkKey = Just key, pushToTalk = True }
                        in
                        ( { prefs = next, state = { state | capturing = False } }
                        , (if next == prefs then
                            []

                           else
                            [ SavePrefs ]
                          )
                            ++ [ FocusId "voice-ptt-capture" ]
                        )

        ClearKey ->
            let
                ( m, fx ) =
                    set { prefs | pushToTalkKey = Nothing }
            in
            ( { m | state = { state | capturing = False } }, fx )

        ChooseSpeaker ->
            if not state.caps.selectAudioOutput || state.output == OutputPending then
                ( model, [] )

            else
                ( { model | state = { state | output = OutputPending } }, [ RequestSpeakerChooser ] )

        PttHeld held ->
            if held && not (prefs.pushToTalk && prefs.pushToTalkKey /= Nothing) then
                ( model, [] )

            else
                ( { model | state = { state | pttHeld = held } }, [] )

        Feed raw ->
            case decodeFeed raw of
                Just (FeedPrefs loaded) ->
                    ( { model | prefs = loaded }, [] )

                Just (FeedDevices (Ok found)) ->
                    let
                        pruned =
                            pruneSelections found.devices prefs
                    in
                    ( { prefs = pruned, state = { state | devices = found.devices, caps = found.caps, deviceState = DevicesReady } }
                    , if pruned == prefs then
                        []

                      else
                        [ SavePrefs ]
                    )

                Just (FeedDevices (Err failure)) ->
                    ( { model | state = { state | deviceState = failure } }, [] )

                Just (FeedOutputChosen chosen) ->
                    case selection chosen.deviceId of
                        Just id ->
                            let
                                others =
                                    List.filter (\d -> not (d.kind == AudioOut && d.deviceId == id)) state.devices

                                previous =
                                    List.filter (\d -> d.kind == AudioOut && d.deviceId == id) state.devices
                                        |> List.head
                                        |> Maybe.map .label

                                label =
                                    if not (String.isEmpty (String.trim chosen.label)) then
                                        String.left 256 (String.trim chosen.label)

                                    else
                                        Maybe.withDefault (fallbackLabel AudioOut (List.length (devicesOf AudioOut state.devices))) previous

                                p =
                                    { prefs | outputDeviceId = Just id }
                            in
                            ( { prefs = p
                              , state = { state | devices = others ++ [ { deviceId = id, kind = AudioOut, label = label } ], output = OutputChosen }
                              }
                            , if p == prefs then
                                []

                              else
                                [ SavePrefs ]
                            )

                        Nothing ->
                            ( { model | state = { state | output = OutputError "The browser returned an invalid speaker." } }, [] )

                Just (FeedOutputError copy) ->
                    case copy of
                        Just text ->
                            ( { model | state = { state | output = OutputError text } }, [] )

                        Nothing ->
                            ( { model | state = { state | output = OutputIdle } }, [] )

                Nothing ->
                    ( model, [] )
