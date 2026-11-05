module OperWireAdmissionTest exposing (suite)

import App exposing (Model, OperDeskIntent(..), Outbound(..), blank, planOperAction, runSlashOper)
import Expect
import Test exposing (Test, describe, test)
import Wire


liveOper : String -> Model
liveOper composer =
    { blank | connection = App.Live, isOper = True, composer = composer }


suite : Test
suite =
    describe "operator wire admission"
        [ test "a current operator can send a permitted typed action" <|
            \_ ->
                let
                    ( sent, outbound ) =
                        runSlashOper (liveOper "/privs") "privs"
                in
                Expect.all
                    [ \_ -> Expect.equal [ SendLine "PRIVS\r\n" ] outbound
                    , \_ -> Expect.equal "" sent.composer
                    , \_ -> Expect.equal Nothing sent.composerError
                    ]
                    ()
        , test "typed plan validates its exact command and parameters" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        case planOperAction (OperKill { target = "bob", reason = "spam links" }) of
                            Ok command ->
                                Expect.equal (Ok "KILL bob :spam links\r\n") (Wire.encodeIrcLine command.command command.params)

                            Err _ ->
                                Expect.fail "a valid operator command should be admitted"
                    , \_ ->
                        case planOperAction (OperKill { target = "bob\u{000D}", reason = "spamming" }) of
                            Err _ ->
                                Expect.pass

                            Ok _ ->
                                Expect.fail "a trailing control-bearing target must be rejected before trimming"
                    , \_ ->
                        case planOperAction (OperObserve { mask = "nick!u@h\u{000D}", actions = [] }) of
                            Err _ ->
                                Expect.pass

                            Ok _ ->
                                Expect.fail "a trailing control-bearing mask must be rejected before trimming"
                    ]
                    ()
        , test "invalid raw fallback preserves the exact draft and sends nothing" <|
            \_ ->
                let
                    draft =
                        "/FROB #room safe\r\nPRIVS"

                    ( rejected, outbound ) =
                        runSlashOper (liveOper draft) "frob"
                in
                Expect.all
                    [ \_ -> Expect.equal [] outbound
                    , \_ -> Expect.equal draft rejected.composer
                    , \_ -> Expect.equal (Just "The command could not be encoded safely; your draft was kept.") rejected.composerError
                    ]
                    ()
        , test "valid raw fallback remains one checked IRC line" <|
            \_ ->
                let
                    ( sent, outbound ) =
                        runSlashOper (liveOper "/FROB #room safe") "frob"
                in
                Expect.all
                    [ \_ -> Expect.equal [ SendLine "FROB #room safe\r\n" ] outbound
                    , \_ -> Expect.equal "" sent.composer
                    ]
                    ()
        , test "malformed typed reason preserves the submitted body" <|
            \_ ->
                let
                    draft =
                        "/kill bob reason\r\nPRIVS"

                    ( rejected, outbound ) =
                        runSlashOper (liveOper draft) "kill"
                in
                Expect.all
                    [ \_ -> Expect.equal [] outbound
                    , \_ -> Expect.equal draft rejected.composer
                    , \_ -> Expect.equal [ "Operator command" ] (List.map .title rejected.toasts)
                    ]
                    ()
        , test "raw fallback accepts the exact 8191-byte Unicode boundary and rejects one more byte" <|
            \_ ->
                let
                    boundary =
                        String.repeat 2045 "😀" ++ "abcdef"

                    acceptedDraft =
                        "/TEST " ++ boundary

                    rejectedDraft =
                        acceptedDraft ++ "x"

                    ( accepted, acceptedOut ) =
                        runSlashOper (liveOper acceptedDraft) "test"

                    ( rejected, rejectedOut ) =
                        runSlashOper (liveOper rejectedDraft) "test"
                in
                Expect.all
                    [ \_ -> Expect.equal [ SendLine ("TEST " ++ boundary ++ "\r\n") ] acceptedOut
                    , \_ -> Expect.equal "" accepted.composer
                    , \_ -> Expect.equal [] rejectedOut
                    , \_ -> Expect.equal rejectedDraft rejected.composer
                    ]
                    ()
        ]
