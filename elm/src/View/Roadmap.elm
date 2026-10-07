module View.Roadmap exposing (roadmapCards, route, view)

{-| Product roadmap page, mirroring `src/routes/Roadmap.tsx`
(`RoadmapBridge`): hero with the Now/Next/Later legend, the priority
cards, and the no-dates note, inside the public frame with the
"What is next" context line.

The oracle's hash bridge (read `location.hash` on mount and on
`hashchange`, select on legend click) is a model fold in `App`:
`roadmapPriority` syncs from the URL fragment on every navigation and
`SelectRoadmapPriority` handles legend clicks. Modified clicks keep
their native browser behaviour (the click decoder below only fires
for unmodified left clicks). Moving keyboard focus onto the card
(`focusRoadmapPriority`) is a DOM behaviour with no pure equivalent
and stays a documented narrowing.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, article, div, h1, h2, p, section, span, text)
import Html.Attributes exposing (attribute, class, href, id, tabindex)
import Html.Events exposing (preventDefaultOn)
import Json.Decode as Decode
import View.PublicFrame exposing (frame)


{-| One roadmap priority card. -}
type alias RoadmapCard =
    { state : String
    , label : String
    , title : String
    , summary : String
    }


{-| The roadmap priorities, mirroring `ROADMAP_ITEMS`. -}
roadmapCards : List RoadmapCard
roadmapCards =
    [ { state = "now"
      , label = "Now"
      , title = "Rooms that stay open"
      , summary = "A standing place for friends, clubs, and creators. The conversation stays with the room when you come back."
      }
    , { state = "next"
      , label = "Next"
      , title = "Calls and catch-up"
      , summary = "Talk in text, then start a call when the night wants one. Come back later and pick up where you left off."
      }
    , { state = "later"
      , label = "Later"
      , title = "Home Screen on this device"
      , summary = "Supporting browsers can keep Onyx here — same rooms, same people, no extra store."
      }
    ]


{-| Legend click: unmodified left clicks select the priority (the
fragment navigation then carries it to every tab); modified clicks
fail the decoder so the browser keeps its native behaviour,
mirroring the oracle's early return. -}
onLegendClick : String -> Html.Attribute Msg
onLegendClick state =
    preventDefaultOn "click"
        (Decode.map5
            (\button meta ctrl shift alt ->
                { button = button, meta = meta, ctrl = ctrl, shift = shift, alt = alt }
            )
            (Decode.field "button" Decode.int)
            (Decode.field "metaKey" Decode.bool)
            (Decode.field "ctrlKey" Decode.bool)
            (Decode.field "shiftKey" Decode.bool)
            (Decode.field "altKey" Decode.bool)
            |> Decode.andThen
                (\press ->
                    if press.button == 0 && not (press.meta || press.ctrl || press.shift || press.alt) then
                        Decode.succeed ( SelectRoadmapPriority { state = state }, False )

                    else
                        Decode.fail "modified click keeps native browser behaviour"
                )
        )


legendLink : Maybe String -> RoadmapCard -> Html Msg
legendLink active card =
    a
        ([ href ("#roadmap-" ++ card.state)
         , attribute "data-state" card.state
         , onLegendClick card.state
         ]
            ++ (if active == Just card.state then
                    [ attribute "aria-current" "location" ]

                else
                    []
               )
        )
        [ text card.label ]


priorityCard : Maybe String -> RoadmapCard -> Html Msg
priorityCard active card =
    article
        ([ id ("roadmap-" ++ card.state)
         , class "roadmap-card"
         , attribute "data-state" card.state
         , attribute "aria-labelledby" ("roadmap-" ++ card.state ++ "-title")
         , tabindex -1
         ]
            ++ (if active == Just card.state then
                    [ attribute "data-current" "true" ]

                else
                    []
               )
        )
        [ div [ class "roadmap-card-head" ]
            [ span [ class "roadmap-state" ] [ text card.label ] ]
        , h2 [ id ("roadmap-" ++ card.state ++ "-title") ] [ text card.title ]
        , p [ class "roadmap-summary" ] [ text card.summary ]
        ]


contextLine : Html Msg
contextLine =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "What is next" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text "Rooms, calls, catch-up" ]
        ]


{-| The roadmap body. `active` is the selected priority. -}
view : Maybe String -> Html Msg
view active =
    div [ class "ui-root r roadmap-page" ]
        [ div [ class "r-ground", attribute "aria-hidden" "true" ] []
        , div [ class "r-grain", attribute "aria-hidden" "true" ] []
        , section [ class "r-wrap r-section roadmap-hero", attribute "aria-labelledby" "roadmap-bridge-title" ]
            [ p [ class "roadmap-kicker" ] [ text "what we are working on" ]
            , h1 [ id "roadmap-bridge-title" ]
                [ text "Rooms, calls, catch-up, and a Home Screen." ]
            , p [ class "roadmap-lede" ]
                [ text "The work in front of us is the life of the rooms — not an operating system, and not a dated promise." ]
            , div [ class "roadmap-legend", attribute "role" "group", attribute "aria-label" "Roadmap state legend" ]
                (List.map (legendLink active) roadmapCards)
            ]
        , div [ class "r-wrap" ]
            [ div [ class "r-divider", attribute "aria-hidden" "true" ] [] ]
        , section [ class "r-wrap r-section roadmap-grid", attribute "aria-label" "Current Onyx product priorities" ]
            (List.map (priorityCard active) roadmapCards)
        , section [ class "r-wrap r-section roadmap-note", attribute "aria-labelledby" "roadmap-note-heading" ]
            [ h2 [ id "roadmap-note-heading" ] [ text "No dates on the wall" ]
            , p []
                [ text "These are the things we are making better. Nothing here is a ship date, a bindable Terms page, or a claim that everything is fully encrypted." ]
            ]
        ]


{-| The roadmap route inside the public frame. -}
route : Model -> List (Html Msg)
route model =
    [ frame model "/roadmap/" "Onyx product roadmap" (Just contextLine) [ view model.roadmapPriority ] ]
