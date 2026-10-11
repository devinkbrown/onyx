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

import App exposing (ConnectionState(..), Model, Msg(..), StewardView, stewardMembersOf, stewardViewFor)
import GapPeople
import Dict
import Html exposing (Html, button, div, h2, h3, input, label, li, option, p, section, select, span, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, placeholder, selected, value)
import Html.Events exposing (onClick, onInput)
import Stewardship
import View.Sheet as Sheet


{-| Roster-header entry: opens Room care for rooms in the 3–30 band
(mirroring the ribbon `isConsumerStewardshipRoom` gate). -}
roomCareButton : Model -> String -> Html Msg
roomCareButton model channel =
    case Dict.get (String.toLower channel) model.channels of
        Nothing ->
            div [] []

        Just room ->
            -- v3/gap-people: a room offered to us opens Room care at
            -- any size, so the take view is always reachable.
            if (stewardViewFor model room.name).offeredToUs then
                button
                    [ class "onyx-roster-care onyx-roster-care--offer"
                    , attribute "aria-label" ("Review the offer to take " ++ room.name)
                    , attribute "data-testid" "steward-open"
                    , onClick (StewardOpen room.name)
                    ]
                    [ text "Room offer" ]

            else if Stewardship.isConsumerStewardshipRoom (Stewardship.memberCount (stewardMembersOf model channel)) then
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
    Sheet.view
        { scope = "steward"
        , label = Sheet.Labelled (title ++ " " ++ view.channel)
        , onClose = StewardClose
        , placement = Sheet.Center
        , layerClass = "onyx-steward-wrap"
        , panelClass = "onyx-steward"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" "steward-panel" ]
        }
            ([ Sheet.headerWith
                (Sheet.head { scope = "steward", title = title, closeLabel = "Close Room care", onClose = StewardClose }
                    |> (\h -> { h | kicker = Just view.channel, closeTestId = Just "steward-close" })
                )
             ]
                ++ body
            )


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
        ([ p [ class "onyx-steward-body" ]
            [ text (from ++ " wants you to take this room. Nothing changes until you accept.") ]
         , p [ class "onyx-steward-body onyx-steward-note" ]
            [ text ("Accepting tells " ++ from ++ "; they then hand the room over and you become an owner.") ]
         ]
            ++ statusLine model
            ++ [ div [ class "onyx-steward-actions" ]
                    [ button
                        [ class "onyx-steward-btn"
                        , attribute "data-testid" "steward-decline"
                        , onClick (StewardDeclineAndClose view.channel)
                        ]
                        [ text "Not now" ]
                    , button
                        [ class "onyx-steward-btn onyx-steward-btn-primary"
                        , attribute "data-testid" "steward-accept"
                        , disabled (not view.live || offerAccepted view)
                        , onClick (StewardAcceptTransfer view.channel)
                        ]
                        [ text
                            (if offerAccepted view then
                                "Accepted"

                             else
                                "Accept"
                            )
                        ]
                    ]
               ]
        )


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
            ++ inviteSection view
            ++ transferSection model view
            ++ closeSection model view
            ++ deleteSection model view
            -- v3/gap-people: webhooks moved to Room settings (any host,
            -- any room size); Room care gains Invite and Leave.
            ++ leaveSection model view
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


{-| v3/gap-people — Invite friends from Room care (the hint plus the
invite sheet the room header opens). -}
inviteSection : StewardView -> List (Html Msg)
inviteSection view =
    [ section [ class "onyx-steward-section" ]
        ([ h3 [ class "onyx-steward-label" ] [ text "Invite friends" ] ]
            ++ (if Stewardship.membersCanInvite view.count then
                    [ p [ class "onyx-steward-body" ] [ text Stewardship.stewardshipCopy.inviteHint ] ]

                else
                    []
               )
            ++ [ div [ class "onyx-steward-actions" ]
                    [ button
                        [ class "onyx-steward-btn"
                        , attribute "data-testid" "steward-invite"
                        , onClick (GapPeopleMsg (GapPeople.StewardInvite view.channel))
                        ]
                        [ text "Invite friends" ]
                    ]
               ]
        )
    ]


{-| v3/gap-people — Leave, with a confirm step. Leaving as the last
person dissolves the room; leaving as the owner leaves it without one
unless someone else already owns it. -}
leaveSection : Model -> StewardView -> List (Html Msg)
leaveSection model view =
    let
        consequence =
            if Stewardship.lastMemberLeaveDissolves view.count then
                Stewardship.stewardshipCopy.lastMember

            else if view.isOwner && List.length view.owners <= 1 then
                "You are the only owner. Hand the room to someone first, or it stays without an owner."

            else
                "You can come back unless the room is invite-only or closed."
    in
    if model.stewardLeaving then
        [ section [ class "onyx-steward-section" ]
            [ p [ class "onyx-steward-body", attribute "id" "steward-leave-title" ] [ text ("Leave " ++ view.channel ++ "?") ]
            , p [ class "onyx-steward-status", attribute "role" "alert" ] [ text consequence ]
            , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn"
                    , attribute "data-testid" "steward-leave-cancel"
                    , onClick (GapPeopleMsg GapPeople.StewardCancelLeave)
                    ]
                    [ text "Stay" ]
                , button
                    [ class "onyx-steward-btn onyx-steward-btn-danger"
                    , attribute "data-testid" "steward-leave-confirm"
                    , disabled (not view.live)
                    , onClick (GapPeopleMsg (GapPeople.StewardConfirmLeave view.channel))
                    ]
                    [ text "Leave room" ]
                ]
            ]
        ]

    else
        [ section [ class "onyx-steward-section" ]
            [ h3 [ class "onyx-steward-label" ] [ text "Leave this room" ]
            , div [ class "onyx-steward-actions" ]
                [ button
                    [ class "onyx-steward-btn"
                    , attribute "data-testid" "steward-leave"
                    , disabled (not view.live)
                    , onClick (GapPeopleMsg GapPeople.StewardAskLeave)
                    ]
                    [ text "Leave room" ]
                ]
            ]
        ]


offerAccepted : StewardView -> Bool
offerAccepted view =
    Maybe.map .accepted view.offer |> Maybe.withDefault False


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
                                (option [ attribute "value" "", selected (model.stewardSuccessor == "") ] [ text "Choose a person" ]
                                    :: List.map
                                        (\member -> option [ value member.nick, selected (model.stewardSuccessor == member.nick) ] [ text member.nick ])
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
                            [ p [ class "onyx-steward-status", attribute "data-testid" "steward-transfer-wait", attribute "role" "status" ]
                                [ text
                                    (if offer.accepted then
                                        Stewardship.stewardshipCopy.transferGrant

                                     else
                                        Stewardship.stewardshipCopy.transferWait ++ " Waiting for " ++ offer.to ++ "."
                                    )
                                ]
                            ]
                                ++ (if offer.accepted then
                                        -- v3/gap-people: what "Hand it over" moves.
                                        case App.transferHandoverPlan model view.channel of
                                            Just plan ->
                                                [ p [ class "onyx-steward-body onyx-steward-note", attribute "data-testid" "steward-handover-note" ] [ text plan.note ] ]

                                            Nothing ->
                                                []

                                    else
                                        [ p [ class "onyx-steward-body onyx-steward-note" ]
                                            [ text ("The offer reaches " ++ offer.to ++ " in Onyx while you are both online. If they use another app, cancel and ask them in a message.") ]
                                        ]
                                   )
                                ++ [ div [ class "onyx-steward-actions" ]
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
