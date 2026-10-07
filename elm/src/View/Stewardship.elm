module View.Stewardship exposing (roomCareButton, stewardPanel)

{-| Room-care panel — the room's stewardship surface for 3–30 person
rooms (mirroring `RoomStewardshipSheet.tsx`): one owner, up to two
helpers, accept-to-take handover, owner-only close and delete, and
the last-member dissolve hint.

The panel renders only for the opened room; the roster entry button
gates opening on the 3–30 band like the oracle ribbon item. When the
room was offered to us the panel is the take-view ("Take X?"),
otherwise the management view. Copy is verbatim with
`STEWARDSHIP_COPY`.
-}

import App exposing (ConnectionState(..), Model, Msg(..), StewardView, stewardMembersOf, stewardViewFor, webhookNotices)
import Dict
import Html exposing (Html, button, div, h2, h3, input, label, li, option, p, section, select, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, placeholder, value)
import Html.Events exposing (onClick, onInput)
import Stewardship


{-| Roster-header entry: opens Room care for rooms in the 3–30 band
(mirroring the ribbon `isConsumerStewardshipRoom` gate). -}
roomCareButton : Model -> String -> Html Msg
roomCareButton model channel =
    case Dict.get (String.toLower channel) model.channels of
        Nothing ->
            div [] []

        Just room ->
            if Stewardship.isConsumerStewardshipRoom (Stewardship.memberCount (stewardMembersOf model channel)) then
                button
                    [ class "onyx-roster-care"
                    , attribute "aria-label" ("Room care for " ++ room.name)
                    , attribute "data-testid" "steward-open"
                    , onClick (StewardOpen room.name)
                    ]
                    [ text "Room care" ]

            else
                div [] []


{-| The shell-level Room-care sheet for the opened room. A room that
is gone renders nothing; a room offered to us renders the take-view,
otherwise the management view. -}
stewardPanel : Model -> Html Msg
stewardPanel model =
    case model.stewardRoom of
        Nothing ->
            div [] []

        Just room ->
            case Dict.get (String.toLower room) model.channels of
                Nothing ->
                    div [] []

                Just _ ->
                    let
                        view =
                            stewardViewFor model room
                    in
                    if view.offeredToUs then
                        takeView model view

                    else
                        manageView model view


panelShell : Model -> StewardView -> String -> List (Html Msg) -> Html Msg
panelShell model view title body =
    div [ class "onyx-steward-wrap" ]
        [ section
            [ class "onyx-steward"
            , attribute "role" "dialog"
            , attribute "aria-label" (title ++ " " ++ view.channel)
            , attribute "data-testid" "steward-panel"
            ]
            ([ div [ class "onyx-steward-head" ]
                [ span [ class "onyx-steward-title" ] [ text title ]
                , span [ class "onyx-steward-room" ] [ text view.channel ]
                , button
                    [ class "onyx-steward-close"
                    , attribute "aria-label" "Close Room care"
                    , attribute "data-testid" "steward-close"
                    , onClick StewardClose
                    ]
                    [ text "×" ]
                ]
             ]
                ++ body
            )
        ]


statusLine : Model -> List (Html Msg)
statusLine model =
    if String.isEmpty model.stewardStatus then
        []

    else
        [ p [ class "onyx-steward-status", attribute "role" "status", attribute "data-testid" "steward-status" ]
            [ text model.stewardStatus ]
        ]


{-| "Take X?" — someone offered us the room. Accepting changes
nothing until the owner still grants (mirroring the oracle
take-view). -}
takeView : Model -> StewardView -> Html Msg
takeView model view =
    let
        from =
            case view.offer of
                Just offer ->
                    offer.from

                Nothing ->
                    ""
    in
    panelShell model
        view
        ("Take " ++ view.channel ++ "?")
        [ p [ class "onyx-steward-body" ]
            [ text (from ++ " wants you to take this room. Nothing changes until you accept.") ]
        , div [ class "onyx-steward-actions" ]
            [ button
                [ class "onyx-steward-btn"
                , attribute "data-testid" "steward-decline"
                , onClick (StewardDeclineAndClose view.channel)
                ]
                [ text "Not now" ]
            , button
                [ class "onyx-steward-btn onyx-steward-btn-primary"
                , attribute "data-testid" "steward-accept"
                , disabled (not view.live)
                , onClick (StewardAcceptTransfer view.channel)
                ]
                [ text "Accept" ]
            ]
        ]


