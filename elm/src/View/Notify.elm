module View.Notify exposing (notifySheet, notifySheetButton, roomNotifyStrip)

{-| Notifications surfaces: the per-room alert-level strip in the room
header (oracle `ChannelNotifyControl`) and the `Notifications` settings
sheet (oracle `KeywordListControl`, `IgnoredUsersControl`, and the DND /
desktop / sound axes of `NotificationControls`).

All writes go through the existing `App` folds, so persistence outbounds
(`ChannelNotifySave`, `HighlightWordsSave`, `BlocklistsSave`, `DndSave`,
`NotifyPushSave`, `NotifySoundSave`) fire exactly as the folds emit them.
-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, button, div, form, h2, h3, input, label, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, placeholder, tabindex, title, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Notify exposing (Permission(..))
import NotifyCenter exposing (NotifyMode(..))
import Set
import View.Sheet as Sheet


{-| Topbar entry point for the Notifications sheet. -}
notifySheetButton : Model -> Html Msg
notifySheetButton model =
    button
        [ class "onyx-notify-toggle"
        , classList [ ( "onyx-notify-toggle-open", model.notifySheetOpen ) ]
        , attribute "aria-pressed"
            (if model.notifySheetOpen then
                "true"

             else
                "false"
            )
        , attribute "aria-label" "Notifications"
        , attribute "data-testid" "shell-notifications"
        , onClick NotifySheetOpen
        ]
        [ text "Alerts" ]


{-| Compact per-room alert-level strip for the room header, mirroring
`ChannelNotifyControl`: a radiogroup named for the channel with the
All / @ / Mute segments. Selection follows the stored level (`none`
reads as `Mute`); clicks write through `setChannelNotify`.
-}
roomNotifyStrip : Model -> String -> Html Msg
roomNotifyStrip model channel =
    let
        active =
            NotifyCenter.modeOfLevel (App.notifyLevel model channel)
    in
    div
        [ class "room-notify"
        , attribute "role" "radiogroup"
        , attribute "aria-label" ("Notifications for " ++ channel)
        , attribute "data-testid" "room-notify"
        ]
        (span [ class "room-notify-name" ] [ text ("Alerts for " ++ channel) ]
            :: List.map (roomNotifySegment model channel active) NotifyCenter.notifyOptions
        )


roomNotifySegment : Model -> String -> NotifyMode -> { mode : NotifyMode, label : String, title : String } -> Html Msg
roomNotifySegment _ channel active option =
    let
        selected =
            active == option.mode
    in
    button
        [ attribute "type" "button"
        , class "room-notify-seg"
        , attribute "role" "radio"
        , attribute "aria-checked"
            (if selected then
                "true"

             else
                "false"
            )
        , attribute "aria-label" option.title
        , title option.title
        , tabindex
            (if selected then
                0

             else
                -1
            )
        , onClick (RoomNotifyLevel { channel = channel, level = NotifyCenter.levelOfMode option.mode })
        ]
        [ span [ attribute "aria-hidden" "true" ] [ text option.label ] ]


{-| Notifications settings sheet: desktop + sound, do-not-disturb,
keywords, and the ignored-users list. -}
notifySheet : Model -> Html Msg
notifySheet model =
    if not model.notifySheetOpen then
        text ""

    else
        Sheet.view
            { scope = "notify"
            , label = Sheet.Labelled "Notifications"
            , onClose = NotifySheetClose
            , placement = Sheet.Center
            , layerClass = ""
            , panelClass = "notify-panel"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "notify-sheet" ]
            }
                [ Sheet.headerWith
                    (Sheet.head { scope = "notify", title = "Notifications", closeLabel = "Close notifications", onClose = NotifySheetClose }
                        |> (\h -> { h | subtitle = Just "Alerts, sounds, quiet hours and the words that reach you." })
                    )
                , desktopSection model
                , dndSection model
                , keywordsSection model
                , ignoredSection model
                ]


