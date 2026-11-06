module View.PublicFrame exposing
    ( NavItem
    , footer
    , footerLinks
    , frame
    , masthead
    , moreNav
    , normalisePath
    , primaryNav
    , trustLinks
    )

{-| Shared public-route chrome in the night-harbor site language:
sticky masthead (brand, primary navigation, Open Onyx, phone menu),
skip link, optional context line, labelled main, route announcer, and
a two-column footer that reaches every public page.

The frame menu keeps full ARIA semantics (`aria-expanded` /
`aria-controls` / labelled toggle), closes on navigation, and closes on
Escape (wired in `Main.subscriptions`). On phones the menu is a panel
under the masthead carrying the primary pair plus the secondary
destinations (ported from the v3 public frame); on wider screens the
primary pair sits inline and the footer carries the rest.

The landing page renders without `Model` (see `View`), so `masthead`
also has a stateless mode: the same inline links on wide screens and a
native `<details>` disclosure on phones — no state to keep in sync.

-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, details, div, header, img, li, main_, nav, p, span, summary, text, ul)
import Html.Attributes exposing (alt, attribute, class, classList, height, href, id, src, tabindex, width)
import Html.Events exposing (onClick)


{-| One navigation entry. -}
type alias NavItem =
    { label : String
    , href : String
    }


{-| Primary navigation from the manifest: `primary` placement ordered
by `navigationOrder` (About 0, Download 1). Hrefs are the canonical
trailing-slash destinations. -}
primaryNav : List NavItem
primaryNav =
    [ { label = "About", href = "/about/" }
    , { label = "Download", href = "/download/" }
    ]


{-| Secondary destinations, shown under the primary pair in the phone
menu only (the footer carries them on wider screens). -}
moreNav : List NavItem
moreNav =
    [ { label = "Guides", href = "/guides/" }
    , { label = "Public room", href = "/invite/?join=%23root" }
    , { label = "Status", href = "/status/" }
    , { label = "Roadmap", href = "/roadmap/" }
    , { label = "Privacy", href = "/privacy/" }
    , { label = "House rules", href = "/guidelines/" }
    , { label = "Contact", href = "/contact/" }
    ]


{-| Footer product column: every public reading page is reachable from
any other in two taps. -}
footerLinks : List NavItem
footerLinks =
    [ { label = "About", href = "/about/" }
    , { label = "Download", href = "/download/" }
    , { label = "Guides", href = "/guides/" }
    , { label = "Public room", href = "/invite/?join=%23root" }
    , { label = "Status", href = "/status/" }
    , { label = "Roadmap", href = "/roadmap/" }
    ]


{-| Footer trust column. -}
trustLinks : List NavItem
trustLinks =
    [ { label = "House rules", href = "/guidelines/" }
    , { label = "Privacy", href = "/privacy/" }
    , { label = "Accessibility", href = "/accessibility/" }
    , { label = "Glossary", href = "/glossary/" }
    , { label = "Contact", href = "/contact/" }
    ]


{-| Manifest slashless match key: drop any query/fragment, strip one
trailing slash unless root. -}
normalisePath : String -> String
normalisePath value =
    let
        noQuery =
            case String.split "?" value of
                first :: _ ->
                    first

                [] ->
                    value

        noFragment =
            case String.split "#" noQuery of
                first :: _ ->
                    first

                [] ->
                    noQuery
    in
    if String.length noFragment > 1 && String.endsWith "/" noFragment then
        String.dropRight 1 noFragment

    else if String.isEmpty noFragment then
        "/"

    else
        noFragment


currentAttrs : String -> NavItem -> List (Html.Attribute msg)
currentAttrs currentPath item =
    if normalisePath item.href == normalisePath currentPath then
        [ attribute "aria-current" "page" ]

    else
        []


navLink : String -> NavItem -> Html msg
navLink currentPath item =
    a (href item.href :: currentAttrs currentPath item) [ text item.label ]


brand : String -> Html msg
brand currentPath =
    a
        ([ class "site-brand", href "/", attribute "aria-label" "Onyx home" ]
            ++ (if normalisePath currentPath == "/" then
                    [ attribute "aria-current" "page" ]

                else
                    []
               )
        )
        [ img [ class "site-brand-mark", src "/brand/mark.png", width 28, height 28, alt "" ] []
        , span [ class "site-brand-name" ] [ text "Onyx" ]
        ]


menuIcon : Html msg
menuIcon =
    span [ class "site-menu-icon", attribute "aria-hidden" "true" ] [ span [] [], span [] [] ]


