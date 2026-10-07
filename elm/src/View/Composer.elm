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
import Html exposing (Html, button, div, form, input, label, p, progress, span, text)
import Html.Attributes exposing (attribute, autofocus, class, classList, disabled, placeholder, title, type_, value)
import Html.Attributes as Attr
import Html.Events exposing (onClick, onInput, onSubmit)
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
    in
    form [ class "onyx-composer", onSubmit ComposerSend ]
        [ span [ class "onyx-composer-target" ]
            [ text (Maybe.withDefault "#" model.activeChannel) ]
        , replyBar model
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
            [ type_ "text"
            , placeholder
                (if not ready then
                    "Select a channel"

                 else if online then
                    "Message"

                 else
                    "Offline — sends queue on this device"
                )
            , value model.composer
            , onInput ComposerInput
            , disabled (not ready)
            ]
            []
        , button [ type_ "submit", disabled (not ready) ] [ text "Send" ]
        , sendLater model
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


{-| Send-later entry + picker (mirroring the composer's schedule
surface: the button is disabled with the refusal reason while the
draft cannot be queued, and the picker offers the four presets plus
a custom date/time). -}
sendLater : Model -> Html Msg
sendLater model =
    let
        gate =
            { target = model.activeChannel, body = model.composer }

        able =
            Schedule.canScheduleComposer gate

        hint =
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
            [ text "Send later" ]
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
