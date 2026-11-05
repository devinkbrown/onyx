module View.Calls exposing (callsHub, mediaControlPanel, recordingStatus)

{-| Calls hub — Elm port of `src/shell/CallsHub.tsx` (presentation copy
and navigation-only behavior; the voice lifecycle arrives from the
engine bridge, which lands with the engine itself).

Hard rules, mirroring the oracle:

  - Opening this hub never joins, accepts, starts, or otherwise mutates
    a call. The only controls are "Choose a room" (reveals the rail)
    and "Return to call" (navigates, voice untouched).
  - Ringing and provisional states are never labeled established.
  - No join / accept / start control exists for any presentation.
  - The last-call outcome renders only while idle; a live call always
    wins over history, and the hub never invents it.

-}

import App exposing (Msg(..))
import Html exposing (Html, button, div, h1, h2, h3, h4, header, input, label, li, main_, p, span, strong, text, ul)
import Html.Attributes exposing (attribute, checked, class, disabled, step, type_, value)
import Html.Events exposing (onCheck, onClick, onInput)
import Media exposing (CallHub, HubPresentation(..), TranscriptEntry)
import RuntimeDomain
import View.CallSetup
import View.CaptionControls
import View.MediaDiagnostics
import View.MediaInterop


recordingStatus : Maybe RuntimeDomain.MediaControlView -> Bool -> Html Msg
recordingStatus maybeSnapshot ownerCurrent =
    case ( ownerCurrent, maybeSnapshot ) of
        ( True, Just snapshot ) ->
            case snapshot.call of
                Just call ->
                    div [ class "onyx-recording-status", attribute "role" "status", attribute "aria-live" "polite", attribute "data-testid" "live-recording-status" ]
                        [ strong [] [ text "Call recording status" ]
                        , span []
                            [ text
                                (call.conversationId
                                    ++ ": " ++ snapshot.recording.actual
                                    ++ "; desired " ++ Maybe.withDefault "none" snapshot.recording.desiredAction
                                    ++ "; request " ++ snapshot.recording.requestState
                                    ++ "; consent " ++ snapshot.recording.ownConsent
                                    ++ "; roster " ++ snapshot.recording.rosterState
                                    ++ Maybe.withDefault "" (Maybe.map ((++) "; ") snapshot.recording.reason)
                                )
                            ]
                        ]

                Nothing ->
                    text ""

        _ ->
            text ""


