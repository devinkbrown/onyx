module View.Home exposing (home)

{-| Home: where the shell lands, not a room.

Slice 1 of the v3 Home (`claude/elm-port-fix-f381d5:elm/src/View/Home.elm`):
the welcome strip with the first-hour coach tip, a "Needs you" list of
conversations with mentions or unread direct messages (each opens the
conversation), and the next actions. The v3 resume points, quiet-room
digest and "Mark all caught up" are left for a later slice.

-}

import App exposing (Channel, Model, Msg(..))
import Dict
import FirstHour
import Html exposing (Html, button, div, h2, h3, li, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, id, tabindex, type_)
import Html.Events exposing (onClick)


home : Model -> Html Msg
home model =
    let
        needsYou =
            model.channels
                |> Dict.values
                |> List.filter (needsAttention model)
                |> List.sortBy (\c -> ( negate c.highlights, negate c.unread, String.toLower c.name ))

        nick =
            String.trim model.ourNick
    in
    section [ class "onyx-home", attribute "aria-labelledby" "home-title", attribute "data-testid" "home" ]
        [ div [ class "onyx-home-inner" ]
            [ h2 [ id "home-title", tabindex -1 ]
                [ text
                    (if String.isEmpty nick || App.isGuestNick nick then
                        "Welcome to Onyx"

                     else
                        "Welcome, " ++ nick
                    )
                ]
            , coach model
            , p [ class "onyx-home-lede" ] [ text "Find a room, meet people, and make yourself at home." ]
            , if List.isEmpty needsYou then
                text ""

              else
                div [ class "onyx-home-group" ]
                    [ h3 [ id "home-needs-you" ] [ text "Needs you" ]
                    , ul [ attribute "aria-labelledby" "home-needs-you" ] (List.map (needsRow model) needsYou)
                    ]
            , div [ class "onyx-empty-actions onyx-home-actions" ]
                [ button [ type_ "button", onClick BrowserOpen ] [ text "Browse rooms" ]
                , button [ type_ "button", onClick CreateRoomOpen ] [ text "Start a room" ]
                , button [ type_ "button", onClick FirstHourInvite ] [ text "Invite a friend" ]
                ]
            ]
        ]


{-| Mentions anywhere, or anything unread in a direct conversation. -}
needsAttention : Model -> Channel -> Bool
needsAttention model channel =
    -- A bucket named after ourselves is never a conversation that needs
    -- us (server notices addressed to our nick used to land there).
    String.toLower channel.name
        /= String.toLower model.ourNick
        && (channel.highlights > 0 || (channel.unread > 0 && not (App.isChannelName model channel.name)))


needsRow : Model -> Channel -> Html Msg
needsRow model channel =
    let
        detail =
            if channel.highlights > 0 then
                String.fromInt channel.highlights ++ (if channel.highlights == 1 then " mention" else " mentions")

            else
                String.fromInt channel.unread ++ " unread"

        kind =
            if App.isChannelName model channel.name then
                "Room"

            else
                "Direct message"
    in
    li []
        [ button
            [ type_ "button"
            , class "onyx-home-row"
            , attribute "aria-label" (channel.name ++ ", " ++ kind ++ ", " ++ detail)
            , onClick (ChannelSelect channel.name)
            ]
            [ span [ class "onyx-home-row-name" ] [ text channel.name ]
            , span [ class "onyx-home-row-detail", attribute "aria-hidden" "true" ] [ text detail ]
            ]
        ]


coach : Model -> Html Msg
coach model =
    case FirstHour.coachTip model.firstHourSeen model.firstHourHandoff FirstHour.Home of
        Nothing ->
            text ""

        Just tip ->
            div [ class "onyx-first-hour", attribute "data-testid" "first-hour-home" ]
                [ span [] [ text tip.text ]
                , button [ type_ "button", onClick FirstHourDismiss ] [ text "Dismiss" ]
                ]