{-| Desktop + sound rows, mirroring the `NotificationControls` desktop
and sound toggles (copy kept: blocked / unsupported / on / off).
-}
desktopSection : Model -> Html Msg
desktopSection model =
    let
        desktopActive =
            model.pushEnabled && model.notifyPermission == Granted

        ( desktopDisabled, desktopLabel ) =
            case model.notifyPermission of
                Unsupported ->
                    ( True, "Desktop notifications are not supported" )

                Denied ->
                    ( True, "Desktop notifications are blocked by the browser" )

                Granted ->
                    if desktopActive then
                        ( False, "Disable desktop notifications" )

                    else
                        ( False, "Enable desktop notifications" )

                Default ->
                    ( False, "Enable desktop notifications" )

        desktopMsg =
            case model.notifyPermission of
                Granted ->
                    NotifyPushToggle

                _ ->
                    RequestNotifyPermission
    in
    section [ class "notify-group", attribute "aria-label" "Desktop and sound" ]
        [ div [ class "notify-row" ]
            [ div [ class "notify-row-copy" ]
                [ span [ class "notify-row-title" ] [ text "Desktop alerts" ]
                , span [ class "notify-row-hint" ]
                    [ text
                        (if desktopActive then
                            "Desktop notifications on"

                         else
                            "Desktop notifications off"
                        )
                    ]
                ]
            , button
                [ attribute "type" "button"
                , class "notify-toggle"
                , attribute "aria-label" desktopLabel
                , title desktopLabel
                , attribute "aria-pressed"
                    (if desktopActive then
                        "true"

                     else
                        "false"
                    )
                , attribute "data-testid" "notify-desktop-toggle"
                , disabled desktopDisabled
                , onClick desktopMsg
                ]
                [ text
                    (if desktopActive then
                        "On"

                     else
                        "Off"
                    )
                ]
            ]
        , div [ class "notify-row" ]
            [ div [ class "notify-row-copy" ]
                [ span [ class "notify-row-title" ] [ text "Notification sound" ]
                , span [ class "notify-row-hint" ]
                    [ text
                        (if model.soundEnabled then
                            "Notification sound on"

                         else
                            "Notification sound off"
                        )
                    ]
                ]
            , button
                [ attribute "type" "button"
                , class "notify-toggle"
                , attribute "aria-label"
                    (if model.soundEnabled then
                        "Mute notification sound"

                     else
                        "Enable notification sound"
                    )
                , title
                    (if model.soundEnabled then
                        "Mute notification sound"

                     else
                        "Enable notification sound"
                    )
                , attribute "aria-pressed"
                    (if model.soundEnabled then
                        "true"

                     else
                        "false"
                    )
                , attribute "data-testid" "notify-sound-toggle"
                , onClick NotifySoundToggle
                ]
                [ text
                    (if model.soundEnabled then
                        "On"

                     else
                        "Off"
                    )
                ]
            ]
        ]


