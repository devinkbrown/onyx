module View.Status exposing (route, view)

{-| Network status page, mirroring `src/routes/Status.tsx`: one honest
sentence about tonight (never a health claim without a fresh report),
a check-again action, and the pointer to the roadmap.

Fold ownership: the feed fetch, path fallback, and 30s poll live in
`App` (`networkStatus`, `StatusRefetch`, `HttpResult`); this module
renders `statusFeedState` with the oracle's voice and chrome.
-}

import App exposing (Model, Msg(..), statusFeedState)
import Html exposing (Html, a, article, button, div, h1, h2, p, section, text)
import Html.Attributes exposing (attribute, class, disabled, href, id)
import Html.Events exposing (onClick)
import Status
import View.PublicFrame exposing (frame)


contextLine : Html Msg
contextLine =
    p [ class "site-context-line" ]
        [ text "Tonight — network status" ]


{-| The status body. -}
view : Model -> Html Msg
view model =
    let
        state =
            statusFeedState model

        voice =
            Status.communityVoice state

        loading =
            model.statusLoading
    in
    article [ class "site-article" ]
        [ h1 [ id "status-heading", class "site-display-sm" ] [ text "Are the rooms up tonight?" ]
        , p [ class "site-lede" ] [ text "One honest sentence. If we cannot say, we say so." ]
        , div
            [ class "site-observation"
            , id "status-observation"
            , attribute "data-feed-state" (Status.feedStateKey state)
            , attribute "role" "status"
            , attribute "aria-live" "polite"
            , attribute "aria-atomic" "true"
            ]
            [ p [ class "site-observation-label" ] [ text voice.label ]
            , p [ class "site-observation-detail" ] [ text voice.sentence ]
            ]
        , div [ class "site-cta" ]
            [ button
                ([ Html.Attributes.type_ "button"
                 , class "status-check__button site-cta-primary"
                 , attribute "aria-describedby" "status-observation"
                 , onClick StatusRefetch
                 ]
                    ++ (if loading then
                            [ disabled True, attribute "aria-busy" "true" ]

                        else
                            []
                       )
                )
                [ text (if loading then "Checking status…" else "Check again") ]
            ]
        , section [ class "site-section", attribute "aria-labelledby" "status-next-heading" ]
            [ h2 [ id "status-next-heading", class "site-h2" ] [ text "What we are working on" ]
            , p []
                [ text "Rooms, calls, catch-up, and a Home Screen on this device live on a quieter page. Status stays about tonight." ]
            , a [ href "/roadmap/" ] [ text "Open the roadmap" ]
            ]
        ]


{-| The status route inside the public frame. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/status/" "Onyx network status" (Just contextLine) [ view model ] ]
