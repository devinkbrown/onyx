module View.Landing exposing (landing)

{-| Public homepage in the night-harbor site language.

Structure (top to bottom):

  - Masthead shared with every public page (`PublicFrame.masthead`,
    stateless variant — `View` renders the landing without `Model`).
  - Hero: kicker, the two-line display title, lede, one primary action
    plus the public room, and a drawn room sketch (ported from the v3
    landing). The sketch is decorative, `aria-hidden`, and captioned as
    an illustration so nothing here implies anyone is online.
  - "What you can count on": the four trust claims with line icons.
  - "Three ways in": every route visible at once as numbered columns
    (no tabs, nothing to operate before reading); each one is a plain,
    URL-addressable link.
  - A closing invitation with the mascot, then the shared footer.

-}

import App exposing (Msg(..))
import Html exposing (Html, a, dd, div, dl, dt, h1, h2, img, li, main_, p, section, span, text, ul)
import Html.Attributes exposing (alt, attribute, class, height, href, id, src, tabindex, width)
import View.PublicFrame as PublicFrame


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


trustClaims : List ( String, String, String )
trustClaims =
    [ ( "ads", "No ads", "Nobody is selling your attention in the room." )
    , ( "trackers", "No third-party trackers", "This site does not load analytics pixels or ad tags." )
    , ( "dms", "Private DMs", "Encrypted DM message text is intended for the two people in the conversation." )
    , ( "device", "History on this device", "About 400 recent messages per room stay here." )
    ]


{-| Decorative room sketch beside the hero: a drawing of a room
(header, a few grouped messages, the composer), not live data. -}
sketch : Html Msg
sketch =
    let
        row tint initial name time lines =
            div [ class "site-sketch-msg" ]
                [ span [ class ("site-sketch-avatar site-sketch-avatar--" ++ tint) ] [ text initial ]
                , div [ class "site-sketch-body" ]
                    (p [ class "site-sketch-meta" ]
                        [ span [ class "site-sketch-name" ] [ text name ]
                        , span [ class "site-sketch-time" ] [ text time ]
                        ]
                        :: List.map (\line -> p [ class "site-sketch-line" ] [ text line ]) lines
                    )
                ]
    in
    div [ class "site-sketch", attribute "aria-hidden" "true" ]
        [ div [ class "site-sketch-window" ]
            [ div [ class "site-sketch-head" ]
                [ span [ class "site-sketch-room" ] [ text "# game-night" ]
                , span [ class "site-sketch-topic" ] [ text "Fridays, 9pm. Bring snacks." ]
                ]
            , div [ class "site-sketch-log" ]
                [ row "lapis" "M" "Mara" "8:52" [ "Who's around tonight?" ]
                , row "gold" "J" "Jun" "8:54" [ "Here. Starting a call at 9", "Same room as last week" ]
                , row "shu" "I" "Iris" "8:55" [ "In. I'll bring the playlist" ]
                , p [ class "site-sketch-event" ] [ span [ class "site-sketch-dot" ] [], text "Jun started a voice call" ]
                ]
            , div [ class "site-sketch-composer" ]
                [ span [ class "site-sketch-input" ] [ text "Message #game-night" ]
                , span [ class "site-sketch-send" ] []
                ]
            ]
        , p [ class "site-sketch-caption" ] [ text "Illustration, not a live room." ]
        ]


{-| The landing surface. -}
landing : Html Msg
landing =
    div [ class "site-landing" ]
        [ a [ class "site-skip", href "#site-main" ] [ text "Skip to content" ]
        , PublicFrame.masthead Nothing "/"
        , main_ [ id "site-main", class "site-landing-main", tabindex -1, attribute "aria-label" "Onyx home" ]
            [ section [ class "site-intro", attribute "aria-labelledby" "intro-heading" ]
                [ div [ class "site-intro-copy" ]
                    [ p [ class "site-kicker" ] [ text "Rooms, messages, and calls" ]
                    , h1 [ id "intro-heading", class "site-display" ]
                        [ span [] [ text "Good company." ]
                        , text " "
                        , span [] [ text "Great nights." ]
                        ]
                    , p [ class "site-lede" ]
                        [ text "A place for your friends to talk, play, and catch up. Open a room in your browser." ]
                    , div [ class "site-cta" ]
                        [ a [ class "site-cta-primary", href "/app/" ] [ text "Open Onyx" ]
                        , a [ class "site-cta-secondary", href "/invite?join=%23root" ] [ text "See the public room" ]
                        ]
                    , p [ class "site-note" ]
                        [ text "Browser first — no download needed. "
                        , a [ href "/download" ] [ text "Keep it on this device" ]
                        , text " from a supporting browser."
                        ]
                    ]
                , sketch
                ]
            , section [ class "site-trust", attribute "aria-labelledby" "trust-heading" ]
                [ h2 [ id "trust-heading", class "site-h2" ] [ text "What you can count on" ]
                , dl [ class "site-claims" ]
                    (List.map
                        (\( icon, term, detail ) ->
                            div [ class "site-claim" ]
                                [ span [ class ("site-claim-icon site-claim-icon--" ++ icon), attribute "aria-hidden" "true" ] []
                                , dt [] [ text term ]
                                , dd [] [ text detail ]
                                ]
                        )
                        trustClaims
                    )
                , p [ class "site-detail" ]
                    [ text "Read "
                    , a [ href "/privacy" ] [ text "the privacy details" ]
                    , text "."
                    ]
                ]
            , section [ class "site-ways", attribute "aria-labelledby" "ways-heading" ]
                [ div [ class "site-section-head" ]
                    [ h2 [ id "ways-heading", class "site-h2" ] [ text "Three ways in" ]
                    , p [ class "site-note" ] [ text "Room links open ready to join. This page never shows who is online." ]
                    ]
                , ul [ class "site-ledger", attribute "data-testid" "ways-in-ledger" ]
                    (List.indexedMap wayRow waysIn)
                ]
            , section [ class "site-closer", attribute "aria-labelledby" "closer-heading" ]
                [ img
                    [ class "site-closer-art"
                    , src "/brand/mascot-still.png"
                    , alt ""
                    , width 512
                    , height 512
                    , attribute "loading" "lazy"
                    , attribute "decoding" "async"
                    ]
                    []
                , div [ class "site-closer-copy" ]
                    [ h2 [ id "closer-heading", class "site-h2" ] [ text "Your room is waiting." ]
                    , p [] [ text "Pick a name, walk in, and invite the people you already like. The room stays open when you come back." ]
                    , div [ class "site-closer-actions" ]
                        [ a [ class "site-cta-primary", href "/app/" ] [ text "Open Onyx" ]
                        , a [ class "site-cta-link", href "/about/" ] [ text "Read the story" ]
                        ]
                    ]
                ]
            ]
        , PublicFrame.footer "/" "More to explore"
        ]


wayRow : Int -> WayIn -> Html Msg
wayRow index way =
    li [ class "site-ledger-row" ]
        [ span [ class "site-ledger-num", attribute "aria-hidden" "true" ] [ text ("0" ++ String.fromInt (index + 1)) ]
        , div [ class "site-ledger-copy" ]
            [ p [ class "site-ledger-head" ] [ text way.head ]
            , p [ class "site-ledger-what" ] [ text way.copy ]
            ]
        , a [ class "site-ledger-go", href way.href ] [ text way.action ]
        ]