mediaControlPanel : Maybe RuntimeDomain.MediaControlView -> Bool -> Maybe String -> List TranscriptEntry -> String -> Bool -> Int -> Maybe { gesture : String, state : String, reason : Maybe String, conversationId : String, callRef : String } -> Bool -> Html Msg
mediaControlPanel maybeSnapshot ownerCurrent activeChannel transcripts captionLanguage browserServiceConsent volumePercent gestureResult authoringPending =
    let
        currentSnapshot =
            if ownerCurrent then maybeSnapshot else Nothing

        exactCall snapshot =
            case ( snapshot.call, activeChannel ) of
                ( Just call, Just target ) ->
                    if call.conversationId == target then Just call else Nothing

                _ ->
                    Nothing

        callPanel snapshot call =
            let
                devices = snapshot.devices
                liveCall = call.conversationId == Maybe.withDefault "" activeChannel
                recordStartAllowed = snapshot.recording.rosterState == "complete" && snapshot.recording.allConsented == Just True && snapshot.recording.policyRevision /= Nothing
                recordPending = snapshot.recording.requestState == "pending" || snapshot.recording.consentRequest == "pending"
                captions = snapshot.caption
            in
            div [ class "onyx-media-call-controls", attribute "data-testid" "media-call-controls" ]
                [ h2 [] [ text "Current call controls" ]
                , p [ attribute "role" "status", attribute "aria-live" "polite" ]
                    [ text
                        ("Observed call in " ++ call.conversationId ++ ". "
                            ++ (if snapshot.muted then "Microphone muted. " else "Microphone unmuted. ")
                            ++ (if snapshot.deafened then "Audio deafened. " else "Audio not deafened. ")
                            ++ Maybe.withDefault "" snapshot.reason
                        )
                    ]
                , h3 [] [ text "Microphone" ]
                , p [] [ text ("Input preference: " ++ devices.inputState ++ Maybe.withDefault "" (Maybe.map ((++) ": ") devices.inputReason)) ]
                , ul []
                    (List.map
                        (\device ->
                            li []
                                [ button
                                    [ type_ "button"
                                    , disabled (authoringPending || not liveCall || device.ref == Maybe.withDefault "" devices.selectedInputRef)
                                    , attribute "data-onyx-media-capture" "input-switch"
                                    , attribute "data-onyx-media-conversation" call.conversationId
                                    , attribute "data-onyx-media-call-ref" call.callRef
                                    , attribute "data-onyx-media-device-ref" device.ref
                                    ]
                                    [ text ((if device.ref == Maybe.withDefault "" devices.selectedInputRef then "Selected: " else "Use: ") ++ device.label) ]
                                ]
                        )
                        devices.inputs
                    )
                , button [ type_ "button", disabled authoringPending, onClick (RuntimeDomainActionRequested RuntimeDomain.MediaDevicesRefresh) ] [ text "Refresh devices" ]
                , h3 [] [ text "Speaker" ]
                , p [ attribute "role" "status" ] [ text ("Output selection: " ++ devices.outputState ++ Maybe.withDefault "" (Maybe.map ((++) ": ") devices.outputReason)) ]
                , ul []
                    (List.map
                        (\device -> li [] [ button [ type_ "button", disabled (authoringPending || devices.selectedOutputRef == Just device.ref), attribute "data-onyx-media-gesture" "output-select", attribute "data-onyx-media-conversation" call.conversationId, attribute "data-onyx-media-call-ref" call.callRef, attribute "data-onyx-media-device-ref" device.ref, attribute "data-onyx-media-volume-percent" (String.fromInt devices.requestedVolumePercent) ] [ text ((if devices.appliedOutputRef == Just device.ref then "Active: " else "Choose: ") ++ device.label) ] ])
                        devices.outputs
                    )
                , label []
                    [ text ("Output volume " ++ String.fromInt volumePercent ++ "%")
                    , input [ type_ "range", Html.Attributes.min "0", Html.Attributes.max "100", step "1", value (String.fromInt volumePercent), disabled authoringPending, onInput MediaOutputVolumeChanged ] []
                    ]
                , p [] [ text ("Applied volume: " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromInt devices.appliedVolumePercent)) ]
                , button [ type_ "button", disabled authoringPending, attribute "data-onyx-media-gesture" "output-select", attribute "data-onyx-media-conversation" call.conversationId, attribute "data-onyx-media-call-ref" call.callRef, attribute "data-onyx-media-device-ref" (Maybe.withDefault "" devices.selectedOutputRef), attribute "data-onyx-media-volume-percent" (String.fromInt volumePercent) ] [ text "Apply speaker settings" ]
                , h3 [] [ text "Server recording" ]
                , p [ attribute "role" "status", attribute "aria-live" "polite" ]
                    [ text
                        ("Your consent: " ++ snapshot.recording.ownConsent
                            ++ "; roster: " ++ snapshot.recording.rosterState
                            ++ "; all participants consented: " ++ Maybe.withDefault "unknown" (Maybe.map (\yes -> if yes then "yes" else "no") snapshot.recording.allConsented)
                            ++ "; recording: " ++ snapshot.recording.actual
                            ++ Maybe.withDefault "" (Maybe.map ((++) ". ") snapshot.recording.reason)
                        )
                    ]
                , button [ type_ "button", disabled (authoringPending || recordPending || not liveCall), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaConsent { conversationId = call.conversationId, callRef = call.callRef, consent = "granted", policyRevision = snapshot.recording.policyRevision })) ] [ text "Consent to recording" ]
                , button [ type_ "button", disabled (not liveCall), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaConsent { conversationId = call.conversationId, callRef = call.callRef, consent = "denied", policyRevision = snapshot.recording.policyRevision })) ] [ text "Decline recording" ]
                , button [ type_ "button", disabled (authoringPending || recordPending || not liveCall), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaRosterRefresh call.conversationId call.callRef)) ] [ text "Refresh recording consent roster" ]
                , button [ type_ "button", disabled (authoringPending || recordPending || not liveCall || not recordStartAllowed), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaRecord { conversationId = call.conversationId, callRef = call.callRef, action = "start", consentRevision = snapshot.recording.policyRevision })) ] [ text "Start server packet recording" ]
                , button [ type_ "button", disabled (not liveCall || (snapshot.recording.actual /= "active" && snapshot.recording.desiredAction /= Just "start" && not (List.member snapshot.recording.requestState [ "pending", "unknown" ]) && not (List.member snapshot.recording.consentRequest [ "pending", "unknown" ]))), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaRecord { conversationId = call.conversationId, callRef = call.callRef, action = "stop", consentRevision = snapshot.recording.policyRevision })) ] [ text "Stop server recording" ]
                , p [ attribute "role" "status" ] [ text ("Recording request: " ++ Maybe.withDefault "none" snapshot.recording.desiredAction ++ "; outcome: " ++ snapshot.recording.requestState ++ ".") ]
                , p [ attribute "role" "note" ] [ text "Recording stores a server packet journal. It does not promise a playable movie, export, or decryption." ]
                , h3 [] [ text "Live captions" ]
                , p [ attribute "role" "note" ] [ text "Caption text is server-visible and may be retained. Browser speech-service mode can send microphone audio to that service and needs separate consent." ]
                , label [] [ text "Language", input [ value captionLanguage, onInput MediaCaptionLanguageChanged, attribute "maxlength" "64" ] [] ]
                , button [ type_ "button", disabled (authoringPending || not liveCall || String.isEmpty captionLanguage), attribute "data-onyx-media-gesture" "caption-prepare", attribute "data-onyx-media-conversation" call.conversationId, attribute "data-onyx-media-call-ref" call.callRef, attribute "data-onyx-media-language" captionLanguage ] [ text "Prepare local language" ]
                , label [] [ input [ type_ "checkbox", checked browserServiceConsent, attribute "aria-label" "Allow browser speech service to receive microphone audio", onCheck MediaBrowserAudioConsentChanged ] [], text "Allow browser speech service to receive microphone audio" ]
                , button [ type_ "button", disabled (authoringPending || not liveCall || String.isEmpty captionLanguage || not browserServiceConsent), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaCaptionStart call.conversationId call.callRef captionLanguage "browser-service" True)) ] [ text "Start browser-service captions" ]
                , button [ type_ "button", disabled (authoringPending || not liveCall || String.isEmpty captionLanguage), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaCaptionStart call.conversationId call.callRef captionLanguage "local" False)) ] [ text "Start local captions" ]
                , button [ type_ "button", disabled (authoringPending || not liveCall || Maybe.map .callRef captions /= Just call.callRef), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaCaptionStop call.conversationId call.callRef)) ] [ text "Stop captions" ]
                , button [ type_ "button", disabled (authoringPending || not liveCall), attribute "data-onyx-media-gesture" "audio-recover", attribute "data-onyx-media-conversation" call.conversationId, attribute "data-onyx-media-call-ref" call.callRef ] [ text "Resume available audio contexts" ]
                ]
    in
    div [ class "onyx-media-controls", attribute "aria-label" "Media device and call controls" ]
        [ button [ type_ "button", disabled authoringPending, onClick (RuntimeDomainActionRequested RuntimeDomain.MediaInspect) ] [ text "Refresh media status" ]
        , View.CallSetup.snapshotView currentSnapshot
        , case gestureResult of
            Just status -> p [ attribute "role" "status", attribute "aria-live" "polite" ] [ text (status.gesture ++ ": " ++ status.state ++ Maybe.withDefault "" (Maybe.map ((++) ". ") status.reason)) ]
            Nothing -> text ""
        , case currentSnapshot of
            Nothing -> p [ attribute "role" "status" ] [ text "Live media device and call state is unavailable." ]
            Just snapshot ->
                div []
                    [ case snapshot.soundcheck of
                        Just result -> p [ attribute "role" "status", attribute "aria-live" "polite" ] [ text ("Microphone check: " ++ result.state ++ "; RMS " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromFloat result.rms) ++ "; sampled frames " ++ String.fromInt result.sampledFrames ++ ".") ]
                        Nothing -> p [ attribute "role" "status" ] [ text "No microphone input check is reported." ]
                    , button [ type_ "button", disabled authoringPending, attribute "data-onyx-media-capture" "soundcheck", attribute "data-onyx-media-conversation" "soundcheck" ] [ text "Check microphone input" ]
                    , devicePreferences snapshot volumePercent authoringPending
                    , case exactCall snapshot of
                        Just call -> callPanel snapshot call
                        Nothing -> p [ attribute "role" "status" ] [ text "No current call for the selected conversation is reported." ]
                    , View.CaptionControls.snapshotView snapshot.caption
                    , View.MediaDiagnostics.snapshotView (Just snapshot.telemetry)
                    , View.MediaInterop.snapshotView snapshot.webRtc
                    , experimentSnapshot snapshot
                    , transcriptView activeChannel transcripts
                    , case snapshot.experimentRef of
                        Just experimentRef -> button [ type_ "button", disabled authoringPending, onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaWebRtcStop experimentRef)) ] [ text "Stop local loopback experiment" ]
                        Nothing -> text ""
                    , case activeChannel of
                        Just room -> button [ type_ "button", disabled authoringPending, attribute "data-onyx-media-capture" "webrtc-voice", attribute "data-onyx-media-conversation" room ] [ text "Run same-browser audio loopback" ]
                        Nothing -> text ""
                    , case activeChannel of
                        Just room -> button [ type_ "button", disabled authoringPending, attribute "data-onyx-media-capture" "webrtc-video", attribute "data-onyx-media-conversation" room ] [ text "Run same-browser video loopback" ]
                        Nothing -> text ""
                    ]
        ]


