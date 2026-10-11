module View.Rail exposing (rail, railMenu)

{-| Sectioned conversation sidebar (mirroring `shell/ChannelSidebar.tsx`):
a filter (query + unread-only + clear), Favorites (starred rooms with a
star toggle), Rooms (alpha, colour label, topic line, activity stamp,
unread/mention badge), Messages (DMs by recency with the latest preview
line, time, device-key warning and the calm offline-memo stamp) with a
"New conversation" button, then "Browse rooms" / "Start a room".

Section/sort/filter derivation lives in `Sidebar`; this module only
renders it. Roving arrow-key focus, folders and the Activity entry stay
with later slices (see COVERAGE).

v3/ui-mobile-shell — Rooms and Messages are separate collections
(`data-collection`): the selected nav collection shows only its own
sections (Home shows both). Every section stays in the DOM; CSS hides
the other collection. On desktop this is the 280px collection sidebar
(dense single-line room rows, DM rows with their preview); under
600px (v3/rx-shell; was 768px) it is the full-screen Rooms / Messages page (64px rows with a
room tile or a face, the topic / preview line, time and badge, a
16px search field so iOS never zooms).

v3/rx-shell — every row has an overflow control (`sidebar-row-more`:
a quiet `…` on hover / focus with a fine pointer, always shown on
touch) and answers a context menu (right-click, Android long-press)
with the same row menu (`railMenu`, mounted with the overlays): for a
room Favorite, Mark as read, Notifications and Leave; for a DM Mark as
read and Mute. Pointer opens anchor the menu at the pointer on wide
screens; keyboard opens and phones get a centred / bottom sheet. Empty
Rooms / Messages collections say what they are for and offer the next
step (Browse rooms / Start a room; New message).
-}

import App exposing (Channel, Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, h2, input, label, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, placeholder, style, tabindex, type_, value)
import Html.Events exposing (on, onClick, onInput, preventDefaultOn)
import Json.Decode as Decode
import Nav
import Set
import Sidebar
-- v3/calls-c1
import View.Account2
import View.CallPresence
-- v3/rx-shell
import View.Notify
import View.Sheet as Sheet


{-| Which collection the sidebar shows. -}
collection : Model -> String
collection model =
    case model.navSection of
        Nav.Rooms ->
            "rooms"

        Nav.Messages ->
            "messages"

        _ ->
            "all"


