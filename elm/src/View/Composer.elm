module View.Composer exposing (composer)

{-| Message composer: pinned under the thread. Offline composing stays
enabled — plain messages queue durably on this device and send on
reconnect (the oracle's outbox); only the sealed paths refuse while
disconnected. Outbox chrome below the input comes from the shared
`Outbox` truth tables, so copy cannot drift.

Send-later lives in the More tools tray (v3/polish, `View.Polish`):
its `Send later` entry (disabled with the oracle's reason copy while
the draft cannot be queued) opens a small picker with the four presets, a custom date/time field parsed
against the local clock by the ports bridge, and a queue button that
hands off to the scheduled sheet. The picker is a `div` dialog, never
a nested form, so Enter in the composer still sends.
-}

import App exposing (Model, Msg(..))
import ComposerAssist
import Dict
import Emoji
import Html exposing (Html, button, div, form, input, label, p, progress, span, text)
import Html.Attributes exposing (attribute, autofocus, class, classList, disabled, placeholder, title, type_, value)
import Html.Attributes as Attr
import Html.Events exposing (custom, on, onClick, onInput, onMouseEnter, onSubmit, preventDefaultOn)
import Json.Decode as Decode
import Outbox
import Polish
import Schedule
import View.Polish


composer : Model -> Html Msg
composer model =
    let
        ready =
            model.activeChannel /= Nothing

        online =
            model.connection == App.Live

        chrome =
            Outbox.composerChrome
                { connected = online
                , queuedCount = toFloat (List.length model.outbox)
                , deliveryFailed = model.outboxFailed
                }

        editingNow =
            editingFor model

        -- Edit mode turns Send into a guarded Save (mirroring the
        -- oracle `canSend` edit branch: nonempty draft, no staged
        -- attachments). The normal path keeps the existing
        -- ready-only gate; its own guards live in update.
        canSaveOrSend =
            case editingNow of
                Nothing ->
                    True

                Just _ ->
                    not (String.isEmpty (String.trim model.composer))
                        && List.isEmpty model.attachments
    in
    form [ class "onyx-composer", onSubmit ComposerSend ]
        [ span [ class "onyx-composer-target" ]
            [ text (Maybe.withDefault "#" model.activeChannel) ]
        , replyBar model
        , editBar model
        , if App.composerAudienceOffered model then
            button
                [ type_ "button"
                , class "onyx-audience-toggle"
                , classList [ ( "onyx-audience-toggle-set", model.composerAudience /= Nothing ) ]
                , attribute "title" "Choose who sees this message"
                , attribute "aria-label" ("Message audience: " ++ App.audienceLabel model.composerAudience)
                , onClick ComposerAudienceCycle
                ]
                [ text (App.audienceLabel model.composerAudience) ]

          else
            text ""
        , input
            ([ type_ "text"
            , placeholder
                (if not ready then
                    "Select a channel"

                 else if editingNow /= Nothing then
                    "Edit message"

                 else if online then
                    "Message"

                 else
                    "Offline — sends queue on this device"
                )
            , attribute "aria-label"
                (if editingNow /= Nothing then
                    "Edit message"

                 else
                    "Message"
                )
            , value model.composer
            , onInput ComposerInput
            , preventDefaultOn "keydown" (keyDecoder model)
            , disabled (not ready)
            , attribute "id" "shell-composer-input"
            ]
                ++ assistAria model
            )
            []
        , assistPopovers model
        , emojiButton model ready
        , button
            [ type_ "submit"
            , disabled (not ready || not canSaveOrSend)
            , attribute "aria-label"
                (if editingNow /= Nothing then
                    "Save edit"

                 else
                    "Send message"
                )
            ]
            [ text
                (if editingNow /= Nothing then
                    "Save"

                 else
                    "Send"
                )
            ]
        -- v3/polish: Send later moved into the More tools tray; the
        -- schedule popover still anchors here.
        , View.Polish.moreTools model
        , if model.scheduleOpen then
            div [ class "onyx-schedule" ] [ schedulePopover model ]

          else
            text ""
        , case model.composerError of
            Just err ->
                p [ class "onyx-composer-error", attribute "role" "alert" ] [ text err ]

            Nothing ->
                text ""
        , case chrome of
            Nothing ->
                text ""

            Just status ->
                div [ class "onyx-outbox-chrome" ]
                    [ span [ class "onyx-outbox-label" ] [ text status.label ]
                    , if status.canRetry then
                        button [ type_ "button", onClick OutboxFlushRequest ] [ text "Retry now" ]

                      else
                        text ""
                    ]
        , attachments model
        , conversation model
        ]


{-| Escape backs out of composer context (mirroring the composer
`handleKeyDown` Escape order: armed edit, then the active reply).
IME-claimed events and other keys decode to nothing, and with
neither context armed nothing fires — the schedule popover keeps
its own focus while open, so it stays ahead of this handler. -}
escapeDecoder : Model -> Decode.Decoder Msg
escapeDecoder model =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen
                            (\key ->
                                if key /= "Escape" then
                                    Decode.fail "not-escape"

                                else
                                    case editingFor model of
                                        Just _ ->
                                            Decode.succeed App.EditCancel

                                        Nothing ->
                                            case Maybe.andThen (App.activeReplyParent model.replyingTo) model.activeChannel of
                                                Just _ ->
                                                    Decode.succeed App.ReplyCancel

                                                Nothing ->
                                                    Decode.fail "nothing-armed"
                            )
            )


