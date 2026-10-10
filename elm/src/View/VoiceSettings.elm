module View.VoiceSettings exposing (pttHint, sheet, youEntry)

{-| v3/calls-c9 — C9 voice settings sheet (`CALLS_DESIGN.md` §2.11,
§3.2; oracle `settings/VoiceSettings.tsx`): devices, processing and
push to talk, through the shared `View.Sheet` (dialog role, focus
trap + restore, Escape). Initial focus is the first select (§3.2).

Talk-key capture listens on the capture button itself (focus is
moved there when capture starts) and stops the key from reaching the
sheet, so Escape cancels the capture rather than closing the sheet.

-}

import App exposing (Model, Msg(..))
import Html exposing (Html, button, div, h2, h3, input, label, option, p, section, select, small, span, strong, text)
import Html.Attributes exposing (attribute, checked, class, disabled, for, id, selected, type_, value)
import Html.Events exposing (custom, on, onCheck, onClick, onInput, targetValue)
import Json.Decode as Decode
import Media
import View.CallPresence exposing (callIcon)
import View.Sheet as Sheet
import VoiceSettings exposing (DeviceKind(..), DeviceState(..), OutputChoice(..), Sensitivity(..))


scope : String
scope =
    "voice-settings"


vs : VoiceSettings.Msg -> Msg
vs =
    VoiceSettingsMsg


{-| The You hub's "This device" entry (§2.11: reachable from More →
Settings and from the You hub).
-}
youEntry : Html Msg
youEntry =
    button
        [ type_ "button"
        , class "onyx-you-link"
        , attribute "data-testid" "you-open-voice-settings"
        , attribute "aria-haspopup" "dialog"
        , onClick (vs VoiceSettings.Open)
        ]
        [ span []
            [ strong [] [ text "Voice settings" ]
            , small [] [ text "Microphone, speakers, camera, and push to talk" ]
            ]
        ]


{-| The bar's push-to-talk hint (new copy): only while PTT is on with
a bound key in a live call.
-}
pttHint : Model -> Html Msg
pttHint model =
    case ( model.voicePrefs.pushToTalk, model.voicePrefs.pushToTalkKey ) of
        ( True, Just key ) ->
            if model.calls.lifecycle == Media.InCall then
                span
                    [ class "onyx-call-ptt"
                    , attribute "data-held" (boolAttr model.voiceSettings.pttHeld)
                    , attribute "data-testid" "call-ptt"
                    ]
                    [ text
                        (if model.voiceSettings.pttHeld then
                            "Talking"

                         else
                            "Hold " ++ key ++ " to talk"
                        )
                    ]

            else
                text ""

        _ ->
            text ""


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


sheet : Model -> Html Msg
sheet model =
    if not model.voiceSettings.open then
        text ""

    else
        Sheet.view
            { scope = scope
            , label = Sheet.LabelledBy (Sheet.titleId scope)
            , onClose = vs VoiceSettings.Close
            , placement = Sheet.Center
            , layerClass = "onyx-call-sheet-layer"
            , panelClass = "onyx-call-sheet onyx-voice-settings"
            , backdropClass = "onyx-call-sheet-backdrop"
            , layerAttrs = []
            , modal = True
            , attrs =
                [ attribute "aria-describedby" "voice-settings-sub"
                , attribute "data-testid" "voice-settings"
                ]
            }
            [ div [ class "onyx-call-sheet-head" ]
                [ div []
                    [ h2 [ id (Sheet.titleId scope) ] [ text "Voice settings" ]
                    , p [ id "voice-settings-sub" ] [ text "Devices, activation, and signal processing." ]
                    ]
                , button
                    [ type_ "button"
                    , class "onyx-call-sheet-close"
                    , attribute "aria-label" "Close voice settings"
                    , attribute "data-testid" "voice-settings-close"
                    , onClick (vs VoiceSettings.Close)
                    ]
                    [ callIcon "x" ]
                ]
            , div [ class "onyx-call-sheet-body onyx-vs-body" ]
                [ devicesSection model
                , processingSection model
                , pttSection model
                ]
            ]