devicePreferences : RuntimeDomain.MediaControlView -> Int -> Bool -> Html Msg
devicePreferences snapshot volumePercent authoringPending =
    div [ class "onyx-media-device-preferences" ]
        [ h3 [] [ text "Device preferences" ]
        , h4 [] [ text "Microphone" ]
        , ul []
            (List.map
                (\device -> li [] [ button [ type_ "button", disabled (authoringPending || snapshot.devices.selectedInputRef == Just device.ref), onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaInput { deviceRef = Just device.ref, conversationId = Nothing, callRef = Nothing, captureRef = Nothing })) ] [ text ((if snapshot.devices.selectedInputRef == Just device.ref then "Selected: " else "Use: ") ++ device.label) ] ])
                snapshot.devices.inputs
            )
        , case snapshot.call of
            Just call ->
                button
                    [ type_ "button"
                    , disabled authoringPending
                    , attribute "data-onyx-media-capture" "input-switch"
                    , attribute "data-onyx-media-conversation" call.conversationId
                    , attribute "data-onyx-media-call-ref" call.callRef
                    , attribute "data-onyx-media-device-ref" ""
                    ]
                    [ text "Use system microphone" ]

            Nothing ->
                button [ type_ "button", disabled authoringPending, onClick (RuntimeDomainActionRequested (RuntimeDomain.MediaInput { deviceRef = Nothing, conversationId = Nothing, callRef = Nothing, captureRef = Nothing })) ] [ text "Use system microphone" ]
        , h4 [] [ text "Speaker" ]
        , ul []
            (List.map
                (\device -> li [] [ button [ type_ "button", disabled (authoringPending || snapshot.devices.selectedOutputRef == Just device.ref), attribute "data-onyx-media-gesture" "output-select", attribute "data-onyx-media-conversation" (Maybe.withDefault "" (Maybe.map .conversationId snapshot.call)), attribute "data-onyx-media-call-ref" (Maybe.withDefault "" (Maybe.map .callRef snapshot.call)), attribute "data-onyx-media-device-ref" device.ref, attribute "data-onyx-media-volume-percent" (String.fromInt volumePercent) ] [ text ((if snapshot.devices.selectedOutputRef == Just device.ref then "Selected: " else "Use: ") ++ device.label) ] ])
                snapshot.devices.outputs
            )
        , button [ type_ "button", disabled authoringPending, attribute "data-onyx-media-gesture" "output-select", attribute "data-onyx-media-conversation" (Maybe.withDefault "" (Maybe.map .conversationId snapshot.call)), attribute "data-onyx-media-call-ref" (Maybe.withDefault "" (Maybe.map .callRef snapshot.call)), attribute "data-onyx-media-device-ref" "", attribute "data-onyx-media-volume-percent" (String.fromInt volumePercent) ] [ text "Use system speaker" ]
        ]


