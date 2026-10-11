module View.Organize exposing
    ( bookmarkMenuItem
    , closedFooter
    , folderSections
    , hiddenFooter
    , homeOutboxActions
    , homeSaved
    , listed
    , memberNote
    , muteEntry
    , mutedLabel
    , mutedMark
    , prefsOrganize
    , railMenuEntries
    , roomMoreItems
    , roomSettingsSection
    , rowMore
    , sheets
    , unfiledRooms
    , youEntry
    )

{-| v3/gap-organize — the organize surfaces: room folders and the
hidden / closed footers in the Rooms and Messages lists, the row
overflow menu, the folder picker, saved messages, private notes on the
member card, the room More / Room settings entries, the Preferences
"Organize" group and the Home saved-messages + queued-send actions.

All state lives in `App.Model.organize` (`Organizer`); every control
dispatches `OrganizeMsg` (or an existing App message: `MuteDm`,
`UnmuteDm`, `ChannelSelect`, `PrefsOutboxRemove`).

Merging with v3/rx-shell (the phone long-press / right-click row menu
in `View.Rail.railMenu`): splice `railMenuEntries model channel` into
that menu (rx-shell already carries the DM mute item, so leave
`muteEntry` out) and drop the `rowMore` calls in `View.Rail` — the
rx-shell `sidebar-row-more` control replaces them; `Organizer.RowMenu`
then simply goes unused. Entries carry `onyx-railmenu-item` so they
pick up that menu's row styling.

-}

