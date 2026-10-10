module View.DmSafety exposing (convoHeader, convoRows, inviteShareSheet)

{-| v3/dmsafety — conversation header row and the Invite friends sheet.

  - DMs: the E2EE posture chip (Private / key changed / Not encrypted),
    the Verify toggle with its in-flow safety-number panel (mirroring
    `shell/DmSafetySheet.tsx`: non-modal, Escape closes, raw keys never
    rendered), and the key-change review as an INLINE row in the
    transcript header (mirroring `shell/DmKeyChangeBanner.tsx`, never a
    toast).
  - Rooms: an "Invite friends" button opening the share sheet
    (mirroring the ribbon overflow `ribbon-invite-friends` entry).
  - `inviteShareSheet` mirrors `shell/RoomInviteShare.tsx`.

-}

import App exposing (ConnectionState(..), Model, Msg(..))
import Dict
import DmSafety exposing (HeaderState(..))
import Html exposing (Html, button, div, h2, node, p, section, small, span, strong, text)
import Html.Attributes exposing (attribute, class, disabled, id, type_)
import Json.Decode
import Html.Events exposing (on, onClick)
import InviteShare
import Json.Decode as Decode
import Set
import View.Sheet as Sheet


{-| The conversation's safety/invite trigger — rendered in the room
header (v3/roomsettings moved it out of the transcript top): rooms get
Invite friends; DMs get the E2EE posture chip and the Verify toggle.
-}
convoHeader : Model -> App.Channel -> Html Msg
convoHeader model channel =
    if App.isChannelName model channel.name then
        roomHeader channel.name

    else
        withPeer model channel (dmHeader model)


{-| The in-flow DM rows that stay at the top of the transcript: the
inline key-change review (never a toast) and the safety-number panel
the header's Verify toggle controls.
-}
convoRows : Model -> App.Channel -> Html Msg
convoRows model channel =
    if App.isChannelName model channel.name then
        text ""

    else
        withPeer model channel (dmRows model)


withPeer : Model -> App.Channel -> (String -> Html Msg) -> Html Msg
withPeer model channel render =
    case App.activeDmPeer model of
        Just peer ->
            if String.toLower peer == String.toLower channel.name then
                render peer

            else
                text ""

        Nothing ->
            text ""



-- ── Room ─────────────────────────────────────────────────────────────


roomHeader : String -> Html Msg
roomHeader name =
    div [ class "onyx-convohead", attribute "role" "group", attribute "aria-label" "Room actions" ]
        [ button
            [ type_ "button"
            , class "onyx-convohead-action"
            , attribute "data-testid" "room-invite-friends"
            , onClick (InviteShareOpen name)
            ]
            [ text "Invite friends" ]
        ]



-- ── DM ───────────────────────────────────────────────────────────────


dmHeader : Model -> String -> Html Msg
dmHeader model peer =
    let
        keys =
            App.sealKeysFor model peer

        keyChanged =
            App.dmKeyChangedFor model peer

        state =
            DmSafety.headerState { keyChanged = keyChanged, sealKeys = keys }

        open =
            DmSafety.isOpenFor peer model.dmSafety
    in
    section
        [ class "onyx-dmsafe"
        , attribute "aria-label" ("Safety number for " ++ peer)
        , attribute "data-testid" "dm-safety"
        ]
        [ div [ class "onyx-dmsafe-bar" ]
            [ stateChip peer state
            , button
                [ type_ "button"
                , class "onyx-dmsafe-trigger"
                , attribute "data-testid" "dm-safety-verify"
                , attribute "aria-expanded" (boolAttr open)
                , attribute "aria-controls" "dm-safety-panel"
                , onClick (DmSafetyToggle peer)
                ]
                [ text DmSafety.dmVerifyAction ]
            ]
        ]


dmRows : Model -> String -> Html Msg
dmRows model peer =
    let
        keys =
            App.sealKeysFor model peer

        keyChanged =
            App.dmKeyChangedFor model peer

        open =
            DmSafety.isOpenFor peer model.dmSafety
    in
    if not keyChanged && not open then
        text ""

    else
        div [ class "onyx-dmsafe onyx-dmsafe-rows" ]
            [ if keyChanged then
                keyChangeRow model peer keys

              else
                text ""
            , if open then
                safetyPanel model peer

              else
                text ""
            ]