sectionHead : String -> String -> String -> List (Html Msg)
sectionHead key title copy =
    [ h3 [ class "onyx-vs-title", id ("voice-" ++ key ++ "-title") ] [ text title ]
    , p [ class "onyx-vs-copy" ] [ text copy ]
    ]


devicesSection : Model -> Html Msg
devicesSection model =
    let
        st =
            model.voiceSettings

        prefs =
            model.voicePrefs
    in
    section [ class "onyx-vs-section", attribute "aria-labelledby" "voice-devices-title" ]
        (sectionHead "devices" "Devices" "Choose the capture, playback, and camera paths for this voice session."
            ++ [ case st.deviceState of
                    DevicesLoading ->
                        p [ class "onyx-vs-desc", attribute "role" "status" ] [ text "Checking media devices…" ]

                    DevicesUnavailable ->
                        p [ class "onyx-vs-error", attribute "role" "alert" ] [ text "Device enumeration is unavailable in this browser." ]

                    DevicesFailed ->
                        p [ class "onyx-vs-error", attribute "role" "alert" ] [ text "Device enumeration failed. Check media permissions." ]

                    _ ->
                        text ""
               , deviceSelect
                    { idValue = "voice-input-device"
                    , label_ = "Microphone"
                    , description = "Microphone used for calls and rooms."
                    , emptyLabel = "System microphone"
                    , current = prefs.inputDeviceId
                    , devices = VoiceSettings.devicesOf AudioIn st.devices
                    , onPick = vs << VoiceSettings.SetInput
                    , autofocus = True
                    }
               , div [ class "onyx-vs-output" ]
                    ([ deviceSelect
                        { idValue = "voice-output-device"
                        , label_ = "Speakers"
                        , description = "Speaker or headset for remote audio."
                        , emptyLabel = "System speaker"
                        , current = prefs.outputDeviceId
                        , devices = VoiceSettings.devicesOf AudioOut st.devices
                        , onPick = vs << VoiceSettings.SetOutput
                        , autofocus = False
                        }
                     ]
                        ++ (if st.caps.selectAudioOutput then
                                [ button
                                    [ type_ "button"
                                    , class "onyx-call-btn onyx-call-btn-ghost onyx-vs-btn"
                                    , attribute "data-testid" "voice-choose-speaker"
                                    , attribute "aria-busy" (boolAttr (st.output == OutputPending))
                                    , disabled (st.output == OutputPending)
                                    , onClick (vs VoiceSettings.ChooseSpeaker)
                                    ]
                                    [ text
                                        (if st.output == OutputPending then
                                            "Choosing speaker…"

                                         else
                                            "Choose speaker…"
                                        )
                                    ]
                                , case st.output of
                                    OutputChosen ->
                                        p [ class "onyx-vs-desc", attribute "role" "status" ] [ text "Speaker access updated." ]

                                    OutputError message ->
                                        p [ class "onyx-vs-error", attribute "role" "alert" ] [ text message ]

                                    _ ->
                                        text ""
                                ]

                            else
                                []
                           )
                    )
               , deviceSelect
                    { idValue = "voice-camera-device"
                    , label_ = "Camera"
                    , description = "Camera used when video is enabled."
                    , emptyLabel = "System camera"
                    , current = prefs.cameraDeviceId
                    , devices = VoiceSettings.devicesOf VideoIn st.devices
                    , onPick = vs << VoiceSettings.SetCamera
                    , autofocus = False
                    }
               , div [ class "onyx-vs-field" ]
                    [ label [ class "onyx-vs-label", for "voice-output-volume" ] [ text "Output volume" ]
                    , input
                        [ type_ "range"
                        , id "voice-output-volume"
                        , class "onyx-vs-range"
                        , Html.Attributes.min "0"
                        , Html.Attributes.max "100"
                        , Html.Attributes.step "1"
                        , value (String.fromInt prefs.outputVolume)
                        , attribute "aria-describedby" "voice-output-volume-description"
                        , onInput (vs << VoiceSettings.SetVolume)
                        ]
                        []
                    , p [ class "onyx-vs-desc", id "voice-output-volume-description" ] [ text (String.fromInt prefs.outputVolume ++ "%") ]
                    ]
               ]
        )


