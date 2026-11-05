module View.OperatorImport exposing (view)

import Html exposing (Html, button, div, h2, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled)
import Html.Events exposing (onClick)
import OperatorImport exposing (Model, Msg(..), Plan(..))


view : Model -> Html Msg
view model =
    section [ class "operator-import", attribute "aria-label" "Offline setup and diagnostics import" ]
        [ h2 [] [ text "Offline setup and diagnostics" ]
        , p [] [ text "Imported files are local observations. They do not verify the current server or grant host permissions." ]
        , button [ onClick BeginImport, disabled (model.phase == OperatorImport.Reading) ] [ text "Review private JSON file" ]
        , case model.phase of
            OperatorImport.Empty -> span [] [ text "No report selected." ]
            OperatorImport.Reading -> span [ attribute "role" "status" ] [ text "Reading locally…" ]
            OperatorImport.Invalid -> span [ attribute "role" "alert" ] [ text "The file is invalid or contains unsupported data." ]
            OperatorImport.UnsupportedSchema -> span [ attribute "role" "alert" ] [ text "This report schema is unsupported." ]
            OperatorImport.TooLarge -> span [ attribute "role" "alert" ] [ text "The file exceeds the local import limits." ]
            OperatorImport.Unavailable -> span [ attribute "role" "alert" ] [ text "The private file could not be read." ]
            OperatorImport.StaleOwner -> span [ attribute "role" "alert" ] [ text "The selected report belongs to an earlier client session." ]
            OperatorImport.Ready plan -> renderPlan plan model
        ]
        ]


renderPlan : Plan -> Model -> Html Msg
renderPlan plan model =
    div [ class "operator-import-preview" ]
        [ case plan of
            DoctorPlan report ->
                div []
                    [ p [] [ text ("Doctor report; readiness: " ++ report.readiness) ]
                    , p [] [ text ("Checks passed: " ++ String.fromInt report.passed ++ ", failed: " ++ String.fromInt report.failed ++ ", unknown: " ++ String.fromInt report.unknownChecks) ]
                    , p [] [ text ("Exporter build: " ++ Maybe.withDefault "unknown" report.build) ]
                    ]
            SetupPlan report ->
                div []
                    [ p [] [ text ("Setup " ++ report.mode ++ " preview; readiness: " ++ report.readiness) ]
                    , p [] [ text ("Profile: " ++ Maybe.withDefault "unknown" report.profile) ]
                    , p [] [ text ("Maximum clients: " ++ (Maybe.map String.fromInt report.maxClients |> Maybe.withDefault "unknown")) ]
                    , p [] [ text ("Media enabled: " ++ (Maybe.map (\enabled -> if enabled then "yes" else "no") report.mediaEnabled |> Maybe.withDefault "unknown")) ]
                    , p [] [ text ("Network assessment: IRC port " ++ (Maybe.map String.fromInt report.networkIrcPort |> Maybe.withDefault "unknown") ++ ", TLS " ++ (Maybe.map (\enabled -> if enabled then "enabled" else "disabled") report.networkTlsEnabled |> Maybe.withDefault "unknown") ++ " on port " ++ (Maybe.map String.fromInt report.networkTlsPort |> Maybe.withDefault "unknown")) ]
                    , p [] [ text ("Media assessment: " ++ Maybe.withDefault "unknown" report.mediaAssessmentEnabled) ]
                    ]
        , ul [] [ li [] [ text "Host paths, credentials, raw diagnostics, and arbitrary imported fields are omitted." ] ]
        , button [ onClick Dismiss ] [ text "Dismiss report" ]
        ]
