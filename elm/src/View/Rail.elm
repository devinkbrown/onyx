module View.Rail exposing (rail)

{-| Conversation rail: rooms and direct messages stay in separate,
alphabetized groups. The active conversation and unread activity have
both visual and accessible labels.
-}

import App exposing (Channel, Model, Msg(..))
import Dict
import Html exposing (Html, button, div, h2, h3, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, classList, id, type_)
import Html.Events exposing (onClick)
import Modes


rail : Model -> Html Msg
rail model =
    let
        conversations =
            model.channels
                |> Dict.values
                |> List.sortWith (\a b -> Modes.compareNicks a.name b.name)

        ( rooms, directMessages ) =
            List.partition (\channel -> App.isChannelName model channel.name) conversations
    in
    section [ class "onyx-rail", id "client-rooms", attribute "aria-label" "Conversations" ]
        [ div [ class "onyx-rail-heading" ]
            [ h2 [] [ text "Conversations" ]
            , span [ class "onyx-rail-total", attribute "aria-label" (countLabel (List.length conversations) "conversation") ]
                [ text (String.fromInt (List.length conversations)) ]
            ]
        , div [ class "onyx-rail-actions" ]
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
        , conversationGroup model "rail-rooms-heading" "Rooms" rooms (emptyRooms model)
        , conversationGroup model "rail-direct-heading" "Direct messages" directMessages
            "Your direct conversations will appear here."
        ]


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
            [ span [ class "onyx-rail-name" ] [ text channel.name ]
            , if not room && Dict.member (String.toLower channel.name) model.dmAway then
                span [ class "onyx-rail-away", attribute "data-testid" "dm-away" ] [ text "away" ]

              else
                text ""
            , if room then
                span
                    [ class "onyx-rail-count"
                    , attribute "aria-hidden" "true"
                    , attribute "title" (countLabel (Dict.size channel.members) "member")
                    ]
                    [ text (String.fromInt (Dict.size channel.members)) ]

              else
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