{-| The armed edit for the active conversation, if any (mirrors the
composer `activeEditing` target scoping shared by the bar, the CTA,
and the schedule gate). -}
editingFor : Model -> Maybe { target : String, msgid : String, draft : String }
editingFor model =
    case model.activeChannel of
        Nothing ->
            Nothing

        Just target ->
            App.activeEditFor model target


{-| Armed-edit banner (mirrors the composer edit context: the
original text re-resolved against the live buffer, painted only
for the active target; a missing row paints the unavailable
placeholder instead of crashing). -}
editBar : Model -> Html Msg
editBar model =
    case editingFor model of
        Nothing ->
            text ""

        Just edit ->
            let
                original =
                    Maybe.withDefault "Message unavailable" (App.editRowBody model edit.target edit.msgid)
            in
            div [ class "shell-composer-context shell-composer-context--edit", attribute "role" "status", attribute "aria-live" "polite" ]
                [ span [ class "shell-composer-context-label" ] [ text "Editing" ]
                , span [ class "shell-composer-context-text" ] [ text (clippedText original) ]
                , button
                    [ type_ "button"
                    , class "shell-composer-context-close"
                    , attribute "aria-label" "Cancel edit"
                    , onClick App.EditCancel
                    ]
                    [ text "×" ]
                ]


{-| Armed-reply banner (mirrors the composer reply context: painted
only for the active target, re-resolved against the live buffer so a
parent redacted after arming paints the withdrawn placeholder). -}
replyBar : Model -> Html Msg
replyBar model =
    case model.activeChannel of
        Nothing ->
            text ""

        Just target ->
            case App.activeReplyParent model.replyingTo target of
                Nothing ->
                    text ""

                Just parent ->
                    let
                        shown =
                            App.resolveReplyDisplay model parent
                    in
                    div [ class "shell-composer-context", attribute "role" "status", attribute "aria-live" "polite" ]
                        [ span [ class "shell-composer-context-label" ] [ text ("Replying to " ++ shown.from) ]
                        , span [ class "shell-composer-context-text" ] [ text (clippedText shown.preview) ]
                        , button
                            [ type_ "button"
                            , class "shell-composer-context-close"
                            , attribute "aria-label" "Cancel reply"
                            , onClick App.ReplyCancel
                            ]
                            [ text "×" ]
                        ]


clippedText : String -> String
clippedText text =
    if String.length text > 96 then
        String.left 96 text ++ "..."

    else
        text


{-| Attachment staging (mirroring the composer attach surface:
the button refuses in protected DMs with the draft kept, staged
files list with per-file status, and failures surface the send
copy). -}
attachments : Model -> Html Msg
attachments model =
    let
        protected =
            case model.activeChannel of
                Just target ->
                    App.dmDesignated model target

                Nothing ->
                    False

        hint =
            if protected then
                App.dmAttachmentBlocked

            else
                "Attach files (up to 5, 25 MB each)"
    in
    div [ class "onyx-attachments" ]
        ([ button
            [ type_ "button"
            , class "onyx-attach-open"
            , disabled protected
            , title hint
            , attribute "aria-label" "Attach files"
            , onClick AttachPick
            ]
            [ text "Attach" ]
         ]
            ++ List.map stagedRow model.attachments
        )


