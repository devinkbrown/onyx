module View.PublicFrame exposing
    ( NavItem
    , footerLinks
    , frame
    , normalisePath
    , primaryNav
    )

{-| Shared public-route chrome, mirroring `src/ui/public/PublicFrame`
(header, primary navigation, skip link, footer) with nav items from
the canonical manifest (`publicRouteManifest`: About + Download carry
`primary` placement, ordered About then Download). The brand lockup,
mark, and footer identity copy the oracle class and asset contract;
`SceneAtmosphere` stays a CSS concern (the `public-atmosphere`
landmark is rendered for it to hydrate).

Narrowings: the mobile focus-trap and toggle refocus are JS
behaviours with no pure equivalent — the toggle keeps full ARIA
semantics (`aria-expanded` / `aria-controls` / labelled), closes on
navigation, and closes on Escape (wired in `Main.subscriptions`).
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, footer, header, img, main_, nav, p, span, text)
import Html.Attributes exposing (alt, attribute, class, classList, height, href, id, src, tabindex, width)
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


{-| Shared document framing for public routes: atmosphere landmark,
skip link, header, optional context line, labelled main, footer. -}
frame : Model -> String -> String -> Maybe (Html Msg) -> List (Html Msg) -> Html Msg
frame model currentPath mainLabel context children =
    let
        normalised =
            normalisePath currentPath

        brandCurrent =
            normalised == "/"
    in
    div [ class "public-frame" ]
        [ div [ class "public-atmosphere", attribute "aria-hidden" "true", attribute "data-testid" "public-atmosphere" ] []
        , a [ class "public-frame__skip", href "#public-main" ] [ text "Skip to content" ]
        , header [ class "public-frame__header" ]
            [ div [ class "public-frame__header-inner" ]
                [ a
                    ([ class "public-frame__brand", href "/", Html.Attributes.attribute "aria-label" "Onyx home" ]
                        ++ (if brandCurrent then
                                [ attribute "aria-current" "page" ]

                            else
                                []
                           )
                    )
                    [ span [ class "public-frame__brand-visual", attribute "aria-hidden" "true" ]
                        [ img [ class "public-frame__lockup", src "/brand/lockup.png", width 200, height 78, alt "", attribute "decoding" "async" ] []
                        , img [ class "public-frame__mark", src "/brand/mark.png", width 40, height 40, alt "", attribute "decoding" "async" ] []
                        , img [ class "public-frame__wordmark", src "/brand/wordmark.png", width 86, height 37, alt "", attribute "decoding" "async" ] []
                        , span [ class "public-frame__name" ] [ text "Onyx" ]
                        ]
                    ]
                , div [ class "public-frame__nav-cluster" ]
                    [ div [ class "public-frame__nav-links" ]
                        [ nav
                            [ id "public-primary-navigation"
                            , class "public-frame__nav"
                            , classList [ ( "is-open", model.navMenuOpen ) ]
                            , attribute "aria-label" "Primary navigation"
                            ]
                            (List.map (navLink currentPath) primaryNav)
                        ]
                    , div [ class "public-frame__nav-actions" ]
                        [ a [ class "public-frame__open", href "/app/" ] [ text "Open Onyx" ]
                        , button
                            [ class "public-frame__menu-toggle"
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
                            [ span [ attribute "aria-hidden" "true" ] []
                            , span [ attribute "aria-hidden" "true" ] []
                            ]
                        ]
                    ]
                ]
            ]
        , case context of
            Just current ->
                div [ class "public-frame__context" ] [ current ]

            Nothing ->
                text ""
        , main_ [ id "public-main", class "public-frame__main", tabindex -1, attribute "aria-label" mainLabel ] children
        , footer [ class "public-frame__footer" ]
            [ div [ class "public-frame__footer-inner" ]
                [ div [ class "public-frame__footer-identity" ]
                    [ a [ class "public-frame__footer-brand", href "/" ]
                        [ img [ class "public-frame__mark", src "/brand/mark.png", width 28, height 28, alt "" ] []
                        , span [] [ text "Onyx" ]
                        ]
                    , p [] [ text "Rooms, messages, and calls for friends, clubs, and creators." ]
                    ]
                , nav [ attribute "aria-label" "Footer navigation" ]
                    [ p [ class "public-frame__footer-title" ] [ text "Explore Onyx" ]
                    , div [ class "public-frame__footer-links" ]
                        (List.map (\link -> a [ href link.href ] [ text link.label ]) footerLinks)
                    ]
                ]
            ]
        ]