rail : Model -> Html Msg
rail model =
    let
        derived =
            Sidebar.sections
                { isChannel = App.isChannelName model
                , starred = model.starredChannels
                , query = model.sidebarFilter
                , unreadOnly = model.sidebarUnreadOnly
                }
                (Dict.values model.channels)

        canStar =
            App.deviceMemoryOwner model /= Nothing

        which =
            collection model
    in
    section
        [ class "onyx-rail"
        , attribute "aria-label" "Room navigation"
        , attribute "data-collection" which
        ]
        ([ h2 [ class "onyx-rail-title" ]
            [ text
                (case which of
                    "rooms" ->
                        "Rooms"

                    "messages" ->
                        "Messages"

                    _ ->
                        "Conversations"
                )
            ]
         , filterBar model which derived
         ]
            ++ (if derived.filterEmpty then
                    [ p
                        [ class "onyx-rail-filter-empty"
                        , attribute "data-testid" "sidebar-filter-empty"
                        , attribute "role" "status"
                        ]
                        [ text (Sidebar.filterEmptyCopy model.sidebarFilter model.sidebarUnreadOnly) ]
                    ]

                else
                    []
               )
            ++ (if List.isEmpty derived.favorites then
                    []

                else
                    [ div [ class "onyx-rail-section onyx-rail-section--rooms", attribute "data-testid" "sidebar-favorites" ]
                        [ p [ class "onyx-rail-label", id "sidebar-favorites-label" ] [ text "Favorites" ]
                        , ul [ attribute "role" "list", attribute "aria-labelledby" "sidebar-favorites-label" ]
                            (List.map (roomRow model canStar) derived.favorites)
                        ]
                    ]
               )
            ++ [ div [ class "onyx-rail-section onyx-rail-section--rooms", attribute "data-testid" "sidebar-channels" ]
                    [ p [ class "onyx-rail-label", id "sidebar-channels-label" ] [ text "Rooms" ]
                    , ul [ attribute "role" "list", attribute "aria-label" "Joined rooms" ]
                        (if List.isEmpty derived.rooms && derived.roomsJoined == 0 then
                            [ li [ class "onyx-rail-zero" ] [ emptyRooms (which == "rooms") ] ]

                         else
                            List.map (roomRow model canStar) derived.rooms
                        )
                    ]
               , div [ class "onyx-rail-section onyx-rail-section--dms", attribute "data-testid" "sidebar-dms" ]
                    [ div [ class "onyx-rail-section-heading" ]
                        [ p [ class "onyx-rail-label", id "sidebar-dms-label" ] [ text "Messages" ]
                        , -- on the Messages page it sits in the filter row instead
                          if which == "messages" then
                            text ""

                          else
                            newConversation
                        ]
                    , if List.isEmpty derived.dms then
                        emptyMessages (which == "messages")

                      else
                        ul [ attribute "role" "list", attribute "aria-labelledby" "sidebar-dms-label" ]
                            (List.map (dmRow model) derived.dms)
                    ]
               , div [ class "onyx-rail-foot", attribute "role" "group", attribute "aria-label" "Find or start a room" ]
                    [ button
                        [ type_ "button"
                        , onClick App.BrowserOpen
                        , class "onyx-rail-browse"
                        , attribute "data-testid" "sidebar-browse-rooms"
                        ]
                        [ span [ class "onyx-shi", attribute "data-icon" "compass", attribute "aria-hidden" "true" ] []
                        , text "Browse rooms"
                        ]
                    , button
                        [ type_ "button"
                        , onClick App.CreateRoomOpen
                        , class "onyx-rail-browse onyx-rail-start"
                        , attribute "data-testid" "sidebar-start-room"
                        ]
                        [ span [ class "onyx-shi", attribute "data-icon" "plus", attribute "aria-hidden" "true" ] []
                        , text "Start a room"
                        ]
                    ]
               ]
        )


{-| v3/rx-shell — the empty Rooms collection: what rooms are, and the
two ways in. Home (both collections) already offers them, so there it
is one quiet line. -}
emptyRooms : Bool -> Html Msg
emptyRooms full =
    if not full then
        p [ class "onyx-rail-empty", attribute "data-testid" "sidebar-rooms-empty" ] [ text "No rooms yet. Browse rooms to join one." ]

    else
        div [ class "onyx-rail-emptystate", attribute "data-kind" "rooms", attribute "data-testid" "sidebar-rooms-empty" ]
            [ span [ class "onyx-rail-emptystate-mark", attribute "aria-hidden" "true" ]
                [ span [ class "onyx-shi", attribute "data-icon" "compass" ] [] ]
            , p [ class "onyx-rail-emptystate-title" ] [ text "No rooms yet" ]
            , p [ class "onyx-rail-empty" ] [ text "Rooms are where your people talk. Browse the public ones or start your own." ]
            , div [ class "onyx-rail-emptystate-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-rail-emptystate-go"
                    , attribute "data-testid" "sidebar-empty-browse"
                    , onClick App.BrowserOpen
                    ]
                    [ text "Browse rooms" ]
                , button
                    [ type_ "button"
                    , class "onyx-rail-emptystate-alt"
                    , attribute "data-testid" "sidebar-empty-start"
                    , onClick App.CreateRoomOpen
                    ]
                    [ text "Start a room" ]
                ]
            ]