experimentSnapshot : RuntimeDomain.MediaControlView -> Html Msg
experimentSnapshot snapshot =
    case snapshot.experiment of
        Just experiment ->
            div [ class "onyx-media-experiment" ]
                [ h3 [] [ text "Local loopback negotiation" ]
                , p [] [ text ("Phase: " ++ experiment.phase ++ "; audio codec: " ++ Maybe.withDefault "unavailable" experiment.audioCodec ++ "; video codec: " ++ Maybe.withDefault "unavailable" experiment.videoCodec ++ "; ICE: " ++ experiment.iceState ++ "; DTLS: " ++ experiment.dtlsState ++ "; transport: " ++ experiment.transportClass ++ ".") ]
                ]

        Nothing ->
            text ""


transcriptView : Maybe String -> List TranscriptEntry -> Html Msg
transcriptView maybeRoom entries =
    case maybeRoom of
        Just room ->
            div [ class "onyx-media-transcript" ]
                [ h3 [] [ text ("Current room caption transcript: " ++ room) ]
                , ul []
                    (List.take Media.maxTranscriptEntries entries
                        |> List.map (\entry -> li [] [ text (Maybe.withDefault "" entry.time ++ " " ++ entry.nick ++ ": " ++ entry.text) ])
                    )
                ]

        Nothing ->
            text ""