{-| Named-conversation picker (mirroring the oracle topic
surface: the registry offers known conversations, the active one
badges with a clear action, and a stale pick falls back to the
whole room). -}
conversation : Model -> Html Msg
conversation model =
    case model.activeChannel of
        Nothing ->
            text ""

        Just channel ->
            let
                options =
                    Maybe.withDefault [] (Dict.get (String.toLower channel) model.topicHistory)

                active =
                    App.activeChannelTopic model channel
            in
            if List.isEmpty options && active == Nothing then
                text ""

            else
                div [ class "onyx-topic" ]
                    [ case active of
                        Just label ->
                            span [ class "onyx-topic-active" ]
                                [ text ("Conversation: " ++ label ++ " ")
                                , button
                                    [ type_ "button"
                                    , class "onyx-topic-clear"
                                    , attribute "aria-label" "Show the whole room"
                                    , onClick (ChannelTopicSelect { channel = channel, topic = Nothing })
                                    ]
                                    [ text "Whole room" ]
                                ]

                        Nothing ->
                            text ""
                    , div [ class "onyx-topic-options", attribute "role" "group", attribute "aria-label" "Conversations" ]
                        (List.map
                            (\label ->
                                button
                                    [ type_ "button"
                                    , class "onyx-topic-option"
                                    , attribute "aria-pressed" (if active == Just label then "true" else "false")
                                    , onClick (ChannelTopicSelect { channel = channel, topic = Just label })
                                    ]
                                    [ text label ]
                            )
                            options
                        )
                    ]


stagedRow : App.StagedAttachment -> Html Msg
stagedRow item =
    let
        statusText =
            case item.status of
                App.StagedReady ->
                    "ready"

                App.StagedUploading ->
                    case item.progress of
                        Just pct ->
                            "Uploading " ++ String.fromInt pct ++ "%"

                        Nothing ->
                            "Uploading…"

                App.StagedUploaded _ ->
                    "uploaded"

                App.StagedFailed ->
                    "failed — " ++ "Couldn't send. Try again."
    in
    div [ class "onyx-attach-row" ]
        ([ span [ class "onyx-attach-name" ] [ text item.name ]
         , span [ class "onyx-attach-status" ] [ text statusText ]
         ]
            ++ (case item.status of
                    App.StagedUploading ->
                        [ progress
                            [ class "shell-attachment-progress"
                            , Attr.max "100"
                            , value (String.fromInt (Maybe.withDefault 0 item.progress))
                            , attribute "aria-label" ("Uploading " ++ item.name)
                            ]
                            []
                        ]

                    _ ->
                        []
               )
            ++ [ button
                    [ type_ "button"
                    , class "onyx-attach-remove"
                    , attribute "aria-label" ("Remove " ++ item.name)
                    , onClick (AttachRemove item.id)
                    ]
                    [ text "Remove" ]
               ]
        )


schedulePopover : Model -> Html Msg
schedulePopover model =
    let
        count =
            App.ownedScheduledMessageCount model
    in
    div
        [ class "onyx-schedule-pop"
        , attribute "id" "onyx-schedule-picker"
        , attribute "role" "dialog"
        , attribute "aria-modal" "false"
        , attribute "aria-label" "Schedule message"
        ]
        [ div [ class "onyx-schedule-head" ]
            [ div [ class "onyx-schedule-headings" ]
                [ p [ class "onyx-schedule-title" ] [ text "Send later" ]
                , p [ class "onyx-schedule-sub" ] [ text "This message will stay in your scheduled list until it sends." ]
                ]
            , button
                [ type_ "button"
                , class "onyx-schedule-close"
                , attribute "aria-label" "Cancel scheduling"
                , onClick ScheduleClose
                ]
                [ text "×" ]
            ]
        , div [ class "onyx-schedule-presets" ]
            (List.indexedMap (schedulePreset model) Schedule.schedulePresets)
        , div [ class "onyx-schedule-custom" ]
            [ label [ class "onyx-schedule-when" ]
                [ span [] [ text "Pick a time" ]
                , input
                    ([ type_ "datetime-local"
                     , value model.scheduleWhen
                     , onInput ScheduleWhenInput
                     ]
                        ++ (if String.isEmpty model.scheduleMinLocal then
                                []

                            else
                                [ Attr.min model.scheduleMinLocal ]
                           )
                        ++ (case model.scheduleError of
                                Just _ ->
                                    [ attribute "aria-describedby" "onyx-schedule-error", attribute "aria-invalid" "true" ]

                                Nothing ->
                                    []
                           )
                    )
                    []
                ]
            , button
                [ type_ "button"
                , class "onyx-schedule-confirm"
                , disabled (String.isEmpty model.scheduleWhen)
                , onClick ScheduleCustomSubmit
                ]
                [ text "Schedule" ]
            ]
        , case model.scheduleError of
            Just err ->
                p [ class "onyx-schedule-error", attribute "role" "alert", attribute "id" "onyx-schedule-error" ] [ text err ]

            Nothing ->
                text ""
        , button [ type_ "button", class "onyx-schedule-view", onClick ScheduleViewQueue ]
            [ text ("View " ++ String.fromInt count ++ " scheduled") ]
        ]