deviceSelect :
    { idValue : String
    , label_ : String
    , description : String
    , emptyLabel : String
    , current : Maybe String
    , devices : List VoiceSettings.Device
    , onPick : String -> Msg
    , autofocus : Bool
    }
    -> Html Msg
deviceSelect cfg =
    div [ class "onyx-vs-field" ]
        [ label [ class "onyx-vs-label", for cfg.idValue ] [ text cfg.label_ ]
        , p [ class "onyx-vs-desc", id (cfg.idValue ++ "-description") ] [ text cfg.description ]
        , select
            ([ id cfg.idValue
             , class "onyx-vs-select"
             , attribute "aria-describedby" (cfg.idValue ++ "-description")
             , on "change" (Decode.map cfg.onPick targetValue)
             ]
                ++ (if cfg.autofocus then
                        [ Sheet.autofocus scope ]

                    else
                        []
                   )
            )
            (option [ value "", selected (cfg.current == Nothing) ] [ text cfg.emptyLabel ]
                :: List.map
                    (\d -> option [ value d.deviceId, selected (cfg.current == Just d.deviceId) ] [ text d.label ])
                    cfg.devices
            )
        ]


toggleRow : { idValue : String, label_ : String, description : String, isOn : Bool, onToggle : Bool -> Msg } -> Html Msg
toggleRow cfg =
    label [ class "onyx-vs-toggle", for cfg.idValue ]
        [ input
            [ type_ "checkbox"
            , id cfg.idValue
            , checked cfg.isOn
            , attribute "aria-describedby" (cfg.idValue ++ "-description")
            , onCheck cfg.onToggle
            ]
            []
        , span [ class "onyx-vs-toggle-text" ]
            [ span [ class "onyx-vs-toggle-label" ] [ text cfg.label_ ]
            , span [ class "onyx-vs-desc", id (cfg.idValue ++ "-description") ] [ text cfg.description ]
            ]
        ]


processingSection : Model -> Html Msg
processingSection model =
    let
        prefs =
            model.voicePrefs

        caps =
            model.voiceSettings.caps
    in
    section [ class "onyx-vs-section", attribute "aria-labelledby" "voice-processing-title" ]
        (sectionHead "processing" "Processing" "Keep the signal readable without hiding the controls from power users."
            ++ [ toggleRow
                    { idValue = "voice-mute-on-join"
                    , label_ = "Join muted"
                    , description = "Start with your microphone off. Unmute when you are ready to speak."
                    , isOn = prefs.muteOnJoin
                    , onToggle = vs << VoiceSettings.SetMuteOnJoin
                    }
               ]
            ++ (if caps.voiceActivity then
                    [ toggleRow
                        { idValue = "voice-vad-enabled"
                        , label_ = "Voice activity"
                        , description = "Transmit when speech is detected."
                        , isOn = prefs.vadEnabled
                        , onToggle = vs << VoiceSettings.SetVad
                        }
                    , div [ class "onyx-vs-field" ]
                        [ label [ class "onyx-vs-label", for "voice-vad-sensitivity" ] [ text "Sensitivity" ]
                        , p [ class "onyx-vs-desc", id "voice-vad-sensitivity-description" ] [ text "Threshold for opening the voice gate." ]
                        , select
                            [ id "voice-vad-sensitivity"
                            , class "onyx-vs-select"
                            , attribute "aria-describedby" "voice-vad-sensitivity-description"
                            , disabled (not prefs.vadEnabled)
                            , on "change" (Decode.map (vs << VoiceSettings.SetSensitivity) targetValue)
                            ]
                            (List.map
                                (\( s, l ) ->
                                    option [ value (VoiceSettings.sensitivityToString s), selected (prefs.vadSensitivity == s) ] [ text l ]
                                )
                                [ ( Low, "Low" ), ( Medium, "Medium" ), ( High, "High" ) ]
                            )
                        ]
                    ]

                else
                    []
               )
            ++ (if caps.noiseSuppression then
                    [ toggleRow
                        { idValue = "voice-noise-suppression"
                        , label_ = "Noise suppression"
                        , description = "Reduce constant background noise before sending."
                        , isOn = prefs.noiseSuppression
                        , onToggle = vs << VoiceSettings.SetNoise
                        }
                    ]

                else
                    []
               )
            ++ (if caps.echoCancellation then
                    [ toggleRow
                        { idValue = "voice-echo-cancellation"
                        , label_ = "Echo cancellation"
                        , description = "Prevent speaker output from returning into the microphone."
                        , isOn = prefs.echoCancellation
                        , onToggle = vs << VoiceSettings.SetEcho
                        }
                    ]

                else
                    []
               )
        )


