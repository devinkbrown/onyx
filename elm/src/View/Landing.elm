module View.Landing exposing (landing)

{-| Public homepage: a product site built around the real Onyx app.

Every picture on this page is a screenshot of the actual Elm shell,
captured from a local build against a mocked wire by
`elm/tools/marketing-capture.mjs` (no live network, demo names). The
images live in `elm/marketing/` as WebP with a JPEG fallback at 1x and
2x; the device frames around them are CSS.

Structure (top to bottom):

  - Masthead shared with every public page (`PublicFrame.masthead`,
    stateless variant — `View` renders the landing without `Model`).
  - Hero: what Onyx is, one primary action (Open Onyx) and one
    secondary (the public room), then the app itself on a laptop and a
    phone.
  - A strip of four plain facts.
  - Three product stories, image and text alternating: rooms, private
    DMs, catching up.
  - "Also in the box": the rest of what ships, each claim checked
    against the client (calls are voice-first and start in a room;
    group rooms are not end-to-end encrypted, and the page says so).
  - How it works in three steps, the trust section, a closing call to
    action, then the shared footer.

-}

import App exposing (Msg(..))
import Html exposing (Html, a, div, h1, h2, h3, img, li, main_, p, section, span, strong, text, ul)
import Html.Attributes exposing (alt, attribute, class, height, href, id, src, tabindex, width)
import View.PublicFrame as PublicFrame


sourceUrl : String
sourceUrl =
    "https://github.com/devinkbrown/onyx"


{-| A product screenshot: WebP first, JPEG fallback, 1x/2x. `eager`
is for the hero only; everything else lazy-loads. -}
shot : { name : String, w : Int, h : Int, label : String, eager : Bool } -> Html msg
shot cfg =
    let
        base =
            "/marketing/" ++ cfg.name

        set ext =
            base ++ "-1x." ++ ext ++ " 1x, " ++ base ++ "-2x." ++ ext ++ " 2x"
    in
    Html.node "picture"
        []
        [ Html.node "source" [ attribute "type" "image/webp", attribute "srcset" (set "webp") ] []
        , img
            [ class "site-shot-img"
            , src (base ++ "-1x.jpg")
            , attribute "srcset" (set "jpg")
            , width cfg.w
            , height cfg.h
            , alt cfg.label
            , attribute "decoding" "async"
            , attribute "loading"
                (if cfg.eager then
                    "eager"

                 else
                    "lazy"
                )
            ]
            []
        ]


laptop : Html msg -> Html msg
laptop inner =
    div [ class "site-device site-device--browser" ]
        [ div [ class "site-device-bar", attribute "aria-hidden" "true" ]
            [ span [] [], span [] [], span [] [], span [ class "site-device-url" ] [ text "eshmaki.me/app" ] ]
        , div [ class "site-device-screen" ] [ inner ]
        ]


phone : String -> Html msg -> Html msg
phone extra inner =
    div [ class ("site-device site-device--phone " ++ extra) ]
        [ div [ class "site-device-screen" ] [ inner ] ]


roomDesktop : Html msg
roomDesktop =
    shot { name = "room-desktop", w = 1280, h = 800, label = "The Onyx app on a computer: the #lounge room with today's messages, the room list on the left, and members on the right.", eager = True }


roomPhone : Bool -> Html msg
roomPhone eager =
    shot { name = "room-phone", w = 390, h = 844, label = "The #lounge room in the Onyx app on a phone, with the composer and the bottom tabs.", eager = eager }


facts : List ( String, String, String )
facts =
    [ ( "browser", "Nothing to install", "Any modern browser" )
    , ( "ads", "No ads, no trackers", "Nobody sells your attention" )
    , ( "lock", "Encrypted DMs", "End-to-end, between two people" )
    , ( "code", "Open source", "AGPL-3.0, code on GitHub" )
    ]


type alias Story =
    { kicker : String
    , title : String
    , copy : String
    , points : List String
    , picture : Html Msg
    }