import App exposing (Channel, ChatMessage, Model, Msg(..))
import Avatar
import Dict
import DmCipher
import GroupEnvelope
import Html exposing (Html, button, div, form, h2, h3, input, label, li, p, section, small, span, strong, text, textarea, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, maxlength, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Organize
import Organizer exposing (Sheet(..))
import Set
import Stats
import View.Sheet as Sheet


org : Organizer.Msg -> App.Msg
org =
    OrganizeMsg


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


icon : String -> Html msg
icon name =
    span [ class "onyx-shi gorg-i", attribute "data-icon" name, attribute "aria-hidden" "true" ] []


isActive : Model -> String -> Bool
isActive model name =
    Maybe.map String.toLower model.activeChannel == Just (String.toLower name)


isRoomName : Model -> String -> Bool
isRoomName model name =
    App.isChannelName model name


{-| The list's text filter is in use (it searches everything). -}
searching : Model -> Bool
searching model =
    not (String.isEmpty (String.trim model.sidebarFilter))


{-| Ready to write: an owner is known and its memory has loaded. -}
ready : Model -> Bool
ready model =
    Organizer.ready (App.deviceMemoryOwner model) model.organize



-- RAIL


{-| Conversations the lists show: hidden rooms and closed DMs step out
(the open one always stays, so you never lose your place). Typing in
the list's filter searches everything, hidden or closed included, so a
person or room you tucked away is one search from coming back. -}
listed : Model -> List Channel -> List Channel
listed model channels =
    if searching model then
        channels

    else
        List.filter
            (\c ->
                isActive model c.name
                    || (if isRoomName model c.name then
                            not (Organizer.isHidden c.name (orgOf model))

                        else
                            Organizer.closedVisible c.name (orgOf model)
                       )
            )
            channels


{-| Rooms that sit in no folder (the plain Rooms section). -}
unfiledRooms : Model -> List Channel -> List Channel
unfiledRooms model rooms =
    (Organize.groupRooms .name (orgOf model).folders rooms).unfiled


{-| One collapsible section per folder that has a listed room, between
Favorites and Rooms. A filter in use opens every folder so matches are
never tucked away; a collapsed folder still shows its unread count. -}
folderSections : Model -> (Channel -> Html Msg) -> List Channel -> List (Html Msg)
folderSections model rowView rooms =
    let
        filtering =
            not (String.isEmpty (String.trim model.sidebarFilter)) || model.sidebarUnreadOnly

        grouped =
            Organize.groupRooms .name (orgOf model).folders rooms
    in
    List.filterMap
        (\( folder, members ) ->
            if List.isEmpty members then
                Nothing

            else
                let
                    open =
                        filtering || not folder.collapsed

                    waiting =
                        List.sum (List.map .unread members)

                    mentions =
                        List.sum (List.map .highlights members)

                    listId =
                        "sidebar-folder-" ++ folder.id
                in
                Just
                    (div
                        [ class "onyx-rail-section onyx-rail-section--rooms gorg-folder"
                        , classList [ ( "gorg-folder--collapsed", not open ) ]
                        , attribute "data-testid" "sidebar-folder"
                        ]
                        [ button
                            [ type_ "button"
                            , class "gorg-folder-head"
                            , attribute "aria-expanded" (boolAttr open)
                            , attribute "aria-controls" listId
                            , attribute "data-testid" "sidebar-folder-toggle"
                            , disabled (filtering || not (ready model))
                            , onClick (org (Organizer.FolderToggle folder.id))
                            ]
                            [ icon "chevron"
                            , span [ class "gorg-folder-name" ] [ text folder.name ]
                            , if not open && (waiting > 0 || mentions > 0) then
                                span
                                    [ class "gorg-folder-count"
                                    , classList [ ( "gorg-folder-count--mention", mentions > 0 ) ]
                                    , attribute "aria-label"
                                        (String.fromInt waiting
                                            ++ " unread"
                                            ++ (if mentions > 0 then
                                                    ", " ++ String.fromInt mentions ++ " mentions"

                                                else
                                                    ""
                                               )
                                        )
                                    ]
                                    [ text
                                        (if mentions > 0 then
                                            "@" ++ String.fromInt mentions

                                         else
                                            String.fromInt waiting
                                        )
                                    ]

                              else
                                text ""
                            ]
                        , if open then
                            ul [ id listId, attribute "role" "list", attribute "aria-label" ("Rooms in " ++ folder.name) ]
                                (List.map rowView members)

                          else
                            text ""
                        ]
                    )
        )
        grouped.folders


{-| "2 hidden rooms" under the Rooms list: opens the list of hidden
rooms, each with Show and a way in. -}
hiddenFooter : Model -> Html Msg
hiddenFooter model =
    let
        joined =
            Dict.values model.channels
                |> List.filter (\c -> isRoomName model c.name && Organizer.isHidden c.name (orgOf model) && not (isActive model c.name))
                |> List.sortBy (.name >> String.toLower)

        count =
            List.length joined
    in
    if count == 0 || searching model then
        text ""

    else
        div [ class "gorg-tucked", attribute "data-testid" "sidebar-hidden" ]
            [ button
                [ type_ "button"
                , class "gorg-tucked-toggle"
                , attribute "aria-expanded" (boolAttr (orgOf model).showHidden)
                , attribute "data-testid" "sidebar-hidden-toggle"
                , onClick (org Organizer.ShowHiddenToggle)
                ]
                [ icon "eye-off"
                , text
                    (String.fromInt count
                        ++ (if count == 1 then
                                " hidden room"

                            else
                                " hidden rooms"
                           )
                    )
                ]
            , if (orgOf model).showHidden then
                ul [ class "gorg-tucked-list", attribute "role" "list", attribute "aria-label" "Hidden rooms" ]
                    (List.map
                        (\c ->
                            li [ class "gorg-tucked-row" ]
                                [ button
                                    [ type_ "button"
                                    , class "gorg-tucked-open"
                                    , attribute "aria-label" ("Open " ++ c.name ++ " (hidden)")
                                    , onClick (ChannelSelect c.name)
                                    ]
                                    [ span [ class "gorg-tucked-name" ] [ text c.name ]
                                    , if c.unread > 0 then
                                        span [ class "gorg-tucked-count" ] [ text (String.fromInt c.unread) ]

                                      else
                                        text ""
                                    ]
                                , button
                                    [ type_ "button"
                                    , class "gorg-tucked-action"
                                    , attribute "aria-label" ("Show " ++ c.name ++ " in your list")
                                    , attribute "data-testid" "sidebar-unhide"
                                    , onClick (org (Organizer.Unhide c.name))
                                    ]
                                    [ text "Show" ]
                                ]
                        )
                        joined
                    )

              else
                text ""
            ]


{-| "1 closed conversation" under the Messages list. -}
closedFooter : Model -> Html Msg
closedFooter model =
    let
        closed =
            Dict.values model.channels
                |> List.filter (\c -> not (isRoomName model c.name) && not (Organizer.closedVisible c.name (orgOf model)) && not (isActive model c.name))
                |> List.sortBy (.name >> String.toLower)

        count =
            List.length closed
    in
    if count == 0 || searching model then
        text ""

    else
        div [ class "gorg-tucked", attribute "data-testid" "sidebar-closed" ]
            [ button
                [ type_ "button"
                , class "gorg-tucked-toggle"
                , attribute "aria-expanded" (boolAttr (orgOf model).showClosed)
                , attribute "data-testid" "sidebar-closed-toggle"
                , onClick (org Organizer.ShowClosedToggle)
                ]
                [ icon "archive"
                , text
                    (String.fromInt count
                        ++ (if count == 1 then
                                " closed conversation"

                            else
                                " closed conversations"
                           )
                    )
                ]
            , if (orgOf model).showClosed then
                ul [ class "gorg-tucked-list", attribute "role" "list", attribute "aria-label" "Closed conversations" ]
                    (List.map
                        (\c ->
                            li [ class "gorg-tucked-row" ]
                                [ span [ class "gorg-tucked-name gorg-tucked-name--static" ] [ text c.name ]
                                , button
                                    [ type_ "button"
                                    , class "gorg-tucked-action"
                                    , attribute "aria-label" ("Reopen conversation with " ++ c.name)
                                    , attribute "data-testid" "sidebar-reopen"
                                    , onClick (org (Organizer.Reopen c.name))
                                    ]
                                    [ text "Reopen" ]
                                ]
                        )
                        closed
                    )

              else
                text ""
            ]


{-| The row's overflow control (a quiet `…`: on hover / focus with a
fine pointer, always on touch). -}
rowMore : Model -> Channel -> Html Msg
rowMore model channel =
    let
        room =
            isRoomName model channel.name

        open =
            (orgOf model).sheet == Just (RowMenu channel.name)
    in
    button
        [ type_ "button"
        , class "gorg-row-more"
        , attribute "data-testid" "sidebar-organize-more"
        , attribute "aria-label"
            ((if room then
                "Organize "

              else
                "Organize conversation with "
             )
                ++ channel.name
            )
        , attribute "aria-haspopup" "dialog"
        , attribute "aria-expanded" (boolAttr open)
        , attribute "title" "Organize"
        , onClick (org (Organizer.RowMenuOpen channel.name))
        ]
        [ icon "more" ]


menuItem : { key : String, label : String, hint : Maybe String, icon : String, msg : Msg, extra : List (Html.Attribute Msg) } -> Html Msg
menuItem item =
    button
        ([ type_ "button"
         , class "gorg-menu-item onyx-railmenu-item"
         , attribute "data-testid" ("organize-" ++ item.key)
         , onClick item.msg
         ]
            ++ item.extra
        )
        [ icon item.icon
        , span [ class "gorg-menu-copy onyx-railmenu-label" ]
            [ span [ class "gorg-menu-label" ] [ text item.label ]
            , case item.hint of
                Just hint ->
                    span [ class "gorg-menu-hint" ] [ text hint ]

                Nothing ->
                    text ""
            ]
        ]


{-| The organize entries of a row menu: rooms move between folders and
hide / show; DMs close. (DM mute is `muteEntry`.) -}
railMenuEntries : Model -> Channel -> List (Html Msg)
railMenuEntries model channel =
    let
        locked =
            [ disabled (not (ready model)) ]
    in
    if isRoomName model channel.name then
        let
            hidden =
                Organizer.isHidden channel.name (orgOf model)

            folder =
                Organize.folderOf channel.name (orgOf model).folders
        in
        [ menuItem
            { key = "move"
            , label = "Move to folder…"
            , hint = Just (Maybe.map (\f -> "In " ++ f.name) folder |> Maybe.withDefault "In Rooms")
            , icon = "folder"
            , msg = org (Organizer.MoveOpen channel.name)
            , extra = attribute "aria-haspopup" "dialog" :: locked
            }
        , menuItem
            { key = "hide"
            , label =
                if hidden then
                    "Show room"

                else
                    "Hide room"
            , hint =
                if hidden then
                    Just "Put it back in your list"

                else
                    Just "Stay joined; it returns when you're mentioned"
            , icon =
                if hidden then
                    "eye"

                else
                    "eye-off"
            , msg =
                if hidden then
                    org (Organizer.Unhide channel.name)

                else
                    org (Organizer.Hide channel.name)
            , extra = attribute "aria-pressed" (boolAttr hidden) :: locked
            }
        ]

    else
        [ menuItem
            { key = "close"
            , label = "Close conversation"
            , hint = Just "Leaves Messages; nothing is deleted"
            , icon = "archive"
            , msg = org (Organizer.CloseConversation channel.name)
            , extra = locked
            }
        ]


dmMuted : Model -> String -> Bool
dmMuted model nick =
    Set.member (String.toLower (String.trim nick)) model.mutedDMs


{-| A quiet bell-off beside a muted DM's time / unread (the row still
reads as a conversation; this only says it will not ping). -}
mutedMark : Model -> String -> Html Msg
mutedMark model nick =
    if dmMuted model nick then
        span
            [ class "gorg-muted-mark"
            , attribute "title" "Muted"
            , attribute "aria-hidden" "true"
            , attribute "data-testid" "sidebar-dm-muted"
            ]
            [ icon "bell-off" ]

    else
        text ""


