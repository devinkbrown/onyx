module View.CaptionControls exposing (snapshotView, view)

import CaptionLifecycle exposing (Mode(..), Model, State(..))
import Html exposing (Html, div, h2, p, text)
import Html.Attributes exposing (attribute, class)
import RuntimeDomain


snapshotView : Maybe RuntimeDomain.MediaCaptionView -> Html msg
snapshotView maybeCaption =
    div [ class "onyx-caption-controls", attribute "aria-label" "Caption status" ]
        [ h2 [] [ text "Live caption status" ]
        , p [ attribute "role" "note" ] [ text "Caption text is server-visible and may be retained. Browser speech-service mode can send microphone audio to that service." ]
        , case maybeCaption of
            Just caption ->
                div []
                    [ p [ attribute "role" "status", attribute "aria-live" "polite" ] [ text ("State: " ++ caption.state ++ Maybe.withDefault "" (Maybe.map ((++) "; reason: ") caption.reason) ++ "; mode: " ++ Maybe.withDefault "not selected" caption.mode ++ "; language: " ++ Maybe.withDefault "not selected" caption.language ++ "; source: " ++ Maybe.withDefault "unavailable" caption.source ++ "; accuracy: " ++ Maybe.withDefault "unknown" caption.accuracy) ]
                    , p [] [ text (Maybe.withDefault "" caption.interimText) ]
                    ]
            Nothing ->
                p [ attribute "role" "status" ] [ text "No current caption observation." ]
        ]


view : Model -> Html msg
view model =
    div [ class "onyx-caption-controls", attribute "aria-labelledby" "onyx-caption-title" ]
        [ h2 [ attribute "id" "onyx-caption-title" ] [ text "Live captions" ]
        , p [ attribute "role" "note" ]
            [ text "Captions recognize only your local microphone. Caption text is sent to the server and may be retained in its transcript or recording, even when recognition runs locally. Accuracy is unknown. Local language packs require an explicit preparation action; browser speech service mode can also send audio to that service and requires separate consent." ]
        , p [] [ text ("Mode: " ++ modeLabel model.mode) ]
        , p [ attribute "aria-live" "polite" ] [ text (stateLabel model.state) ]
        , p [ attribute "aria-live" "polite" ] [ text (Maybe.withDefault "" model.interimText) ]
        ]


modeLabel : Maybe Mode -> String
modeLabel mode =
    case mode of
        Just LocalOnly ->
            "Local only"

        Just BrowserSpeechService ->
            "Browser speech service"

        Nothing ->
            "Not selected"


stateLabel : State -> String
stateLabel state =
    case state of
        Idle ->
            "Stopped"

        PreparingLanguage ->
            "Preparing"

        LanguageReady ->
            "Language ready"

        Listening ->
            "Listening"

        Unavailable reason ->
            "Unavailable: " ++ reason

        Failed reason ->
            "Failed: " ++ reason