{-| The masthead. `Just open` renders the stateful frame menu (the
toggle dispatches `ToggleNavMenu`); `Nothing` renders the stateless
landing variant (inline links + a `<details>` phone menu). -}
masthead : Maybe Bool -> String -> Html Msg
masthead menu currentPath =
    let
        primaryLinks =
            div [ class "site-nav-primary" ] (List.map (navLink currentPath) primaryNav)

        moreLinks =
            [ p [ class "site-nav-more-title" ] [ text "More from Onyx" ]
            , div [ class "site-nav-more" ] (List.map (navLink currentPath) moreNav)
            ]
    in
    header [ class "site-mast" ]
        [ div [ class "site-mast-inner" ]
            (case menu of
                Just open ->
                    [ brand currentPath
                    , nav
                        [ id "public-primary-navigation"
                        , class "site-nav"
                        , classList [ ( "is-open", open ) ]
                        , attribute "aria-label" "Primary navigation"
                        ]
                        (primaryLinks :: moreLinks)
                    , div [ class "site-mast-actions" ]
                        [ a [ class "site-mast-open", href "/app/" ] [ text "Open Onyx" ]
                        , button
                            [ class "site-menu-toggle"
                            , attribute "type" "button"
                            , attribute "aria-expanded"
                                (if open then
                                    "true"

                                 else
                                    "false"
                                )
                            , attribute "aria-controls" "public-primary-navigation"
                            , attribute "aria-label"
                                (if open then
                                    "Close navigation menu"

                                 else
                                    "Open navigation menu"
                                )
                            , onClick ToggleNavMenu
                            ]
                            [ menuIcon, span [ class "site-menu-label" ] [ text "Menu" ] ]
                        ]
                    ]

                Nothing ->
                    [ brand currentPath
                    , nav [ class "site-nav site-nav--inline", attribute "aria-label" "Primary navigation" ]
                        [ primaryLinks ]
                    , div [ class "site-mast-actions" ]
                        [ a [ class "site-mast-open", href "/app/" ] [ text "Open Onyx" ]
                        , details [ class "site-menu-details" ]
                            [ summary [ class "site-menu-toggle", attribute "aria-label" "Navigation menu" ]
                                [ menuIcon, span [ class "site-menu-label" ] [ text "Menu" ] ]
                            , nav [ class "site-nav site-nav--panel", attribute "aria-label" "Site menu" ]
                                (div [ class "site-nav-primary" ] (List.map (navLink currentPath) primaryNav) :: moreLinks)
                            ]
                        ]
                    ]
            )
        ]


{-| The footer: identity with a quiet Open Onyx, then the product and
trust columns. `exploreTitle` heads the product column. -}
footer : String -> String -> Html msg
footer currentPath exploreTitle =
    let
        column title links =
            div [ class "site-foot-col" ]
                [ p [ class "site-foot-title" ] [ text title ]
                , ul [ class "site-foot-links" ]
                    (List.map (\link -> li [] [ navLink currentPath link ]) links)
                ]
    in
    Html.footer [ class "site-foot" ]
        [ div [ class "site-foot-inner" ]
            [ div [ class "site-foot-identity" ]
                [ a [ class "site-brand", href "/" ]
                    [ img [ class "site-brand-mark", src "/brand/mark.png", width 28, height 28, alt "" ] []
                    , span [ class "site-brand-name" ] [ text "Onyx" ]
                    ]
                , p [] [ text "Rooms, DMs, and voice calls for your people. Runs in your browser." ]
                , a [ class "site-foot-open", href "/app/" ] [ text "Open Onyx" ]
                , p [ class "site-foot-legal" ]
                    [ text "Free and open source under AGPL-3.0. "
                    , a [ href "https://github.com/devinkbrown/onyx" ] [ text "Source on GitHub" ]
                    ]
                ]
            , nav [ class "site-foot-nav", attribute "aria-label" "Footer navigation" ]
                [ column exploreTitle footerLinks
                , column "Trust and help" trustLinks
                ]
            ]
        ]


{-| Shared document framing for public routes: skip link, masthead,
optional context line, labelled main, route announcer, footer. -}
frame : Model -> String -> String -> Maybe (Html Msg) -> List (Html Msg) -> Html Msg
frame model currentPath mainLabel context children =
    div [ class "site-frame" ]
        [ a [ class "site-skip", href "#site-main" ] [ text "Skip to content" ]
        , masthead (Just model.navMenuOpen) currentPath
        , case context of
            Just current ->
                div [ class "site-context" ] [ div [ class "site-context-inner" ] [ current ] ]

            Nothing ->
                text ""
        , main_ [ id "site-main", class "site-body", tabindex -1, attribute "aria-label" mainLabel ] children

        -- Ported from v3/rx-public: the frame node persists across
        -- public pages, so a changed label is announced on SPA moves.
        , p [ class "sr-only", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true", attribute "data-testid" "route-announcer" ] [ text mainLabel ]
        , footer currentPath "Explore Onyx"
        ]
