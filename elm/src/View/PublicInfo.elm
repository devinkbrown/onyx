module View.PublicInfo exposing (PublicInfoPage(..), content, mainLabel, pageForPath, pageForRoute, pageTitle, route, view)

{-| Supporting public-information pages, mirroring
`src/routes/PublicInfo.tsx`: Accessibility, Glossary, Integrations,
and Agent safety share one data table and one layout, reached through
the allowlisted trailing-slash paths (slashless aliases resolve the
same way). An unallowlisted path is a routing error in the oracle
(`resolvePublicInfoPage` throws); here it is `Nothing` and the caller
renders the route terminus instead — fail-closed, no invented page.
-}

import App exposing (Model, Msg)
import Html exposing (Html, article, div, h1, h2, p, section, span, text)
import Html.Attributes exposing (attribute, class, id)
import Route exposing (Route)
import View.PublicFrame exposing (frame)


{-| The four supporting pages. -}
type PublicInfoPage
    = Accessibility
    | Glossary
    | Integrations
    | Agents


{-| Page content: title, lede, statement — mirroring `content`. -}
content : PublicInfoPage -> { title : String, lede : String, statement : String }
content page =
    case page of
        Accessibility ->
            { title = "Accessibility"
            , lede = "Access is a product requirement."
            , statement = "Keyboard navigation, focus recovery, motion controls, contrast variants, and live-status announcements are tested in the client. Report a gap in #accessibility."
            }

        Glossary ->
            { title = "Glossary"
            , lede = "Words should make the network easier to use."
            , statement = "Onyx is the network and client. Onyx Server is the engine. Cadence is the media system. Mooring is the secured peer channel."
            }

        Integrations ->
            { title = "Integrations"
            , lede = "Useful actions, constrained by design."
            , statement = "Onyx renders reviewed Block-Kit-lite content and uses capability-scoped action manifests. It never executes a message as a command."
            }

        Agents ->
            { title = "Agent safety"
            , lede = "Automation has a boundary."
            , statement = "Agent-visible actions are reviewed, capability-scoped, and labelled with their source. Local data stays local unless you explicitly choose otherwise."
            }


{-| Path segment key, mirroring the `PUBLIC_INFO_PATHS` keys. -}
pageKey : PublicInfoPage -> String
pageKey page =
    case page of
        Accessibility ->
            "accessibility"

        Glossary ->
            "glossary"

        Integrations ->
            "integrations"

        Agents ->
            "agents"


{-| Resolve a supporting page from an allowlisted path, mirroring
`publicInfoPageForPath` (trailing-slash and slashless forms both
resolve; anything else is `Nothing`). -}
pageForPath : String -> Maybe PublicInfoPage
pageForPath path =
    case path of
        "/accessibility/" ->
            Just Accessibility

        "/accessibility" ->
            Just Accessibility

        "/glossary/" ->
            Just Glossary

        "/glossary" ->
            Just Glossary

        "/integrations/" ->
            Just Integrations

        "/integrations" ->
            Just Integrations

        "/agents/" ->
            Just Agents

        "/agents" ->
            Just Agents

        _ ->
            Nothing


{-| Accessible `main` landmark name, mirroring `mainLabels`. -}
mainLabel : PublicInfoPage -> String
mainLabel page =
    case page of
        Accessibility ->
            "Onyx accessibility"

        Glossary ->
            "Onyx glossary"

        Integrations ->
            "Onyx integrations"

        Agents ->
            "Onyx agent safety"


{-| Document title, mirroring the `setPageMeta` call (`Onyx — <title>`). -}
pageTitle : PublicInfoPage -> String
pageTitle page =
    "Onyx — " ++ (content page).title


{-| The supporting-page body. -}
view : PublicInfoPage -> Html Msg
view page =
    let
        item =
            content page

        key =
            pageKey page
    in
    div [ class ("ui-root r data-page public-info-page public-info-page--" ++ key) ]
        [ div [ class "r-ground", attribute "aria-hidden" "true" ] []
        , div [ class "r-flecks", attribute "aria-hidden" "true" ] []
        , section [ class "r-wrap r-section public-info-article", attribute "aria-labelledby" ("public-info-" ++ key ++ "-heading") ]
            [ div [ class "public-info-article__header" ]
                [ p [ class "r-kicker" ] [ text "public contract" ]
                , h1 [ id ("public-info-" ++ key ++ "-heading") ] [ text item.title ]
                , p [ class "sub" ] [ text item.lede ]
                ]
            , article [ class "public-info-statement", attribute "aria-labelledby" ("public-info-" ++ key ++ "-statement") ]
                [ p [ class "label" ] [ text "Onyx · public statement" ]
                , h2 [ id ("public-info-" ++ key ++ "-statement") ] [ text "The statement" ]
                , p [] [ text item.statement ]
                ]
            ]
        ]


contextLine : PublicInfoPage -> Html Msg
contextLine page =
    p [ class "public-frame__current-line" ]
        [ span [ class "public-frame__current-kicker" ] [ text "Public contract" ]
        , span [ attribute "aria-hidden" "true" ] [ text "·" ]
        , span [ class "public-frame__current-label" ] [ text (content page).title ]
        ]


{-| The supporting-page route inside the public frame. -}
route : Model -> PublicInfoPage -> List (Html Msg)
route model page =
    [ frame model ("/" ++ pageKey page ++ "/") (mainLabel page) (Just (contextLine page)) [ view page ] ]


{-| Dispatch helper: route → supporting page, if any. -}
pageForRoute : Route -> Maybe PublicInfoPage
pageForRoute route_ =
    case route_ of
        Route.Accessibility ->
            Just Accessibility

        Route.Glossary ->
            Just Glossary

        Route.Integrations ->
            Just Integrations

        Route.Agents ->
            Just Agents

        _ ->
            Nothing