captureDecoder : Decode.Decoder { message : Msg, stopPropagation : Bool, preventDefault : Bool }
captureDecoder =
    Decode.map4 VoiceSettings.KeyEvent
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        (Decode.oneOf [ Decode.field "keyCode" Decode.int, Decode.succeed 0 ])
        (Decode.oneOf [ Decode.field "repeat" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\ev ->
                case VoiceSettings.captureKey ev of
                    Nothing ->
                        Decode.fail "not a talk key"

                    Just _ ->
                        Decode.succeed { message = vs (VoiceSettings.CaptureKey ev), stopPropagation = True, preventDefault = True }
            )


pttSection : Model -> Html Msg
pttSection model =
    let
        prefs =
            model.voicePrefs

        capturing =
            model.voiceSettings.capturing
    in
    section [ class "onyx-vs-section", attribute "aria-labelledby" "voice-ptt-title" ]
        (sectionHead "ptt" "Push to talk" "Use a held key instead of automatic voice activation."
            ++ [ toggleRow
                    { idValue = "voice-push-to-talk"
                    , label_ = "Push to talk"
                    , description = "Require a key press before transmitting."
                    , isOn = prefs.pushToTalk
                    , onToggle = vs << VoiceSettings.SetPushToTalk
                    }
               , div [ class "onyx-vs-key-row" ]
                    [ div [ class "onyx-vs-key-display" ]
                        [ span [ class "onyx-vs-label", id "voice-ptt-key-label" ] [ text "Talk key" ]
                        , span
                            [ class "onyx-vs-key"
                            , attribute "aria-labelledby" "voice-ptt-key-label"
                            , attribute "aria-live" "polite"
                            , attribute "data-capturing" (boolAttr capturing)
                            , attribute "data-testid" "voice-ptt-key"
                            ]
                            [ text (VoiceSettings.keyDisplay capturing prefs.pushToTalkKey) ]
                        ]
                    , button
                        ([ type_ "button"
                         , id "voice-ptt-capture"
                         , class "onyx-call-btn onyx-vs-btn"
                         , attribute "data-testid" "voice-ptt-capture"
                         , attribute "aria-label"
                            (if capturing then
                                "Cancel push-to-talk key capture"

                             else
                                "Capture push-to-talk key"
                            )
                         , attribute "aria-pressed" (boolAttr capturing)
                         , onClick (vs VoiceSettings.CaptureToggle)
                         ]
                            ++ (if capturing then
                                    [ custom "keydown" captureDecoder ]

                                else
                                    []
                               )
                        )
                        [ text
                            (if capturing then
                                "Cancel capture"

                             else
                                "Capture key"
                            )
                        ]
                    , button
                        [ type_ "button"
                        , class "onyx-call-btn onyx-call-btn-ghost onyx-vs-btn onyx-vs-clear"
                        , attribute "aria-label" "Clear push-to-talk key"
                        , attribute "data-testid" "voice-ptt-clear"
                        , disabled (prefs.pushToTalkKey == Nothing)
                        , onClick (vs VoiceSettings.ClearKey)
                        ]
                        [ text "Clear" ]
                    ]
               ]
        )
