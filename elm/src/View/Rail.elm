module View.Rail exposing (rail)

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
768px it is the full-screen Rooms / Messages page (64px rows with a
room tile or a face, the topic / preview line, time and badge, a
16px search field so iOS never zooms).
-}

import App exposing (Channel, Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, h2, input, label, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, for, id, placeholder, style, tabindex, type_, value)
import Html.Events exposing (onClick, onInput)
import Json.Decode as Decode
import Nav
import Set
import Sidebar
-- v3/calls-c1
import View.Account2
import View.CallPresence
-- v3/gap-organize
import View.Organize


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
                -- v3/gap-organize: hidden rooms + closed DMs step out
                (View.Organize.listed model (Dict.values model.channels))

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
            -- v3/gap-organize: room folders sit between Favorites and Rooms
            ++ View.Organize.folderSections model (roomRow model canStar) derived.rooms
            ++ [ div [ class "onyx-rail-section onyx-rail-section--rooms", attribute "data-testid" "sidebar-channels" ]
                    [ p [ class "onyx-rail-label", id "sidebar-channels-label" ] [ text "Rooms" ]
                    , ul [ attribute "role" "list", attribute "aria-label" "Joined rooms" ]
                        (if List.isEmpty derived.rooms && derived.roomsJoined == 0 then
                            [ li [ class "onyx-rail-zero" ]
                                [ p [ class "onyx-rail-empty" ] [ text "No rooms yet. Browse rooms to join one." ] ]
                            ]

                         else
                            List.map (roomRow model canStar) (View.Organize.unfiledRooms model derived.rooms)
                        )
                    , View.Organize.hiddenFooter model -- v3/gap-organize
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
                        p [ class "onyx-rail-empty" ] [ text "No messages yet. Open a person to start one." ]

                      else
                        ul [ attribute "role" "list", attribute "aria-labelledby" "sidebar-dms-label" ]
                            (List.map (dmRow model) derived.dms)
                    , View.Organize.closedFooter model -- v3/gap-organize
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
                            "Find a conversation"

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
            , classList [ ( "onyx-rail-row--starred", starred ) ]
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
                ++ [ View.Organize.rowMore model channel ] -- v3/gap-organize
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
                    ++ View.Organize.mutedLabel model channel.name -- v3/gap-organize
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
                        , View.Organize.mutedMark model channel.name -- v3/gap-organize
                        , badge channel
                        ]
                    ]
                ]
            ]
        , View.Organize.rowMore model channel -- v3/gap-organize
        ]