schedulePreset : Model -> Int -> Schedule.SchedulePreset -> Html Msg
schedulePreset model index preset =
    case App.schedulePresetEpoch model preset of
        Just _ ->
            button
                ([ type_ "button"
                 , class "onyx-schedule-preset"
                 , onClick (SchedulePresetClicked { id = preset.id })
                 ]
                    ++ (if index == 0 then
                            [ autofocus True ]

                        else
                            []
                       )
                )
                [ text preset.label ]

        Nothing ->
            -- The clock answer has not landed: greyed out until the
            -- local-zone epoch arrives (an async consequence with no
            -- oracle equivalent, so the tooltip copy is Elm-only).
            button
                [ type_ "button"
                , class "onyx-schedule-preset"
                , disabled True
                , title "The local time is still loading."
                ]
                [ text preset.label ]


-- v3/composer


{-| The composer keydown: suggestion-list keys and Tab nick
completion first (preventDefault only when the assist layer claims
the key, so Enter submits normally with no list open), then Escape
closes the emoji picker, then the edit/reply Escape order. IME
composition yields everything to the browser. -}
keyDecoder : Model -> Decode.Decoder ( Msg, Bool )
keyDecoder model =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.map5 ComposerAssist.Key
                        (Decode.field "key" Decode.string)
                        (optionalBool "shiftKey")
                        (optionalBool "altKey")
                        (optionalBool "ctrlKey")
                        (optionalBool "metaKey")
                        |> Decode.andThen
                            (\key ->
                                case ComposerAssist.keyIntent (App.composerAssistInputs model) model.composerAssist key of
                                    Just intent ->
                                        Decode.succeed ( ComposerAssistIntent intent, True )

                                    Nothing ->
                                        if key.key == "Escape" && model.composerAssist.emojiOpen then
                                            Decode.succeed ( ComposerEmojiClose, True )

                                        else if key.key == "Escape" && model.polish.toolsOpen then
                                            -- v3/polish: the tools tray closes before edit/reply
                                            Decode.succeed ( PolishMsg Polish.ToolsClose, True )

                                        else
                                            escapeDecoder model |> Decode.map (\msg -> ( msg, False ))
                            )
            )


optionalBool : String -> Decode.Decoder Bool
optionalBool field =
    Decode.oneOf [ Decode.field field Decode.bool, Decode.succeed False ]


{-| Combobox wiring on the composer input (mirroring the textarea's
`aria-controls` / `aria-expanded` / `aria-autocomplete` /
`aria-activedescendant` while a list is open). -}
assistAria : Model -> List (Html.Attribute Msg)
assistAria model =
    case ComposerAssist.menuFor (App.composerAssistInputs model) model.composerAssist of
        ComposerAssist.SlashMenu _ ->
            [ attribute "aria-controls" "shell-command-menu"
            , attribute "aria-expanded" "true"
            , attribute "aria-autocomplete" "list"
            , attribute "aria-activedescendant" ("shell-command-option-" ++ String.fromInt model.composerAssist.slashIndex)
            ]

        ComposerAssist.NickMenu _ _ ->
            [ attribute "aria-controls" "shell-nick-menu"
            , attribute "aria-expanded" "true"
            , attribute "aria-autocomplete" "list"
            , attribute "aria-activedescendant" ("shell-nick-option-" ++ String.fromInt model.composerAssist.nickIndex)
            ]

        ComposerAssist.NoMenu ->
            [ attribute "aria-expanded" "false" ]


