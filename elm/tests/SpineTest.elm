module SpineTest exposing (suite)

{-| Event Spine & OBSERVE: intent planning (fail-closed validation,
exact wire shapes, destructive flags), slash mapping, EVENT
re-dispatch, and WALLOPS logging. Oracles `lib/oper/operDesk.ts`,
`store.ts` EVENT/WALLOPS cases, protocol §11.
-}

import Expect
import Spine exposing (..)
import Test exposing (Test, describe, test)
import Wire


okLine : OperIntent -> Maybe String
okLine intent =
    case planOperAction intent of
        Ok cmd ->
            Just (commandLine cmd)

        Err _ ->
            Nothing


suite : Test
suite =
    describe "Spine"
        [ describe "intent planning"
            [ test "broadcast shapes EVENT BROADCAST and marks destructive" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "EVENT BROADCAST :hello ops\r\n") (okLine (Broadcast "hello ops"))
                        , \_ ->
                            case planOperAction (Broadcast "hello ops") of
                                Ok cmd ->
                                    Expect.equal True cmd.destructive

                                Err _ ->
                                    Expect.fail "expected Ok"
                        , \_ -> Expect.equal Nothing (okLine (Broadcast "   "))
                        , \_ -> Expect.equal Nothing (okLine (Broadcast "a\nb"))
                        ]
                        ()
            , test "event subscribe validates the category" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "EVENT ADD KILL\r\n") (okLine (EventSubscribe "kill"))
                        , \_ -> Expect.equal (Just "EVENT DEL KILL\r\n") (okLine (EventUnsubscribe "KILL"))
                        , \_ -> Expect.equal Nothing (okLine (EventSubscribe "nope"))
                        , \_ -> Expect.equal (Just "EVENT LIST\r\n") (okLine EventList)
                        ]
                        ()
            , test "MEDIA subscribes with the membership mask" <|
                \_ ->
                    Expect.equal (Just "EVENT ADD MEDIA *\r\n") (okLine (EventSubscribe "MEDIA"))
            , test "observe validates mask and actions" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "EVENT OBSERVE *!*@*.example connect quit\r\n")
                                (okLine (ObserveWatch { mask = "*!*@*.example", actions = [ "quit", "connect" ] }))
                        , \_ -> Expect.equal Nothing (okLine (ObserveWatch { mask = "*!*@*", actions = [] }))
                        , \_ -> Expect.equal Nothing (okLine (ObserveWatch { mask = "nick!u@h", actions = [ "bogus" ] }))
                        , \_ -> Expect.equal (Just "EVENT OBSERVE LIST\r\n") (okLine ObserveList)
                        , \_ -> Expect.equal (Just "EVENT OBSERVE OFF\r\n") (okLine ObserveOff)
                        ]
                        ()
            , test "observe emits actions in documented order" <|
                \_ ->
                    case planOperAction (ObserveWatch { mask = "n!u@h", actions = [ "oper", "connect" ] }) of
                        Ok cmd ->
                            Expect.equal [ "OBSERVE", "n!u@h", "connect", "oper" ] cmd.params

                        Err _ ->
                            Expect.fail "expected Ok"
            , test "kill requires a nick and a reason" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "KILL troll spamming\r\n")
                                (okLine (Kill { target = "troll", reason = "spamming" }))
                        , \_ -> Expect.equal Nothing (okLine (Kill { target = "a b", reason = "x" }))
                        , \_ -> Expect.equal Nothing (okLine (Kill { target = "troll", reason = "" }))
                        , \_ ->
                            case planOperAction (Kill { target = "troll", reason = "spamming" }) of
                                Ok cmd ->
                                    Expect.equal True cmd.destructive

                                Err _ ->
                                    Expect.fail "expected Ok"
                        ]
                        ()
            , test "rehash and privs are fixed lines" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "REHASH\r\n" rehashNode
                        , \_ -> Expect.equal "PRIVS\r\n" privsQuery
                        , \_ -> Expect.equal "EVENT LIST\r\n" eventList
                        , \_ -> Expect.equal "EVENT ADD MEDIA *\r\n" mediaSubscribe
                        , \_ -> Expect.equal "EVENT OBSERVE LIST\r\n" observeList
                        , \_ -> Expect.equal "EVENT OBSERVE OFF\r\n" observeOff
                        ]
                        ()
            ]
        , describe "slash mapping"
            [ test "wallops is an alias for broadcast" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just (Broadcast "hi all")) (parseOperSlash "wallops" [ "hi", "all" ])
                        , \_ -> Expect.equal (Just (Broadcast "hi all")) (parseOperSlash "broadcast" [ "hi", "all" ])
                        , \_ -> Expect.equal (Just Rehash) (parseOperSlash "rehash" [])
                        , \_ -> Expect.equal (Just Privs) (parseOperSlash "privs" [])
                        , \_ -> Expect.equal Nothing (parseOperSlash "join" [ "#c" ])
                        ]
                        ()
            , test "events maps add del and list" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just (EventSubscribe "kill")) (parseOperSlash "events" [ "add", "kill" ])
                        , \_ -> Expect.equal (Just (EventUnsubscribe "kill")) (parseOperSlash "events" [ "del", "kill" ])
                        , \_ -> Expect.equal (Just (EventUnsubscribe "kill")) (parseOperSlash "events" [ "remove", "kill" ])
                        , \_ -> Expect.equal (Just EventList) (parseOperSlash "events" [])
                        ]
                        ()
            , test "observe maps mask list and off" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just ObserveList) (parseOperSlash "observe" [])
                        , \_ -> Expect.equal (Just ObserveList) (parseOperSlash "observe" [ "list" ])
                        , \_ -> Expect.equal (Just ObserveOff) (parseOperSlash "observe" [ "off" ])
                        , \_ -> Expect.equal (Just ObserveOff) (parseOperSlash "observe" [ "clear" ])
                        , \_ ->
                            Expect.equal
                                (Just (ObserveWatch { mask = "n!u@h", actions = [ "connect" ] }))
                                (parseOperSlash "observe" [ "n!u@h", "connect" ])
                        ]
                        ()
            , test "kill splits target from reason words" <|
                \_ ->
                    Expect.equal
                        (Just (Kill { target = "troll", reason = "being rude" }))
                        (parseOperSlash "kill" [ "troll", "being", "rude" ])
            ]
        , describe "folds"
            [ test "MEDIA events reshape into NOTE param order" <|
                \_ ->
                    Expect.equal
                        (EventAsNote { params = [ "MEDIA", "#c", "JOIN", "alice", "detail" ] })
                        (foldEventLine (Wire.parseIrcMessage ":s EVENT me MEDIA JOIN #c alice detail"))
            , test "MEDIA reshape tolerates missing params" <|
                \_ ->
                    Expect.equal
                        (EventAsNote { params = [ "MEDIA", "", "JOIN", "" ] })
                        (foldEventLine (Wire.parseIrcMessage ":s EVENT me MEDIA JOIN"))
            , test "WEBAUTHN drops the target for the passkey fold" <|
                \_ ->
                    Expect.equal
                        (EventAsPasskey { params = [ "WEBAUTHN", "REGISTER", "challenge" ] })
                        (foldEventLine (Wire.parseIrcMessage ":s EVENT me WEBAUTHN REGISTER challenge"))
            , test "category bodies and other planes are ignored" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal EventIgnored (foldEventLine (Wire.parseIrcMessage ":s EVENT me CONNECT alice!u@h"))
                        , \_ -> Expect.equal EventIgnored (foldEventLine (Wire.parseIrcMessage ":s PRIVMSG #c :hi"))
                        ]
                        ()
            , test "WALLOPS renders into the server log" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "WALLOPS: Restarting in 5 minutes")
                                (foldWallops (Wire.parseIrcMessage ":s WALLOPS :Restarting in 5 minutes"))
                        , \_ -> Expect.equal Nothing (foldWallops (Wire.parseIrcMessage ":s PRIVMSG #c :hi"))
                        ]
                        ()
            ]
        ]
