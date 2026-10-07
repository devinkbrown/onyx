module View.NotFound exposing (notFound)

{-| Route terminus page, mirroring `src/routes/NotFound.tsx`: the 404
kicker, heading, sub-copy, and the app-miss-aware action. Rendered
inside the public frame by `View`. Document metadata (title/meta
dance in `setNotFoundPageMeta`) stays ports-side; the title is set
through the Elm document head.
-}

import App exposing (Msg)
import Html exposing (Html, a, div, h1, p, section, text)
import Html.Attributes exposing (attribute, class, href)


{-| The 404 body. `isAppMiss` selects the action target and label. -}
notFound : Bool -> Html Msg
notFound isAppMiss =
    div [ class "ui-root r not-found-page" ]
        [ div [ class "r-ground", attribute "aria-hidden" "true" ] []
        , div [ class "r-flecks", attribute "aria-hidden" "true" ] []
        , section [ class "r-wrap not-found-page__body" ]
            [ p [ class "r-kicker" ] [ text "404 · route terminus" ]
            , h1 [] [ text "Route terminus" ]
            , p [ class "sub" ] [ text "This route is not part of the public Onyx surface." ]
            , a [ class "not-found-page__action", href (if isAppMiss then "/app/" else "/") ]
                [ text
                    (if isAppMiss then
                        "Open Onyx"

                     else
                        "Back to home"
                    )
                ]
            ]
        ]