{-| The same fact for the row's accessible name. -}
mutedLabel : Model -> String -> String
mutedLabel model nick =
    if dmMuted model nick then
        ", muted"

    else
        ""


{-| Mute / unmute a DM (the existing `MuteDm` / `UnmuteDm` folds). -}
muteEntry : Model -> String -> Html Msg
muteEntry model nick =
    let
        muted =
            Set.member (String.toLower (String.trim nick)) model.mutedDMs
    in
    menuItem
        { key = "mute"
        , label =
            if muted then
                "Unmute conversation"

            else
                "Mute conversation"
        , hint =
            if muted then
                Just ("Alerts from " ++ nick ++ " resume")

            else
                Just "No alerts or unread badges from them"
        , icon =
            if muted then
                "bell"

            else
                "bell-off"
        , msg =
            if muted then
                UnmuteDm nick

            else
                MuteDm nick
        , extra = [ attribute "aria-pressed" (boolAttr muted), attribute "aria-label" ((if muted then "Unmute " else "Mute ") ++ nick) ]
        }



-- SHEETS


sheets : Model -> Html Msg
sheets model =
    case (orgOf model).sheet of
        Nothing ->
            text ""

        Just (RowMenu name) ->
            rowMenuSheet model name

        Just (MoveToFolder room) ->
            moveSheet model room

        Just Bookmarks ->
            bookmarksSheet model


rowMenuSheet : Model -> String -> Html Msg
rowMenuSheet model name =
    case Dict.get (String.toLower name) model.channels of
        Nothing ->
            text ""

        Just channel ->
            let
                room =
                    isRoomName model name
            in
            Sheet.view
                { scope = "organize-menu"
                , label = Sheet.LabelledBy (Sheet.titleId "organize-menu")
                , onClose = org Organizer.SheetClose
                , placement = Sheet.Center
                , layerClass = "gorg-layer"
                , panelClass = "gorg-menu"
                , backdropClass = ""
                , layerAttrs = []
                , modal = True
                , attrs = [ attribute "data-testid" "organize-menu" ]
                }
                [ div [ class "gorg-menu-head" ]
                    [ if room then
                        span [ class "gorg-menu-tile", attribute "aria-hidden" "true" ] [ text (String.left 1 (String.dropLeft 1 channel.name) |> String.toUpper) ]

                      else
                        span [ class "onyx-face gorg-menu-face", attribute "aria-hidden" "true" ] [ text (Avatar.initials channel.name) ]
                    , div [ class "gorg-menu-titles" ]
                        [ h2 [ class "gorg-menu-title", id (Sheet.titleId "organize-menu") ] [ text channel.name ]
                        , p [ class "gorg-menu-sub" ]
                            [ text
                                (if room then
                                    "Room · on this device"

                                 else
                                    "Direct message · on this device"
                                )
                            ]
                        ]
                    , Sheet.closeButton { label = "Close", onClose = org Organizer.SheetClose, testId = Nothing, extraClass = "gorg-menu-close" }
                    ]
                , div [ class "gorg-menu-items", attribute "role" "group", attribute "aria-label" ("Organize " ++ channel.name) ]
                    ((if room then
                        []

                      else
                        [ muteEntry model channel.name ]
                     )
                        ++ railMenuEntries model channel
                    )
                , if ready model then
                    text ""

                  else
                    p [ class "gorg-menu-note" ] [ text "Connect to keep folders and hidden rooms on this device." ]
                ]


moveSheet : Model -> String -> Html Msg
moveSheet model room =
    let
        current =
            Organize.folderOf room (orgOf model).folders |> Maybe.map .id

        option target label count =
            let
                selected =
                    current == target
            in
            li []
                [ button
                    [ type_ "button"
                    , class "gorg-choice"
                    , classList [ ( "gorg-choice--on", selected ) ]
                    , attribute "role" "radio"
                    , attribute "aria-checked" (boolAttr selected)
                    , attribute "data-testid" "organize-folder-choice"
                    , disabled (not (ready model))
                    , onClick (org (Organizer.FolderAssign room target))
                    ]
                    [ icon
                        (if target == Nothing then
                            "list"

                         else
                            "folder"
                        )
                    , span [ class "gorg-choice-label" ] [ text label ]
                    , span [ class "gorg-choice-meta" ] [ text count ]
                    , if selected then
                        icon "check"

                      else
                        text ""
                    ]
                ]

        roomsLabel n =
            if n == 1 then
                "1 room"

            else
                String.fromInt n ++ " rooms"
    in
    Sheet.view
        { scope = "organize-move"
        , label = Sheet.LabelledBy (Sheet.titleId "organize-move")
        , onClose = org Organizer.SheetClose
        , placement = Sheet.Center
        , layerClass = "gorg-layer"
        , panelClass = "gorg-move"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" "organize-move" ]
        }
        [ Sheet.headerWith
            (Sheet.head { scope = "organize-move", title = "Move to folder", closeLabel = "Close", onClose = org Organizer.SheetClose }
                |> (\h -> { h | subtitle = Just ("Where " ++ room ++ " sits in your Rooms list. Only on this device.") })
            )
        , div [ class "gorg-move-body" ]
            [ ul [ class "gorg-choices", attribute "role" "radiogroup", attribute "aria-label" ("Folder for " ++ room) ]
                (option Nothing "No folder" "Rooms"
                    :: List.map (\f -> option (Just f.id) f.name (roomsLabel (List.length f.rooms))) (orgOf model).folders
                )
            , form [ class "gorg-new-folder", onSubmit (org (Organizer.FolderCreate (Just room))) ]
                [ label [ class "gorg-field-label", for "organize-new-folder" ] [ text "New folder" ]
                , div [ class "gorg-inline" ]
                    [ input
                        [ id "organize-new-folder"
                        , class "gorg-input"
                        , type_ "text"
                        , placeholder "Folder name"
                        , maxlength Organize.maxFolderNameLength
                        , value (orgOf model).folderDraft
                        , attribute "data-testid" "organize-new-folder"
                        , attribute "autocomplete" "off"
                        , attribute "enterkeyhint" "done"
                        , disabled (not (ready model))
                        , onInput (org << Organizer.FolderDraft)
                        ]
                        []
                    , button
                        [ type_ "submit"
                        , class "gorg-btn gorg-btn--primary"
                        , attribute "data-testid" "organize-create-folder"
                        , disabled (not (ready model) || String.isEmpty (String.trim (orgOf model).folderDraft))
                        ]
                        [ text "Create and move" ]
                    ]
                , errorLine (orgOf model).folderError
                ]
            ]
        ]


errorLine : Maybe String -> Html Msg
errorLine err =
    case err of
        Just why ->
            p [ class "gorg-error", attribute "role" "alert" ] [ text why ]

        Nothing ->
            text ""



-- SAVED MESSAGES


{-| Is this row encrypted (its words never leave the transcript)? -}
sealedRow : ChatMessage -> Bool
sealedRow m =
    m.plaintext /= Nothing || DmCipher.isEnvelope (String.trimLeft m.body) || GroupEnvelope.isGroupEnvelope (String.trimLeft m.body)


{-| The message menu's Save / Remove entry (rows with a server id). -}
bookmarkMenuItem : Model -> String -> ChatMessage -> String -> Maybe (Html Msg)
bookmarkMenuItem model target m msgid =
    if m.deleted || m.redacted || m.pending then
        Nothing

    else
        let
            saved =
                Organize.isBookmarked target msgid (orgOf model).bookmarks
        in
        Just
            (button
                [ type_ "button"
                , class "onyx-msg-menu-item gorg-msg-save"
                , attribute "role" "menuitem"
                , attribute "data-testid" "msg-menu-save"
                , attribute "aria-label"
                    (if saved then
                        "Remove message from " ++ m.from ++ " from saved messages"

                     else
                        "Save message from " ++ m.from
                    )
                , attribute "aria-pressed" (boolAttr saved)
                , disabled (not (ready model))
                , onClick
                    (org
                        (Organizer.BookmarkSave
                            { id = msgid
                            , target = target
                            , from = m.from
                            , text =
                                if sealedRow m then
                                    Nothing

                                else
                                    Just (App.displayBody m)
                            , at = m.at
                            , savedAt = round model.nowMs
                            }
                        )
                    )
                ]
                [ text
                    (if saved then
                        "Remove from saved"

                     else
                        "Save message"
                    )
                ]
            )


bookmarksSheet : Model -> Html Msg
bookmarksSheet model =
    let
        saved =
            (orgOf model).bookmarks
    in
    Sheet.view
        { scope = "organize-saved"
        , label = Sheet.LabelledBy (Sheet.titleId "organize-saved")
        , onClose = org Organizer.SheetClose
        , placement = Sheet.Side
        , layerClass = "gorg-layer"
        , panelClass = "gorg-saved"
        , backdropClass = ""
        , layerAttrs = []
        , modal = True
        , attrs = [ attribute "data-testid" "organize-saved" ]
        }
        [ Sheet.headerWith
            (Sheet.head { scope = "organize-saved", title = "Saved messages", closeLabel = "Close saved messages", onClose = org Organizer.SheetClose }
                |> (\h -> { h | subtitle = Just "Kept on this device. Encrypted messages save their place, never their words." })
            )
        , if List.isEmpty saved then
            div [ class "gorg-empty", attribute "role" "status" ]
                [ icon "bookmark"
                , p [ class "gorg-empty-title" ] [ text "Nothing saved yet" ]
                , p [ class "gorg-empty-body" ] [ text "Open a message's menu and choose Save message to keep it here." ]
                ]

          else
            ul [ class "gorg-saved-list", attribute "role" "list", attribute "aria-label" "Saved messages" ]
                (List.map (savedRow model) saved)
        ]


savedRow : Model -> Organize.Bookmark -> Html Msg
savedRow model b =
    let
        when =
            if b.at > 0 then
                Stats.relTime (toFloat b.at / 1000) model.nowMs

            else
                ""

        joined =
            Dict.member (String.toLower b.target) model.channels
    in
    li [ class "gorg-saved-row", attribute "data-testid" "organize-saved-row" ]
        [ button
            [ type_ "button"
            , class "gorg-saved-open"
            , attribute "aria-label" ("Open saved message from " ++ b.from ++ " in " ++ b.target)
            , disabled (not joined)
            , onClick (org (Organizer.BookmarkJump b.target b.id))
            ]
            [ span [ class "gorg-saved-meta" ]
                [ strong [ class "gorg-saved-where" ] [ text b.target ]
                , span [ class "gorg-saved-from" ] [ text b.from ]
                , if String.isEmpty when then
                    text ""

                  else
                    span [ class "gorg-saved-when" ] [ text when ]
                ]
            , span [ class "gorg-saved-text", classList [ ( "gorg-saved-text--locked", b.locked ) ] ]
                [ text
                    (if b.locked then
                        "Encrypted message — open it to read"

                     else if String.isEmpty b.snippet then
                        "(no text)"

                     else
                        b.snippet
                    )
                ]
            , if joined then
                text ""

              else
                span [ class "gorg-saved-gone" ] [ text "Not joined on this connection" ]
            ]
        , button
            [ type_ "button"
            , class "gorg-icon-btn"
            , attribute "aria-label" ("Remove saved message from " ++ b.from)
            , attribute "title" "Remove"
            , attribute "data-testid" "organize-saved-remove"
            , onClick (org (Organizer.BookmarkRemove b.target b.id))
            ]
            [ icon "close" ]
        ]


{-| You hub → This device → Saved messages. -}
youEntry : Model -> Html Msg
youEntry model =
    let
        n =
            List.length (orgOf model).bookmarks
    in
    button
        [ type_ "button"
        , class "onyx-you-link"
        , attribute "data-testid" "you-open-saved"
        , attribute "aria-haspopup" "dialog"
        , onClick (org Organizer.BookmarksOpen)
        ]
        [ span []
            [ strong [] [ text "Saved messages" ]
            , small []
                [ text
                    (if n == 0 then
                        "Messages you keep to come back to"

                     else if n == 1 then
                        "1 saved message"

                     else
                        String.fromInt n ++ " saved messages"
                    )
                ]
            ]
        ]


{-| Home: the three newest saved messages. -}
homeSaved : Model -> Html Msg
homeSaved model =
    case (orgOf model).bookmarks of
        [] ->
            text ""

        saved ->
            section [ class "onyx-home-saved gorg-home-saved", attribute "aria-labelledby" "home-saved-title", attribute "data-testid" "home-saved" ]
                [ div [ class "onyx-home-head" ]
                    [ h2 [ class "onyx-home-label", id "home-saved-title" ] [ text "Saved messages" ]
                    , button
                        [ type_ "button"
                        , class "gorg-link"
                        , attribute "aria-haspopup" "dialog"
                        , attribute "data-testid" "home-saved-all"
                        , onClick (org Organizer.BookmarksOpen)
                        ]
                        [ text
                            (if List.length saved > 3 then
                                "See all " ++ String.fromInt (List.length saved)

                             else
                                "Open"
                            )
                        ]
                    ]
                , ul [ class "gorg-saved-list gorg-saved-list--home", attribute "role" "list" ]
                    (List.map (savedRow model) (List.take 3 saved))
                ]



-- ROOM HEADER / ROOM SETTINGS


moreItem : String -> String -> String -> Msg -> List (Html.Attribute Msg) -> Html Msg
moreItem testId classes label msg extra =
    button ([ type_ "button", class ("gorg-more " ++ classes), attribute "data-testid" testId, onClick msg ] ++ extra) [ text label ]


{-| Room / DM More menu entries (mute and close for DMs; folder and
hide for rooms; saved messages and reader mode for both). -}
roomMoreItems : Model -> String -> Bool -> List (Html Msg)
roomMoreItems model name room =
    let
        reader =
            model.prefs.readerMode

        savedCount =
            List.length (orgOf model).bookmarks

        ownerReady =
            [ disabled (not (ready model)) ]
    in
    (if room then
        let
            hidden =
                Organizer.isHidden name (orgOf model)
        in
        [ moreItem "room-more-folder" "gorg-more--folder" "Move to folder…" (org (Organizer.MoveOpen name)) (attribute "aria-haspopup" "dialog" :: ownerReady)
        , moreItem "room-more-hide"
            (if hidden then
                "gorg-more--show"

             else
                "gorg-more--hide"
            )
            (if hidden then
                "Show room in list"

             else
                "Hide room from list"
            )
            (if hidden then
                org (Organizer.Unhide name)

             else
                org (Organizer.Hide name)
            )
            (attribute "aria-pressed" (boolAttr hidden) :: ownerReady)
        ]

     else
        let
            muted =
                Set.member (String.toLower (String.trim name)) model.mutedDMs
        in
        [ moreItem "dm-more-mute"
            (if muted then
                "gorg-more--unmute"

             else
                "gorg-more--mute"
            )
            (if muted then
                "Unmute conversation"

             else
                "Mute conversation"
            )
            (if muted then
                UnmuteDm name

             else
                MuteDm name
            )
            [ attribute "aria-pressed" (boolAttr muted)
            , attribute "aria-label"
                ((if muted then
                    "Unmute "

                  else
                    "Mute "
                 )
                    ++ name
                )
            ]
        , moreItem "dm-more-close" "gorg-more--close" "Close conversation" (org (Organizer.CloseConversation name)) (attribute "aria-label" ("Close conversation with " ++ name) :: ownerReady)
        ]
    )
        ++ [ moreItem "room-more-saved"
                "gorg-more--saved"
                (if savedCount > 0 then
                    "Saved messages (" ++ String.fromInt savedCount ++ ")"

                 else
                    "Saved messages"
                )
                (org Organizer.BookmarksOpen)
                [ attribute "aria-haspopup" "dialog" ]
           , moreItem "room-more-reader"
                "gorg-more--reader"
                (if reader then
                    "Exit reader mode"

                 else
                    "Reader mode"
                )
                (PrefsTogglePref "readerMode")
                [ attribute "aria-pressed" (boolAttr reader) ]
           ]


{-| Room settings → "On this device": the folder and hide switches. -}
roomSettingsSection : Model -> String -> Html Msg
roomSettingsSection model room =
    let
        hidden =
            Organizer.isHidden room (orgOf model)

        folder =
            Organize.folderOf room (orgOf model).folders
    in
    section [ class "rset-section gorg-rset", attribute "aria-labelledby" "chset-device-heading", attribute "data-testid" "chset-device" ]
        [ h3 [ id "chset-device-heading", class "rset-heading" ] [ text "On this device" ]
        , div [ class "gorg-rset-row" ]
            [ div [ class "gorg-rset-copy" ]
                [ span [ class "gorg-rset-title" ] [ text "Folder" ]
                , span [ class "gorg-rset-hint" ] [ text (Maybe.map .name folder |> Maybe.withDefault "Not in a folder") ]
                ]
            , button
                [ type_ "button"
                , class "gorg-btn"
                , attribute "aria-haspopup" "dialog"
                , attribute "data-testid" "chset-folder"
                , disabled (not (ready model))
                , onClick (org (Organizer.MoveOpen room))
                ]
                [ text "Change" ]
            ]
        , div [ class "gorg-rset-row" ]
            [ div [ class "gorg-rset-copy" ]
                [ span [ class "gorg-rset-title" ] [ text "Hide from Rooms" ]
                , span [ class "gorg-rset-hint" ] [ text "Stay joined. The room comes back to your list when someone mentions you." ]
                ]
            , button
                [ type_ "button"
                , class "gorg-switch"
                , attribute "role" "switch"
                , attribute "aria-checked" (boolAttr hidden)
                , attribute "aria-label" "Hide room from your list"
                , attribute "data-testid" "chset-hide"
                , disabled (not (ready model))
                , onClick
                    (if hidden then
                        org (Organizer.Unhide room)

                     else
                        org (Organizer.Hide room)
                    )
                ]
                [ span [ class "gorg-switch-knob", attribute "aria-hidden" "true" ] [] ]
            ]
        ]



-- MEMBER CARD NOTE


{-| A private note on a person, on their member card (yours only, kept
on this device). -}
memberNote : Model -> String -> Html Msg
memberNote model nick =
    let
        organize =
            (orgOf model)

        note =
            Organize.noteFor nick organize.notes

        editing =
            case organize.noteEditing of
                Just e ->
                    if String.toLower e.nick == String.toLower nick then
                        Just e

                    else
                        Nothing

                Nothing ->
                    Nothing

        fieldId =
            "member-note-" ++ String.toLower (String.filter Char.isAlphaNum nick)
    in
    if not (ready model) then
        text ""

    else
        case editing of
            Just e ->
                form [ class "gorg-note gorg-note--edit", attribute "data-testid" "member-note", onSubmit (org Organizer.NoteSave) ]
                    [ label [ class "gorg-note-label", for fieldId ] [ text ("Private note on " ++ nick) ]
                    , textarea
                        [ id fieldId
                        , class "gorg-note-input"
                        , value e.draft
                        , maxlength Organize.maxNoteLength
                        , attribute "rows" "3"
                        , attribute "data-testid" "member-note-input"
                        , attribute "data-onyx-autofocus" "member-note"
                        , placeholder "Only you can see this"
                        , onInput (org << Organizer.NoteDraft)
                        ]
                        []
                    , errorLine organize.noteError
                    , div [ class "gorg-note-actions" ]
                        [ span [ class "gorg-note-count" ] [ text (String.fromInt (String.length e.draft) ++ " / " ++ String.fromInt Organize.maxNoteLength) ]
                        , button [ type_ "button", class "gorg-btn", onClick (org Organizer.NoteCancel) ] [ text "Cancel" ]
                        , button [ type_ "submit", class "gorg-btn gorg-btn--primary", attribute "data-testid" "member-note-save" ] [ text "Save note" ]
                        ]
                    ]

            Nothing ->
                case note of
                    Just body ->
                        div [ class "gorg-note", attribute "data-testid" "member-note" ]
                            [ div [ class "gorg-note-head" ]
                                [ span [ class "gorg-note-label" ] [ icon "note", text "Your note" ]
                                , button
                                    [ type_ "button"
                                    , class "gorg-link"
                                    , attribute "aria-label" ("Edit your note on " ++ nick)
                                    , attribute "data-testid" "member-note-edit"
                                    , onClick (org (Organizer.NoteEdit nick))
                                    ]
                                    [ text "Edit" ]
                                ]
                            , p [ class "gorg-note-body" ] [ text body ]
                            ]

                    Nothing ->
                        button
                            [ type_ "button"
                            , class "gorg-note-add"
                            , attribute "data-testid" "member-note-add"
                            , attribute "aria-label" ("Add a private note on " ++ nick)
                            , onClick (org (Organizer.NoteEdit nick))
                            ]
                            [ icon "note", text "Add a private note" ]



-- PREFERENCES


{-| Preferences → Conversation → Organize: folders (create, rename,
reorder, delete), hidden rooms and closed conversations. -}
prefsOrganize : Model -> Html Msg
prefsOrganize model =
    let
        organize =
            (orgOf model)

        folders =
            organize.folders

        lastIndex =
            List.length folders - 1

        hiddenRooms =
            Set.toList organize.hidden

        closedDms =
            Dict.keys organize.closed
    in
    section [ class "pref-group gorg-prefs", attribute "aria-labelledby" "pref-organize-title", attribute "data-testid" "pref-organize" ]
        [ div [ class "pref-group-head" ] [ h3 [ class "pref-label", id "pref-organize-title" ] [ text "Organize your lists" ] ]
        , p [ class "pref-desc" ] [ text "Folders, hidden rooms and closed conversations live on this device, for this account." ]
        , if ready model then
            text ""

          else
            p [ class "pref-desc gorg-muted" ] [ text "Connect to load and change them." ]
        , h3 [ class "gorg-sub" ] [ text "Room folders" ]
        , if List.isEmpty folders then
            p [ class "pref-desc" ] [ text "No folders yet. Create one here, or move a room from its menu in the Rooms list." ]

          else
            ul [ class "gorg-folder-list", attribute "role" "list", attribute "aria-label" "Room folders" ]
                (List.indexedMap
                    (\i f ->
                        li [ class "gorg-folder-row", attribute "data-testid" "pref-folder" ]
                            (case organize.renaming of
                                Just r ->
                                    if r.id == f.id then
                                        [ form [ class "gorg-inline gorg-rename", onSubmit (org Organizer.FolderRenameSave) ]
                                            [ label [ class "sr-only", for "pref-folder-rename" ] [ text ("Rename " ++ f.name) ]
                                            , input
                                                [ id "pref-folder-rename"
                                                , class "gorg-input"
                                                , value r.draft
                                                , maxlength Organize.maxFolderNameLength
                                                , attribute "data-testid" "pref-folder-rename-input"
                                                , onInput (org << Organizer.FolderRenameDraft)
                                                ]
                                                []
                                            , button [ type_ "submit", class "gorg-btn gorg-btn--primary" ] [ text "Save" ]
                                            , button [ type_ "button", class "gorg-btn", onClick (org Organizer.FolderRenameCancel) ] [ text "Cancel" ]
                                            ]
                                        ]

                                    else
                                        folderRow model i lastIndex f

                                Nothing ->
                                    folderRow model i lastIndex f
                            )
                    )
                    folders
                )
        , form [ class "gorg-inline gorg-new-folder", onSubmit (org (Organizer.FolderCreate Nothing)) ]
            [ label [ class "sr-only", for "pref-new-folder" ] [ text "New folder name" ]
            , input
                [ id "pref-new-folder"
                , class "gorg-input"
                , type_ "text"
                , placeholder "New folder name"
                , maxlength Organize.maxFolderNameLength
                , value organize.folderDraft
                , attribute "data-testid" "pref-new-folder"
                , disabled (not (ready model))
                , onInput (org << Organizer.FolderDraft)
                ]
                []
            , button
                [ type_ "submit"
                , class "gorg-btn"
                , attribute "data-testid" "pref-create-folder"
                , disabled (not (ready model) || String.isEmpty (String.trim organize.folderDraft))
                ]
                [ text "Create folder" ]
            ]
        , errorLine organize.folderError
        , h3 [ class "gorg-sub" ] [ text "Hidden rooms" ]
        , if List.isEmpty hiddenRooms then
            p [ class "pref-desc" ] [ text "None. Hide a room from its menu to keep it joined but out of your list." ]

          else
            ul [ class "gorg-folder-list", attribute "role" "list", attribute "aria-label" "Hidden rooms" ]
                (List.map
                    (\r ->
                        li [ class "gorg-folder-row" ]
                            [ span [ class "gorg-folder-row-name" ] [ text r ]
                            , button [ type_ "button", class "gorg-btn", attribute "aria-label" ("Show " ++ r ++ " in your list"), onClick (org (Organizer.Unhide r)) ] [ text "Show" ]
                            ]
                    )
                    hiddenRooms
                )
        , h3 [ class "gorg-sub" ] [ text "Closed conversations" ]
        , if List.isEmpty closedDms then
            p [ class "pref-desc" ] [ text "None. A closed conversation comes back by itself when that person writes." ]

          else
            ul [ class "gorg-folder-list", attribute "role" "list", attribute "aria-label" "Closed conversations" ]
                (List.map
                    (\n ->
                        li [ class "gorg-folder-row" ]
                            [ span [ class "gorg-folder-row-name" ] [ text n ]
                            , button [ type_ "button", class "gorg-btn", attribute "aria-label" ("Reopen conversation with " ++ n), onClick (org (Organizer.Reopen n)) ] [ text "Reopen" ]
                            ]
                    )
                    closedDms
                )
        ]


folderRow : Model -> Int -> Int -> Organize.Folder -> List (Html Msg)
folderRow model i lastIndex f =
    let
        locked =
            not (ready model)

        count =
            List.length f.rooms
    in
    [ span [ class "gorg-folder-row-name" ]
        [ text f.name
        , span [ class "gorg-folder-row-count" ]
            [ text
                (if count == 1 then
                    " · 1 room"

                 else
                    " · " ++ String.fromInt count ++ " rooms"
                )
            ]
        ]
    , div [ class "gorg-folder-row-actions", attribute "role" "group", attribute "aria-label" ("Folder " ++ f.name) ]
        [ button [ type_ "button", class "gorg-icon-btn", attribute "aria-label" ("Move " ++ f.name ++ " up"), disabled (locked || i == 0), onClick (org (Organizer.FolderMove f.id -1)) ] [ icon "up" ]
        , button [ type_ "button", class "gorg-icon-btn", attribute "aria-label" ("Move " ++ f.name ++ " down"), disabled (locked || i == lastIndex), onClick (org (Organizer.FolderMove f.id 1)) ] [ icon "down" ]
        , button [ type_ "button", class "gorg-btn", attribute "aria-label" ("Rename " ++ f.name), disabled locked, onClick (org (Organizer.FolderRenameStart f.id)) ] [ text "Rename" ]
        , button [ type_ "button", class "gorg-btn gorg-btn--danger", attribute "aria-label" ("Delete folder " ++ f.name), attribute "data-testid" "pref-folder-delete", disabled locked, onClick (org (Organizer.FolderDelete f.id)) ] [ text "Delete" ]
        ]
    ]



-- HOME QUEUED SENDS


{-| Open / Remove (two-step) on a queued send row on Home. -}
homeOutboxActions : Model -> App.OutboxEntry -> Html Msg
homeOutboxActions model entry =
    let
        confirming =
            (orgOf model).outboxConfirm == Just entry.id
    in
    div [ class "gorg-outbox-actions" ]
        (if confirming then
            [ button
                [ type_ "button"
                , class "gorg-btn gorg-btn--danger"
                , attribute "aria-label" ("Confirm remove queued message for " ++ entry.target)
                , attribute "data-testid" "home-outbox-remove-confirm"
                , disabled model.prefsOutboxBusy
                , onClick (PrefsOutboxRemove entry.id)
                ]
                [ text "Confirm remove" ]
            , button [ type_ "button", class "gorg-btn", onClick (org Organizer.OutboxRemoveCancel) ] [ text "Keep" ]
            ]

         else
            [ button
                [ type_ "button"
                , class "gorg-btn"
                , attribute "aria-label" ("Open queued message for " ++ entry.target)
                , attribute "data-testid" "home-outbox-open"
                , onClick (org (Organizer.OutboxOpen entry.target))
                ]
                [ text "Open" ]
            , button
                [ type_ "button"
                , class "gorg-btn"
                , attribute "aria-label" ("Remove queued message for " ++ entry.target)
                , attribute "data-testid" "home-outbox-remove"
                , onClick (org (Organizer.OutboxRemoveAsk entry.id))
                ]
                [ text "Remove" ]
            ]
        )


{-| The organize memory for the live owner (empty until it loads). -}
orgOf : Model -> Organizer.State
orgOf model =
    Organizer.current (App.deviceMemoryOwner model) model.organize