{-| Do-not-disturb row: manual toggle plus a minutes timer, mirroring
the `/dnd` + `/snooze` folds (1–1440 minutes). -}
dndSection : Model -> Html Msg
dndSection model =
    let
        active =
            App.notifyDndActive model
    in
    section [ class "notify-group", attribute "aria-label" "Do not disturb" ]
        [ h3 [ class "notify-group-title" ] [ text "Do not disturb" ]
        , div [ class "notify-row" ]
            [ div [ class "notify-row-copy" ]
                [ span [ class "notify-row-title" ] [ text "Silence alerts" ]
                , span [ class "notify-row-hint" ] [ text "Desktop and sound alerts pause while on." ]
                ]
            , button
                [ attribute "type" "button"
                , class "notify-toggle"
                , attribute "aria-label"
                    (if active then
                        "Turn off do not disturb"

                     else
                        "Turn on do not disturb"
                    )
                , title
                    (if active then
                        "Turn off do not disturb"

                     else
                        "Turn on do not disturb"
                    )
                , attribute "aria-pressed"
                    (if active then
                        "true"

                     else
                        "false"
                    )
                , attribute "data-testid" "notify-dnd-toggle"
                , attribute "aria-keyshortcuts" "Control+Shift+D Meta+Shift+D" -- v3/gap-commands
                , onClick NotifyDndToggle
                ]
                [ text
                    (if active then
                        "On"

                     else
                        "Off"
                    )
                ]
            ]
        , form [ class "notify-dnd-timer", onSubmit NotifyDndSnooze ]
            [ label [ class "notify-hint", for "notify-dnd-minutes" ] [ text "Snooze for minutes (1–1440)" ]
            , div [ class "notify-add" ]
                [ input
                    [ type_ "text"
                    , id "notify-dnd-minutes"
                    , class "notify-input"
                    , attribute "data-testid" "notify-dnd-minutes"
                    , attribute "inputmode" "numeric"
                    , placeholder "30"
                    , value model.notifyDndMinutes
                    , onInput NotifyDndMinutesInput
                    ]
                    []
                , button
                    [ attribute "type" "submit"
                    , class "notify-add-btn"
                    , attribute "data-testid" "notify-dnd-snooze"
                    ]
                    [ text "Snooze" ]
                , button
                    [ attribute "type" "button"
                    , class "notify-add-btn"
                    , attribute "data-testid" "notify-dnd-clear"
                    , attribute "aria-label" "Clear do not disturb"
                    , onClick NotifyDndClear
                    ]
                    [ text "Clear" ]
                ]
            ]
        , case model.notifyDndError of
            Just message ->
                p [ class "notify-status", attribute "role" "alert", attribute "data-testid" "notify-dnd-error" ] [ text message ]

            Nothing ->
                text ""
        , p [ class "notify-hint", attribute "role" "status", attribute "data-testid" "notify-dnd-status" ]
            [ text (NotifyCenter.dndStatusLine model.dndEnabled model.dndUntil model.nowMs) ]
        ]


{-| Keyword list, mirroring `KeywordListControl` copy and testids. -}
keywordsSection : Model -> Html Msg
keywordsSection model =
    let
        words =
            List.sort model.highlightWords
    in
    section
        [ class "notify-group"
        , attribute "aria-labelledby" "you-keywords-title"
        , attribute "aria-describedby" "you-keywords-hint"
        , attribute "data-testid" "you-keywords"
        ]
        [ h3 [ id "you-keywords-title", class "notify-group-title" ] [ text "Keywords" ]
        , p [ class "notify-hint", id "you-keywords-hint" ]
            [ text "Also ping when these words appear. They do not replace All, @, or Mute. Muted rooms stay silent." ]
        , form [ class "notify-add", attribute "role" "group", attribute "aria-label" "Add a keyword", onSubmit NotifyKeywordAdd ]
            [ label [ class "notify-hint", for "you-keyword-input" ] [ text "Word" ]
            , input
                [ type_ "text"
                , id "you-keyword-input"
                , class "notify-input"
                , attribute "data-testid" "you-keyword-input"
                , attribute "spellcheck" "false"
                , attribute "autocomplete" "off"
                , attribute "maxlength" (String.fromInt App.maxHighlightWordLength)
                , placeholder "word"
                , value model.notifyKeywordDraft
                , onInput NotifyKeywordInput
                ]
                []
            , button
                [ attribute "type" "submit"
                , class "notify-add-btn"
                , attribute "data-testid" "you-keyword-add"
                ]
                [ text "Add" ]
            ]
        , if List.isEmpty words then
            p [ class "notify-hint", attribute "data-testid" "you-keywords-empty" ]
                [ text "No extra ping words on this device." ]

          else
            ul [ class "notify-list", attribute "data-testid" "you-keywords-list" ]
                (List.map keywordRow words)
        ]


