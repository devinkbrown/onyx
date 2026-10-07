module View.Status exposing (route, view)

{-| Network status page, mirroring `src/routes/Status.tsx`: one honest
sentence about tonight (never a health claim without a fresh report),
a check-again action, and the pointer to the roadmap.

Fold ownership: the feed fetch, path fallback, and 30s poll live in
`App` (`networkStatus`, `StatusRefetch`, `HttpResult`); this module
renders `statusFeedState` with the oracle's voice and chrome.
-}

import App exposing (Model, Msg(..), statusFeedState)
import Html exposing (Html, a, button, div, h1, h2, p, section, span, text)
import Html.Attributes exposing (attribute, class, disabled, href, id, tabindex)
import Html.Events exposing (onClick)
import Status
import View.PublicFrame exposing (frame)


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "Tonight" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Status" ]
        ]


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
    div [ class "ui-root r status-route" ]
        [ section
            [ class "r-wrap r-section status-hero status-scroll-surface"
            , attribute "aria-labelledby" "status-heading"
            , attribute "role" "region"
            , tabindex 0
            ]
            [ p [ class "status-kicker" ] [ text "for people in the rooms" ]
            , h1 [ id "status-heading" ] [ text "Are the rooms up tonight?" ]
            , p [ class "status-lede" ] [ text "One honest sentence. If we cannot say, we say so." ]
            , div
                [ class "status-observation"
                , id "status-observation"
                , attribute "data-feed-state" (Status.feedStateKey state)
                , attribute "role" "status"
                , attribute "aria-live" "polite"
                , attribute "aria-atomic" "true"
                ]
                [ span [ class "status-observation__marker", attribute "aria-hidden" "true" ] []
                , span [ class "status-observation__label" ] [ text voice.label ]
                , span [ class "status-observation__detail" ] [ text voice.sentence ]
                ]
            , div [ class "status-check" ]
                [ button
                    ([ Html.Attributes.type_ "button"
                     , class "status-check__button"
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
            ]
        , div [ class "r-wrap" ]
            [ div [ class "r-divider", attribute "aria-hidden" "true" ] [] ]
        , section [ class "r-wrap status-quiet", attribute "aria-labelledby" "status-next-heading" ]
            [ h2 [ id "status-next-heading" ] [ text "What we are working on" ]
            , p []
                [ text "Rooms, calls, catch-up, and a Home Screen on this device live on a quieter page. Status stays about tonight." ]
            , a [ class "status-quiet-link", href "/roadmap/" ] [ text "Open the roadmap" ]
            ]
        ]


{-| The status route inside the public frame. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/status/" "Onyx network status" (Just contextLine) [ view model ] ]