{-| Slash suggestions, nick completions and the emoji picker
(mirroring the composer popovers: same ids, roles, aria names and
test ids). Rows keep focus in the input on mousedown. -}
assistPopovers : Model -> Html Msg
assistPopovers model =
    let
        menu =
            ComposerAssist.menuFor (App.composerAssistInputs model) model.composerAssist

        row id active onPick =
            [ type_ "button"
            , attribute "id" id
            , class "shell-command-item"
            , classList [ ( "shell-command-item--active", active ) ]
            , attribute "role" "option"
            , attribute "tabindex" "-1"
            , attribute "aria-selected" (if active then "true" else "false")
            , preventDefaultOn "mousedown" (Decode.succeed ( onPick, True ))
            , onClick onPick
            ]
    in
    if menu == ComposerAssist.NoMenu && not model.composerAssist.emojiOpen then
        text ""

    else
    div [ class "shell-composer-popovers" ]
        [ case menu of
            ComposerAssist.SlashMenu commands ->
                div
                    [ attribute "id" "shell-command-menu"
                    , class "shell-command-menu"
                    , attribute "role" "listbox"
                    , attribute "aria-label" "Slash command suggestions"
                    ]
                    (List.indexedMap
                        (\index command ->
                            button
                                (row ("shell-command-option-" ++ String.fromInt index)
                                    (index == model.composerAssist.slashIndex)
                                    (ComposerAssistIntent (ComposerAssist.MenuPick index))
                                    ++ [ onMouseEnter (ComposerAssistIntent (ComposerAssist.MenuHover index)) ]
                                )
                                [ span [ class "shell-command-usage" ] [ text command.usage ]
                                , span [ class "shell-command-desc" ] [ text command.description ]
                                ]
                        )
                        commands
                    )

            ComposerAssist.NickMenu _ matches ->
                div
                    [ attribute "id" "shell-nick-menu"
                    , class "shell-command-menu shell-nick-menu"
                    , attribute "role" "listbox"
                    , attribute "aria-label" "Name completions"
                    , attribute "data-testid" "composer-nick-menu"
                    ]
                    (List.indexedMap
                        (\index nick ->
                            button
                                (row ("shell-nick-option-" ++ String.fromInt index)
                                    (index == model.composerAssist.nickIndex)
                                    (ComposerAssistIntent (ComposerAssist.MenuPick index))
                                    ++ [ attribute "data-testid" ("composer-nick-option-" ++ nick)
                                       , onMouseEnter (ComposerAssistIntent (ComposerAssist.MenuHover index))
                                       ]
                                )
                                [ span [ class "shell-command-usage" ] [ text nick ]
                                , span [ class "shell-command-desc" ] [ text "Complete nick" ]
                                ]
                        )
                        matches
                    )

            ComposerAssist.NoMenu ->
                text ""
        , if model.composerAssist.emojiOpen then
            emojiPicker model

          else
            text ""
        ]


emojiPicker : Model -> Html Msg
emojiPicker model =
    div
        [ attribute "id" "shell-emoji-picker"
        , class "shell-emoji-picker"
        , attribute "role" "dialog"
        , attribute "aria-modal" "false"
        , attribute "aria-label" "Emoji picker"
        , custom "keydown"
            (Decode.field "key" Decode.string
                |> Decode.andThen
                    (\key ->
                        if key == "Escape" then
                            Decode.succeed { message = ComposerEmojiClose, stopPropagation = True, preventDefault = True }

                        else
                            Decode.fail "not-escape"
                    )
            )
        ]
        [ label [ class "sr-only", attribute "for" "shell-emoji-search" ] [ text "Search emoji" ]
        , input
            [ attribute "id" "shell-emoji-search"
            , class "shell-emoji-search"
            , value model.composerAssist.emojiQuery
            , placeholder "Search emoji"
            , attribute "aria-label" "Search emoji"
            , autofocus True
            , onInput ComposerEmojiQuery
            ]
            []
        , div [ class "shell-emoji-grid", attribute "role" "listbox", attribute "aria-label" "Emoji results" ]
            (List.map
                (\entry ->
                    button
                        [ type_ "button"
                        , class "shell-emoji-choice"
                        , attribute "role" "option"
                        , attribute "aria-label" ("Insert " ++ entry.shortcode)
                        , onClick (ComposerEmojiInsert entry.emoji)
                        ]
                        [ text entry.emoji ]
                )
                (Emoji.searchEmojis model.composerAssist.emojiQuery 36)
            )
        ]


emojiButton : Model -> Bool -> Html Msg
emojiButton model ready =
    button
        ([ type_ "button"
         , class "shell-composer-tool shell-composer-tool--emoji"
         , attribute "data-composer-primary" "emoji"
         , disabled (not ready)
         , attribute "aria-label" "Insert emoji"
         , attribute "aria-haspopup" "dialog"
         , attribute "aria-expanded" (if model.composerAssist.emojiOpen then "true" else "false")
         , title "Insert emoji"
         , onClick ComposerEmojiToggle
         ]
            ++ (if model.composerAssist.emojiOpen then
                    [ attribute "aria-controls" "shell-emoji-picker" ]

                else
                    []
               )
        )
        [ span [ class "shell-composer-action-label" ] [ text "Emoji" ] ]
