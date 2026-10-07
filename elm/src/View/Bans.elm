module View.Bans exposing (banPanel)

{-| Moderation block-list panel — the room's authoritative ban list with
review-first unbans (mirroring `BanListPanel.tsx`: op-gated fetch,
verbatim status strings, mask rows with setters, and a confirm step
that re-checks authority before the lift sends `MODE -b`).

The panel renders only where we moderate; elsewhere it is empty (the
oracle mounts its equivalent inside the moderation cockpit rather than
inline, so non-moderators never see the surface at all).
-}

import App exposing (BanEntry, BanListView(..), ConnectionState(..), Model, Msg(..), UnbanReview, banListViewFor, isChannelOp)
import Html exposing (Html, button, code, div, h4, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled)
import Html.Events exposing (onClick)
import String


banPanel : Model -> String -> Html Msg
banPanel model channel =
    if not (isChannelOp model channel) then
        div [] []

    else
        let
            live =
                model.connection == Live

            view =
                banListViewFor model channel
        in
        section [ class "moderation-desk__bans", attribute "data-testid" "ban-list-panel" ]
            ([ div [ class "moderation-cockpit__head" ]
                [ div []
                    [ h4 [] [ text "Active blocks" ]
                    , span [ class "moderation-desk__room" ] [ text channel ]
                    ]
                , button
                    [ attribute "data-testid" "ban-list-refresh"
                    , disabled (not live)
                    , onClick (BanListRequested channel)
                    ]
                    [ text "Refresh list" ]
                ]
             ]
                ++ statusLine view
                ++ entryList model channel view
                ++ reviewDialog model channel
            )


statusLine : BanListView -> List (Html Msg)
statusLine view =
    let
        line message =
            [ p [ class "moderation-cockpit__hint", attribute "role" "status", attribute "data-testid" "ban-list-status" ]
                [ text message ]
            ]
    in
    case view of
        BanViewLoading entries ->
            if List.isEmpty entries then
                line "Loading the block list…"

            else
                line "Refreshing the block list…"

        BanViewEmpty _ ->
            line "No active blocks in this room."

        BanViewError message _ ->
            line message

        BanViewUnavailable message _ ->
            line message

        BanViewIdle _ ->
            line "Refresh to load the server block list."

        BanViewPopulated _ _ ->
            []


entryList : Model -> String -> BanListView -> List (Html Msg)
entryList model channel view =
    let
        entries =
            case view of
                BanViewLoading rows ->
                    rows

                BanViewPopulated rows _ ->
                    rows

                BanViewError _ rows ->
                    rows

                BanViewUnavailable _ rows ->
                    rows

                _ ->
                    []
    in
    if List.isEmpty entries then
        []

    else
        [ ul [ class "moderation-desk__ban-list", attribute "aria-label" ("Active blocks in " ++ channel) ]
            (List.map (banRow model channel) entries)
        ]


banRow : Model -> String -> BanEntry -> Html Msg
banRow model channel entry =
    li [ class "moderation-desk__ban-row", attribute "data-testid" "ban-list-row" ]
        [ div []
            ([ code [ class "moderation-desk__ban-mask" ] [ text entry.mask ] ]
                ++ (case entry.setBy of
                        Nothing ->
                            []

                        Just setter ->
                            [ p [ class "moderation-cockpit__hint" ] [ text ("Set by " ++ setter) ] ]
                   )
            )
        , button
            [ disabled (model.connection /= Live)
            , attribute "aria-label" ("Review lifting the block on " ++ entry.mask)
            , onClick (UnbanReviewRequested { channel = channel, mask = entry.mask })
            ]
            [ text "Review lift" ]
        ]


reviewDialog : Model -> String -> List (Html Msg)
reviewDialog model channel =
    case model.pendingUnban of
        Nothing ->
            []

        Just review ->
            if not (isReviewFor review channel) then
                []

            else
                [ div [ class "moderation-review", attribute "role" "dialog", attribute "aria-label" ("Review lifting the block on " ++ review.mask) ]
                    [ p [] [ text ("Lift the block on " ++ review.mask ++ " in " ++ review.channel ++ "?") ]
                    , button [ onClick UnbanReviewConfirmed ] [ text "Lift block" ]
                    , button [ onClick UnbanReviewCancelled ] [ text "Keep block" ]
                    ]
                ]


isReviewFor : UnbanReview -> String -> Bool
isReviewFor review channel =
    String.toLower review.channel == String.toLower channel
