module View.Formation exposing (formation)

{-| Start-a-room formation sheet (create mode), mirroring
`src/shell/CreateRoomFormation.tsx`: name + optional skin + hang and
first-line toggles + the 3-person invite loop with the copy-invite
receipt + the shared-receipt finish gate.

Divergences are ports/DOM-shaped and documented: the native share-sheet
button has no port (copy covers the receipt); Enter-to-add on the
invitee field stays a DOM concern; the friend quick-add row has no Elm
friends store yet; the next-hang label renders once `createHangLabel`
is fed (locale formatting stays in JS).
-}

import App exposing (Model, Msg(..), RoomSkin, canFinishCreateRoom, createShareUrl, formationCopy, formationInviteTarget, normalizeCreateRoomName, roomSkins)
import Html exposing (Html, button, details, div, fieldset, form, h2, h3, input, label, legend, li, p, span, summary, text, ul)
import Html.Attributes exposing (attribute, checked, class, disabled, placeholder, type_, value)
import Html.Events exposing (onCheck, onClick, onInput, onSubmit)


formation : Model -> Html Msg
formation model =
    let
        offline =
            model.connection /= App.Live

        channel =
            normalizeCreateRoomName model.createName

        canEnter =
            canFinishCreateRoom model.createSharedInvite && channel /= Nothing
    in
    div [ class "chb-veil" ]
        [ div
            [ class "chb"
            , attribute "role" "dialog"
            , attribute "aria-label" "Start a room"
            ]
            [ div [ class "chb-head" ]
                [ h2 [ class "chb-title" ] [ text "Start a room" ]
                , p [ class "chb-desc" ] [ text "Name it, share the invite with a few people, and walk in together." ]
                , button
                    [ type_ "button"
                    , class "chb-close"
                    , attribute "aria-label" "Close room creation"
                    , onClick CreateRoomClose
                    ]
                    [ text "×" ]
                ]
            , form
                [ class "chb-create"
                , attribute "data-testid" "create-room-formation"
                , onSubmit CreateSubmit
                ]
                [ div [ class "chb-create-header" ]
                    [ span [ class "chb-eyebrow" ] [ text "Create" ]
                    , h2 [] [ text "Start a room" ]
                    , p [ class "chb-create-lead" ]
                        [ text "A room is a shared conversation. Name it, choose an optional look, and share the invite before you enter." ]
                    ]
                , p [ class "chb-create-note" ] [ text formationCopy ]
                , if offline then
                    p [ class "chb-state chb-state--offline", attribute "role" "status" ]
                        [ text "You’re offline. Reconnect to create or join this room. Your form will stay here." ]

                  else
                    text ""
                , case model.createRoomError of
                    Just err ->
                        p [ class "chb-state chb-state--offline", attribute "role" "alert" ] [ text err ]

                    Nothing ->
                        text ""
                , div [ class "chb-field" ]
                    [ label [ attribute "for" "chb-create-name" ] [ text "Room name" ]
                    , p [ class "chb-field-desc" ] [ text "Friends will see this name when they open the invite." ]
                    , input
                        [ type_ "text"
                        , attribute "id" "chb-create-name"
                        , attribute "autocomplete" "off"
                        , placeholder "book club"
                        , value model.createName
                        , onInput CreateNameInput
                        ]
                        []
                    , if String.isEmpty model.createNameError then
                        text ""

                      else
                        p [ class "chb-field-error", attribute "role" "alert" ] [ text model.createNameError ]
                    ]
                , fieldset [ class "chb-skins" ]
                    [ legend [] [ text "Room skin (optional)" ]
                    , div [ class "chb-skins-row", attribute "role" "group", attribute "aria-label" "Room skin" ]
                        (List.map (skinButton model.createSkin) roomSkins)
                    ]
                , label [ class "chb-check" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.createIncludeHang
                        , onCheck CreateHangToggle
                        ]
                        []
                    , span [] [ text ("Suggest a next hang" ++ hangSuffix model.createHangLabel) ]
                    ]
                , label [ class "chb-check" ]
                    [ input
                        [ type_ "checkbox"
                        , checked model.createIncludeFirstLine
                        , onCheck CreateFirstLineToggle
                        ]
                        []
                    , span [] [ text "Leave a first line in the composer" ]
                    ]
                , if model.createIncludeFirstLine then
                    div [ class "chb-field" ]
                        [ label [ attribute "for" "chb-create-first-line" ] [ text "First line" ]
                        , p [ class "chb-field-desc" ] [ text "Optional. You land in the room ready to send it — or you can edit it." ]
                        , input
                            [ type_ "text"
                            , attribute "id" "chb-create-first-line"
                            , attribute "autocomplete" "off"
                            , value model.createFirstLine
                            , onInput CreateFirstLineInput
                            ]
                            []
                        ]

                  else
                    text ""
                , div [ class "chb-invite" ]
                    [ h3 [ class "chb-invite-heading" ] [ text ("Add " ++ String.fromInt formationInviteTarget ++ " people") ]
                    , p [ class "chb-invite-progress", attribute "role" "status" ]
                        [ text
                            (String.fromInt (List.length model.createInvitees)
                                ++ " of "
                                ++ String.fromInt formationInviteTarget
                                ++ " people added."
                                ++ (if model.createSharedInvite then
                                        " Invite shared."

                                    else
                                        " Share the link so they can join."
                                   )
                            )
                        ]
                    , div [ class "chb-invitee-row" ]
                        [ div [ class "chb-field" ]
                            [ label [ attribute "for" "chb-create-invitee" ] [ text "Add someone by name" ]
                            , p [ class "chb-field-desc" ] [ text "A suggested name on their invite. They can still pick their own." ]
                            , input
                                [ type_ "text"
                                , attribute "id" "chb-create-invitee"
                                , attribute "autocomplete" "off"
                                , placeholder "ada"
                                , value model.createInviteeDraft
                                , onInput CreateInviteeInput
                                ]
                                []
                            , if String.isEmpty model.createInviteeError then
                                text ""

                              else
                                p [ class "chb-field-error", attribute "role" "alert" ] [ text model.createInviteeError ]
                            ]
                        , button
                            [ type_ "button"
                            , class "chb-add"
                            , disabled (List.length model.createInvitees >= formationInviteTarget)
                            , onClick CreateInviteeAdd
                            ]
                            [ text "Add" ]
                        ]
                    , if List.isEmpty model.createInvitees then
                        text ""

                      else
                        ul [ class "chb-seats", attribute "aria-label" "People to invite" ]
                            (List.map inviteeSeat model.createInvitees)
                    , div [ class "chb-invite-preview", attribute "role" "group", attribute "aria-label" "Invite link" ]
                        [ p [ class "chb-invite-label" ] [ text "Invite link" ]
                        , p [ class "chb-invite-url" ]
                            [ text
                                (case createShareUrl model of
                                    Just url ->
                                        url

                                    Nothing ->
                                        "Name the room to get a shareable invite."
                                )
                            ]
                        , div [ class "chb-invite-actions" ]
                            [ button
                                [ type_ "button"
                                , class "chb-copy"
                                , disabled (channel == Nothing || model.createCopyBusy)
                                , onClick CreateCopyRequest
                                ]
                                [ text
                                    (if model.createCopyBusy then
                                        "Copying invite link…"

                                     else
                                        "Copy invite"
                                    )
                                ]
                            ]
                        ]
                    , span [ class "sr-only", attribute "role" "status" ] [ text model.createCopyStatus ]
                    ]
                , details [ class "chb-advanced" ]
                    [ summary [] [ text "Advanced" ]
                    , p []
                        [ text "Room rules, keys, and who can join stay in This room after you enter. This form names the place, shares the existing invite link, and opens the composer." ]
                    ]
                , div [ class "chb-create-actions" ]
                    [ button
                        [ type_ "button"
                        , class "chb-ghost"
                        , onClick BrowserOpen
                        ]
                        [ text "Browse rooms" ]
                    , button
                        [ type_ "submit"
                        , class "chb-submit"
                        , disabled (not canEnter || offline)
                        ]
                        [ text "Create and enter room" ]
                    ]
                ]
            ]
        ]


hangSuffix : String -> String
hangSuffix hangLabel =
    if String.isEmpty (String.trim hangLabel) then
        ""

    else
        " · " ++ hangLabel


skinButton : Maybe RoomSkin -> { a | id : RoomSkin, label : String, blurb : String } -> Html Msg
skinButton current option =
    button
        [ type_ "button"
        , class "chb-skin"
        , attribute "aria-label" option.label
        , attribute "aria-pressed" (pressed (current == Just option.id))
        , onClick (CreateSkinToggle option.id)
        ]
        [ span [ class "chb-skin-label" ] [ text option.label ]
        , span [ class "chb-skin-blurb" ] [ text option.blurb ]
        ]


inviteeSeat : String -> Html Msg
inviteeSeat nick =
    li []
        [ span [] [ text nick ]
        , button [ type_ "button", onClick (CreateInviteeRemove nick) ] [ text ("Remove " ++ nick) ]
        ]


pressed : Bool -> String
pressed active =
    if active then
        "true"

    else
        "false"
