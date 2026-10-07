module View.Rail exposing (rail)

{-| Channel rail: alphabetized channels with member counts; the active
channel carries the accent.
-}

import App exposing (Channel, Model, Msg(..))
import Dict
import Html exposing (Html, button, h2, li, section, span, text, ul)
import Html.Attributes exposing (class, classList)
import Html.Events exposing (onClick)
import Modes


rail : Model -> Html Msg
rail model =
    section [ class "onyx-rail" ]
        [ h2 [] [ text "Channels" ]
        , ul []
            (model.channels
                |> Dict.values
                |> List.sortWith (\a b -> Modes.compareNicks a.name b.name)
                |> List.map (railItem model)
            )
        , button
            [ onClick App.BrowserOpen
            , class "onyx-rail-browse"
            ]
            [ text "Browse rooms" ]
        , button
            [ onClick App.CreateRoomOpen
            , class "onyx-rail-browse"
            ]
            [ text "Start a room" ]
        ]


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
    in
    li []
        [ button
            [ onClick (ChannelSelect channel.name)
            , classList [ ( "onyx-rail-active", active ) ]
            ]
            [ span [ class "onyx-rail-name" ] [ text channel.name ]
            , span [ class "onyx-rail-count" ]
                [ text (String.fromInt (Dict.size channel.members)) ]
            , if channel.unread > 0 then
                span
                    [ class "onyx-rail-unread"
                    , classList [ ( "onyx-rail-mention", channel.highlights > 0 ) ]
                    ]
                    [ text (String.fromInt channel.unread) ]

              else
                text ""
            , case memoCount of
                Just n ->
                    if n > 0 then
                        span [ class "onyx-rail-offline" ] [ text (offlineStamp n) ]

                    else
                        text ""

                Nothing ->
                    text ""
            ]
        ]


{-| Calm pending-memo stamp for a DM row (`1 offline` / `N offline`). -}
offlineStamp : Int -> String
offlineStamp count =
    if count == 1 then
        "1 offline"

    else
        String.fromInt count ++ " offline"