keywordRow : String -> Html Msg
keywordRow word =
    li [ class "notify-item" ]
        [ span [ class "notify-word" ] [ text word ]
        , button
            [ attribute "type" "button"
            , class "notify-remove"
            , attribute "data-testid" ("you-keyword-remove-" ++ word)
            , attribute "aria-label" ("Remove " ++ word)
            , onClick (RemoveHighlightWord word)
            ]
            [ text "Remove" ]
        ]


{-| Ignored-users list, mirroring `IgnoredUsersControl` copy and testids. -}
ignoredSection : Model -> Html Msg
ignoredSection model =
    let
        nicks =
            List.sort (Set.toList model.ignoredUsers)

        count =
            List.length nicks
    in
    section
        [ class "notify-group"
        , attribute "aria-labelledby" "pref-ignored-users-title"
        , attribute "data-testid" "pref-ignored-users"
        ]
        [ div [ class "notify-group-head" ]
            [ h3 [ id "pref-ignored-users-title", class "notify-group-title" ] [ text "Personal mute & block" ]
            , span
                [ class "notify-count"
                , attribute "aria-label" (String.fromInt count ++ " muted names")
                , attribute "data-testid" "pref-ignored-users-count"
                ]
                [ text
                    (if count == 0 then
                        "None"

                     else
                        String.fromInt count
                    )
                ]
            ]
        , p [ class "notify-hint" ]
            [ text "Muting hides messages and notifications from these names on this device. Nothing is removed from rooms, and the server is not notified. People-card Block and /ignore share this list." ]
        , form [ class "notify-add", attribute "role" "group", attribute "aria-label" "Add name to personal mute and block list", onSubmit NotifyIgnoreAdd ]
            [ label [ class "notify-hint", for "pref-ignore-nick-input" ] [ text "Name to mute" ]
            , input
                [ type_ "text"
                , id "pref-ignore-nick-input"
                , class "notify-input"
                , attribute "data-testid" "pref-ignore-nick-input"
                , attribute "spellcheck" "false"
                , attribute "autocomplete" "off"
                , attribute "maxlength" (String.fromInt NotifyCenter.maxIgnoreNickLength)
                , attribute "aria-describedby" "pref-ignore-help"
                , attribute "aria-invalid"
                    (if model.notifyIgnoreError == Nothing then
                        "false"

                     else
                        "true"
                    )
                , placeholder "Name to mute or block"
                , value model.notifyIgnoreDraft
                , onInput NotifyIgnoreInput
                ]
                []
            , button
                [ attribute "type" "button"
                , class "notify-add-btn"
                , attribute "data-testid" "pref-ignore-add"
                , onClick NotifyIgnoreAdd
                ]
                [ text "Mute name" ]
            ]
        , p [ id "pref-ignore-help", class "notify-hint" ] [ text "Only you see this setting. Press Enter to add." ]
        , case model.notifyIgnoreError of
            Just message ->
                p [ class "notify-status", attribute "role" "alert", attribute "data-testid" "pref-ignore-error" ] [ text message ]

            Nothing ->
                text ""
        , if List.isEmpty nicks then
            p [ class "notify-hint", attribute "role" "status", attribute "data-testid" "pref-ignored-users-empty" ]
                [ text "Your list is clear. Names you mute or block here will appear in this device-only list." ]

          else
            ul [ class "notify-list", attribute "aria-label" "Muted names on this device", attribute "data-testid" "pref-ignored-users-list" ]
                (List.map ignoredRow nicks)
        ]


ignoredRow : String -> Html Msg
ignoredRow nick =
    li [ class "notify-item" ]
        [ span [ class "notify-word", title nick ] [ text nick ]
        , button
            [ attribute "type" "button"
            , class "notify-remove"
            , attribute "data-testid" ("pref-unignore-" ++ nick)
            , attribute "aria-label" ("Unblock " ++ nick)
            , onClick (UnignoreUser nick)
            ]
            [ text "Unblock" ]
        ]