{-| v3/rx-shell — the empty Messages collection. The full state (with
its New message action) shows on the Messages page; elsewhere a quiet
line, since the section heading already carries New. -}
emptyMessages : Bool -> Html Msg
emptyMessages full =
    if full then
        div [ class "onyx-rail-emptystate", attribute "data-kind" "messages", attribute "data-testid" "sidebar-dms-empty" ]
            [ span [ class "onyx-rail-emptystate-mark", attribute "aria-hidden" "true" ]
                [ span [ class "onyx-shi", attribute "data-icon" "compose" ] [] ]
            , p [ class "onyx-rail-emptystate-title" ] [ text "No messages yet" ]
            , p [ class "onyx-rail-empty" ] [ text "Private conversations with one person live here. Start one with anyone on Onyx." ]
            , div [ class "onyx-rail-emptystate-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-rail-emptystate-go"
                    , attribute "data-testid" "sidebar-empty-new"
                    , onClick NewMessageOpen
                    ]
                    [ text "New message" ]
                ]
            ]

    else
        p [ class "onyx-rail-empty", attribute "data-testid" "sidebar-dms-empty" ] [ text "No messages yet. Start one with New." ]


newConversation : Html Msg
newConversation =
    button
        [ type_ "button"
        , class "onyx-rail-new"
        , attribute "data-testid" "new-conversation"
        , attribute "aria-label" "New conversation"
        , attribute "title" "New conversation"
        , onClick NewMessageOpen
        ]
        [ span [ class "onyx-shi", attribute "data-icon" "compose", attribute "aria-hidden" "true" ] []
        , span [ class "onyx-rail-new-label" ] [ text "New" ]
        ]


filterBar : Model -> String -> Sidebar.Sections -> Html Msg
filterBar model which derived =
    div
        [ class "onyx-rail-filter"
        , classList [ ( "onyx-rail-filter-on", derived.filterActive ) ]
        , attribute "role" "search"
        ]
        ([ label [ class "sr-only", for "sidebar-filter-input" ] [ text "Filter rooms" ]
         , span [ class "onyx-rail-filter-field" ]
            [ span [ class "onyx-shi onyx-rail-filter-icon", attribute "data-icon" "search", attribute "aria-hidden" "true" ] []
            , input
                [ id "sidebar-filter-input"
                , class "onyx-rail-filter-input"
                , type_ "search"
                , attribute "data-testid" "sidebar-filter"
                , placeholder
                    (case which of
                        "rooms" ->
                            "Find a room"

                        "messages" ->
                            "Find a person"

                        _ ->
                            "Find a room or person"
                    )
                , attribute "autocomplete" "off"
                , attribute "spellcheck" "false"
                , attribute "enterkeyhint" "search"
                , attribute "autocapitalize" "off"
                , attribute "autocorrect" "off"
                , value model.sidebarFilter
                , onInput SidebarFilterInput
                , Html.Events.preventDefaultOn "keydown" (Decode.map (\escMsg -> ( escMsg, True )) (filterEscape derived.filterActive))
                ]
                []
            ]
         , button
            [ type_ "button"
            , class "onyx-rail-filter-unread"
            , classList [ ( "onyx-rail-filter-unread-on", model.sidebarUnreadOnly ) ]
            , attribute "data-testid" "sidebar-unread-only"
            , attribute "aria-pressed" (boolAttr model.sidebarUnreadOnly)
            , attribute "title"
                (if model.sidebarUnreadOnly then
                    "Showing unread only — click to show all"

                 else
                    "Show unread only"
                )
            , onClick SidebarUnreadOnlyToggle
            ]
            [ text "Unread" ]
         ]
            ++ (if derived.filterActive then
                    [ button
                        [ type_ "button"
                        , class "onyx-rail-filter-clear"
                        , attribute "data-testid" "sidebar-filter-clear"
                        , attribute "aria-label" "Clear filter"
                        , onClick SidebarFilterClear
                        ]
                        [ text "Clear" ]
                    ]

                else
                    []
               )
            ++ (if which == "messages" then
                    [ newConversation ]

                else
                    []
               )
        )


{-| Escape clears an active filter (IME composition yields). -}
filterEscape : Bool -> Decode.Decoder Msg
filterEscape active =
    Decode.map2 Tuple.pair
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\( key, composing ) ->
                if key == "Escape" && active && not composing then
                    Decode.succeed SidebarFilterClear

                else
                    Decode.fail "ignored"
            )


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"


isActive : Model -> String -> Bool
isActive model name =
    model.activeChannel
        |> Maybe.map (\a -> String.toLower a == String.toLower name)
        |> Maybe.withDefault False