stateChip : String -> HeaderState -> Html Msg
stateChip peer state =
    case state of
        Private ->
            span
                [ class "onyx-dmsafe-chip"
                , attribute "data-state" "private"
                , attribute "data-testid" "dm-safety-private"
                , attribute "aria-label" DmSafety.dmPrivateChipLabel
                ]
                [ text DmSafety.dmPrivateChip ]

        KeyChanged ->
            span
                [ class "onyx-dmsafe-chip onyx-dmsafe-chip-warn"
                , attribute "data-state" "key-changed"
                , attribute "data-testid" "dm-safety-keychanged"
                ]
                [ text (DmSafety.dmKeyChangeTitle peer) ]

        Plaintext ->
            span
                [ class "onyx-dmsafe-chip onyx-dmsafe-chip-plain"
                , attribute "data-state" "plaintext"
                , attribute "data-testid" "dm-safety-plaintext"
                , attribute "aria-label" (DmSafety.plaintextChipLabel peer)
                ]
                [ text DmSafety.plaintextChip ]


safetyPanel : Model -> String -> Html Msg
safetyPanel model peer =
    let
        count =
            App.dmPeerDeviceCount model peer

        number =
            DmSafety.currentNumber peer model.dmSafety

        loading =
            case DmSafety.evidenceFor peer model.dmSafety of
                Just ev ->
                    ev.current == DmSafety.Loading

                Nothing ->
                    True

        groups =
            DmSafety.groups number
    in
    div
        [ id "dm-safety-panel"
        , class "onyx-dmsafe-panel"
        , attribute "role" "region"
        , attribute "aria-labelledby" "dm-safety-title"
        , attribute "aria-describedby" "dm-safety-guidance"
        , Html.Events.preventDefaultOn "keydown" (Json.Decode.map (\escMsg -> ( escMsg, True )) (escapeDecoder DmSafetyClose))
        ]
        [ div [ class "onyx-dmsafe-seal", attribute "aria-hidden" "true" ]
            [ span [] [ text "DM" ], span [] [ text (DmSafety.sealDeviceLabel count) ] ]
        , div [ class "onyx-dmsafe-content" ]
            [ div [ class "onyx-dmsafe-head" ]
                [ div []
                    [ p [ class "onyx-dmsafe-kicker" ] [ text "Safety number" ]
                    , h2 [ id "dm-safety-title" ] [ text ("Review this safety number with " ++ peer) ]
                    ]
                , button
                    [ type_ "button"
                    , class "onyx-dmsafe-close"
                    , attribute "aria-label" "Close safety number"
                    , onClick DmSafetyClose
                    ]
                    [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
                ]
            , p [ id "dm-safety-guidance", class "onyx-dmsafe-copy" ]
                [ text
                    ("Compare every group with "
                        ++ peer
                        ++ " in person, on a trusted voice call, or through another channel you already trust. A matching number helps this device to "
                        ++ DmSafety.verifyGuidanceTail count
                        ++ "."
                    )
                ]
            , p [ class "onyx-dmsafe-scope" ] [ text DmSafety.dmPrivacyScope ]
            , div [ class "onyx-dmsafe-ready", attribute "role" "list", attribute "aria-label" "Encryption key readiness" ]
                [ readinessRow "Your device"
                    (if number /= Nothing then
                        "Number available"

                     else
                        "Number unavailable"
                    )
                , readinessRow (peer ++ "'s device keys") (DmSafety.deviceReadiness count)
                , readinessRow ("Review with " ++ peer) "Still required"
                ]
            , div [ class "onyx-dmsafe-number-block" ]
                [ p [ class "onyx-dmsafe-number-label" ] [ text (DmSafety.numberLabel count) ]
                , case ( groups, number ) of
                    ( _ :: _, Just value ) ->
                        node "output"
                            [ class "onyx-dmsafe-number"
                            , attribute "aria-label" (DmSafety.numberAriaLabel peer count value)
                            , attribute "aria-live" "off"
                            , attribute "data-testid" "dm-safety-number"
                            ]
                            (List.indexedMap
                                (\i g ->
                                    span [ class "onyx-dmsafe-group" ]
                                        [ small [ attribute "aria-hidden" "true" ] [ text (String.padLeft 2 '0' (String.fromInt (i + 1))) ]
                                        , text g
                                        ]
                                )
                                groups
                            )

                    _ ->
                        p [ class "onyx-dmsafe-empty", attribute "role" "status", attribute "aria-live" "polite" ]
                            [ text (DmSafety.emptyNumberCopy { name = peer, loading = loading, deviceCount = count }) ]
                ]
            , p [ class "onyx-dmsafe-warning" ]
                [ text
                    ("This number is a review aid, not proof by itself. Until you compare it, treat the identity as unverified. If their device key changes"
                        ++ DmSafety.warningDeviceClause count
                        ++ ", messages stay locked until you review it."
                    )
                ]
            ]
        ]


readinessRow : String -> String -> Html Msg
readinessRow label value =
    div [ class "onyx-dmsafe-ready-row", attribute "role" "listitem" ]
        [ span [] [ text label ], strong [] [ text value ] ]


keyChangeRow : Model -> String -> List String -> Html Msg
keyChangeRow model peer keys =
    let
        key =
            String.toLower peer

        current =
            DmSafety.currentNumber peer model.dmSafety

        pending =
            DmSafety.pendingNumber peer model.dmSafety

        ready =
            DmSafety.evidenceReady peer keys model.dmSafety

        accepting =
            Set.member key model.dmSafety.accepting

        failed =
            Set.member key model.dmSafety.persistFailed

        loadOf pick =
            case DmSafety.evidenceFor peer model.dmSafety of
                Just ev ->
                    pick ev == DmSafety.Loading

                Nothing ->
                    True
    in
    section
        [ class "onyx-keychange"
        , attribute "role" "region"
        , attribute "aria-labelledby" "dm-keychange-title"
        , attribute "data-testid" "dm-keychange"
        ]
        [ span [ class "sr-only", attribute "role" "alert" ] [ text (DmSafety.dmKeyChangeAlert peer) ]
        , div [ class "onyx-keychange-head" ]
            [ div [ class "onyx-keychange-lede" ]
                [ span [ class "onyx-keychange-kicker" ]
                    [ span [ class "ui-icon ui-icon--alert", attribute "aria-hidden" "true" ] [], text "Review needed" ]
                , h2 [ id "dm-keychange-title", class "onyx-keychange-title" ]
                    [ span [ class "onyx-keychange-peer" ] [ text peer ], text "'s device identity changed" ]
                , p [ class "onyx-keychange-sub" ]
                    [ text
                        (DmSafety.dmKeyChangeBody
                            ++ " Compare the current and new safety numbers with "
                            ++ peer
                            ++ " through a trusted channel before accepting. Messages remain locked until you decide."
                        )
                    ]
                , p [ class "onyx-keychange-scope" ] [ text DmSafety.dmPrivacyScope ]
                , if ready then
                    text ""

                  else
                    case DmSafety.keyChangeStateCopy { current = current, pending = pending } of
                        Just copy ->
                            p [ class "onyx-keychange-state", attribute "role" "status" ]
                                ([ text copy ]
                                    ++ (if loadOf .current || loadOf .pending then
                                            []

                                        else
                                            [ text " "
                                            , button
                                                [ type_ "button"
                                                , class "onyx-keychange-retry"
                                                , onClick (DmSafetyRetry peer)
                                                ]
                                                [ text "Try again" ]
                                            ]
                                       )
                                )

                        Nothing ->
                            text ""
                , if failed then
                    p [ class "onyx-keychange-state", attribute "role" "alert" ]
                        [ text "The new key was not saved. Messages remain locked. Try accepting again." ]

                  else
                    text ""
                ]
            , div [ class "onyx-keychange-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-keychange-accept"
                    , attribute "data-testid" "dm-keychange-accept"
                    , disabled (not ready || accepting)
                    , onClick (DmKeyAccept peer)
                    ]
                    [ text (DmSafety.acceptLabel { accepting = accepting, persistFailed = failed }) ]
                , button
                    [ type_ "button"
                    , class "onyx-keychange-dismiss"
                    , attribute "data-testid" "dm-keychange-dismiss"
                    , onClick (DmKeyKeepLocked peer)
                    ]
                    [ text "Keep messages locked" ]
                ]
            ]
        , div [ class "onyx-keychange-compare" ]
            [ safetyColumn "Current (trusted)" "pinned" current (loadOf .current)
            , safetyColumn "New (unverified)" "pending" pending (loadOf .pending)
            ]
        ]


