module View.MediaDiagnostics exposing (snapshotView, view)

import Html exposing (Html, div, h2, li, p, text, ul)
import Html.Attributes exposing (attribute, class)
import RuntimeDomain


snapshotView : Maybe RuntimeDomain.MediaTelemetryView -> Html msg
snapshotView maybeTelemetry =
    case maybeTelemetry of
        Just telemetry ->
            div [ class "onyx-media-diagnostics" ]
                [ p [ attribute "role" "note" ] [ text ("Counter source: " ++ telemetry.availability ++ Maybe.withDefault "" (Maybe.map ((++) ". ") telemetry.reason)) ]
                , view (List.map (\( name, count ) -> { name = name, value = count, unit = "frames/count", unavailableReason = telemetry.reason }) telemetry.counters)
                ]
        Nothing ->
            view []


type alias Observation =
    { name : String
    , value : Maybe Float
    , unit : String
    , unavailableReason : Maybe String
    }


view : List Observation -> Html msg
view observations =
    div [ class "onyx-media-diagnostics", attribute "aria-labelledby" "onyx-media-diagnostics-title" ]
        [ h2 [ attribute "id" "onyx-media-diagnostics-title" ] [ text "Media diagnostics" ]
        , p [ attribute "role" "note" ] [ text "These are browser observations. Missing counters are shown as unavailable." ]
        , ul [] (List.map viewObservation observations)
        ]


viewObservation : Observation -> Html msg
viewObservation observation =
    li []
        [ text
            (observation.name
                ++ ": "
                ++ (case observation.value of
                        Just value -> String.fromFloat value ++ " " ++ observation.unit
                        Nothing -> "Unavailable" ++ Maybe.withDefault "" (Maybe.map (\reason -> " — " ++ reason) observation.unavailableReason)
                   )
            )
        ]