manageView : Model -> StewardView -> Html Msg
manageView model view =
    panelShell model
        view
        Stewardship.stewardshipCopy.title
        ([ p [ class "onyx-steward-desc" ] [ text Stewardship.stewardshipCopy.blurb ]
         , p [ class "onyx-steward-ranks", attribute "data-testid" "steward-ranks" ]
            [ text ("Owner: " ++ String.join ", " view.owners ++ " · Helpers: " ++ String.join ", " view.helpers) ]
         ]
            ++ statusLine model
            ++ helperSection model view
            ++ inviteHint view
            ++ transferSection model view
            ++ closeSection model view
            ++ deleteSection model view
            ++ webhookSection model view
            ++ lastMemberHint view
            ++ mismatchHint model view
            ++ [ div [ class "onyx-steward-actions" ]
                    [ button
                        [ class "onyx-steward-btn"
                        , attribute "data-testid" "steward-done"
                        , onClick StewardClose
                        ]
                        [ text "Done" ]
                    ]
               ]
        )


helperSection : Model -> StewardView -> List (Html Msg)
helperSection model view =
    if not view.isOwner then
        []

    else
        [ section [ class "onyx-steward-section" ]
            ([ h3 [ class "onyx-steward-label" ] [ text "People who can help" ]
             , ul [ class "onyx-steward-list" ]
                (List.map (helperRow model view) view.helpers)
             , label [ class "onyx-steward-label", for "steward-helper" ] [ text "Add someone who can help" ]
             , input
                [ id "steward-helper"
                , class "onyx-steward-field"
                , attribute "data-testid" "steward-helper-input"
                , placeholder "Their name"
                , attribute "autocomplete" "off"
                , value model.stewardHelper
                , onInput StewardHelperInput
                ]
                []
             , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn onyx-steward-btn-primary"
                    , attribute "data-testid" "steward-helper-add"
                    , disabled (not view.live || String.isEmpty (String.trim model.stewardHelper))
                    , onClick (StewardAddHelper view.channel)
                    ]
                    [ text "Add" ]
                ]
             ]
            )
        ]


helperRow : Model -> StewardView -> String -> Html Msg
helperRow model view helper =
    li [ class "onyx-steward-item", attribute "data-testid" "steward-helper-row" ]
        [ span [] [ text helper ]
        , button
            [ class "onyx-steward-btn"
            , attribute "data-testid" "steward-helper-remove"
            , attribute "aria-label" ("Remove " ++ helper)
            , disabled (not view.live)
            , onClick (StewardRemoveHelper view.channel helper)
            ]
            [ text "Remove" ]
        ]


inviteHint : StewardView -> List (Html Msg)
inviteHint view =
    if Stewardship.membersCanInvite view.count then
        [ section [ class "onyx-steward-section" ]
            [ p [ class "onyx-steward-body" ] [ text Stewardship.stewardshipCopy.inviteHint ] ]
        ]

    else
        []


transferSection : Model -> StewardView -> List (Html Msg)
transferSection model view =
    if not view.isOwner then
        []

    else
        [ section [ class "onyx-steward-section" ]
            ([ h3 [ class "onyx-steward-label" ] [ text "Hand the room to someone" ]
             , p [ class "onyx-steward-body" ] [ text Stewardship.stewardshipCopy.transferNoTake ]
             ]
                ++ (case view.offer of
                        Nothing ->
                            [ label [ class "onyx-steward-label", for "steward-successor" ] [ text "Who should take it" ]
                            , select
                                [ id "steward-successor"
                                , class "onyx-steward-field"
                                , attribute "data-testid" "steward-successor"
                                , value model.stewardSuccessor
                                , onInput StewardSuccessorInput
                                ]
                                (option [ value "" ] [ text "Choose a person" ]
                                    :: List.map
                                        (\member -> option [ value member.nick ] [ text member.nick ])
                                        (transferCandidates model view)
                                )
                            , div [ class "onyx-steward-actions" ]
                                [ button
                                    [ class "onyx-steward-btn onyx-steward-btn-primary"
                                    , attribute "data-testid" "steward-offer"
                                    , disabled (not view.live || String.isEmpty model.stewardSuccessor)
                                    , onClick (StewardOfferTransfer view.channel)
                                    ]
                                    [ text "Offer" ]
                                ]
                            ]

                        Just offer ->
                            [ p [ class "onyx-steward-status", attribute "data-testid" "steward-transfer-wait" ]
                                [ text
                                    (if offer.accepted then
                                        Stewardship.stewardshipCopy.transferGrant

                                     else
                                        Stewardship.stewardshipCopy.transferWait ++ " Waiting for " ++ offer.to ++ "."
                                    )
                                ]
                            , div [ class "onyx-steward-actions" ]
                                [ button
                                    [ class "onyx-steward-btn onyx-steward-btn-primary"
                                    , attribute "data-testid" "steward-grant"
                                    , disabled (not view.live || not offer.accepted)
                                    , onClick (StewardGrantTransfer view.channel)
                                    ]
                                    [ text "Hand it over" ]
                                , button
                                    [ class "onyx-steward-btn"
                                    , attribute "data-testid" "steward-cancel-offer"
                                    , onClick (StewardDeclineTransfer view.channel)
                                    ]
                                    [ text "Cancel" ]
                                ]
                            ]
                   )
            )
        ]


