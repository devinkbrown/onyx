module View.PublicFrame exposing
    ( NavItem
    , footerLinks
    , frame
    , normalisePath
    , primaryNav
    )

{-| Shared public-route chrome in the Elm-first site language: serif
wordmark with the brand mark, quiet primary navigation, skip link,
optional context line, labelled main, footer.

Behavior is unchanged from the old frame: the mobile toggle keeps full
ARIA semantics (`aria-expanded` / `aria-controls` / labelled labelled),
closes on navigation, and closes on Escape (wired in
`Main.subscriptions`). The animated atmosphere landmark is gone with
the old site — nothing hydrates it anymore.

-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, footer, header, img, main_, nav, p, span, text)
import Html.Attributes exposing (alt, attribute, class, classList, height, href, id, src, width)
import Html.Events exposing (onClick)


{-| One primary navigation entry. -}
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


{-| Footer exploration links, mirroring `PublicFooter`. -}
footerLinks : List NavItem
footerLinks =
    [ { label = "House rules", href = "/guidelines/" }
    , { label = "Privacy", href = "/privacy/" }
    , { label = "Contact", href = "/contact/" }
    , { label = "Status", href = "/status/" }
    , { label = "Guides", href = "/guides/" }
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


navLink : String -> NavItem -> Html Msg
navLink currentPath item =
    let
        current =
            normalisePath item.href == normalisePath currentPath
    in
    a
        ([ href item.href ]
            ++ (if current then
                    [ attribute "aria-current" "page" ]

                else
                    []
               )
        )
        [ text item.label ]


{-| Shared document framing for public routes: skip link, masthead,
optional context line, labelled main, footer. -}
frame : Model -> String -> String -> Maybe (Html Msg) -> List (Html Msg) -> Html Msg
frame model currentPath mainLabel context children =
    let
        normalised =
            normalisePath currentPath

        brandCurrent =
            normalised == "/"
    in
    div [ class "site-frame" ]
        [ a [ class "site-skip", href "#site-main" ] [ text "Skip to content" ]
        , header [ class "site-mast" ]
            [ a
                ([ class "site-brand", href "/" ]
                    ++ (if brandCurrent then
                            [ attribute "aria-current" "page"
                            , attribute "aria-label" "Onyx home"
                            ]

                        else
                            [ attribute "aria-label" "Onyx home" ]
                       )
                )
                [ img [ class "site-brand-mark", src "/brand/mark.png", width 28, height 28, alt "" ] []
                , span [ class "site-brand-name" ] [ text "Onyx" ]
                ]
            , div [ class "site-mast-nav" ]
                [ nav
                    [ id "public-primary-navigation"
                    , class "site-nav"
                    , classList [ ( "is-open", model.navMenuOpen ) ]
                    , attribute "aria-label" "Primary navigation"
                    ]
                    (List.map (navLink currentPath) primaryNav)
                , a [ class "site-mast-open", href "/app/" ] [ text "Open Onyx" ]
                , button
                    [ class "site-menu-toggle"
                    , attribute "type" "button"
                    , attribute "aria-expanded"
                        (if model.navMenuOpen then
                            "true"

                         else
                            "false"
                        )
                    , attribute "aria-controls" "public-primary-navigation"
                    , attribute "aria-label"
                        (if model.navMenuOpen then
                            "Close navigation menu"

                         else
                            "Open navigation menu"
                        )
                    , onClick ToggleNavMenu
                    ]
                    [ text "Menu" ]
                ]
            ]
        , case context of
            Just current ->
                div [ class "site-context" ] [ current ]

            Nothing ->
                text ""
        , main_ [ id "site-main", class "site-body", attribute "aria-label" mainLabel ] children
        , footer [ class "site-foot" ]
            [ div [ class "site-foot-identity" ]
                [ a [ class "site-brand", href "/" ]
                    [ img [ class "site-brand-mark", src "/brand/mark.png", width 28, height 28, alt "" ] []
                    , span [ class "site-brand-name" ] [ text "Onyx" ]
                    ]
                , p [] [ text "Rooms, messages, and calls for friends, clubs, and creators." ]
                ]
            , nav [ attribute "aria-label" "Footer navigation" ]
                [ p [ class "site-foot-title" ] [ text "Explore Onyx" ]
                , div [ class "site-foot-links" ]
                    (List.map (\link -> a [ href link.href ] [ text link.label ]) footerLinks)
                ]
            ]
        ]