presentationOf : CallHub -> HubPresentation
presentationOf hub =
    Media.classifyHubPresentation hub.lifecycle hub.startedAt


presentationWord : HubPresentation -> String
presentationWord presentation =
    case presentation of
        HubRingingIn ->
            "ringing_in"

        HubRingingOut ->
            "ringing_out"

        HubProvisional ->
            "provisional"

        HubEstablished ->
            "established"

        HubIdle ->
            "idle"


statusLabel : HubPresentation -> String
statusLabel presentation =
    case presentation of
        HubRingingIn ->
            "Incoming"

        HubRingingOut ->
            "Outgoing"

        HubProvisional ->
            "Connecting"

        HubEstablished ->
            "In call"

        HubIdle ->
            "Idle · Pre-join"


hubTitle : HubPresentation -> String
hubTitle presentation =
    case presentation of
        HubRingingIn ->
            "Incoming call"

        HubRingingOut ->
            "Calling…"

        HubProvisional ->
            "Connecting to the call…"

        HubEstablished ->
            "Your call is still here."

        HubIdle ->
            "Talk where the conversation already lives."


hubIntro : HubPresentation -> Maybe String -> String
hubIntro presentation label =
    case presentation of
        HubRingingIn ->
            case label of
                Just where_ ->
                    if String.startsWith "#" where_ then
                        "Someone is calling you in " ++ where_ ++ ". Accept or decline from the call controls; this screen never answers for you."

                    else
                        "Someone is calling you — " ++ where_ ++ ". Accept or decline from the call controls; this screen never answers for you."

                Nothing ->
                    "Someone is calling you. Accept or decline from the call controls; this screen never answers for you."

        HubRingingOut ->
            case label of
                Just where_ ->
                    "Ringing " ++ where_ ++ ". Stay here or keep browsing — Onyx will not pretend the call is established until it connects."

                Nothing ->
                    "Your outgoing call is still ringing. Onyx will not pretend the call is established until it connects."

        HubProvisional ->
            case label of
                Just where_ ->
                    "Joining " ++ where_ ++ ". Media is not established yet — connection status stays honest while the session starts."

                Nothing ->
                    "Joining the call. Media is not established yet — connection status stays honest while the session starts."

        HubEstablished ->
            case label of
                Just where_ ->
                    "Return to " ++ where_ ++ " without losing your place in the conversation."

                Nothing ->
                    "Return to your live call without losing your place in the conversation."

        HubIdle ->
            "Voice and video begin inside a room, so people arrive with the same context before, during, and after the call."


