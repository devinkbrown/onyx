module View.RoomSettings exposing
    ( bridgeBadge
    , groupControlMark
    , insightsStrip
    , roomSettingsSheet
    , scheduledEventLine
    , settingsToggle
    )

{-| v3/roomsettings — the Room settings sheet (oracle
`shell/ChannelSettings.tsx`) and the small room surfaces of roadmap
3.8 that read the same channel state: the scheduled-event line
(`ScheduledEventLine`), the bridge badge (`BridgeStatusBadge`), the
group-control mark (`GroupControlRoomIndicator`) and the insights
strip (`RoomInsightsStrip`).

The sheet renders through `View.Sheet` (dialog role, focus scope,
Escape) and is registered in `App.overlayStack` as `room-settings`.
Every control writes through `RoomSettingsMsg` (pure core in
`RoomSettings`) or an existing App fold (`RoomNotifyLevel`,
`StewardOpen`). Members see read-only summaries; room hosts (ops and
above, network opers) get the editors.

Not ported here (narrowings, listed in the sheet's own footer): the
invite builder (the header's Invite friends button covers it), local
transcript export, hide / leave, and per-device topic draft
durability.

-}

import App exposing (Model, Msg(..))
import Dict
import GroupControl
import Html exposing (Html, button, details, div, figcaption, figure, form, h3, input, label, li, option, p, section, select, span, strong, summary, text, textarea, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, for, href, id, selected, style, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Ircx
import Json.Decode as Decode
import Modes
import NotifyCenter exposing (NotifyMode(..))
import RoomSettings
import Roster
import Set
import Stats
import Stewardship
import Time
import View.Sheet as Sheet


scope : String
scope =
    "room-settings"


rs : RoomSettings.Msg -> Msg
rs =
    RoomSettingsMsg


{-| The More-menu entry that opens the sheet (rooms only). -}
settingsToggle : Model -> List (Html Msg)
settingsToggle model =
    case (App.roomSettingsCtx model).room of
        Nothing ->
            []

        Just room ->
            [ button
                [ class "onyx-room-settings-toggle"
                , attribute "aria-label" ("Room settings for " ++ room.name)
                , attribute "data-testid" "ribbon-room-settings"
                , attribute "aria-haspopup" "dialog"
                , onClick (rs RoomSettings.Open)
                ]
                [ text "Room settings" ]
            ]



-- SHEET


roomSettingsSheet : Model -> Html Msg
roomSettingsSheet model =
    let
        ctx =
            App.roomSettingsCtx model
    in
    case ( RoomSettings.isOpenFor model.activeChannel model.roomSettings, ctx.room ) of
        ( True, Just room ) ->
            Sheet.view
                { scope = scope
                , label = Sheet.LabelledBy (Sheet.titleId scope)
                , onClose = rs RoomSettings.Close
                , placement = Sheet.Side
                , layerClass = ""
                , panelClass = "rset"
                , backdropClass = ""
                , layerAttrs = []
                , modal = True
                , attrs = [ attribute "data-testid" "channel-settings" ]
                }
                [ Sheet.header
                    { scope = scope
                    , title = "Room settings"
                    , closeLabel = "Close room settings"
                    , onClose = rs RoomSettings.Close
                    , closeTestId = Just "channel-settings-close"
                    }
                , p [ class "rset-room" ] [ text (String.dropLeft 1 room.name) ]
                , contextLine ctx
                , topicSection model ctx room
                , notifySection model room
                , details [ class "rset-advanced" ]
                    [ summary [] [ text "Advanced" ]
                    , p [ class "rset-hint" ] [ text "Room rules, roles, insights, and integrations. Everyday alerts stay above." ]
                    , rulesSection model ctx room
                    , retentionSection model ctx room
                    , rolesSection model ctx room
                    , encryptionSection model ctx room
                    , historySection model ctx room
                    , sectionWith "insights" "Public insights" [ insightsStrip model room.name ]
                    , integrationsSection model ctx room
                    ]
                , notPorted
                ]

        _ ->
            text ""


contextLine : RoomSettings.Ctx -> Html Msg
contextLine ctx =
    div [ class "rset-context", attribute "role" "status", attribute "aria-live" "polite" ]
        [ span []
            [ text
                (if ctx.connected then
                    "Changes apply to this room"

                 else
                    "Offline — changes wait for reconnect"
                )
            ]
        , span [ class "rset-context-state", attribute "data-testid" "chset-access-state" ]
            [ text
                (if ctx.isOp then
                    "Host access"

                 else
                    "Member access"
                )
            ]
        ]


notPorted : Html Msg
notPorted =
    p [ class "rset-hint rset-footnote", attribute "data-testid" "chset-not-ported" ]
        [ text "Invite links live on the room header (Invite friends). Transcript export, hide and leave are not in this sheet yet." ]


sectionWith : String -> String -> List (Html Msg) -> Html Msg
sectionWith key heading body =
    section [ class "rset-section", attribute "aria-labelledby" ("chset-" ++ key ++ "-heading") ]
        (h3 [ id ("chset-" ++ key ++ "-heading"), class "rset-heading" ] [ text heading ] :: body)


readonly : String -> String -> String -> String -> Html Msg
readonly testId labelText valueText hint =
    div [ class "rset-readonly", attribute "data-testid" testId ]
        [ p [ class "rset-readonly-label" ] [ text labelText ]
        , p [ class "rset-readonly-value" ] [ text valueText ]
        , p [ class "rset-hint" ] [ text hint ]
        ]


changeTo : (String -> Msg) -> Html.Attribute Msg
changeTo toMsg =
    on "change" (Decode.map toMsg (Decode.at [ "target", "value" ] Decode.string))


selectField : { id : String, current : String, options : List ( String, String ), toMsg : String -> Msg, describedBy : String } -> Html Msg
selectField cfg =
    select
        [ id cfg.id
        , class "rset-select"
        , value cfg.current
        , attribute "aria-describedby" cfg.describedBy
        , changeTo cfg.toMsg
        ]
        (List.map
            (\( v, l ) -> option [ value v, selected (v == cfg.current) ] [ text l ])
            cfg.options
        )


applyButton : String -> String -> Bool -> Html Msg
applyButton testId label_ isDisabled =
    button [ type_ "submit", class "rset-btn", attribute "data-testid" testId, disabled isDisabled ] [ text label_ ]



-- Topic


topicSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
topicSection model ctx room =
    let
        draft =
            model.roomSettings.topicDraft
    in
    sectionWith "topic" "Topic" <|
        if RoomSettings.canEditTopic ctx room then
            [ form [ class "rset-form", onSubmit (rs RoomSettings.TopicSubmit) ]
                [ label [ class "rset-label", for "chset-topic-input" ] [ text "Topic text" ]
                , textarea
                    [ id "chset-topic-input"
                    , class "rset-textarea"
                    , attribute "rows" "3"
                    , attribute "aria-describedby" "chset-topic-hint"
                    , attribute "data-testid" "chset-topic-input"
                    , value draft
                    , onInput (rs << RoomSettings.TopicInput)
                    ]
                    []
                , p [ id "chset-topic-hint", class "rset-hint" ]
                    [ text
                        (if not ctx.connected then
                            "Offline: topic changes can be saved after reconnect."

                         else if RoomSettings.topicLocked room then
                            "Topic-locked: your host rank lets you edit it."

                         else
                            "Press Save to update the room topic."
                        )
                    ]
                , div [ class "rset-actions" ]
                    [ button
                        [ type_ "submit"
                        , class "rset-btn rset-btn-primary"
                        , attribute "data-testid" "chset-topic-save"
                        , disabled (draft == room.topic || not ctx.connected)
                        ]
                        [ text "Save topic" ]
                    ]
                ]
            ]

        else
            [ readonly "chset-topic-readonly"
                "Topic"
                (if String.isEmpty room.topic then
                    "No topic set"

                 else
                    room.topic
                )
                "This room is topic-locked. Only room hosts can change the topic."
            ]



-- Notifications (the notify slice's per-room level, as the oracle select)


notifySection : Model -> RoomSettings.Room -> Html Msg
notifySection model room =
    let
        current =
            NotifyCenter.levelOfMode (NotifyCenter.modeOfLevel (App.notifyLevel model room.name))

        labelOf mode =
            case mode of
                NotifyAll ->
                    "All messages"

                NotifyMentions ->
                    "Mentions only"

                NotifyMute ->
                    "Mute"
    in
    sectionWith "notify" "Notifications" <|
        [ div [ class "rset-form" ]
            [ label [ class "rset-label", for "chset-notify" ] [ text ("Notifications for " ++ room.name) ]
            , selectField
                { id = "chset-notify"
                , current = current
                , options = List.map (\o -> ( NotifyCenter.levelOfMode o.mode, labelOf o.mode )) NotifyCenter.notifyOptions
                , toMsg = \level -> RoomNotifyLevel { channel = room.name, level = level }
                , describedBy = "chset-notify-hint"
                }
            , p [ id "chset-notify-hint", class "rset-hint" ]
                [ text "Your own alerts for this room on this device. All messages notify. Mentions only still badges @. Mute is hard silence — you will not be tapped: no badge, no OS ping, no digest highlight." ]
            ]
        ]



-- Room rules (modes)


rulesSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
rulesSection model ctx room =
    let
        flags =
            (Modes.parseChannelModeString room.modes).flags
    in
    sectionWith "modes" "Room rules" <|
        if not ctx.isOp then
            [ readonly "chset-rules-readonly" "Current rules" (RoomSettings.modeSummary room) "Only room hosts can change these rules." ]

        else
            [ ul [ class "rset-flags", attribute "role" "group", attribute "aria-label" "Room mode flags" ]
                (List.map
                    (\f ->
                        let
                            isOn =
                                List.member f.letter flags
                        in
                        li [ class "rset-flag" ]
                            [ button
                                [ type_ "button"
                                , attribute "role" "switch"
                                , attribute "aria-checked" (boolAttr isOn)
                                , attribute "data-testid" ("chset-flag-" ++ String.fromChar f.letter)
                                , classList [ ( "rset-toggle", True ), ( "rset-toggle-on", isOn ) ]
                                , disabled (not ctx.connected)
                                , onClick (rs (RoomSettings.FlagToggle f.letter))
                                ]
                                [ span [ class "rset-toggle-track", attribute "aria-hidden" "true" ] [ span [ class "rset-toggle-thumb" ] [] ]
                                , span [ class "rset-toggle-text" ]
                                    [ span [ class "rset-toggle-label" ] [ text f.label ]
                                    , span [ class "rset-hint" ] [ text f.hint ]
                                    ]
                                ]
                            ]
                    )
                    RoomSettings.flagToggles
                )
            , form [ class "rset-form", onSubmit (rs RoomSettings.KeySubmit) ]
                [ label [ class "rset-label", for "chset-key" ] [ text "Join key" ]
                , input
                    [ id "chset-key"
                    , class "rset-input"
                    , type_ "text"
                    , attribute "autocomplete" "off"
                    , attribute "aria-describedby" "chset-key-hint"
                    , value model.roomSettings.keyDraft
                    , onInput (rs << RoomSettings.KeyInput)
                    ]
                    []
                , p [ id "chset-key-hint", class "rset-hint" ] [ text "People must supply this key to join. Leave blank to remove." ]
                , applyButton "chset-key-apply" "Apply key" (not ctx.connected)
                ]
            , form [ class "rset-form", onSubmit (rs RoomSettings.LimitSubmit) ]
                [ label [ class "rset-label", for "chset-limit" ] [ text "Member limit" ]
                , input
                    [ id "chset-limit"
                    , class "rset-input"
                    , type_ "number"
                    , attribute "min" "1"
                    , attribute "inputmode" "numeric"
                    , attribute "aria-describedby" "chset-limit-hint"
                    , value model.roomSettings.limitDraft
                    , onInput (rs << RoomSettings.LimitInput)
                    ]
                    []
                , p [ id "chset-limit-hint", class "rset-hint" ] [ text "Maximum people allowed. Leave blank to remove." ]
                , applyButton "chset-limit-apply" "Apply limit" (not ctx.connected)
                ]
            ]



-- History retention (EPHEMERAL)


retentionSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
retentionSection model ctx room =
    let
        current =
            RoomSettings.ephemeralSecondsOf room.props

        draft =
            model.roomSettings.ephemeralDraft
    in
    sectionWith "retention" "History" <|
        if not ctx.isOp then
            [ readonly "chset-retention-readonly" "Ephemeral history" (RoomSettings.formatEphemeral current) "Only room hosts can change history retention." ]

        else
            [ form [ class "rset-form", onSubmit (rs RoomSettings.EphemeralSubmit) ]
                [ label [ class "rset-label", for "chset-ephemeral" ] [ text "Ephemeral history" ]
                , selectField
                    { id = "chset-ephemeral"
                    , current = draft
                    , options = List.map (\p_ -> ( String.fromInt p_.seconds, p_.label )) RoomSettings.ephemeralPresets
                    , toMsg = rs << RoomSettings.EphemeralInput
                    , describedBy = "chset-ephemeral-hint"
                    }
                , p [ id "chset-ephemeral-hint", class "rset-hint" ]
                    [ text "When enabled, replay and search omit messages older than this window, and room stats skip new messages." ]
                , applyButton "chset-ephemeral-apply" "Apply retention" (not ctx.connected || draft == String.fromInt (Maybe.withDefault 0 current))
                ]
            ]



-- Roles: who holds them (words), plus the IRCX ACCESS list for hosts


rolesSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
rolesSection model ctx room =
    sectionWith "access" "Roles" <|
        holders model room
            :: (if not ctx.isOp then
                    [ readonly "chset-access-readonly"
                        "Persistent access list"
                        "Managed by room hosts."
                        "Access entries grant founder, owner, host, or voice on join — or deny/grant masks."
                    ]

                else
                    accessManager model ctx room
               )


{-| Who is Owner / Op / Voice right now, as words (never prefix
symbols or mode letters). Plain members are counted, not listed.
-}
holders : Model -> RoomSettings.Room -> Html Msg
holders model room =
    let
        members =
            Dict.get (String.toLower room.name) model.channels
                |> Maybe.map (.members >> Dict.values)
                |> Maybe.withDefault []

        groups =
            Roster.groupMembers model.isupport.prefixOrder model.isupport.modeToPrefix members

        ranked =
            List.filter (\g -> g.key /= "member") groups

        plain =
            groups
                |> List.filter (\g -> g.key == "member")
                |> List.concatMap .members
                |> List.length
    in
    div [ class "rset-roles", attribute "data-testid" "chset-roles" ]
        [ if List.isEmpty ranked then
            p [ class "rset-hint" ] [ text "No one holds a room role yet." ]

          else
            ul [ class "rset-roles-list", attribute "aria-label" "Room roles" ]
                (List.map
                    (\g ->
                        li [ class "rset-roles-row" ]
                            [ span [ class "rset-roles-label" ] [ text g.label ]
                            , span [ class "rset-roles-names" ] [ text (String.join ", " (List.map (.member >> .nick) g.members)) ]
                            ]
                    )
                    ranked
                )
        , p [ class "rset-hint" ]
            [ text
                (String.fromInt plain
                    ++ (if plain == 1 then
                            " member without a role"

                        else
                            " members without a role"
                       )
                )
            ]
        ]


accessManager : Model -> RoomSettings.Ctx -> RoomSettings.Room -> List (Html Msg)
accessManager model ctx room =
    let
        key =
            String.toLower room.name

        entries =
            Ircx.sortAccessEntries (Maybe.withDefault [] (Dict.get key model.access.lists))

        loading =
            Set.member key model.access.loading

        draftLevel =
            Ircx.parseAccessLevel (Just model.roomSettings.accessLevelDraft)
                |> Maybe.withDefault Ircx.Host

        levels =
            [ Ircx.Founder, Ircx.Owner, Ircx.Host, Ircx.Voice, Ircx.Grant, Ircx.Deny ]
    in
    [ div [ class "rset-actions" ]
        [ button
            [ type_ "button"
            , class "rset-btn"
            , attribute "data-testid" "chset-access-refresh"
            , attribute "aria-busy" (boolAttr loading)
            , disabled (not ctx.connected || loading)
            , onClick (rs RoomSettings.AccessRefresh)
            ]
            [ text
                (if loading then
                    "Loading access list…"

                 else
                    "Refresh list"
                )
            ]
        ]
    , if List.isEmpty entries then
        p [ class "rset-hint", attribute "data-testid" "chset-access-empty" ]
            [ text
                (if loading then
                    "Loading access entries…"

                 else
                    "No access entries yet. Add a name or hostmask below."
                )
            ]

      else
        ul [ class "rset-access-list", attribute "aria-label" "Room access entries" ]
            (List.map
                (\entry ->
                    let
                        entryLevel =
                            levelName entry.level
                    in
                    li [ class "rset-access-row" ]
                        [ div [ class "rset-access-meta" ]
                            [ span [ class "rset-access-level" ] [ text (Ircx.accessLevelLabel entry.level) ]
                            , span [ class "rset-mono" ] [ text entry.mask ]
                            , span [ class "rset-hint" ]
                                [ text
                                    (Ircx.formatAccessDuration entry.duration
                                        ++ (case entry.setBy of
                                                Just by ->
                                                    " · set by " ++ by

                                                Nothing ->
                                                    ""
                                           )
                                    )
                                ]
                            ]
                        , button
                            [ type_ "button"
                            , class "rset-btn"
                            , disabled (not ctx.connected)
                            , attribute "aria-label" ("Remove " ++ entryLevel ++ " access for " ++ entry.mask)
                            , onClick (rs (RoomSettings.AccessRemove { level = entryLevel, mask = entry.mask }))
                            ]
                            [ text "Remove" ]
                        ]
                )
                entries
            )
    , form [ class "rset-form", onSubmit (rs RoomSettings.AccessSubmit) ]
        ([ label [ class "rset-label", for "chset-access-level" ] [ text "Role level" ]
         , selectField
            { id = "chset-access-level"
            , current = levelName draftLevel
            , options = List.map (\l -> ( levelName l, Ircx.accessLevelLabel l )) levels
            , toMsg = rs << RoomSettings.AccessLevelInput
            , describedBy = "chset-access-level-hint"
            }
         , p [ id "chset-access-level-hint", class "rset-hint" ] [ text (Ircx.accessLevelHint draftLevel) ]
         , label [ class "rset-label", for "chset-access-mask" ] [ text "Name or hostmask" ]
         , input
            [ id "chset-access-mask"
            , class "rset-input"
            , type_ "text"
            , attribute "autocomplete" "off"
            , attribute "maxlength" "128"
            , attribute "aria-describedby" "chset-access-mask-hint"
            , value model.roomSettings.accessMaskDraft
            , onInput (rs << RoomSettings.AccessMaskInput)
            ]
            []
         , p [ id "chset-access-mask-hint", class "rset-hint" ] [ text "Bare names expand to name!*@*. Full masks use name!user@host." ]
         , label [ class "rset-label", for "chset-access-timeout" ] [ text "Timeout seconds (optional)" ]
         , input
            [ id "chset-access-timeout"
            , class "rset-input"
            , type_ "number"
            , attribute "min" "1"
            , attribute "inputmode" "numeric"
            , attribute "aria-describedby" "chset-access-timeout-hint"
            , value model.roomSettings.accessTimeoutDraft
            , onInput (rs << RoomSettings.AccessTimeoutInput)
            ]
            []
         , p [ id "chset-access-timeout-hint", class "rset-hint" ] [ text "Leave blank for a permanent entry." ]
         ]
            ++ (case model.roomSettings.accessError of
                    Just err ->
                        [ p [ class "rset-hint rset-error", attribute "role" "alert" ] [ text err ] ]

                    Nothing ->
                        []
               )
            ++ [ button
                    [ type_ "submit"
                    , class "rset-btn rset-btn-primary"
                    , attribute "data-testid" "chset-access-add"
                    , disabled (not ctx.connected)
                    ]
                    [ text "Add access entry" ]
               ]
        )
    ]


levelName : Ircx.AccessLevel -> String
levelName level =
    case level of
        Ircx.Founder ->
            "FOUNDER"

        Ircx.Owner ->
            "OWNER"

        Ircx.Host ->
            "HOST"

        Ircx.Voice ->
            "VOICE"

        Ircx.Grant ->
            "GRANT"

        Ircx.Deny ->
            "DENY"



-- Encryption (policy prop + the group-control mark)


encryptionSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
encryptionSection model ctx room =
    let
        current =
            RoomSettings.encryptionPolicyOf room.props

        labelFor v =
            List.filter (\e -> e.value == v) RoomSettings.encryptionPolicies
                |> List.head
                |> Maybe.map .label
                |> Maybe.withDefault "Off"

        hintFor v =
            List.filter (\e -> e.value == v) RoomSettings.encryptionPolicies
                |> List.head
                |> Maybe.map .hint
                |> Maybe.withDefault ""

        draft =
            model.roomSettings.encryptionDraft
    in
    sectionWith "encryption" "Encryption" <|
        (if not ctx.isOp then
            readonly "chset-encryption-readonly" "Message policy" (labelFor current) "Only room hosts can change the room encryption policy."

         else
            form [ class "rset-form", onSubmit (rs RoomSettings.EncryptionSubmit) ]
                [ label [ class "rset-label", for "chset-encryption" ] [ text "Message policy" ]
                , selectField
                    { id = "chset-encryption"
                    , current = draft
                    , options = List.map (\e -> ( e.value, e.label )) RoomSettings.encryptionPolicies
                    , toMsg = rs << RoomSettings.EncryptionInput
                    , describedBy = "chset-encryption-hint"
                    }
                , p [ id "chset-encryption-hint", class "rset-hint" ] [ text (hintFor draft) ]
                , applyButton "chset-encryption-apply" "Apply policy" (not ctx.connected || draft == current)
                ]
        )
            :: groupControlIndicator model room.name


-- History visibility (history-policy prop)


historySection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
historySection model ctx room =
    let
        current =
            RoomSettings.historyPolicyOf room.props

        find v =
            List.filter (\e -> e.value == v) RoomSettings.historyPolicies |> List.head

        draft =
            model.roomSettings.historyDraft
    in
    sectionWith "history" "History visibility" <|
        if not ctx.isOp then
            [ readonly "chset-history-readonly"
                "Who can request history"
                (find current |> Maybe.map .label |> Maybe.withDefault "Public")
                "Only room hosts can change the room history policy."
            ]

        else
            [ form [ class "rset-form", onSubmit (rs RoomSettings.HistorySubmit) ]
                [ label [ class "rset-label", for "chset-history" ] [ text "Who can request history" ]
                , selectField
                    { id = "chset-history"
                    , current = draft
                    , options = List.map (\e -> ( e.value, e.label )) RoomSettings.historyPolicies
                    , toMsg = rs << RoomSettings.HistoryInput
                    , describedBy = "chset-history-hint"
                    }
                , p [ id "chset-history-hint", class "rset-hint" ] [ text (find draft |> Maybe.map .hint |> Maybe.withDefault "") ]
                , applyButton "chset-history-apply" "Apply history policy" (not ctx.connected || draft == current)
                ]
            ]



-- Integrations (bridge status + webhooks via Room care)


integrationsSection : Model -> RoomSettings.Ctx -> RoomSettings.Room -> Html Msg
integrationsSection model ctx room =
    let
        careBand =
            Stewardship.isConsumerStewardshipRoom (Stewardship.memberCount (App.stewardMembersOf model room.name))
    in
    sectionWith "integrations" "Integrations" <|
        [ div [ class "rset-readonly" ]
            [ p [ class "rset-readonly-label" ] [ text "Bridge status" ]
            , bridgeBadgeFull (RoomSettings.bridgeStatusOf room.props)
            ]
        , div [ class "rset-readonly", attribute "data-testid" "chset-webhooks" ]
            ([ p [ class "rset-readonly-label" ] [ text "Incoming webhooks" ] ]
                ++ (if ctx.isOp && careBand then
                        [ p [ class "rset-hint" ] [ text "Discord-compatible webhook URLs are managed in Room care." ]
                        , button
                            [ type_ "button"
                            , class "rset-btn"
                            , attribute "data-testid" "chset-webhooks-open"
                            , onClick (StewardOpen room.name)
                            ]
                            [ text "Open Room care" ]
                        ]

                    else
                        [ p [ class "rset-readonly-value" ] [ text "Managed by room hosts." ]
                        , p [ class "rset-hint" ] [ text "Discord-compatible webhook URLs can post into this room." ]
                        ]
                   )
            )
        ]



-- 3.8 — BRIDGE BADGE


{-| Header badge: only when a bridge is advertised (the sheet's
Integrations section shows the full badge, "No bridge" included).
-}
bridgeBadge : Model -> String -> Html Msg
bridgeBadge model channel =
    let
        status =
            RoomSettings.bridgeStatusOf (propsOf model channel)
    in
    if status.bridged then
        span
            [ class "rset-bridge rset-bridge-compact"
            , attribute "data-testid" "bridge-badge"
            , attribute "data-state" (bridgeStateKey status.state)
            , attribute "aria-label" (RoomSettings.bridgeAria status)
            , attribute "title" (RoomSettings.bridgeAria status)
            ]
            [ span [ class "rset-bridge-dot", attribute "aria-hidden" "true" ] []
            , span [] [ text (RoomSettings.bridgeLabel status) ]
            ]

    else
        text ""


bridgeBadgeFull : RoomSettings.BridgeStatus -> Html Msg
bridgeBadgeFull status =
    span
        [ class "rset-bridge"
        , attribute "data-testid" "chset-bridge"
        , attribute "data-bridged" (boolAttr status.bridged)
        , attribute "data-state" (bridgeStateKey status.state)
        , attribute "role" "status"
        , attribute "aria-live" "polite"
        , attribute "aria-atomic" "true"
        , attribute "tabindex" "0"
        , attribute "aria-label" (RoomSettings.bridgeAria status)
        , attribute "title" (RoomSettings.bridgeAria status)
        ]
        ([ span [ class "rset-bridge-dot", attribute "aria-hidden" "true" ] []
         , span [ class "rset-bridge-copy" ]
            [ span [ class "rset-bridge-label" ] [ text (RoomSettings.bridgeLabel status) ]
            , span [ class "rset-hint" ] [ text (RoomSettings.bridgeAction status) ]
            ]
         ]
            ++ (case ( status.bridged, status.lastSeen ) of
                    ( True, Just seen ) ->
                        [ span [ class "rset-hint" ] [ text seen ] ]

                    _ ->
                        []
               )
        )


bridgeStateKey : RoomSettings.BridgeState -> String
bridgeStateKey state =
    case state of
        RoomSettings.BridgeUp ->
            "up"

        RoomSettings.BridgeDown ->
            "down"

        RoomSettings.BridgeDegraded ->
            "degraded"



-- 3.8 — GROUP-CONTROL MARK


groupStatus : Model -> String -> Maybe GroupControl.RoomStatus
groupStatus model channel =
    Dict.get (String.toLower channel) model.groupRooms |> Maybe.map .status


{-| Compact header mark: only once the room has a group-control
projection (an unconfigured room stays quiet in the header; the
sheet's Encryption section always shows the full indicator).
-}
groupControlMark : Model -> String -> Html Msg
groupControlMark model channel =
    case groupStatus model channel of
        Nothing ->
            text ""

        Just status ->
            case
                RoomSettings.groupMark
                    { isChannel = App.isChannelName model channel
                    , authenticated = model.accountName /= Nothing
                    , status = Just status
                    }
            of
                Just mark ->
                    span
                        [ class "rset-group-mark"
                        , attribute "data-testid" "group-control-mark"
                        , attribute "data-state" mark.state
                        , attribute "aria-label" (mark.protection ++ ". " ++ mark.detail ++ ".")
                        , attribute "title" mark.detail
                        ]
                        [ span [ attribute "aria-hidden" "true" ] [ text "◇" ]
                        , span [ class "rset-group-mark-word" ] [ text "Room controls" ]
                        ]

                Nothing ->
                    text ""


groupControlIndicator : Model -> String -> List (Html Msg)
groupControlIndicator model channel =
    case
        RoomSettings.groupMark
            { isChannel = App.isChannelName model channel
            , authenticated = model.accountName /= Nothing
            , status = groupStatus model channel
            }
    of
        Just mark ->
            [ div
                [ class "rset-group-indicator"
                , attribute "data-testid" "group-control-room-indicator"
                , attribute "data-state" mark.state
                , attribute "aria-label" (mark.protection ++ ". " ++ mark.detail ++ ".")
                ]
                [ span [ attribute "aria-hidden" "true" ] [ text "◇" ]
                , span [ class "rset-group-indicator-label" ] [ text mark.protection ]
                , span [ class "rset-hint", attribute "aria-live" "polite", attribute "aria-atomic" "true" ] [ text mark.detail ]
                ]
            ]

        Nothing ->
            []



-- 3.8 — SCHEDULED EVENT LINE


scheduledEventLine : Model -> String -> Html Msg
scheduledEventLine model channel =
    case RoomSettings.scheduledEventOf (propsOf model channel) of
        Nothing ->
            text ""

        Just event ->
            if not (RoomSettings.eventVisible event model.nowMs) then
                text ""

            else
                let
                    startMs =
                        event.at * 1000

                    live =
                        model.nowMs >= startMs

                    inCall =
                        Maybe.map String.toLower model.calls.channel == Just (String.toLower channel)

                    canManage =
                        App.isChannelOp model channel
                in
                div
                    [ classList [ ( "rset-event", True ), ( "rset-event-live", live ) ]
                    , attribute "data-testid" "scheduled-event"
                    , attribute "role" "region"
                    , attribute "aria-label" ("Scheduled event: " ++ event.title)
                    ]
                    ([ span [ class "rset-event-main" ]
                        [ span [ class "rset-event-title" ] [ text event.title ]
                        , span [ class "rset-hint" ]
                            [ text (whenLabel model.zone (round startMs) ++ " · ")
                            , strong [] [ text (RoomSettings.eventCountdown event model.nowMs) ]
                            ]
                        ]
                     ]
                        ++ (if live && not inCall then
                                [ button
                                    [ type_ "button"
                                    , class "rset-btn"
                                    , attribute "data-testid" "scheduled-event-join"
                                    , onClick (CallJoin { channel = channel, video = False })
                                    ]
                                    [ text "Join call" ]
                                ]

                            else
                                []
                           )
                        ++ (if canManage then
                                [ button
                                    [ type_ "button"
                                    , class "rset-btn rset-event-clear"
                                    , attribute "aria-label" "Clear scheduled event"
                                    , attribute "title" "Clear event"
                                    , attribute "data-testid" "scheduled-event-clear"
                                    , onClick (rs RoomSettings.EventClear)
                                    ]
                                    [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
                                ]

                            else
                                []
                           )
                    )


whenLabel : Time.Zone -> Int -> String
whenLabel zone ms =
    let
        posix =
            Time.millisToPosix ms

        pad n =
            String.padLeft 2 '0' (String.fromInt n)
    in
    weekdayShort (Time.toWeekday zone posix)
        ++ ", "
        ++ monthShort (Time.toMonth zone posix)
        ++ " "
        ++ String.fromInt (Time.toDay zone posix)
        ++ ", "
        ++ pad (Time.toHour zone posix)
        ++ ":"
        ++ pad (Time.toMinute zone posix)


weekdayShort : Time.Weekday -> String
weekdayShort day =
    case day of
        Time.Mon ->
            "Mon"

        Time.Tue ->
            "Tue"

        Time.Wed ->
            "Wed"

        Time.Thu ->
            "Thu"

        Time.Fri ->
            "Fri"

        Time.Sat ->
            "Sat"

        Time.Sun ->
            "Sun"


monthShort : Time.Month -> String
monthShort month =
    case month of
        Time.Jan ->
            "Jan"

        Time.Feb ->
            "Feb"

        Time.Mar ->
            "Mar"

        Time.Apr ->
            "Apr"

        Time.May ->
            "May"

        Time.Jun ->
            "Jun"

        Time.Jul ->
            "Jul"

        Time.Aug ->
            "Aug"

        Time.Sep ->
            "Sep"

        Time.Oct ->
            "Oct"

        Time.Nov ->
            "Nov"

        Time.Dec ->
            "Dec"



-- 3.8 — INSIGHTS STRIP (public chanstats aggregate)


insightsStrip : Model -> String -> Html Msg
insightsStrip model channel =
    let
        lower =
            String.toLower channel

        detail =
            model.statsDetail
                |> Maybe.andThen
                    (\d ->
                        if String.toLower d.channel == lower then
                            Just d

                        else
                            Nothing
                    )

        loading =
            model.statsDetailLoading && String.toLower model.statsDetailRequested == lower
    in
    section
        [ class "rset-insights"
        , attribute "data-testid" "room-insights"
        , attribute "aria-label" ("Insights for " ++ channel)
        ]
        ([ div [ class "rset-insights-head" ]
            [ span [ class "rset-insights-title" ] [ text "Room pulse" ]
            , Html.a [ class "rset-link", href (Stats.statsRoomHref channel), attribute "data-testid" "room-insights-open-stats" ] [ text "Room ledger" ]
            ]
         ]
            ++ (case ( detail, loading ) of
                    ( Just d, _ ) ->
                        [ div [ class "rset-hint", attribute "data-testid" "room-insights-meta" ]
                            [ text
                                ("Public aggregate · Updated "
                                    ++ Stats.relTime d.generatedAt model.nowMs
                                    ++ (if d.complete then
                                            ""

                                        else
                                            " · Partial snapshot"
                                       )
                                )
                            ]
                        , rhythm d.hours d.peakHour
                        , ul [ class "rset-metrics", attribute "data-testid" "room-insights-metrics" ]
                            [ metric "Observed present" (RoomSettings.insightCount d.present)
                            , metric "Messages" (RoomSettings.insightCount d.totals.messages)
                            , metric "Contributors" (RoomSettings.insightCount d.totals.activeUsers)
                            , metric "Last speaker"
                                (if String.isEmpty d.lastSpeaker then
                                    "—"

                                 else
                                    d.lastSpeaker
                                )
                            , metric "Net joins" (RoomSettings.insightSigned (Stats.netMembershipFlow d.totals))
                            , metric "Peak hour" (RoomSettings.insightHour d.peakHour)
                            , metric "Last active" (Stats.relTime d.lastActive model.nowMs)
                            ]
                        ]

                    ( Nothing, True ) ->
                        [ p [ class "rset-hint", attribute "role" "status", attribute "data-testid" "room-insights-loading" ] [ text "Loading public room stats…" ] ]

                    ( Nothing, False ) ->
                        [ p [ class "rset-hint", attribute "role" "status", attribute "data-testid" "room-insights-empty" ] [ text "No public stats for this room yet." ] ]
               )
        )


metric : String -> String -> Html Msg
metric name val =
    li [] [ span [] [ text name ], strong [] [ text val ] ]


rhythm : List Int -> Maybe Int -> Html Msg
rhythm hours peakHour =
    let
        safe v =
            max 0 v

        total =
            List.sum (List.map safe hours)

        peak =
            max 1 (Maybe.withDefault 0 (List.maximum (List.map safe hours)))

        peakLabel =
            case peakHour of
                Nothing ->
                    "No peak hour recorded"

                Just _ ->
                    "Peak " ++ RoomSettings.insightHour peakHour
    in
    if total <= 0 then
        text ""

    else
        figure [ class "rset-rhythm", attribute "data-testid" "room-insights-rhythm" ]
            [ div [ class "rset-rhythm-bars", attribute "role" "img", attribute "aria-labelledby" "rset-rhythm-caption" ]
                (List.indexedMap
                    (\hour count ->
                        span
                            [ classList [ ( "rset-rhythm-bar", True ), ( "rset-rhythm-peak", peakHour == Just hour ) ]
                            , attribute "aria-hidden" "true"
                            , style "--room-heat" (String.fromFloat (toFloat (round (toFloat (safe count) / toFloat peak * 1000)) / 1000))
                            ]
                            []
                    )
                    hours
                )
            , figcaption [ id "rset-rhythm-caption", class "rset-hint" ]
                [ text (RoomSettings.insightCount total ++ " messages in UTC · " ++ String.toLower peakLabel) ]
            ]



-- HELPERS


propsOf : Model -> String -> Dict.Dict String String
propsOf model channel =
    Maybe.withDefault Dict.empty (Dict.get (String.toLower channel) model.props.channelProps)


boolAttr : Bool -> String
boolAttr on_ =
    if on_ then
        "true"

    else
        "false"