safetyColumn : String -> String -> Maybe String -> Bool -> Html Msg
safetyColumn label tone value loading =
    div [ class "onyx-keychange-col", attribute "data-tone" tone ]
        [ span [ class "onyx-keychange-col-label" ] [ text label ]
        , case DmSafety.groups value of
            [] ->
                p [ class "onyx-keychange-col-empty" ]
                    [ text
                        (if loading then
                            "Computing safety number…"

                         else
                            "Safety number unavailable"
                        )
                    ]

            gs ->
                node "output"
                    [ class "onyx-keychange-fingerprint"
                    , attribute "aria-label" (label ++ " safety number")
                    , attribute "aria-live" "off"
                    ]
                    (List.map (\g -> span [ class "onyx-keychange-group" ] [ text g ]) gs)
        ]



-- ── Invite friends sheet ─────────────────────────────────────────────


inviteShareSheet : Model -> Html Msg
inviteShareSheet model =
    case model.inviteShare of
        Nothing ->
            text ""

        Just sheet ->
            let
                link =
                    App.inviteSharePayload model sheet.channel

                heading =
                    Maybe.withDefault "Onyx" link.card.channel

                topic =
                    if String.isEmpty sheet.channel then
                        ""

                    else
                        Dict.get (String.toLower sheet.channel) model.channels
                            |> Maybe.map (.topic >> String.trim)
                            |> Maybe.withDefault ""
            in
            Sheet.view
                { scope = "room-invite-share"
                , label = Sheet.LabelledBy "invite-share-title"
                , onClose = InviteShareClose
                , placement = Sheet.Center
                , layerClass = "onyx-newmsg onyx-invshare"
                , panelClass = "onyx-newmsg-sheet"
                , backdropClass = "onyx-newmsg-backdrop"
                , layerAttrs = [ attribute "data-testid" "room-invite-share" ]
                , modal = True
                , attrs = [ attribute "aria-describedby" "invite-share-description" ]
                }
                    [ Sheet.headerWith
                        (Sheet.head { scope = "room-invite-share", title = "Invite friends", closeLabel = "Close invite friends", onClose = InviteShareClose }
                            |> (\h -> { h | titleId = Just "invite-share-title", subtitle = Just heading, subtitleId = Just "invite-share-description" })
                        )
                    , p [ class "onyx-invshare-copy" ] [ text InviteShare.introCopy ]
                    , p [ class "onyx-newmsg-help", attribute "role" "status" ]
                        [ text (InviteShare.contextCopy (model.connection == Live)) ]
                    , div [ class "onyx-invshare-preview", attribute "role" "group", attribute "aria-label" "Invite preview" ]
                        [ p [ class "onyx-invshare-label" ] [ text "Room" ]
                        , p [ class "onyx-invshare-room" ] [ text heading ]
                        , if String.isEmpty topic then
                            text ""

                          else
                            p [ class "onyx-invshare-topic" ] [ text topic ]
                        ]
                    , div [ class "onyx-invshare-preview" ]
                        [ p [ class "onyx-invshare-label" ] [ text "Link" ]
                        , p [ class "onyx-invshare-url", attribute "data-testid" "room-invite-share-url" ] [ text link.shareUrl ]
                        ]
                    , div [ class "onyx-newmsg-actions" ]
                        [ button
                            [ type_ "button"
                            , class "onyx-newmsg-primary"
                            , disabled sheet.busy
                            , attribute "aria-busy" (boolAttr sheet.busy)
                            , attribute "data-testid" "room-invite-share-copy"
                            , onClick InviteShareCopy
                            ]
                            [ text (InviteShare.copyBusyLabel sheet.busy) ]
                        ]
                    , p [ class "onyx-newmsg-help" ] [ text InviteShare.fallbackCopy ]
                    , p
                        [ class "onyx-invshare-status"
                        , attribute "role" "status"
                        , attribute "aria-live" "polite"
                        , attribute "aria-atomic" "true"
                        , attribute "data-testid" "room-invite-share-status"
                        ]
                        [ text sheet.status ]
                    ]



-- ── Helpers ──────────────────────────────────────────────────────────


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


escapeDecoder : Msg -> Decode.Decoder Msg
escapeDecoder msg =
    Decode.map2 Tuple.pair
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\( key, composing ) ->
                if key == "Escape" && not composing then
                    Decode.succeed msg

                else
                    Decode.fail "ignored"
            )
