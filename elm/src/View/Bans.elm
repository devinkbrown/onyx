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
import Dict
import Html exposing (Html, button, code, div, h4, input, label, li, option, p, section, select, span, text, ul)
import Html.Attributes exposing (attribute, checked, class, disabled, for, id, placeholder, type_, value)
import Html.Events exposing (onCheck, onClick, onInput)
import Moderation
import Modes
import Prefs
import String


banPanel : Model -> String -> Html Msg
banPanel model channel =
    if not (isChannelOp model channel) then
        -- Non-moderators get the read-only context (mirroring the
        -- cockpit fallback): the boundary copy plus the last known
        -- mode state, and no rule-changing surface.
        div [ class "moderation-cockpit__empty-wrap" ]
            [ p [ class "moderation-cockpit__empty" ]
                [ text "You can view this room’s context, but only room moderators can change its rules or invite people." ]
            , protocolDisclosure model channel
            ]

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
                ++ deskRail model channel live
                ++ statusLine view
                ++ entryList model channel view
                ++ addForm model channel live
                ++ deskForms model channel live
                ++ deskActivity model channel
                ++ [ protocolDisclosure model channel ]
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


{-| Room authority rail — the boundary note, the live
authority facts, and the offline coaching (mirroring the cockpit
`moderation-desk__boundary` rail and offline note).
-}
deskRail : Model -> String -> Bool -> List (Html Msg)
deskRail model channel live =
    [ div [ class "moderation-desk__boundary", attribute "role" "note" ]
        [ span [] [ text "Room moderation" ]
        , span [] [ text "These controls affect this room on the server. Personal mute/block lives in Preferences and only affects your device." ]
        ]
    , div [ class "moderation-desk__rail", attribute "aria-label" "Room authority" ]
        [ div []
            [ span [] [ text "Connected" ]
            , span [] [ text (if live then "Yes" else "No") ]
            ]
        , div []
            [ span [] [ text "Moderator" ]
            , span [] [ text "Yes" ]
            ]
        , div []
            [ span [] [ text "Last room update" ]
            , span [] [ text (deskLastUpdateLabel model channel) ]
            ]
        ]
    ]
        ++ (if live then
                []

            else
                [ p [ class "moderation-desk__offline", attribute "role" "status" ]
                    [ text "Reconnect to send room changes. Drafts stay on this device." ]
                ]
           )


{-| Desk safeguard toggles (mirroring `QUICK_MODES`).
-}
deskToggles : Model -> String -> Bool -> List (Html Msg)
deskToggles model channel live =
    let
        flags =
            case Dict.get (String.toLower channel) model.channels of
                Nothing ->
                    []

                Just room ->
                    (Modes.parseChannelModeString room.modes).flags

        toggle letter label help =
            let
                on =
                    List.member letter flags
            in
            button
                [ type_ "button"
                , class "moderation-cockpit__mode"
                , attribute "data-testid" ("desk-mode-" ++ String.fromChar letter)
                , attribute "aria-pressed" (if on then "true" else "false")
                , disabled (not live)
                , attribute "title" help
                , onClick (ModerationDeskToggleMode channel (String.fromChar letter))
                ]
                [ span [] [ text label ]
                , Html.small [] [ text (if on then "On" else "Off") ]
                ]
    in
    [ div [ class "moderation-cockpit__modes", attribute "role" "group", attribute "aria-label" "Room safeguards" ]
        [ toggle 'm' "Moderated" "Only voiced members and moderators can speak."
        , toggle 'i' "Invite-only" "New people need an invitation to join."
        , toggle 't' "Protected topic" "Only moderators can change the topic."
        ]
    ]


{-| Room-desk moderation forms — the safeguard toggles, the
invite row, and the member-action and ban-mask inputs (mirroring
`ModerationCockpit`; the action and mask forms stage a review
draft rather than sending, while invites and toggles send
directly under the same authority gate).
-}
deskForms : Model -> String -> Bool -> List (Html Msg)
deskForms model channel live =
    deskToggles model channel live
        ++ deskInviteForm model channel live
        ++ deskMemberForm model channel live
        ++ deskBanForm model channel live


