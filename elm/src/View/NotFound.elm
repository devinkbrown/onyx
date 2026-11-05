module View.NotFound exposing (notFound)

{-| Route terminus page, mirroring `src/routes/NotFound.tsx`: the 404
kicker, heading, sub-copy, and the app-miss-aware action. Rendered
inside the public frame by `View`. Document metadata (title/meta
dance in `setNotFoundPageMeta`) stays ports-side; the title is set
through the Elm document head.
-}

import App exposing (Msg)
import Html exposing (Html, a, article, div, h1, p, text)
import Html.Attributes exposing (class, href)


{-| The 404 body. `isAppMiss` selects the action target and label. -}
notFound : Bool -> Html Msg
notFound isAppMiss =
    article [ class "site-article" ]
        [ p [ class "site-note" ] [ text "404 · route terminus" ]
        , h1 [ class "site-display-sm" ] [ text "Route terminus" ]
        , p [] [ text "This route is not part of the public Onyx surface." ]
        , div [ class "site-cta" ]
            [ a [ class "not-found-page__action site-cta-primary", href (if isAppMiss then "/app/" else "/") ]
                [ text
                    (if isAppMiss then
                        "Open Onyx"

                     else
                        "Back to home"
                    )
                ]
            ]
        ]
