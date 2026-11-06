module View.Rail exposing (rail)

{-| The collection sidebar: rooms and direct messages stay in separate,
alphabetized groups. The active conversation and unread activity have
both visual and accessible labels.

v3/shell-nav: the selected nav destination picks the collection (Rooms
shows Favorites then rooms, Messages shows direct conversations, Home
shows both as separate groups), and a single-select filter row (All /
Unread / @Mentions / Favorites) narrows it. On desktop this is the 280px
sidebar beside the icon rail; under 768px it is the full Rooms /
Messages page (see `rail.css`).
-}

import App exposing (Channel, Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, h2, h3, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, id, tabindex, type_)
import Html.Events exposing (onClick)
import Modes
import Nav


rail : Model -> Html Msg
rail model =
    let
        conversations =
            model.channels
                |> Dict.values
                |> List.sortWith (\a b -> Modes.compareNicks a.name b.name)

        ( allRooms, allDirect ) =
            List.partition (\channel -> App.isChannelName model channel.name) conversations

        passes =
            List.filter (Nav.passesFilter model.railFilter model.starredChannels)

        starred channel =
            Nav.passesFilter Nav.FilterFavorites model.starredChannels channel

        ( favorites, rooms ) =
            if model.railFilter == Nav.FilterFavorites then
                ( [], passes allRooms )

            else
                List.partition starred (passes allRooms)

        directMessages =
            passes allDirect

        collection =
            case model.navSection of
                Nav.Rooms ->
                    "rooms"

                Nav.Messages ->
                    "messages"

                _ ->
                    "all"

        title =
            case collection of
                "rooms" ->
                    "Rooms"

                "messages" ->
                    "Messages"

                _ ->
                    "Conversations"

        shownTotal =
            case collection of
                "rooms" ->
                    List.length allRooms

                "messages" ->
                    List.length allDirect

                _ ->
                    List.length conversations

        showRooms =
            collection /= "messages"

        showDirect =
            collection /= "rooms"

        filtering =
            model.railFilter /= Nav.FilterAll

        nothingMatches =
            filtering
                && (not showRooms || List.isEmpty favorites && List.isEmpty rooms)
                && (not showDirect || List.isEmpty directMessages)
    in
    section
        [ class "onyx-rail"
        , id "client-rooms"
        , tabindex -1
        , attribute "aria-label" title
        , attribute "data-collection" collection
        ]
        ([ div [ class "onyx-rail-heading" ]
            [ h2 [] [ text title ]
            , span [ class "onyx-rail-total", attribute "aria-label" (countLabel shownTotal "conversation") ]
                [ text (String.fromInt shownTotal) ]
            ]
         , filterRow model
         ]
            ++ (if showRooms then
                    [ div [ class "onyx-rail-actions" ]
                        [ button
                            [ onClick App.BrowserOpen
                            , class "onyx-rail-browse"
                            , type_ "button"
                            ]
                            [ text "Browse rooms" ]
                        , button
                            [ onClick App.CreateRoomOpen
                            , class "onyx-rail-browse"
                            , type_ "button"
                            ]
                            [ text "Start a room" ]
                        ]
                    ]

                else
                    []
               )
            ++ (if nothingMatches then
                    [ p [ class "onyx-rail-empty onyx-rail-filter-empty", attribute "role" "status" ]
                        [ text (filterEmptyCopy model.railFilter) ]
                    ]

                else
                    []
               )
            ++ (if showRooms && not (List.isEmpty favorites) then
                    [ conversationGroup model "rail-favorites-heading" "Favorites" favorites "" ]

                else
                    []
               )
            ++ (if showRooms && not (filtering && List.isEmpty rooms) then
                    [ conversationGroup model "rail-rooms-heading" "Rooms" rooms (emptyRooms model) ]

                else
                    []
               )
            ++ (if showDirect && not (filtering && List.isEmpty directMessages) then
                    [ conversationGroup model "rail-direct-heading" "Direct messages" directMessages
                        "Your direct conversations will appear here."
                    ]

                else
                    []
               )
        )


{-| Single-select filter row: a group of toggle buttons, exactly one
pressed. -}
filterRow : Model -> Html Msg
filterRow model =
    div [ class "onyx-rail-filters", attribute "role" "group", attribute "aria-label" "Filter conversations" ]
        (List.map
            (\filter ->
                button
                    [ type_ "button"
                    , classList [ ( "onyx-rail-filter", True ), ( "onyx-rail-filter--on", model.railFilter == filter ) ]
                    , attribute "aria-pressed"
                        (if model.railFilter == filter then
                            "true"

                         else
                            "false"
                        )
                    , attribute "data-testid" ("rail-filter-" ++ Nav.filterKey filter)
                    , onClick (RailFilterSet filter)
                    ]
                    [ text (Nav.filterLabel filter) ]
            )
            Nav.allFilters
        )


filterEmptyCopy : Nav.Filter -> String
filterEmptyCopy filter =
    case filter of
        Nav.FilterUnread ->
            "Nothing unread. You are all caught up."

        Nav.FilterMentions ->
            "No mentions waiting for you."

        Nav.FilterFavorites ->
            "No favorites yet. Use /star in a room to keep it here."

        Nav.FilterAll ->
            ""


