module View.Composer exposing (composer)

{-| Message composer: pinned under the thread. Offline composing stays
enabled — plain messages queue durably on this device and send on
reconnect (the oracle's outbox); only the sealed paths refuse while
disconnected. Outbox chrome below the input comes from the shared
`Outbox` truth tables, so copy cannot drift.

Send-later lives beside Send: a `Send later` button (disabled with
the oracle's reason copy while the draft cannot be queued) opens a
small picker with the four presets, a custom date/time field parsed
against the local clock by the ports bridge, and a queue button that
hands off to the scheduled sheet. The picker is a `div` dialog, never
a nested form, so Enter in the composer still sends.
-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, button, div, form, input, label, li, p, progress, span, text, ul)
import Html.Attributes exposing (attribute, autofocus, class, classList, disabled, placeholder, title, type_, value)
import Html.Attributes as Attr
import Html.Events exposing (on, onClick, onInput, onSubmit, preventDefaultOn)
import Json.Decode as Decode
import FirstHour
import Outbox
import Schedule


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

        retainedDraftLocked =
            model.retiredDraftOwner /= Nothing

        -- Edit mode turns Send into a guarded Save (mirroring the
        -- oracle `canSend` edit branch: nonempty draft, no staged
        -- attachments). The normal path keeps the existing
        -- ready-only gate; its own guards live in update.
        toolsShown =
            model.composerToolsOpen || model.scheduleOpen || not (List.isEmpty model.attachments)

        canSaveOrSend =
            case editingNow of
                Nothing ->
                    True

                Just _ ->
                    not (String.isEmpty (String.trim model.composer))
                        && List.isEmpty model.attachments
    in
    form [ class "onyx-composer", onSubmit ComposerSend ]
        [ if not model.threadFollowing && model.activeChannel /= Nothing then
            div [ class "onyx-reading-bar" ]
                [ span [] [ text "Reading earlier messages" ]
                , button [ type_ "button", onClick ThreadShowLatest ] [ text "Back to latest" ]
                ]
          else
            text ""
        , span [ class "onyx-composer-target" ]
            [ text (Maybe.withDefault "#" model.activeChannel) ]
        , retainedDraftBanner model
        , replyBar model
        , editBar model
        , coach model
        , suggestions model
        , button
            [ type_ "button"
            , class "onyx-composer-tools-toggle"
            , attribute "aria-label" "More message options"
            , attribute "aria-expanded" (boolString toolsShown)
            , attribute "aria-controls" "onyx-composer-tools"
            , onClick ComposerToolsToggle
            ]
            [ span [ class "onyx-icon", attribute "data-icon" "plus", attribute "aria-hidden" "true" ] [] ]
        , input
            [ type_ "text"
            , placeholder
                (if not ready then
                    "Select a channel"

                 else if editingNow /= Nothing then
                    "Edit message"

                 else if retainedDraftLocked then
                    "Retained draft — edits stay in this tab"

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
            , on "compositionstart" (Decode.succeed ComposerCompositionStarted)
            , on "compositionend" (Decode.succeed ComposerCompositionEnded)
            , onInput ComposerInput
            , preventDefaultOn "keydown" (composerKey model)
            , disabled (not ready)
            ]
            []
        , button
            [ type_ "submit"
            , disabled (not ready || not canSaveOrSend || retainedDraftLocked)
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
        , -- Audience, attachments, and send-later: inline beside the
          -- input on wide screens; on phones a tray behind the + button
          -- (opened automatically while files are staged or the
          -- schedule picker is open).
          div [ class "onyx-composer-tools", attribute "id" "onyx-composer-tools", attribute "data-open" (boolString toolsShown) ]
            [ if App.composerAudienceOffered model then
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
            , attachments model
            , sendLater model
            ]
        , case model.composerError of
            Just err ->
                p [ class "onyx-composer-error", attribute "role" "alert" ] [ text err ]

            Nothing ->
                text ""
        , case editingNow of
            Just edit ->
                if App.editOutcomeUnknown model edit.target edit.msgid then
                    div [ class "onyx-composer-error", attribute "role" "status" ]
                        [ span [] [ text "Edit outcome unknown. Review the current message before editing again." ]
                        , button [ type_ "button", onClick (DismissEditUncertainty edit.target edit.msgid) ] [ text "Dismiss edit uncertainty" ]
                        ]

                else
                    text ""

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
        , conversation model
        ]


{-| Keys for the composer. Slash and nick menus take arrows, Tab,
Enter, and Escape before the form can submit. Escape then backs out
of an armed edit, then the active reply. The schedule popover is its
own dialog, so this decoder does not claim keys for it. -}
composerKey : Model -> Decode.Decoder ( Msg, Bool )
composerKey model =
    Decode.field "isComposing" Decode.bool
        |> Decode.andThen
            (\composing ->
                if composing then
                    Decode.fail "ime"

                else
                    Decode.field "key" Decode.string
                        |> Decode.andThen (keyAction model)
            )


keyAction : Model -> String -> Decode.Decoder ( Msg, Bool )
keyAction model key =
    let
        slash =
            App.slashSuggestionCommands model

        nicks =
            App.nickSuggestionMatches model
    in
    if not (List.isEmpty slash) then
        menuKey key (List.map .name slash) model.slashIndex SlashSuggestMove SlashSuggestPick SlashSuggestDismiss

    else if not (List.isEmpty nicks) then
        menuKey key nicks model.nickIndex NickSuggestMove NickSuggestPick NickSuggestDismiss

    else if key == "Escape" then
        case editingFor model of
            Just _ ->
                Decode.succeed ( App.EditCancel, False )

            Nothing ->
                case Maybe.andThen (App.activeReplyParent model.replyingTo) model.activeChannel of
                    Just _ ->
                        Decode.succeed ( App.ReplyCancel, False )

                    Nothing ->
                        Decode.fail "nothing-armed"

    else
        Decode.fail "pass"


retainedDraftBanner : Model -> Html Msg
retainedDraftBanner model =
    case model.retiredDraftOwner of
        Nothing ->
            text ""

        Just origin ->
            let
                copy =
                    case origin.accountId of
                        Just account ->
                            "This unsent draft is retained from account " ++ account ++ ". It stays only in this tab until that account reconnects on the same network."

                        Nothing ->
                            "This unsent draft is from an earlier guest connection. It stays only in this tab until you authorize it for this guest session."

                reauthorize =
                    case ( origin.accountId, model.runtimeOwnerStamp ) of
                        ( Nothing, Just stamp ) ->
                            if stamp.networkId == origin.networkId
                                && stamp.accountId == Nothing
                                && stamp.connectionGeneration > origin.connectionGeneration then
                                [ button [ type_ "button", onClick RetiredDraftReauthorize ] [ text "Use draft in this guest session" ] ]

                            else
                                []

                        _ ->
                            []
            in
            div [ class "onyx-retained-draft", attribute "role" "status", attribute "aria-live" "polite" ]
                ([ p [] [ text copy ]
                 , button [ type_ "button", onClick RetiredDraftDiscard ] [ text "Clear retained draft" ]
                 ]
                    ++ reauthorize
                )


menuKey : String -> List String -> Int -> (Int -> Msg) -> (String -> Msg) -> Msg -> Decode.Decoder ( Msg, Bool )
menuKey key names index move pick dismiss =
    let
        current =
            List.drop index names |> List.head |> Maybe.withDefault ""
    in
    if key == "ArrowDown" then
        Decode.succeed ( move 1, True )

    else if key == "ArrowUp" then
        Decode.succeed ( move -1, True )

    else if (key == "Tab" || key == "Enter") && not (String.isEmpty current) then
        Decode.succeed ( pick current, True )

    else if key == "Escape" then
        Decode.succeed ( dismiss, True )

    else
        Decode.fail "menu-pass"


coach : Model -> Html Msg
coach model =
    case FirstHour.composerHint model.firstHourSeen model.firstHourHandoff of
        Nothing ->
            text ""

        Just hint ->
            div [ class "onyx-first-hour", attribute "data-testid" "first-hour-coach" ]
                [ span [] [ text hint ]
                , button [ type_ "button", onClick FirstHourDismiss ] [ text "Dismiss" ]
                ]


suggestions : Model -> Html Msg
suggestions model =
    let
        slash =
            App.slashSuggestionCommands model

        nicks =
            App.nickSuggestionMatches model
    in
    if not (List.isEmpty slash) then
        ul [ class "onyx-suggest", attribute "role" "listbox", attribute "data-testid" "slash-suggestions", attribute "aria-label" "Commands" ]
            (List.indexedMap (suggestButton model.slashIndex SlashSuggestPick .name .description) slash)

    else if not (List.isEmpty nicks) then
        ul [ class "onyx-suggest", attribute "role" "listbox", attribute "data-testid" "nick-suggestions", attribute "aria-label" "Nicks" ]
            (List.indexedMap (\index nick -> suggestRow (index == model.nickIndex) (NickSuggestPick nick) nick "") nicks)

    else
        text ""


suggestButton : Int -> (String -> Msg) -> (a -> String) -> (a -> String) -> Int -> a -> Html Msg
suggestButton selected pick nameOf detailOf index item =
    suggestRow (index == selected) (pick (nameOf item)) (nameOf item) (detailOf item)


suggestRow : Bool -> Msg -> String -> String -> Html Msg
suggestRow active msg name detail =
    li
        [ class "onyx-suggest-row"
        , classList [ ( "is-active", active ) ]
        , attribute "role" "option"
        , attribute "aria-selected" (if active then "true" else "false")
        ]
        [ button [ type_ "button", onClick msg ]
            [ text name
            , if String.isEmpty detail then
                text ""

              else
                span [] [ text (" " ++ detail) ]
            ]
        ]


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
            , disabled (protected || model.retiredDraftOwner /= Nothing)
            , title
                (if model.retiredDraftOwner /= Nothing then
                    "Clear or reauthorize the retained draft before attaching files."

                 else
                    hint
                )
            , attribute "aria-label" "Attach files"
            , onClick AttachPick
            ]
            [ span [ class "onyx-icon", attribute "data-icon" "attach", attribute "aria-hidden" "true" ] []
            , span [ class "onyx-tool-label" ] [ text "Attach" ]
            ]
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


{-| Send-later entry + picker (mirroring the composer's schedule
surface: the button is disabled with the refusal reason while the
draft cannot be queued, and the picker offers the four presets plus
a custom date/time). -}
sendLater : Model -> Html Msg
sendLater model =
    let
        gate =
            { target = model.activeChannel
            , body = model.composer
            , editing = editingFor model /= Nothing
            , attachmentsStaged = not (List.isEmpty model.attachments)
            }

        able =
            model.retiredDraftOwner == Nothing && Schedule.canScheduleComposer gate

        hint =
            if model.retiredDraftOwner /= Nothing then
                "Clear or reauthorize the retained draft before scheduling a message."

            else
                Maybe.withDefault "Schedule this message" (Schedule.scheduleComposerRefusal gate)
    in
    div [ class "onyx-schedule" ]
        ([ button
            ([ type_ "button"
             , class "onyx-schedule-open"
             , disabled (not able)
             , title hint
             , attribute "aria-label" "Schedule message to send later"
             , attribute "aria-haspopup" "dialog"
             , onClick ScheduleOpen
             ]
                ++ (if model.scheduleOpen then
                        [ attribute "aria-expanded" "true", attribute "aria-controls" "onyx-schedule-picker" ]

                    else
                        [ attribute "aria-expanded" "false" ]
                   )
            )
            [ span [ class "onyx-icon", attribute "data-icon" "clock", attribute "aria-hidden" "true" ] []
            , span [ class "onyx-tool-label" ] [ text "Send later" ]
            ]
         ]
            ++ (if model.scheduleOpen then
                    [ schedulePopover model ]

                else
                    []
               )
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
                , p [ class "onyx-schedule-sub" ] [ text "A private editor will open for the scheduled message. The encrypted list never shows its text." ]
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


boolString : Bool -> String
boolString on =
    if on then
        "true"

    else
        "false"
