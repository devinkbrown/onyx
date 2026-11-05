module SlashSuggestTest exposing (suite)

import Expect
import SlashSuggest exposing (Command)
import Test exposing (Test, describe, test)


join : Command
join =
    { name = "join", usage = "/join #room", description = "Join a room.", aliases = [ "j" ], insertText = Nothing, oper = False, textCommand = False }


shrug : Command
shrug =
    { name = "shrug", usage = "/shrug", description = "Insert a shrug.", aliases = [], insertText = Just "¯\\_(ツ)_/¯", oper = False, textCommand = True }


kill : Command
kill =
    { name = "kill", usage = "/kill <nick> <reason>", description = "Disconnect someone.", aliases = [], insertText = Nothing, oper = True, textCommand = False }


commands : List Command
commands =
    [ join, shrug, kill ]


suite : Test
suite =
    describe "slash suggestions"
        [ test "query matches the composer oracle" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just "") (SlashSuggest.query "/")
                    , \_ -> Expect.equal (Just "join") (SlashSuggest.query "/join")
                    , \_ -> Expect.equal Nothing (SlashSuggest.query "/join #x")
                    , \_ -> Expect.equal (Just "join") (SlashSuggest.query "/Join")
                    , \_ -> Expect.equal Nothing (SlashSuggest.query "//me")
                    , \_ -> Expect.equal Nothing (SlashSuggest.query "hello")
                    , \_ -> Expect.equal (Just "") (SlashSuggest.query "/ join")
                    , \_ -> Expect.equal (Just "j") (SlashSuggest.query "/j")
                    , \_ -> Expect.equal (Just "op") (SlashSuggest.query "/op")
                    ]
                    ()
        , test "suggestions hide oper verbs and stop at eight" <|
            \_ ->
                let
                    shown =
                        SlashSuggest.suggestions commands "/k" 8 False |> List.map .name
                in
                Expect.equal [] shown
        , test "an oper sees the oper verb and an alias prefix matches" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal [ "kill" ] (SlashSuggest.suggestions commands "/k" 8 True |> List.map .name)
                    , \_ -> Expect.equal [ "join" ] (SlashSuggest.suggestions commands "/j" 8 False |> List.map .name)
                    ]
                    ()
        , test "complete inserts the command or the text expansion" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "/join " (SlashSuggest.complete "/j" join)
                    , \_ -> Expect.equal "/join #x" (SlashSuggest.complete "/j #x" join)
                    , \_ -> Expect.equal "¯\\_(ツ)_/¯" (SlashSuggest.complete "/shrug" shrug)
                    ]
                    ()
        ]
