module View.MediaInterop exposing (snapshotView, view)

import Html exposing (Html, div, h2, li, p, text, ul)
import Html.Attributes exposing (attribute, class)
import MediaInterop exposing (Observation, State(..))
import RuntimeDomain


snapshotView : Maybe RuntimeDomain.MediaWebRtcView -> Html msg
snapshotView maybeSnapshot =
    div [ class "onyx-media-interop", attribute "aria-label" "Same-browser WebRTC loopback" ]
        [ h2 [] [ text "Same-browser WebRTC loopback" ]
        , p [ attribute "role" "note" ] [ text "This is a local loopback observation. It does not prove remote or cross-browser interoperability." ]
        , case maybeSnapshot of
            Just observation ->
                ul []
                    [ li [] [ text ("Connection state: " ++ Maybe.withDefault "unavailable" observation.connectionState) ]
                    , li [] [ text ("Bytes: " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromFloat observation.bytes)) ]
                    , li [] [ text ("Packets: " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromFloat observation.packets)) ]
                    , li [] [ text ("Frames: " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromFloat observation.frames)) ]
                    , li [] [ text ("Duration: " ++ Maybe.withDefault "unavailable" (Maybe.map String.fromFloat observation.durationMs) ++ " ms") ]
                    , li [] [ text (Maybe.withDefault "" observation.reason) ]
                    ]
            Nothing ->
                p [ attribute "role" "status" ] [ text "No local loopback result is reported." ]
        ]


view : Maybe Observation -> Html msg
view maybeObservation =
    div [ class "onyx-media-interop", attribute "aria-labelledby" "onyx-media-interop-title" ]
        [ h2 [ attribute "id" "onyx-media-interop-title" ] [ text "Native media interop experiment" ]
        , p [ attribute "role" "note" ]
            [ text "This bounded loopback checks browser-native WebRTC negotiation only. It does not use Cadence codecs, select normal call transport, or prove cross-browser or remote interoperability." ]
        , case maybeObservation of
            Nothing -> p [] [ text "No experiment has run." ]

            Just observation ->
                ul []
                    [ li [] [ text ("State: " ++ stateLabel observation.state) ]
                    , li [] [ text ("Audio codec: " ++ Maybe.withDefault "Unavailable" observation.audioCodec) ]
                    , li [] [ text ("Video codec: " ++ Maybe.withDefault "Unavailable" observation.videoCodec) ]
                    , li [] [ text ("ICE state: " ++ observation.iceState) ]
                    , li [] [ text ("DTLS state: " ++ observation.dtlsState) ]
                    , li [] [ text ("Selected transport: " ++ observation.transportClass) ]
                    , li [] [ text ("Inbound bytes: " ++ Maybe.withDefault "Unavailable" (Maybe.map String.fromInt observation.inboundBytes)) ]
                    , li [] [ text ("Inbound packets: " ++ Maybe.withDefault "Unavailable" (Maybe.map String.fromInt observation.inboundPackets)) ]
                    , li [] [ text ("Decoded video frames: " ++ Maybe.withDefault "Unavailable" (Maybe.map String.fromInt observation.decodedFrames)) ]
                    ]
        ]


stateLabel : State -> String
stateLabel state =
    case state of
        Idle ->
            "Idle"

        Preparing ->
            "Preparing"

        Completed ->
            "Completed"

        Unsupported reason ->
            "Unsupported: " ++ reason

        Failed reason ->
            "Failed: " ++ reason

        Cancelled ->
            "Cancelled"