deskInviteForm : Model -> String -> Bool -> List (Html Msg)
deskInviteForm model channel live =
    let
        desk =
            model.moderationDesk

        candidates =
            deskCandidates model channel
    in
    [ section [ class "moderation-cockpit__form", attribute "data-testid" "desk-invite-form" ]
        ([ label [ class "onyx-steward-label", for "desk-invite-nick" ] [ text "Invite someone" ]
         , input
            [ id "desk-invite-nick"
            , class "onyx-steward-field"
            , attribute "data-testid" "desk-invite-nick"
            , placeholder "Nickname"
            , attribute "autocomplete" "off"
            , value desk.invite
            , onInput ModerationDeskInvite
            ]
            []
         , button
            [ attribute "data-testid" "desk-invite-submit"
            , disabled (String.trim desk.invite == "" || not live)
            , onClick (ModerationDeskSubmitInvite channel)
            ]
            [ text "Send invite" ]
         ]
            ++ (if List.isEmpty candidates then
                    []

                else
                    [ p [ class "moderation-cockpit__hint" ]
                        [ text ("People here: " ++ String.join ", " candidates) ]
                    ]
               )
        )
    ]


deskBanForm : Model -> String -> Bool -> List (Html Msg)
deskBanForm model channel live =
    let
        desk =
            model.moderationDesk
    in
    [ section [ class "moderation-ban-form", attribute "data-testid" "desk-ban-form" ]
        [ div [ class "moderation-cockpit__head" ]
            [ h4 [] [ text "Block a mask" ] ]
        , label [ class "onyx-steward-label", for "desk-ban-mask" ] [ text "Block an address in this room" ]
        , input
            [ id "desk-ban-mask"
            , class "onyx-steward-field"
            , attribute "data-testid" "desk-ban-mask"
            , placeholder "name!*@*"
            , attribute "autocomplete" "off"
            , value desk.mask
            , onInput ModerationDeskMask
            ]
            []
        , button
            [ attribute "data-testid" "desk-ban-submit"
            , disabled (String.trim desk.mask == "" || not live)
            , onClick (ModerationDeskSubmitBan channel)
            ]
            [ text "Review block" ]
        , p [ class "moderation-cockpit__hint" ]
            [ text "Server-side, persistent until lifted. Review the target and reason before sending." ]
        ]
    ]


deskMemberForm : Model -> String -> Bool -> List (Html Msg)
deskMemberForm model channel live =
    let
        desk =
            model.moderationDesk

        kinds =
            Moderation.kindsForMode (Prefs.experienceModeToString model.prefs.experienceMode)

        candidates =
            deskCandidates model channel

        showReason =
            desk.action == "kick" || desk.action == "ban"
    in
    [ section [ class "moderation-member-form", attribute "data-testid" "desk-member-form" ]
        ([ label [ class "onyx-steward-label", for "desk-member-select" ] [ text "Room member action" ]
         , select
            [ id "desk-member-select"
            , class "onyx-steward-field"
            , attribute "data-testid" "desk-member-select"
            , onInput ModerationDeskMember
            , value desk.member
            ]
            (option [ value "" ] [ text "Choose a member" ]
                :: List.map (\nick -> option [ value nick ] [ text nick ]) candidates
            )
         , select
            [ id "desk-action-select"
            , class "onyx-steward-field"
            , attribute "data-testid" "desk-action-select"
            , attribute "aria-label" "Member action"
            , onInput ModerationDeskAction
            , value desk.action
            ]
            (List.map
                (\kind -> option [ value (Moderation.kindToString kind) ] [ text (Moderation.kindLabel kind) ])
                kinds
            )
         ]
            ++ (if showReason then
                    [ label [ class "onyx-steward-label", for "desk-member-reason" ]
                        [ text "Reason "
                        , span [ class "moderation-desk__optional" ] [ text "optional" ]
                        ]
                    , input
                        [ id "desk-member-reason"
                        , class "onyx-steward-field"
                        , attribute "data-testid" "desk-member-reason"
                        , type_ "text"
                        , attribute "autocomplete" "off"
                        , value desk.reason
                        , onInput ModerationDeskReason
                        ]
                        []
                    , p [ class "moderation-cockpit__hint" ]
                        [ text "No expiry is available for this room action; a moderator can lift a block later." ]
                    ]

                else
                    []
               )
            ++ [ button
                    [ attribute "data-testid" "desk-member-submit"
                    , disabled (String.trim desk.member == "" || not live)
                    , onClick (ModerationDeskSubmitMember channel)
                    ]
                    [ text "Review action" ]
               ]
        )
    ]