stories : List Story
stories =
    [ { kicker = "Rooms"
      , title = "Rooms that stay open."
      , copy = "A room is a place your group keeps coming back to — the book club, the game night, the photo walk. Drop in, catch up, and pick up the thread where you left it."
      , points =
            [ "Topics, mentions, and unread filters keep busy rooms readable"
            , "Owners, ops, and voice roles for the people who run the room"
            , "Invite links that open the room ready to join"
            ]
      , picture = phone "" (roomPhone False)
      }
    , { kicker = "Direct messages"
      , title = "Private when you want it."
      , copy = "Take a conversation to a DM when it should stay between two people. When both apps support it, the message text is encrypted on your device before it leaves."
      , points =
            [ "End-to-end encrypted DMs, a setting you control"
            , "Group rooms are shared spaces and are not end-to-end encrypted — we say so plainly"
            , "Block and report tools in every conversation"
            ]
      , picture = phone "" (shot { name = "dm-phone", w = 390, h = 844, label = "A direct message with nova in the Onyx app on a phone.", eager = False })
      }
    , { kicker = "Catch up"
      , title = "Back in a minute, not a scroll."
      , copy = "The inbox gathers what needs you — mentions, replies, and DMs — so coming back after a day away takes a glance instead of an hour."
      , points =
            [ "Needs-you and everything-else views, mark all read in one tap"
            , "Search your rooms, and save the searches you repeat"
            , "About 400 recent messages per room kept on this device"
            ]
      , picture = phone "" (shot { name = "inbox-phone", w = 390, h = 844, label = "The Onyx inbox sheet on a phone, listing two unread direct messages.", eager = False })
      }
    ]


extras : List ( String, String, String )
extras =
    [ ( "voice", "Voice calls in the room", "Start a call inside any room, right in the browser. Joining is always a choice — a call never pulls you in. Sign in to start one." )
    , ( "install", "Keep it like an app", "Add Onyx to your home screen or dock from a supporting browser. Same rooms, same people, no app store." )
    , ( "device", "History on your device", "Recent messages are kept in this browser, so rooms open fast and your search covers what you have already seen." )
    , ( "mesh", "Runs on Onyx Server", "Onyx connects to a mesh of linked Onyx Server nodes and picks the fastest one near you." )
    , ( "palette", "Make it yours", "Light and dark looks, text size, density, and a theme studio for the details." )
    , ( "code", "Open source", "The client is AGPL-3.0. Read it, run it, or host your own Onyx Server." )
    ]


steps : List ( String, String )
steps =
    [ ( "Open Onyx", "It runs in your browser. No download, no app store." )
    , ( "Pick a name", "Start as a guest. Keep the name with an account when you are ready." )
    , ( "Join or start a room", "Walk into the public room, or make one and share its invite." )
    ]


{-| The landing surface. -}
landing : Html Msg
landing =
    div [ class "site-landing" ]
        [ a [ class "site-skip", href "#site-main" ] [ text "Skip to content" ]
        , PublicFrame.masthead Nothing "/"
        , main_ [ id "site-main", class "site-landing-main", tabindex -1, attribute "aria-label" "Onyx home" ]
            [ hero
            , factStrip
            , section [ class "site-stories", attribute "aria-label" "What Onyx does" ]
                (List.indexedMap storyRow stories)
            , extrasSection
            , howSection
            , trustSection
            , closer
            ]
        , PublicFrame.footer "/" "Explore Onyx"
        ]


hero : Html Msg
hero =
    section [ class "site-hero", attribute "aria-labelledby" "hero-heading" ]
        [ div [ class "site-hero-copy" ]
            [ p [ class "site-kicker site-kicker--chip" ] [ text "Free and open source" ]
            , h1 [ id "hero-heading", class "site-display" ]
                [ span [] [ text "Rooms, DMs, and calls" ]
                , text " "
                , span [] [ text "for your people." ]
                ]
            , p [ class "site-lede" ]
                [ text "Onyx is where your group hangs out: rooms that stay open, private messages, and voice calls. It runs in your browser — nothing to install, no ads, no trackers." ]
            , div [ class "site-cta" ]
                [ a [ class "site-cta-primary", href "/app/" ] [ text "Open Onyx" ]
                , a [ class "site-cta-secondary", href "/invite?join=%23root" ] [ text "Visit the public room" ]
                ]
            , p [ class "site-note" ]
                [ text "Works in any modern browser. "
                , a [ href "/download/" ] [ text "Install it as an app" ]
                , text " if you like."
                ]
            ]
        , div [ class "site-hero-art" ]
            [ laptop roomDesktop
            , phone "site-device--float" (roomPhone True)
            ]
        ]


factStrip : Html Msg
factStrip =
    section [ class "site-facts", attribute "aria-label" "At a glance" ]
        [ ul [ class "site-facts-list" ]
            (List.map
                (\( icon, title, detail ) ->
                    li [ class "site-fact" ]
                        [ span [ class ("site-icon site-icon--" ++ icon), attribute "aria-hidden" "true" ] []
                        , span [ class "site-fact-copy" ] [ strong [] [ text title ], span [] [ text detail ] ]
                        ]
                )
                facts
            )
        ]