nextStep : HubPresentation -> String
nextStep presentation =
    case presentation of
        HubEstablished ->
            " Your call is active; use the call controls for microphone, camera, and captions."

        HubProvisional ->
            " The session is connecting. Media controls appear when the call confirms a connection."

        _ ->
            " This page is a starting point. Choosing a room does not join or start a call."


actionNote : HubPresentation -> Bool -> String
actionNote presentation canReturn =
    if presentation == HubEstablished then
        "Microphone, camera, sharing, and captions stay available in the call bar."

    else if canReturn then
        "Return to the conversation while the call connects."

    else
        "Choose a room to see its call controls and live status."


{-| The hub surface. `canReturn` needs a provisional-or-established
call plus a target; otherwise the primary button reveals the rooms.
An idle hub with an open conversation offers voice/video join (the
join resolves through the engine feed, so a missing engine lands as
a failed outcome); a live call offers mute + leave.
-}
callsHub : CallHub -> Maybe String -> Maybe String -> Bool -> Bool -> Maybe RuntimeDomain.MediaQualityView -> Bool -> Bool -> Html Msg
callsHub hub activeChannel liveCallRef selfMuted selfDeafened qualityView qualityOwnerCurrent authoringPending =
    let
        presentation =
            presentationOf hub

        label =
            Media.hubRoomLabel hub

        canReturn =
            (presentation == HubProvisional || presentation == HubEstablished) && label /= Nothing

        idleOutcome =
            if presentation == HubIdle then
                hub.outcome

            else
                Nothing

        qualityControls =
            case ( hub.lifecycle, activeChannel, qualityView ) of
                ( Media.InCall, Just active, Just quality ) ->
                    if qualityOwnerCurrent && quality.conversationId == active then
                        div [ class "onyx-calls-quality", attribute "aria-label" "Call quality policy" ]
                            [ h2 [] [ text "Call quality" ]
                            , p [ attribute "role" "status", attribute "aria-live" "polite" ]
                                [ text
                                    ("Desired policy: " ++ quality.desiredPolicy
                                        ++ ". Observed network tier: " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromInt quality.observedNetworkTier)
                                        ++ "; observed audio quality: " ++ (Maybe.map String.fromInt quality.observedAudioQuality |> Maybe.withDefault "unavailable")
                                        ++ "; video: " ++ quality.videoState ++ "."
                                    )
                                ]
                            , p [] [ text "Choosing Auto never starts or restores camera capture; use the explicit camera control for that." ]
                            , div [ class "onyx-calls-quality-policies" ]
                                (List.map
                                    (\( policy, policyLabel ) ->
                                        button
                                            [ type_ "button"
                                            , disabled authoringPending
                                            , attribute "aria-pressed" (if quality.desiredPolicy == policy then "true" else "false")
                                            , onClick (MediaQualityPolicySet policy)
                                            ]
                                            [ text policyLabel ]
                                    )
                                    [ ( "auto", "Auto" ), ( "balanced", "Balanced" ), ( "audio-priority", "Audio priority" ) ]
                                )
                            ]

                    else
                        text ""

                _ ->
                    text ""
    in
    main_
        [ class "onyx-calls"
        , attribute "data-call-presentation" (presentationWord presentation)
        ]
        [ header [ class "onyx-calls-header" ]
            [ div [ class "onyx-calls-kicker" ] [ text "Calls" ]
            , p [ class "onyx-calls-status", attribute "data-testid" "calls-hub-status" ]
                [ span [ class "onyx-calls-pip", attribute "data-state" (presentationWord presentation) ] []
                , span [] [ text (statusLabel presentation) ]
                , case label of
                    Just where_ ->
                        span [ class "onyx-calls-where" ] [ text where_ ]

                    Nothing ->
                        text ""
                ]
            , h1 [ class "onyx-calls-title" ] [ text (hubTitle presentation) ]
            , p [ class "onyx-calls-intro" ] [ text (hubIntro presentation label) ]
            , p [ class "onyx-calls-caption-disclosure" ]
                [ text "Captions are sent as server-visible text and may be included in a server transcript or recording. Local speech recognition does not make caption text private." ]
            ]
        , case idleOutcome of
            Just outcome ->
                let
                    copy =
                        Media.callOutcomeCopy outcome
                in
                p [ class "onyx-calls-outcome", attribute "data-testid" "calls-hub-outcome" ]
                    [ strong [] [ text copy.title ]
                    , span [] [ text copy.detail ]
                    ]

            Nothing ->
                text ""
        , p [ class "onyx-calls-next" ]
            [ strong [] [ text "What happens next" ]
            , span [] [ text (nextStep presentation) ]
            ]
        , case ( canReturn, label ) of
            ( True, Just where_ ) ->
                button
                    [ class "onyx-calls-primary"
                    , onClick (CallsReturnToCall where_)
                    ]
                    [ text "Return to call" ]

            _ ->
                button
                    [ class "onyx-calls-primary"
                    , onClick CallsChooseRoom
                    ]
                    [ text "Choose a room" ]
        , case ( presentation, activeChannel ) of
            ( HubIdle, Just where_ ) ->
                div [ class "onyx-calls-join" ]
                    [ button
                        [ class "onyx-calls-join-voice"
                        , attribute "data-onyx-media-capture" "voice"
                        , attribute "data-onyx-media-conversation" where_
                        ]
                        [ text ("Join call in " ++ where_) ]
                    , button
                        [ class "onyx-calls-join-video"
                        , attribute "data-onyx-media-capture" "video"
                        , attribute "data-onyx-media-conversation" where_
                        ]
                        [ text ("Join with video in " ++ where_) ]
                    , button
                        [ class "onyx-calls-camera-preview"
                        , attribute "data-onyx-media-capture" "camera-preview"
                        , attribute "data-onyx-media-conversation" where_
                        ]
                        [ text "Preview camera" ]
                    , button
                        [ class "onyx-calls-webrtc-check"
                        , attribute "data-onyx-media-capture" "webrtc-voice"
                        , attribute "data-onyx-media-conversation" where_
                        ]
                        [ text "Run local WebRTC compatibility check" ]
                    ]

            _ ->
                text ""
        , qualityControls
        , if presentation == HubProvisional || presentation == HubEstablished then
            div [ class "onyx-calls-controls" ]
                [ button
                    [ class "onyx-calls-mute"
                    , onClick CallToggleMute
                    ]
                    [ text
                        (if selfMuted then
                            "Unmute"

                         else
                            "Mute"
                        )
                    ]
                , button
                    [ class "onyx-calls-deafen"
                    , onClick CallToggleDeafen
                    ]
                    [ text
                        (if selfDeafened then
                            "Undeafen"

                         else
                            "Deafen"
                        )
                    ]
                , button
                    [ class "onyx-calls-leave"
                    , onClick CallLeave
                    ]
                    [ text "Leave call" ]
                , case label of
                    Just where_ ->
                        case liveCallRef of
                            Just callRef ->
                                button
                                    [ class "onyx-calls-screen-share"
                                    , attribute "data-onyx-media-capture" "screen"
                                    , attribute "data-onyx-media-conversation" where_
                                    , attribute "data-onyx-media-call-ref" callRef
                                    ]
                                    [ text "Share screen" ]

                            Nothing ->
                                text ""

                    Nothing ->
                        text ""
                ]

          else
            text ""
        , p [ class "onyx-calls-note" ]
            [ span [ attribute "aria-hidden" "true" ] [ text "●" ]
            , text (actionNote presentation canReturn)
            ]
        ]