transferCandidates : Model -> StewardView -> List Stewardship.StewardMember
transferCandidates model view =
    List.filter
        (\member -> Stewardship.nickKey member.nick /= Stewardship.nickKey model.ourNick)
        (stewardMembersOf model view.channel)


closeSection : Model -> StewardView -> List (Html Msg)
closeSection model view =
    if not view.isOwner then
        []

    else if model.stewardClosing then
        [ section [ class "onyx-steward-section" ]
            [ p [ class "onyx-steward-body" ] [ text (Stewardship.closeTitle view.channel) ]
            , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn"
                    , onClick StewardCancelAsk
                    ]
                    [ text "Keep it open" ]
                , button
                    [ class "onyx-steward-btn onyx-steward-btn-danger"
                    , attribute "data-testid" "steward-close-confirm"
                    , disabled (not view.live)
                    , onClick (StewardConfirmClose view.channel)
                    ]
                    [ text Stewardship.stewardshipCopy.closeConfirm ]
                ]
            ]
        ]

    else
        [ section [ class "onyx-steward-section" ]
            [ h3 [ class "onyx-steward-label" ] [ text "Close this room" ]
            , p [ class "onyx-steward-body" ] [ text Stewardship.stewardshipCopy.closeBody ]
            , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn"
                    , attribute "data-testid" "steward-close-ask"
                    , disabled (not view.live)
                    , onClick StewardAskClose
                    ]
                    [ text "Close room" ]
                ]
            ]
        ]


deleteSection : Model -> StewardView -> List (Html Msg)
deleteSection model view =
    if not view.isOwner then
        []

    else
        [ section [ class "onyx-steward-section" ]
            ([ h3 [ class "onyx-steward-label" ] [ text "Delete this room" ]
             , p [ class "onyx-steward-body" ] [ text Stewardship.stewardshipCopy.deleteBody ]
             ]
                ++ (if model.stewardDeleting then
                        [ p [ class "onyx-steward-status", attribute "role" "alert" ]
                            [ text "This permanently removes the room for everyone. To continue, type the exact room name." ]
                        , label [ class "onyx-steward-label", for "steward-delete-name" ]
                            [ text ("Type " ++ view.channel ++ " to delete") ]
                        , input
                            [ id "steward-delete-name"
                            , class "onyx-steward-field"
                            , attribute "data-testid" "steward-delete-name"
                            , attribute "autocomplete" "off"
                            , value model.stewardTypedName
                            , onInput StewardTypedNameInput
                            ]
                            []
                        ]

                    else
                        []
                   )
                ++ [ div [ class "onyx-steward-actions" ]
                        [ button
                            [ class "onyx-steward-btn onyx-steward-btn-danger"
                            , attribute "data-testid" "steward-delete"
                            , disabled
                                (model.stewardDeleting
                                    && (not view.live
                                            || not
                                                (Stewardship.canDeleteRoom
                                                    { actorIsOwner = True
                                                    , typedName = model.stewardTypedName
                                                    , room = view.channel
                                                    }
                                                )
                                       )
                                )
                            , onClick
                                (if model.stewardDeleting then
                                    StewardConfirmDelete view.channel

                                 else
                                    StewardAskDelete
                                )
                            ]
                            [ text
                                (if model.stewardDeleting then
                                    Stewardship.stewardshipCopy.deleteConfirm

                                 else
                                    "Review deletion"
                                )
                            ]
                        ]
                   ]
            )
        ]


