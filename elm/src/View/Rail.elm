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
-}

import App exposing (Channel, Model, Msg(..))
import Dict
import Html exposing (Html, button, div, input, label, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, for, id, placeholder, style, tabindex, type_, value)
import Html.Events exposing (on, onClick, onInput)
import Json.Decode as Decode
import Set
import Sidebar
-- v3/calls-c1
import View.CallPresence


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
    in
    section [ class "onyx-rail", attribute "aria-label" "Room navigation" ]
        ([ filterBar model derived ]
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
                    [ div [ class "onyx-rail-section", attribute "data-testid" "sidebar-favorites" ]
                        [ p [ class "onyx-rail-label", id "sidebar-favorites-label" ] [ text "Favorites" ]
                        , ul [ attribute "role" "list", attribute "aria-labelledby" "sidebar-favorites-label" ]
                            (List.map (roomRow model canStar) derived.favorites)
                        ]
                    ]
               )
            ++ [ div [ class "onyx-rail-section", attribute "data-testid" "sidebar-channels" ]
                    [ p [ class "onyx-rail-label", id "sidebar-channels-label" ] [ text "Rooms" ]
                    , ul [ attribute "role" "list", attribute "aria-label" "Joined rooms" ]
                        (if List.isEmpty derived.rooms && derived.roomsJoined == 0 then
                            [ li [ class "onyx-rail-zero" ]
                                [ p [ class "onyx-rail-empty" ] [ text "No rooms yet. Browse rooms to join one." ] ]
                            ]

                         else
                            List.map (roomRow model canStar) derived.rooms
                        )
                    ]
               , div [ class "onyx-rail-section", attribute "data-testid" "sidebar-dms" ]
                    [ div [ class "onyx-rail-section-heading" ]
                        [ p [ class "onyx-rail-label", id "sidebar-dms-label" ] [ text "Messages" ]
                        , button
                            [ type_ "button"
                            , class "onyx-rail-new"
                            , attribute "data-testid" "new-conversation"
                            , attribute "aria-label" "New conversation"
                            , onClick NewMessageOpen
                            ]
                            [ span [ attribute "aria-hidden" "true" ] [ text "+" ], text " New" ]
                        ]
                    , if List.isEmpty derived.dms then
                        p [ class "onyx-rail-empty" ] [ text "No messages yet. Open a person to start one." ]

                      else
                        ul [ attribute "role" "list", attribute "aria-labelledby" "sidebar-dms-label" ]
                            (List.map (dmRow model) derived.dms)
                    ]
               , button
                    [ type_ "button"
                    , onClick App.BrowserOpen
                    , class "onyx-rail-browse"
                    , attribute "data-testid" "sidebar-browse-rooms"
                    ]
                    [ text "Browse rooms" ]
               , button
                    [ type_ "button"
                    , onClick App.CreateRoomOpen
                    , class "onyx-rail-browse"
                    , attribute "data-testid" "sidebar-start-room"
                    ]
                    [ text "Start a room" ]
               ]
        )


filterBar : Model -> Sidebar.Sections -> Html Msg
filterBar model derived =
    div
        [ class "onyx-rail-filter"
        , classList [ ( "onyx-rail-filter-on", derived.filterActive ) ]
        , attribute "role" "search"
        ]
        ([ label [ class "sr-only", for "sidebar-filter-input" ] [ text "Filter rooms" ]
         , input
            [ id "sidebar-filter-input"
            , class "onyx-rail-filter-input"
            , type_ "search"
            , attribute "data-testid" "sidebar-filter"
            , placeholder "Filter rooms"
            , attribute "autocomplete" "off"
            , attribute "spellcheck" "false"
            , value model.sidebarFilter
            , onInput SidebarFilterInput
            , on "keydown" (filterEscape derived.filterActive)
            ]
            []
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
                [ text count ]

        Nothing ->
            text ""


roomRow : Model -> Bool -> Channel -> Html Msg
roomRow model canStar channel =
    let
        active =
            isActive model channel.name

        starred =
            Sidebar.isStarred model.starredChannels channel.name

        stamp =
            if Sidebar.hasAttention channel then
                ""

            else
                Sidebar.activityStamp model.nowMs (Sidebar.channelActivityMs channel)

        topic =
            String.trim channel.topic
    in
    li []
        [ div [ class "onyx-rail-row" ]
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
                [ case Dict.get (String.toLower channel.name) model.channelColors of
                    Just color ->
                        span
                            [ class "onyx-rail-color"
                            , attribute "data-testid" "sidebar-channel-color"
                            , attribute "aria-hidden" "true"
                            , style "background-color" color
                            ]
                            []

                    Nothing ->
                        text ""
                , span [ class "onyx-rail-copy" ]
                    [ span [ class "onyx-rail-name" ] [ text channel.name ]
                    , if String.isEmpty topic then
                        text ""

                      else
                        span [ class "onyx-rail-sub", attribute "aria-hidden" "true" ] [ text topic ]
                    ]
                , span [ class "onyx-rail-meta" ]
                    [ if String.isEmpty stamp then
                        text ""

                      else
                        span [ class "onyx-rail-time", attribute "aria-hidden" "true" ] [ text stamp ]
                    -- v3/calls-c1
                    , View.CallPresence.railCount model channel.name
                    , badge channel
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
                            , tabindex -1
                            , onClick (SidebarStarToggle channel.name)
                            ]
                            [ text
                                (if starred then
                                    "★"

                                 else
                                    "☆"
                                )
                            ]
                        ]

                    else
                        []
                   )
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

        initial =
            String.trim channel.name
                |> String.left 1
                |> String.toUpper
                |> (\s ->
                        if String.isEmpty s then
                            "?"

                        else
                            s
                   )
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
                (Sidebar.dmAriaLabel channel { preview = preview, keyChanged = keyChanged, offline = offline })
            , attribute "aria-current"
                (if active then
                    "location"

                 else
                    "false"
                )
            , onClick (ChannelSelect channel.name)
            ]
            [ span [ class "onyx-rail-avatar", attribute "aria-hidden" "true" ] [ text initial ]
            , span [ class "onyx-rail-copy" ]
                [ span [ class "onyx-rail-name" ] [ text channel.name ]
                , case preview of
                    Just line ->
                        span
                            [ class "onyx-rail-sub onyx-rail-preview"
                            , attribute "data-testid" "sidebar-dm-preview"
                            , attribute "aria-hidden" "true"
                            ]
                            [ text line ]

                    Nothing ->
                        text ""
                ]
            , span [ class "onyx-rail-meta" ]
                [ if String.isEmpty stamp then
                    text ""

                  else
                    span [ class "onyx-rail-time", attribute "aria-hidden" "true" ] [ text stamp ]
                , if keyChanged then
                    span
                        [ class "onyx-rail-keywarn"
                        , attribute "data-testid" "sidebar-dm-keywarn"
                        , attribute "title" "Device key changed"
                        , attribute "aria-hidden" "true"
                        ]
                        [ text "⚠" ]

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
