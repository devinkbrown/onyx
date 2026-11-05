module NickCompleteTest exposing (suite)

import Expect
import NickComplete
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "nick completion"
        [ test "ranks a case-sensitive prefix ahead of a shorter nick" <|
            \_ ->
                Expect.equal [ "alice", "AL", "Alex" ]
                    (NickComplete.rankNickCompletions "al" [ "alice", "AL", "bob", "Alex" ] 8)
        , test "cycles the original token from the shortest case-sensitive match" <|
            \_ ->
                let
                    nicks =
                        [ "alice", "alex", "albert" ]

                    first =
                        NickComplete.cycleNickCompletion "al" 2 nicks -1
                in
                case first of
                    Nothing ->
                        Expect.fail "expected a match"

                    Just picked ->
                        let
                            again =
                                NickComplete.cycleNickCompletion "al" 2 nicks picked.index
                        in
                        Expect.all
                            [ \_ -> Expect.equal "alex" (List.head picked.matches |> Maybe.withDefault "")
                            , \_ -> Expect.equal "alex " picked.text
                            , \_ -> Expect.equal (Just "alice ") (Maybe.map .text again)
                            , \_ -> Expect.equal (Just 1) (Maybe.map .index again)
                            ]
                            ()
        , test "a slash command with no space is not a nick" <|
            \_ ->
                Expect.equal Nothing (NickComplete.nickTokenAt "/join" 5)
        , test "an empty query without @ is not a nick" <|
            \_ ->
                Expect.equal Nothing (NickComplete.nickTokenAt "hello " 6)
        , test "apply keeps the @ and leaves the caret after the space" <|
            \_ ->
                case NickComplete.nickTokenAt "@al" 3 of
                    Nothing ->
                        Expect.fail "expected a token"

                    Just token ->
                        Expect.equal { text = "@alice ", caret = 7 }
                            (NickComplete.applyNickCompletion "@al" token "alice")
        ]