conversationGroup : Model -> String -> String -> List Channel -> String -> Html Msg
conversationGroup model headingId label conversations emptyLabel =
    div [ class "onyx-rail-group" ]
        [ h3 [ id headingId ]
            [ text label
            , span [ class "onyx-rail-group-count", attribute "aria-hidden" "true" ]
                [ text (String.fromInt (List.length conversations)) ]
            ]
        , if List.isEmpty conversations then
            p [ class "onyx-rail-empty" ] [ text emptyLabel ]

          else
            ul [ attribute "aria-labelledby" headingId ]
                (List.map (railItem model) conversations)
        ]


emptyRooms : Model -> String
emptyRooms model =
    case model.connection of
        App.Registering ->
            "Connecting to Onyx. Your rooms will appear here."

        App.Offline ->
            "Reconnect to join a room. You can still read your recent chats."

        App.Live ->
            "Find a room to join, or start one of your own."


railItem : Model -> Channel -> Html Msg
railItem model channel =
    let
        active =
            model.activeChannel
                |> Maybe.map String.toLower
                |> Maybe.map (\a -> a == String.toLower channel.name)
                |> Maybe.withDefault False

        memoCount =
            if App.isChannelName model channel.name then
                Nothing

            else
                Maybe.map .count (App.offlineMemoFor model channel.name)

        room =
            App.isChannelName model channel.name

        memberLabel =
            if room then
                ", " ++ countLabel (Dict.size channel.members) "member"

            else
                ""

        awayLabel =
            if not room && Dict.member (String.toLower channel.name) model.dmAway then
                ", away"

            else
                ""

        unreadLabel =
            if channel.unread > 0 then
                ", " ++ countLabel channel.unread "unread message"

            else
                ""

        mentionLabel =
            if channel.highlights > 0 then
                ", " ++ countLabel channel.highlights "mention"

            else
                ""

        memoLabel =
            case memoCount of
                Just count ->
                    if count > 0 then
                        ", " ++ countLabel count "offline memo"

                    else
                        ""

                Nothing ->
                    ""
    in
    li []
        [ button
            [ onClick (ChannelSelect channel.name)
            , type_ "button"
            , classList
                [ ( "onyx-rail-conversation", True )
                , ( "onyx-rail-active", active )
                , ( "onyx-rail-has-unread", channel.unread > 0 )
                ]
            , attribute "aria-current" (if active then "true" else "false")
            , attribute "aria-label" (channel.name ++ awayLabel ++ memberLabel ++ unreadLabel ++ mentionLabel ++ memoLabel)
            , attribute "title" channel.name
            ]
            [ if room then
                text ""

              else
                span [ class "onyx-rail-avatar", attribute "aria-hidden" "true" ]
                    [ Avatar.view { name = channel.name, owner = False, size = Avatar.Sm, extraClass = "", hidden = True } ]
            , span [ class "onyx-rail-row-main" ]
                [ span [ class "onyx-rail-name" ] [ text channel.name ]
                , case ( room, lastLine channel ) of
                    ( False, Just preview ) ->
                        span [ class "onyx-rail-preview", attribute "aria-hidden" "true" ] [ text preview ]

                    _ ->
                        text ""
                ]
            , if not room && Dict.member (String.toLower channel.name) model.dmAway then
                span [ class "onyx-rail-away", attribute "data-testid" "dm-away" ] [ text "away" ]

              else
                text ""
            , case ( room, lastAt channel ) of
                ( False, Just at ) ->
                    span [ class "onyx-rail-time", attribute "aria-hidden" "true" ] [ text (App.formatRowClock model.zone model.prefs.clock at) ]

                _ ->
                    text ""
            , if channel.unread > 0 then
                span
                    [ classList
                        [ ( "onyx-rail-unread", True )
                        , ( "onyx-rail-mention", channel.highlights > 0 )
                        ]
                    , attribute "aria-hidden" "true"
                    ]
                    [ text (if channel.unread > 99 then "99+" else String.fromInt channel.unread) ]

              else
                text ""
            , case memoCount of
                Just n ->
                    if n > 0 then
                        span [ class "onyx-rail-offline", attribute "aria-hidden" "true" ] [ text (offlineStamp n) ]

                    else
                        text ""

                Nothing ->
                    text ""
            ]
        ]


{-| One-line preview of the newest readable message in a conversation. -}
lastLine : Channel -> Maybe String
lastLine channel =
    channel.messages
        |> List.reverse
        |> List.filter (\m -> not (String.isEmpty (String.trim m.body)))
        |> List.head
        |> Maybe.map (\m -> String.left 80 (String.replace "\n" " " m.body))


lastAt : Channel -> Maybe Int
lastAt channel =
    channel.messages
        |> List.reverse
        |> List.filter (\m -> m.at > 0)
        |> List.head
        |> Maybe.map .at


countLabel : Int -> String -> String
countLabel count label =
    String.fromInt count ++ " " ++ label ++ (if count == 1 then "" else "s")


{-| Calm pending-memo stamp for a DM row (`1 offline` / `N offline`). -}
offlineStamp : Int -> String
offlineStamp count =
    if count == 1 then
        "1 offline"

    else
        String.fromInt count ++ " offline"
