module View.Bans exposing (banPanel)

{-| Moderation block-list panel — the room's authoritative ban list with
review-first unbans (mirroring `BanListPanel.tsx`: op-gated fetch,
verbatim status strings, mask rows with setters, and a confirm step
that re-checks authority before the lift sends `MODE -b`).

The panel renders only where we moderate; elsewhere it is empty (the
oracle mounts its equivalent inside the moderation cockpit rather than
inline, so non-moderators never see the surface at all).
-}

import App exposing (BanAddForm, BanEntry, BanListView(..), ConnectionState(..), Model, Msg(..), UnbanReview, banListViewFor, isChannelOp)
import Html exposing (Html, button, code, div, h4, input, label, li, option, p, section, select, span, text, ul)
import Html.Attributes exposing (attribute, checked, class, disabled, for, id, placeholder, type_, value)
import Html.Events exposing (onCheck, onClick, onInput)
import Modes
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
                ++ addForm model channel live
                ++ reviewDialog model channel
            )


addForm : Model -> String -> Bool -> List (Html Msg)
addForm model channel live =
    let
        form =
            model.banAdd
    in
    [ section [ class "moderation-desk__ban-add", attribute "data-testid" "ban-add-form" ]
        ([ div [ class "moderation-cockpit__head" ]
            [ h4 [] [ text "Add a timed block" ] ]
         , label [ class "onyx-steward-label", for "ban-add-mask" ] [ text "Mask" ]
         , input
            [ id "ban-add-mask"
            , class "onyx-steward-field"
            , attribute "data-testid" "ban-add-mask"
            , placeholder "nick!user@host"
            , value form.mask
            , disabled form.useExtBan
            , onInput BanAddMask
            ]
            []
         , label [ class "onyx-steward-label", for "ban-add-minutes" ] [ text "Minutes" ]
         , input
            [ id "ban-add-minutes"
            , class "onyx-steward-field"
            , attribute "data-testid" "ban-add-minutes"
            , value form.minutes
            , onInput BanAddMinutes
            ]
            []
         , label [ class "chb-check" ]
            [ input
                [ type_ "checkbox"
                , checked form.useExtBan
                , attribute "data-testid" "ban-add-ext-toggle"
                , onCheck BanAddUseExtBan
                ]
                []
            , span [] [ text "Extended ban ($a/$c/$g/$m/$r/$z/$o)" ]
            ]
         ]
            ++ extBuilder form
            ++ [ if String.isEmpty form.error then
                    text ""

                 else
                    p [ class "moderation-cockpit__hint", attribute "role" "alert", attribute "data-testid" "ban-add-error" ]
                        [ text form.error ]
               , div [ class "onyx-steward-actions" ]
                    [ button
                        [ class "onyx-steward-btn onyx-steward-btn-primary"
                        , attribute "data-testid" "ban-add-submit"
                        , disabled (not live)
                        , onClick (BanAddSubmit channel)
                        ]
                        [ text "Add block" ]
                    ]
               ]
        )
    ]


extBuilder : BanAddForm -> List (Html Msg)
extBuilder form =
    if not form.useExtBan then
        []

    else
        [ label [ class "onyx-steward-label", for "ban-add-ext-type" ] [ text "Type" ]
        , select
            [ id "ban-add-ext-type"
            , class "onyx-steward-field"
            , attribute "data-testid" "ban-add-ext-type"
            , value form.extType
            , onInput BanAddExtType
            ]
            (List.map
                (\t -> option [ value (String.fromChar t) ] [ text (Modes.extBanTypeLabel t) ])
                (String.toList Modes.extBanTypes)
            )
        , label [ class "onyx-steward-label", for "ban-add-ext-pattern" ] [ text "Pattern" ]
        , input
            [ id "ban-add-ext-pattern"
            , class "onyx-steward-field"
            , attribute "data-testid" "ban-add-ext-pattern"
            , placeholder "alice"
            , value form.extPattern
            , onInput BanAddExtPattern
            ]
            []
        , label [ class "chb-check" ]
            [ input
                [ type_ "checkbox"
                , checked form.extNegated
                , attribute "data-testid" "ban-add-ext-negate"
                , onCheck BanAddExtNegated
                ]
                []
            , span [] [ text "Negate ($~…)" ]
            ]
        , p [ class "moderation-cockpit__hint", attribute "data-testid" "ban-add-preview" ]
            [ text
                (case extPreview form of
                    Just mask ->
                        "Will add: " ++ mask

                    Nothing ->
                        "Does not validate — check the type and pattern."
                )
            ]
        ]


extPreview : BanAddForm -> Maybe String
extPreview form =
    let
        banType =
            case String.uncons form.extType of
                Just ( t, _ ) ->
                    t

                Nothing ->
                    'a'
    in
    Modes.buildExtBan form.extNegated banType (String.trim form.extPattern)


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
