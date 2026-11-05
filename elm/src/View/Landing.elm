module View.Landing exposing (landing)

{-| Public homepage — fresh Elm-first design over the `src/routes/Landing.tsx`
copy (hero lines, lede, trust claims, entry routes, shelf links all kept).

Design notes:

  - Every way in is visible at once in a single ledger — no tabs, no hidden
    panels, nothing to operate before reading. The old tab state is gone.
  - The ledger is plain links, so each route stays URL-addressable and
    nothing here implies anyone is online.
  - Visual language lives in `site.css` under the `site-` namespace: serif
    display type, ruled ledger rows, one quiet accent. No pills, no cards,
    no gradients.

-}

import App exposing (Msg(..))
import Html exposing (Html, a, dd, div, dl, dt, h1, h2, header, img, li, main_, nav, p, section, text, ul)
import Html.Attributes exposing (alt, attribute, class, height, href, id, src, width)


type alias WayIn =
    { head : String
    , copy : String
    , action : String
    , href : String
    }


waysIn : List WayIn
waysIn =
    [ { head = "Walk into the public room."
      , copy = "Start with the room that is open to everyone, then decide where you want to go next."
      , action = "Open the public room"
      , href = "/invite?join=%23root"
      }
    , { head = "Bring your people along."
      , copy = "Open Onyx, make a room, then share its invite when the room is ready. Friends, clubs, and ordinary hangouts all fit here."
      , action = "Open Onyx"
      , href = "/app/"
      }
    , { head = "Get oriented, then join in."
      , copy = "Read the short guide for rooms, messages, calls, and coming back later without losing the thread."
      , action = "Read the first-room guide"
      , href = "/guides"
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


{-| The landing surface. -}
landing : Html Msg
landing =
    main_ [ class "site-landing", attribute "aria-label" "Onyx home" ]
        [ header [ class "site-mast" ]
            [ a [ class "site-wordmark", href "/" ]
                [ img [ src "/brand/mark.png", width 28, height 28, alt "" ] []
                , text "Onyx"
                ]
            , nav [ class "site-mast-nav", attribute "aria-label" "Site" ]
                [ a [ href "/status" ] [ text "System status" ]
                , a [ class "site-mast-open", href "/app/" ] [ text "Open Onyx" ]
                ]
            ]
        , section [ class "site-intro", attribute "aria-labelledby" "intro-heading" ]
            [ div [ class "site-intro-copy" ]
                [ h1 [ id "intro-heading", class "site-display" ]
                    [ text "Good company. Great nights." ]
                , p [ class "site-lede" ]
                    [ text "A place for your friends to talk, play, and catch up. Open a room in your browser." ]
                , div [ class "site-cta" ]
                    [ a [ class "site-cta-primary", href "/app/" ] [ text "Open Onyx" ]
                    , a [ class "site-cta-link", href "/invite?join=%23root" ] [ text "See the public room" ]
                    , a [ class "site-cta-link", href "/download" ] [ text "Keep it on this device" ]
                    ]
                , p [ class "site-note" ]
                    [ text "Browser first. Keep it on this device from a supporting browser." ]
                ]
            , div [ class "site-intro-art", attribute "aria-hidden" "true" ]
                [ img
                    [ src "/brand/mascot-still.png"
                    , alt ""
                    , width 512
                    , height 512
                    , attribute "loading" "lazy"
                    , attribute "decoding" "async"
                    ]
                    []
                ]
            ]
        , section [ class "site-ways", attribute "aria-labelledby" "ways-heading" ]
            [ h2 [ id "ways-heading", class "site-h2" ] [ text "Three ways in" ]
            , ul [ class "site-ledger", attribute "data-testid" "ways-in-ledger" ]
                (List.map wayRow waysIn)
            , p [ class "site-note" ]
                [ text "Room links open ready to join. This page never shows who is online." ]
            ]
        , section [ class "site-trust", attribute "aria-labelledby" "trust-heading" ]
            [ h2 [ id "trust-heading", class "site-h2" ] [ text "What you can count on" ]
            , dl [ class "site-claims" ]
                (List.concatMap
                    (\( term, detail ) -> [ dt [] [ text term ], dd [] [ text detail ] ])
                    trustClaims
                )
            , p [ class "site-detail" ]
                [ text "Read "
                , a [ href "/privacy" ] [ text "the privacy details" ]
                , text "."
                ]
            ]
        , nav [ class "site-shelf", attribute "aria-label" "Also here" ]
            [ p [ class "site-shelf-label" ] [ text "More to explore" ]
            , ul [ class "site-shelf-list" ]
                (List.map
                    (\( href_, label ) -> li [] [ a [ href href_ ] [ text label ] ])
                    shelfItems
                )
            ]
        ]


wayRow : WayIn -> Html Msg
wayRow way =
    li [ class "site-ledger-row" ]
        [ div [ class "site-ledger-copy" ]
            [ p [ class "site-ledger-head" ] [ text way.head ]
            , p [ class "site-ledger-what" ] [ text way.copy ]
            ]
        , a [ class "site-ledger-go", href way.href ] [ text way.action ]
        ]