{-| Recent server-echoed room activity (mirroring the cockpit
log: only echoed changes appear, newest first, capped at twelve).
-}
deskActivity : Model -> String -> List (Html Msg)
deskActivity model channel =
    let
        key =
            String.toLower (String.trim channel)

        entries =
            model.moderationLog
                |> List.filter (\entry -> String.toLower entry.channel == key)
                |> List.take 12
    in
    [ section [ class "moderation-desk__log", attribute "aria-label" "Recent room activity" ]
        ([ h4 [] [ text "Server activity" ]
         , p [ class "moderation-desk__receipt" ]
            [ text "Only server-echoed changes appear here. A review is a local draft until confirmed." ]
         ]
            ++ (if List.isEmpty entries then
                    [ p [ class "moderation-cockpit__hint" ]
                        [ text "No recent server-echoed moderation activity in this room." ]
                    ]

                else
                    [ ul [ class "moderation-desk__log-list" ]
                        (List.map
                            (\entry -> li [] [ text (entry.by ++ " " ++ String.toLower entry.action ++ " " ++ entry.target) ])
                            entries
                        )
                    ]
               )
        )
    ]


{-| Read-only open-wire mode state (mirroring the cockpit
protocol disclosure).
-}
protocolDisclosure : Model -> String -> Html Msg
protocolDisclosure model channel =
    let
        raw =
            case Dict.get (String.toLower channel) model.channels of
                Nothing ->
                    ""

                Just room ->
                    room.modes
    in
    Html.details [ class "moderation-cockpit__protocol" ]
        [ Html.summary [] [ text "Open-wire details" ]
        , p [] [ text "This is a read-only view of the room’s last known mode state. Changes above wait for a server reply before the interface updates." ]
        , Html.code []
            [ text
                ("MODE "
                    ++ channel
                    ++ " "
                    ++ (if String.trim raw == "" then
                            "(no modes set)"

                        else
                            raw
                       )
                )
            ]
        ]


{-| Last room-update stamp (mirroring `selectLastRoomUpdateAt`:
the ban-list fetch stamp versus the newest log entry, whichever
is later; `None yet` when neither exists, else the message clock).
-}
deskLastUpdateLabel : Model -> String -> String
deskLastUpdateLabel model channel =
    let
        key =
            String.toLower (String.trim channel)

        fromList =
            case Dict.get key model.banListMeta of
                Just meta ->
                    meta.updatedAt

                Nothing ->
                    Nothing

        fromLog =
            List.foldl
                (\entry best ->
                    if String.toLower entry.channel == key then
                        case best of
                            Nothing ->
                                Just entry.at

                            Just top ->
                                Just (max top entry.at)

                    else
                        best
                )
                Nothing
                model.moderationLog

        latest =
            case ( fromList, fromLog ) of
                ( Just a, Just b ) ->
                    Just (max a b)

                ( Just a, Nothing ) ->
                    Just a

                ( Nothing, Just b ) ->
                    Just b

                ( Nothing, Nothing ) ->
                    Nothing
    in
    case latest of
        Nothing ->
            "None yet"

        Just at ->
            App.formatRowClock model.zone model.prefs.clock at


{-| Desk member candidates (mirroring the cockpit `candidates`:
everyone present except ourselves, capped at twelve; Elm sorts
alphabetically where the oracle keeps join order).
-}
deskCandidates : Model -> String -> List String
deskCandidates model channel =
    case Dict.get (String.toLower channel) model.channels of
        Nothing ->
            []

        Just room ->
            room.members
                |> Dict.values
                |> List.map .nick
                |> List.filter (\nick -> String.trim nick /= "" && String.toLower nick /= String.toLower model.ourNick)
                |> List.sort
                |> List.take 12