badge : Channel -> Html Msg
badge channel =
    case Sidebar.badgeText channel of
        Just count ->
            span
                [ class "onyx-rail-unread"
                , classList [ ( "onyx-rail-mention", channel.highlights > 0 ) ]
                , attribute "aria-hidden" "true"
                ]
                [ text
                    (if channel.highlights > 0 then
                        "@" ++ count

                     else
                        count
                    )
                ]

        Nothing ->
            text ""


{-| The room's tile letter (`#lounge` → `L`). -}
tileLetter : String -> String
tileLetter name =
    let
        bare =
            String.trim name
                |> String.toList
                |> List.filter Char.isAlphaNum
                |> String.fromList
    in
    case String.uncons bare of
        Just ( c, _ ) ->
            String.toUpper (String.fromChar c)

        Nothing ->
            "#"


roomRow : Model -> Bool -> Channel -> Html Msg
roomRow model canStar channel =
    let
        active =
            isActive model channel.name

        starred =
            Sidebar.isStarred model.starredChannels channel.name

        stamp =
            Sidebar.activityStamp model.nowMs (Sidebar.channelActivityMs channel)

        topic =
            String.trim channel.topic

        color =
            Dict.get (String.toLower channel.name) model.channelColors
    in
    li []
        [ div
            [ class "onyx-rail-row"
            , classList [ ( "onyx-rail-row--starred", starred ), ( "onyx-rail-row--menu", menuOpenFor model channel.name ) ]
            , rowContextMenu channel.name
            ]
            ([ button
                [ type_ "button"
                , class "onyx-rail-item"
                , classList
                    [ ( "onyx-rail-active", active )
                    , ( "onyx-rail-has-unread", channel.unread > 0 && not active )
                    ]
                , attribute "aria-label" (Sidebar.roomAriaLabel channel starred ++ View.CallPresence.railAriaSuffix model channel.name)
                , attribute "aria-current"
                    (if active then
                        "location"

                     else
                        "false"
                    )
                , onClick (ChannelSelect channel.name)
                ]
                [ span
                    [ class "onyx-rail-tile"
                    , attribute "aria-hidden" "true"
                    ]
                    [ text (tileLetter channel.name) ]
                , case color of
                    Just c ->
                        span
                            [ class "onyx-rail-color"
                            , attribute "data-testid" "sidebar-channel-color"
                            , attribute "aria-hidden" "true"
                            , style "background-color" c
                            ]
                            []

                    Nothing ->
                        text ""
                , span [ class "onyx-rail-copy" ]
                    [ span [ class "onyx-rail-line" ]
                        [ span [ class "onyx-rail-name" ] [ text channel.name ]
                        , if String.isEmpty stamp then
                            text ""

                          else
                            span [ class "onyx-rail-time", attribute "aria-hidden" "true" ] [ text stamp ]
                        ]
                    , span [ class "onyx-rail-line onyx-rail-line--sub" ]
                        [ span [ class "onyx-rail-sub", attribute "aria-hidden" "true" ]
                            [ text
                                (if String.isEmpty topic then
                                    "No topic yet"

                                 else
                                    topic
                                )
                            ]
                        , span [ class "onyx-rail-meta" ]
                            [ -- v3/calls-c1
                              View.CallPresence.railCount model channel.name
                            , badge channel
                            ]
                        ]
                    ]
                ]
             ]
                ++ (if canStar then
                        [ button
                            [ type_ "button"
                            , class "onyx-rail-star"
                            , classList [ ( "onyx-rail-star-on", starred ) ]
                            , attribute "data-testid" "sidebar-channel-star"
                            , attribute "aria-label"
                                (if starred then
                                    "Remove " ++ channel.name ++ " from favorites"

                                 else
                                    "Add " ++ channel.name ++ " to favorites"
                                )
                            , attribute "aria-pressed" (boolAttr starred)
                            , attribute "title"
                                (if starred then
                                    "Remove from favorites"

                                 else
                                    "Add to favorites"
                                )
                            , tabindex -1
                            , onClick (SidebarStarToggle channel.name)
                            ]
                            [ span
                                [ class "onyx-shi"
                                , attribute "data-icon"
                                    (if starred then
                                        "star-on"

                                     else
                                        "star"
                                    )
                                , attribute "aria-hidden" "true"
                                ]
                                []
                            ]
                        ]

                    else
                        []
                   )
                ++ [ rowMore model channel True ]
            )
        ]


dmRow : Model -> Channel -> Html Msg
dmRow model channel =
    let
        active =
            isActive model channel.name

        preview =
            Sidebar.dmPreview channel

        offline =
            App.offlineMemoFor model channel.name
                |> Maybe.map .count
                |> Maybe.withDefault 0

        keyChanged =
            Set.member (String.toLower channel.name) model.peerKeyChanges

        stamp =
            Sidebar.activityStamp model.nowMs (Sidebar.dmActivityMs channel)
    in
    li []
        [ div
            [ class "onyx-rail-entry"
            , classList [ ( "onyx-rail-row--menu", menuOpenFor model channel.name ) ]
            , rowContextMenu channel.name
            ]
            [ button
            [ type_ "button"
            , class "onyx-rail-item onyx-rail-dm"
            , classList
                [ ( "onyx-rail-active", active )
                , ( "onyx-rail-has-unread", channel.unread > 0 && not active )
                ]
            , attribute "aria-label"
                (Sidebar.dmAriaLabel channel { preview = preview, keyChanged = keyChanged, offline = offline }
                    -- v3/account2
                    ++ View.Account2.friendPresenceLabel model channel.name
                )
            , attribute "aria-current"
                (if active then
                    "location"

                 else
                    "false"
                )
            , onClick (ChannelSelect channel.name)
            ]
            [ span [ class "onyx-face onyx-rail-avatar", attribute "aria-hidden" "true" ]
                [ text (Avatar.initials channel.name)
                , -- v3/account2
                  case View.Account2.friendPresence model channel.name of
                    Just online ->
                        span
                            [ class "a2-dot a2-dot--avatar"
                            , attribute "data-online"
                                (if online then
                                    "true"

                                 else
                                    "false"
                                )
                            , attribute "data-testid" "sidebar-dm-friend"
                            ]
                            []

                    Nothing ->
                        text ""
                ]
            , span [ class "onyx-rail-copy" ]
                [ span [ class "onyx-rail-line" ]
                    [ span [ class "onyx-rail-name" ] [ text channel.name ]
                    , if String.isEmpty stamp then
                        text ""

                      else
                        span [ class "onyx-rail-time", attribute "aria-hidden" "true" ] [ text stamp ]
                    ]
                , span [ class "onyx-rail-line onyx-rail-line--sub" ]
                    [ case preview of
                        Just line ->
                            span
                                [ class "onyx-rail-sub onyx-rail-preview"
                                , attribute "data-testid" "sidebar-dm-preview"
                                , attribute "aria-hidden" "true"
                                ]
                                [ text line ]

                        Nothing ->
                            span [ class "onyx-rail-sub", attribute "aria-hidden" "true" ] [ text "No messages yet" ]
                    , span [ class "onyx-rail-meta" ]
                        [ if keyChanged then
                            span
                                [ class "onyx-rail-keywarn"
                                , attribute "data-testid" "sidebar-dm-keywarn"
                                , attribute "title" "Device key changed"
                                , attribute "aria-hidden" "true"
                                ]
                                [ span [ class "onyx-shi", attribute "data-icon" "warn" ] [] ]

                          else
                            text ""
                        , if offline > 0 then
                            span [ class "onyx-rail-offline", attribute "aria-hidden" "true" ] [ text (Sidebar.offlineStamp offline) ]

                          else
                            text ""
                        , badge channel
                        ]
                    ]
                ]
            ]
            , rowMore model channel False
            ]
        ]


{-| v3/rx-shell — is the row menu open on this conversation? -}
menuOpenFor : Model -> String -> Bool
menuOpenFor model name =
    Maybe.map (.name >> String.toLower) model.railMenu == Just (String.toLower name)


{-| v3/rx-shell — the row's overflow control. -}
rowMore : Model -> Channel -> Bool -> Html Msg
rowMore model channel isRoom =
    button
        [ type_ "button"
        , class "onyx-rail-more"
        , attribute "data-testid" "sidebar-row-more"
        , attribute "aria-label"
            ((if isRoom then
                "Room options for "

              else
                "Conversation options for "
             )
                ++ channel.name
            )
        , attribute "aria-haspopup" "dialog"
        , attribute "aria-expanded" (boolAttr (menuOpenFor model channel.name))
        , attribute "title" "More options"
        , on "click" (Decode.map RailMenuOpen (clickPoint channel.name))
        ]
        [ span [ class "onyx-shi", attribute "data-icon" "more", attribute "aria-hidden" "true" ] [] ]


{-| A context menu on the row (right-click; Android reports a long
press the same way) opens the row menu at the pointer. Fields keep the
browser's own menu. -}
rowContextMenu : String -> Html.Attribute Msg
rowContextMenu name =
    preventDefaultOn "contextmenu"
        (Decode.oneOf [ Decode.at [ "target", "tagName" ] Decode.string, Decode.succeed "" ]
            |> Decode.andThen
                (\tag ->
                    if List.member (String.toUpper tag) [ "INPUT", "TEXTAREA" ] then
                        Decode.fail "native menu"

                    else
                        Decode.map (\menu -> ( RailMenuOpen menu, True )) (point name)
                )
        )


{-| Where a pointer asked for the menu (with the viewport size, so the
view can flip it near the bottom edge). -}
point : String -> Decode.Decoder App.RailMenu
point name =
    Decode.map4 (\x y vw vh -> { name = name, x = x, y = y, vw = vw, vh = vh })
        (Decode.oneOf [ Decode.field "clientX" Decode.float, Decode.succeed 0 ])
        (Decode.oneOf [ Decode.field "clientY" Decode.float, Decode.succeed 0 ])
        (Decode.oneOf [ Decode.at [ "view", "innerWidth" ] Decode.float, Decode.succeed 0 ])
        (Decode.oneOf [ Decode.at [ "view", "innerHeight" ] Decode.float, Decode.succeed 0 ])


{-| A click carries a pointer position unless a key pressed the
button (`detail` 0): keyboard opens centre the menu. -}
clickPoint : String -> Decode.Decoder App.RailMenu
clickPoint name =
    Decode.map2
        (\detail menu ->
            if detail == 0 then
                { menu | x = 0, y = 0 }

            else
                menu
        )
        (Decode.oneOf [ Decode.field "detail" Decode.int, Decode.succeed 0 ])
        (point name)


{-| v3/rx-shell — the row menu: a context menu anchored at the pointer
on wide screens, a centred dialog for keyboard opens, a bottom sheet on
phones (all through `View.Sheet`, so focus, Escape and light dismiss
behave like every other sheet).
-}
railMenu : Model -> Html Msg
railMenu model =
    case App.railMenuFor model of
        Nothing ->
            text ""

        Just ( menu, channel ) ->
            let
                isRoom =
                    App.isChannelName model channel.name

                anchored =
                    menu.vw >= 768 && (menu.x > 0 || menu.y > 0)

                width =
                    272

                left =
                    clamp 8 (max 8 (menu.vw - width - 8)) (menu.x - 4)

                lowerHalf =
                    menu.y > menu.vh * 0.58

                px n =
                    String.fromInt (round n) ++ "px"

                anchor =
                    if anchored then
                        [ style "left" (px left)
                        , if lowerHalf then
                            style "bottom" (px (menu.vh - menu.y + 4))

                          else
                            style "top" (px (menu.y + 4))
                        , style "max-height"
                            (px
                                (if lowerHalf then
                                    menu.y - 12

                                 else
                                    menu.vh - menu.y - 12
                                )
                            )
                        ]

                    else
                        []

                starred =
                    Sidebar.isStarred model.starredChannels channel.name

                canStar =
                    App.deviceMemoryOwner model /= Nothing

                waiting =
                    Sidebar.hasAttention channel

                muted =
                    Set.member (String.toLower channel.name) model.mutedDMs

                status =
                    if channel.highlights > 0 then
                        String.fromInt channel.highlights
                            ++ (if channel.highlights == 1 then
                                    " mention"

                                else
                                    " mentions"
                               )
                            ++ (if channel.unread > 0 then
                                    " · " ++ String.fromInt channel.unread ++ " unread"

                                else
                                    ""
                               )

                    else if channel.unread > 0 then
                        String.fromInt channel.unread ++ " unread"

                    else
                        "No new messages"

                item key label icon msg extra =
                    button
                        ([ type_ "button"
                         , class "onyx-railmenu-item"
                         , attribute "data-testid" ("rail-menu-" ++ key)
                         , onClick msg
                         ]
                            ++ extra
                        )
                        [ span [ class "onyx-shi", attribute "data-icon" icon, attribute "aria-hidden" "true" ] []
                        , span [ class "onyx-railmenu-label" ] [ text label ]
                        ]
            in
            Sheet.view
                { scope = "rail-menu"
                , label = Sheet.LabelledBy (Sheet.titleId "rail-menu")
                , onClose = RailMenuClose
                , placement = Sheet.Center
                , layerClass = "onyx-railmenu-layer"
                , panelClass = "onyx-railmenu"
                , backdropClass = ""
                , layerAttrs = [ attribute "data-anchored" (boolAttr anchored) ]
                , modal = True
                , attrs = attribute "data-testid" "rail-menu" :: anchor
                }
                ([ div [ class "onyx-railmenu-head" ]
                    [ if isRoom then
                        span [ class "onyx-rail-tile onyx-railmenu-tile", attribute "aria-hidden" "true" ] [ text (tileLetter channel.name) ]

                      else
                        span [ class "onyx-face onyx-railmenu-face", attribute "aria-hidden" "true" ] [ text (Avatar.initials channel.name) ]
                    , div [ class "onyx-railmenu-titles" ]
                        [ h2 [ class "onyx-railmenu-title", id (Sheet.titleId "rail-menu") ] [ text channel.name ]
                        , p [ class "onyx-railmenu-sub" ] [ text status ]
                        ]
                    , Sheet.closeButton { label = "Close options", onClose = RailMenuClose, testId = Nothing, extraClass = "onyx-railmenu-close" }
                    ]
                 ]
                    ++ (if isRoom then
                            [ item "favorite"
                                (if starred then
                                    "Remove from Favorites"

                                 else
                                    "Add to Favorites"
                                )
                                (if starred then
                                    "star-on"

                                 else
                                    "star"
                                )
                                (SidebarStarToggle channel.name)
                                ([ disabled (not canStar)
                                 , attribute "aria-pressed" (boolAttr starred)
                                 ]
                                    ++ (if canStar then
                                            [ Sheet.autofocus "rail-menu" ]

                                        else
                                            []
                                       )
                                )
                            ]
                                ++ (if canStar then
                                        []

                                    else
                                        [ p [ class "onyx-railmenu-hint" ] [ text "Connect to keep favorites on this device." ] ]
                                   )

                        else
                            []
                       )
                    ++ [ item "read"
                            "Mark as read"
                            "check"
                            (RailMarkRead channel.name)
                            ([ disabled (not waiting) ]
                                ++ (if waiting && not (isRoom && canStar) then
                                        [ Sheet.autofocus "rail-menu" ]

                                    else
                                        []
                                   )
                            )
                       ]
                    ++ (if isRoom then
                            [ div [ class "onyx-railmenu-notify" ] [ View.Notify.roomNotifyStrip model channel.name ]
                            , item "leave" "Leave room" "leave" (RailLeave channel.name) [ class "onyx-railmenu-item--danger" ]
                            ]

                        else
                            [ item "mute"
                                (if muted then
                                    "Unmute conversation"

                                 else
                                    "Mute conversation"
                                )
                                (if muted then
                                    "bell"

                                 else
                                    "bell-off"
                                )
                                (if muted then
                                    UnmuteDm channel.name

                                 else
                                    MuteDm channel.name
                                )
                                [ attribute "aria-pressed" (boolAttr muted) ]
                            ]
                       )
                )
