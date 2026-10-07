module View.Landing exposing (landing)

{-| Public homepage — Elm port of `src/routes/Landing.tsx` (hero, trust
claims, room board, shelf) with the content kept 1:1 and the layout
rebuilt in the Onyx design language: left-aligned hero, no card grids,
no pills, hierarchy through weight and size only.

The board tabs are honest entry choices, not presence: nothing here
implies any room or person is live. Tab selection is local `Msg`
state; no focus juggling (buttons stay natively keyboard-reachable).
-}

import App exposing (Msg(..))
import Html exposing (Html, a, dd, div, dl, dt, h1, h2, li, main_, nav, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, href, id)
import Html.Events exposing (onClick)


type alias BoardRoute =
    { id : String
    , tab : String
    , title : String
    , copy : String
    , action : String
    , href : String
    , note : String
    }


boardRoutes : List BoardRoute
boardRoutes =
    [ { id = "public-room"
      , tab = "Meet people"
      , title = "Walk into the public room."
      , copy = "Start with the room that is open to everyone, then decide where you want to go next."
      , action = "Open the public room"
      , href = "/invite?join=%23root"
      , note = "The room link opens with the public room ready; this page does not show who is online."
      }
    , { id = "bring-people"
      , tab = "Bring people"
      , title = "Bring your people along."
      , copy = "Open Onyx, make a room, then share its invite when the room is ready. Friends, clubs, and ordinary hangouts all fit here."
      , action = "Open Onyx"
      , href = "/app/"
      , note = "Room creation and invitations happen in the app, not on this page."
      }
    , { id = "learn"
      , tab = "Get oriented"
      , title = "Get oriented, then join in."
      , copy = "Read the short guide for rooms, messages, calls, and coming back later without losing the thread."
      , action = "Read the first-room guide"
      , href = "/guides"
      , note = "The guide is local reading; it does not create an account or send anything."
      }
    ]


trustClaims : List ( String, String )
trustClaims =
    [ ( "No ads", "Nobody is selling your attention in the room." )
    , ( "No third-party trackers", "This site does not load analytics pixels or ad tags." )
    , ( "Private DMs", "Encrypted DM message text is intended for the two people in the conversation." )
    , ( "History on this device", "About 400 recent messages per room stay here." )
    ]


shelfItems : List ( String, String )
shelfItems =
    [ ( "/status", "Status" )
    , ( "/roadmap", "Roadmap" )
    , ( "/about", "About" )
    , ( "/download", "Download" )
    , ( "/guides", "Guides" )
    , ( "/invite?join=%23root", "Invite" )
    ]


activeRoute : String -> BoardRoute
activeRoute tab =
    List.filter (\route -> route.id == tab) boardRoutes
        |> List.head
        |> Maybe.withDefault
            { id = "public-room"
            , tab = "Meet people"
            , title = "Walk into the public room."
            , copy = "Start with the room that is open to everyone, then decide where you want to go next."
            , action = "Open the public room"
            , href = "/invite?join=%23root"
            , note = "The room link opens with the public room ready; this page does not show who is online."
            }


{-| The landing surface. The active board tab arrives as plain state;
unknown ids fall back to the public room, never a blank panel.
-}
landing : String -> Html Msg
landing tab =
    let
        active =
            activeRoute tab
    in
    main_ [ class "onyx-landing", attribute "aria-label" "Onyx home" ]
        [ section [ class "onyx-land-hero", attribute "aria-labelledby" "hero-heading" ]
            [ div [ class "onyx-land-copy" ]
                [ h1 [ id "hero-heading", class "onyx-land-h1" ]
                    [ span [] [ text "Good company." ]
                    , span [] [ text "Great nights." ]
                    ]
                , p [ class "onyx-land-lede" ]
                    [ text "A place for your friends to talk, play, and catch up. Open a room in your browser." ]
                , div [ class "onyx-land-cta" ]
                    [ a [ class "onyx-land-open", href "/app/" ] [ text "Open Onyx" ]
                    , a [ class "onyx-land-link", href "/invite?join=%23root" ] [ text "See the public room" ]
                    , a [ class "onyx-land-link", href "/download" ] [ text "Keep it on this device" ]
                    ]
                , p [ class "onyx-land-note" ]
                    [ text "Browser first. Keep it on this device from a supporting browser." ]
                ]
            ]
        , section [ class "onyx-land-trust", attribute "aria-labelledby" "trust-heading" ]
            [ h2 [ id "trust-heading", class "onyx-land-h2" ] [ text "What you can count on" ]
            , dl [ class "onyx-land-claims" ]
                (List.concatMap
                    (\( term, detail ) -> [ dt [] [ text term ], dd [] [ text detail ] ])
                    trustClaims
                )
            , p [ class "onyx-land-detail" ]
                [ text "Read "
                , a [ href "/privacy" ] [ text "the privacy details" ]
                , text "."
                ]
            ]
        , section [ class "onyx-land-board", attribute "aria-labelledby" "room-board-title" ]
            [ div [ class "onyx-land-board-head" ]
                [ h2 [ id "room-board-title", class "onyx-land-h2" ] [ text "For the next match. And the conversation after." ]
                , p [] [ text "Onyx gives friends, clubs, and ordinary hangouts a room to return to. Pick a useful way in; this is not a live list of who is online." ]
                ]
            , div [ class "onyx-land-tabs", attribute "role" "tablist", attribute "aria-label" "Choose a first-room route" ]
                (List.map
                    (\route ->
                        Html.button
                            [ attribute "role" "tab"
                            , attribute "aria-selected" (if route.id == active.id then "true" else "false")
                            , onClick (SelectBoardTab route.id)
                            ]
                            [ text route.tab ]
                    )
                    boardRoutes
                )
            , div [ class "onyx-land-panel", attribute "role" "tabpanel" ]
                [ div [ class "onyx-land-panel-copy" ]
                    [ h2 [ class "onyx-land-h3" ] [ text active.title ]
                    , p [] [ text active.copy ]
                    , a [ class "onyx-land-action", href active.href ] [ text active.action ]
                    , p [ class "onyx-land-panel-note" ] [ text active.note ]
                    ]
                , nav [ class "onyx-land-links", attribute "aria-label" "Useful ways into Onyx" ]
                    [ a [ href "/invite?join=%23root" ] [ text "Public room" ]
                    , a [ href "/app/" ] [ text "Invite friends" ]
                    , a [ href "/guides" ] [ text "Getting started" ]
                    , a [ href "/download" ] [ text "Browser and device help" ]
                    ]
                ]
            , if active.id == "public-room" then
                p [ class "onyx-land-footnote" ]
                    [ text "Want a quieter start? "
                    , a [ href "/guides" ] [ text "Read the guide first" ]
                    , text "."
                    ]

              else
                text ""
            ]
        , nav [ class "onyx-land-shelf", attribute "aria-label" "Also here" ]
            [ p [ class "onyx-land-shelf-label" ] [ text "More to explore" ]
            , ul [ class "onyx-land-shelf-list" ]
                (List.map
                    (\( href_, label ) -> li [] [ a [ href href_ ] [ text label ] ])
                    shelfItems
                )
            ]
        ]
