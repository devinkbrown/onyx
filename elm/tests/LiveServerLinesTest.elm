module LiveServerLinesTest exposing (suite)

{-| Regression vectors captured from the live Onyx node (eshmaki.me,
2026-10-10): server welcome NOTICEs and the IRCX-gated EVENT command.
-}

import App exposing (..)
import Dict
import Expect
import Test exposing (Test, describe, test)


feed : Model -> String -> Model
feed model line =
    Tuple.first (update (WsLineReceived line) model)


connected : Model
connected =
    { blank | ourNick = "guest" }


welcome : List String
welcome =
    [ ":eshmaki.me NOTICE guest :secured (TLS1.3 AES-128-GCM) | you are a18fefc75a155091.opq.onyx | not logged in"
    , ":eshmaki.me NOTICE guest :mesh: 2 nodes linked | /HELP to get started"
    , ":eshmaki.me NOTICE guest :connecting from Dallas, Texas, US | AS397423 (Tier.Net Technologies LLC)"
    ]


suite : Test
suite =
    describe "live server lines"
        [ test "server welcome NOTICEs never become DM notifications or DM conversations" <|
            \_ ->
                let
                    after =
                        List.foldl (\l m -> feed m l) connected welcome
                in
                Expect.all
                    [ \m -> Expect.equal [] (List.filter (\n -> n.kind /= NotifError && n.kind /= NotifSystem) m.notifications |> List.map .text)
                    , \m -> Expect.equal False (List.any (\k -> String.contains "eshmaki" k) (List.map Tuple.first (Dict.toList m.channels)))
                    ]
                    after
        , test "registration sends IRCX before EVENT ADD MEDIA (server requires ISIRCX first)" <|
            \_ ->
                let
                    ( _, out ) =
                        update (WsLineReceived ":eshmaki.me 001 guest :Welcome to the Onyx network") { blank | connection = Registering, ourNick = "guest" }

                    lines =
                        List.filterMap
                            (\o ->
                                case o of
                                    SendLine l ->
                                        Just (String.trim l)

                                    _ ->
                                        Nothing
                            )
                            out

                    indexOf needle =
                        List.indexedMap Tuple.pair lines
                            |> List.filter (\( _, l ) -> String.startsWith needle l)
                            |> List.head
                            |> Maybe.map Tuple.first
                in
                case ( indexOf "IRCX", indexOf "EVENT ADD MEDIA" ) of
                    ( Just i, Just e ) ->
                        Expect.lessThan e i

                    other ->
                        Expect.fail ("missing IRCX/EVENT in " ++ String.join " | " lines ++ " " ++ Debug.toString other)
        ]