storyRow : Int -> Story -> Html Msg
storyRow index story =
    let
        headingId =
            "story-" ++ String.fromInt index
    in
    div
        [ class
            ("site-story"
                ++ (if modBy 2 index == 1 then
                        " site-story--flip"

                    else
                        ""
                   )
            )
        , attribute "role" "group"
        , attribute "aria-labelledby" headingId
        ]
        [ div [ class "site-story-copy" ]
            [ p [ class "site-kicker" ] [ text story.kicker ]
            , h2 [ id headingId, class "site-h2" ] [ text story.title ]
            , p [ class "site-story-lede" ] [ text story.copy ]
            , ul [ class "site-checks" ] (List.map (\point -> li [] [ text point ]) story.points)
            ]
        , div [ class "site-story-art" ] [ story.picture ]
        ]


extrasSection : Html Msg
extrasSection =
    section [ class "site-extras", attribute "aria-labelledby" "extras-heading" ]
        [ div [ class "site-section-head" ]
            [ p [ class "site-kicker" ] [ text "Also in the box" ]
            , h2 [ id "extras-heading", class "site-h2" ] [ text "Everything a group chat needs. Nothing it doesn't." ]
            ]
        , ul [ class "site-cards" ]
            (List.map
                (\( icon, title, copy ) ->
                    li [ class "site-card" ]
                        [ span [ class ("site-icon site-icon--" ++ icon), attribute "aria-hidden" "true" ] []
                        , h3 [] [ text title ]
                        , p [] [ text copy ]
                        ]
                )
                extras
            )
        ]


howSection : Html Msg
howSection =
    section [ class "site-how", attribute "aria-labelledby" "how-heading" ]
        [ div [ class "site-section-head" ]
            [ p [ class "site-kicker" ] [ text "How it works" ]
            , h2 [ id "how-heading", class "site-h2" ] [ text "In a room in under a minute." ]
            ]
        , Html.ol [ class "site-steps", attribute "data-testid" "how-it-works" ]
            (List.map
                (\( title, copy ) ->
                    li [ class "site-step" ] [ h3 [] [ text title ], p [] [ text copy ] ]
                )
                steps
            )
        ]


trustSection : Html Msg
trustSection =
    section [ class "site-trust", attribute "aria-labelledby" "trust-heading" ]
        [ div [ class "site-trust-panel" ]
            [ div [ class "site-trust-copy" ]
                [ p [ class "site-kicker" ] [ text "Privacy" ]
                , h2 [ id "trust-heading", class "site-h2" ] [ text "Built to be trusted, not to watch you." ]
                , p [] [ text "No ads and no third-party trackers — this site does not load analytics pixels or ad tags. Your recent history is kept on your device. The code is public, so none of this has to be taken on faith." ]
                , div [ class "site-trust-links" ]
                    [ a [ href "/privacy/" ] [ text "What stays where" ]
                    , a [ href "/guidelines/" ] [ text "House rules" ]
                    , a [ href sourceUrl ] [ text "Source on GitHub" ]
                    ]
                ]
            , ul [ class "site-trust-list" ]
                [ li [] [ strong [] [ text "DMs" ], span [] [ text "End-to-end encrypted when both apps support it." ] ]
                , li [] [ strong [] [ text "Rooms" ], span [] [ text "Shared with the room so it can stay open; not end-to-end encrypted." ] ]
                , li [] [ strong [] [ text "History" ], span [] [ text "About 400 recent messages per room, kept in this browser." ] ]
                , li [] [ strong [] [ text "Accounts" ], span [] [ text "Optional to look around; the server stores the name and email you give it." ] ]
                ]
            ]
        ]


closer : Html Msg
closer =
    section [ class "site-closer", attribute "aria-labelledby" "closer-heading" ]
        [ div [ class "site-closer-panel" ]
            [ div [ class "site-closer-copy" ]
                [ h2 [ id "closer-heading", class "site-h2" ] [ text "Your room is ready when you are." ]
                , p [] [ text "Open Onyx, pick a name, and bring the people you already like." ]
                ]
            , div [ class "site-closer-actions" ]
                [ a [ class "site-cta-primary", href "/app/" ] [ text "Open Onyx" ]
                , a [ class "site-cta-link", href "/about/" ] [ text "Read about Onyx" ]
                ]
            ]
        ]