{-| Incoming webhooks (mirroring the settings sheet's Integrations
section): owners manage Discord-compatible webhook URLs with the
create/list/delete verbs; everyone else sees the hosts-managed
readonly hint. Recent server notices surface the created URLs,
which the server shows once.
-}
webhookSection : Model -> StewardView -> List (Html Msg)
webhookSection model view =
    if not view.isOwner then
        [ section [ class "onyx-steward-section" ]
            [ h3 [ class "onyx-steward-label" ] [ text "Incoming webhooks" ]
            , p [ class "onyx-steward-body", attribute "data-testid" "steward-webhook-readonly" ]
                [ text "Managed by room hosts. Discord-compatible webhook URLs can post into this room." ]
            ]
        ]

    else
        [ section [ class "onyx-steward-section" ]
            ([ h3 [ class "onyx-steward-label" ] [ text "Incoming webhooks" ]
             , p [ class "onyx-steward-body" ]
                [ text "Discord-compatible webhook URLs can post into this room. The created URL is shown once in server notices." ]
             , label [ class "onyx-steward-label", for "steward-webhook-name" ] [ text "Webhook name" ]
             , input
                [ id "steward-webhook-name"
                , class "onyx-steward-field"
                , attribute "data-testid" "steward-webhook-name"
                , attribute "maxlength" "32"
                , attribute "autocomplete" "off"
                , value model.webhookName
                , onInput WebhookNameInput
                ]
                []
             , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn onyx-steward-btn-primary"
                    , attribute "data-testid" "steward-webhook-create"
                    , disabled (not view.live)
                    , onClick (WebhookCreate view.channel)
                    ]
                    [ text "Create webhook" ]
                , button
                    [ class "onyx-steward-btn"
                    , attribute "data-testid" "steward-webhook-list"
                    , disabled (not view.live)
                    , onClick (WebhookList view.channel)
                    ]
                    [ text "List webhooks" ]
                ]
             , label [ class "onyx-steward-label", for "steward-webhook-delete" ] [ text "Delete webhook id" ]
             , input
                [ id "steward-webhook-delete"
                , class "onyx-steward-field"
                , attribute "data-testid" "steward-webhook-delete-id"
                , attribute "autocomplete" "off"
                , value model.webhookDeleteId
                , onInput WebhookDeleteIdInput
                ]
                []
             , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn onyx-steward-btn-danger"
                    , attribute "data-testid" "steward-webhook-delete"
                    , disabled (not view.live || String.isEmpty (String.trim model.webhookDeleteId))
                    , onClick (WebhookDelete view.channel)
                    ]
                    [ text "Delete webhook" ]
                ]
             ]
                ++ webhookNoticeRows model
            )
        ]


webhookNoticeRows : Model -> List (Html Msg)
webhookNoticeRows model =
    case webhookNotices model of
        [] ->
            []

        notices ->
            [ div [ class "onyx-steward-notices", attribute "aria-live" "polite" ]
                (List.map
                    (\notice ->
                        p [ class "onyx-steward-notice", attribute "data-testid" "steward-webhook-notice" ]
                            [ text notice ]
                    )
                    notices
                )
            ]


lastMemberHint : StewardView -> List (Html Msg)
lastMemberHint view =
    if Stewardship.lastMemberLeaveDissolves view.count then
        [ section [ class "onyx-steward-section" ]
            [ p [ class "onyx-steward-body", attribute "data-testid" "steward-last-member" ]
                [ text Stewardship.stewardshipCopy.lastMember ]
            ]
        ]

    else
        []


mismatchHint : Model -> StewardView -> List (Html Msg)
mismatchHint model view =
    if
        not
            (Stewardship.typedNameMatchesRoom model.stewardTypedName view.channel)
            && not (String.isEmpty (String.trim model.stewardTypedName))
            && view.isOwner
    then
        [ p [ class "onyx-steward-status" ] [ text "Type the room name to delete it." ] ]

    else
        []
