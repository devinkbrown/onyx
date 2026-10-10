module View.PublicFrame exposing
    ( NavItem
    , brandMark
    , footerLinks
    , frame
    , normalisePath
    , primaryNav
    , relatedNav
    )

{-| Shared public-route chrome, mirroring `src/ui/public/PublicFrame`
(header, primary navigation, skip link, footer) with nav items from
the canonical manifest (`publicRouteManifest`: About + Download carry
`primary` placement, ordered About then Download). The footer
identity copies the oracle class contract; the brand mark is drawn
in CSS rather than fetched as raster lockup/wordmark images, and the
phone menu adds the secondary destinations under the primary pair.
`SceneAtmosphere` stays a CSS concern (the `public-atmosphere`
landmark is rendered for it to hydrate).

Narrowings: the mobile focus-trap and toggle refocus are JS
behaviours with no pure equivalent — the toggle keeps full ARIA
semantics (`aria-expanded` / `aria-controls` / labelled), closes on
navigation, and closes on Escape (wired in `Main.subscriptions`).
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, footer, header, li, main_, nav, p, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, href, id, tabindex)
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


{-| Secondary destinations, shown under the primary items in the
phone menu only (desktop keeps the header to the manifest's two
primary links; the footer carries the rest). -}
moreNav : List NavItem
moreNav =
    [ { label = "Guides", href = "/guides/" }
    , { label = "Status", href = "/status/" }
    , { label = "Roadmap", href = "/roadmap/" }
    , { label = "Privacy", href = "/privacy/" }
    , { label = "House rules", href = "/guidelines/" }
    , { label = "Contact", href = "/contact/" }
    ]


{-| Footer exploration links, mirroring `PublicFooter` (plus the
other public destinations, so every page is two taps from any). -}
footerLinks : List NavItem
footerLinks =
    [ { label = "About", href = "/about/" }
    , { label = "Download", href = "/download/" }
    , { label = "Guides", href = "/guides/" }
    , { label = "Status", href = "/status/" }
    , { label = "Roadmap", href = "/roadmap/" }
    , { label = "House rules", href = "/guidelines/" }
    , { label = "Privacy", href = "/privacy/" }
    , { label = "Accessibility", href = "/accessibility/" }
    , { label = "Contact", href = "/contact/" }
    ]


{-| v3/rx-public — "Also on Onyx": sibling reading pages (trust and
public-contract pages plus Status), the current one marked. CSS sets it
beside the article on wide screens and after it on phones. -}
relatedNav : String -> Html msg
relatedNav currentPath =
    let
        item link =
            li []
                [ a
                    (href link.href
                        :: (if normalisePath link.href == normalisePath currentPath then
                                [ attribute "aria-current" "page" ]

                            else
                                []
                           )
                    )
                    [ text link.label ]
                ]
    in
    nav [ class "public-related", attribute "aria-label" "Related pages" ]
        [ p [ class "public-related__title" ] [ text "Also on Onyx" ]
        , ul [ class "public-related__list" ]
            (List.map item
                [ { label = "Privacy", href = "/privacy/" }
                , { label = "House rules", href = "/guidelines/" }
                , { label = "Contact", href = "/contact/" }
                , { label = "Accessibility", href = "/accessibility/" }
                , { label = "Glossary", href = "/glossary/" }
                , { label = "Status", href = "/status/" }
                ]
            )
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


{-| The Onyx mark, drawn in CSS (`.public-frame__mark`) so it is
crisp at every size and never depends on a raster fetch. -}
brandMark : String -> Html msg
brandMark extra =
    span [ class ("public-frame__mark " ++ extra), attribute "aria-hidden" "true" ] []


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
                        [ brandMark ""
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
                            [ div [ class "public-frame__nav-primary" ] (List.map (navLink currentPath) primaryNav)
                            , p [ class "public-frame__nav-more-title" ] [ text "More from Onyx" ]
                            , div [ class "public-frame__nav-more" ] (List.map (navLink currentPath) moreNav)
                            ]
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

        -- v3/rx-public: SPA page changes are announced (the frame node
        -- persists across public pages, so the new label is spoken).
        , p [ class "sr-only", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true", attribute "data-testid" "route-announcer" ] [ text mainLabel ]
        , footer [ class "public-frame__footer" ]
            [ div [ class "public-frame__footer-inner" ]
                [ div [ class "public-frame__footer-identity" ]
                    [ a [ class "public-frame__footer-brand", href "/" ]
                        [ brandMark "public-frame__mark--sm"
                        , span [] [ text "Onyx" ]
                        ]
                    , p [] [ text "Rooms, messages, and calls for friends, clubs, and creators." ]
                    , a [ class "public-frame__footer-open", href "/app/" ] [ text "Open Onyx" ]
                    ]
                , nav [ class "public-frame__footer-nav", attribute "aria-label" "Footer navigation" ]
                    [ p [ class "public-frame__footer-title" ] [ text "Explore Onyx" ]
                    , div [ class "public-frame__footer-links" ]
                        (List.map (\link -> a [ href link.href ] [ text link.label ]) footerLinks)
                    ]
                ]
            ]
        ]
