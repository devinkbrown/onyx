module AuthGateTest exposing (suite)

{-| v3/gap-auth — wire-line vectors and state-machine tests for the
sign-in paths the connect gate was missing. Every server line below is
the exact shape the Onyx Server emits (`/home/kain/onyx-server`,
`src/daemon/server.zig` `noticeChallenge` / `handleChallenge` /
`handleIdentify` / `handleSetpass` / `handleResetpass` / `failReply`,
`src/daemon/dispatch.zig` SASL 904).
-}

import App
    exposing
        ( ConnectionState(..)
        , Model
        , Msg(..)
        , Outbound(..)
        , SaslExchange(..)
        , blank
        , update
        )
import AuthGate exposing (Challenge(..), ChallengeNotice(..), ChallengeStop(..), Flow(..), PasskeyPhase(..), ResetPhase(..), SetPass(..), TwoFactorPhase(..))
import Expect
import Html.Attributes
import Json.Decode as Decode
import Json.Encode as Encode
import Passkey
import Services
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import View.AuthGate
import Wire


suite : Test
suite =
    describe "gap-auth"
        [ describe "CHALLENGE notices" challengeNotices
        , describe "CHALLENGE answers" challengeAnswers
        , describe "pre-001 challenge flow" challengeFlow
        , describe "two-step sign-in" twoFactor
        , describe "change password (SETPASS)" setPass
        , describe "forgot password (RESETPASS)" resetFlow
        , describe "passkey sign-in" passkeyFlow
        , describe "913 and custom status" noAccess
        , describe "copy" copyTests
        , describe "views" viewTests
        ]



-- HELPERS


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


run : List Msg -> Model -> ( Model, List Outbound )
run msgs model =
    List.foldl
        (\msg ( m, outs ) ->
            let
                ( next, out ) =
                    update msg m
            in
            ( next, outs ++ out )
        )
        ( model, [] )
        msgs


gateMsg : AuthGate.Msg -> Msg
gateMsg =
    AuthGateMsg


sentLines : List Outbound -> List String
sentLines outs =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    Just line

                _ ->
                    Nothing
        )
        outs


portFields : String -> List Outbound -> List String
portFields name outs =
    List.filterMap
        (\o ->
            case o of
                AuthGatePort value ->
                    Decode.decodeValue (Decode.field name Decode.string) value |> Result.toMaybe

                _ ->
                    Nothing
        )
        outs


portKinds : List Outbound -> List String
portKinds =
    portFields "kind"


hasOutbound : (Outbound -> Bool) -> List Outbound -> Bool
hasOutbound pred outs =
    List.any pred outs


isDisconnect : Outbound -> Bool
isDisconnect o =
    o == WsDisconnect


isProbe : Outbound -> Bool
isProbe o =
    case o of
        ProbeNodes _ ->
            True

        _ ->
            False


probeNick : List Outbound -> Maybe String
probeNick outs =
    List.filterMap
        (\o ->
            case o of
                ProbeNodes { nick } ->
                    Just nick

                _ ->
                    Nothing
        )
        outs
        |> List.head


portIn : List ( String, String ) -> Msg
portIn fields =
    AuthGatePortIn (Encode.object (List.map (\( k, v ) -> ( k, Encode.string v )) fields))


withGate : (AuthGate.State -> AuthGate.State) -> Model -> Model
withGate f model =
    { model | authGate = f model.authGate }


{-| A socket that has just opened and is registering as a guest. -}
registering : Model
registering =
    { blank | connection = Registering, ourNick = "Guest12345", connectGate = True }


{-| A signed-in-looking model: Live, with account `kai`. -}
liveKai : Model
liveKai =
    { blank | connection = Live, ourNick = "kai", accountName = Just "kai" }


{-| A model whose SASL PLAIN attempt for `kai` is in flight (the
password sits in the ports-side credential slot). -}
saslInFlight : Model
saslInFlight =
    { blank
        | connection = Registering
        , ourNick = "kai"
        , connectGate = True
        , saslAccount = Just "kai"
        , saslPasswordHeld = True
        , sasl = SaslPending Wire.Plain
    }


{-| A guest socket that is live and verifying a code for `kai`. -}
verifying : Model
verifying =
    { liveKai
        | accountName = Nothing
        , ourNick = "Guest12345"
        , identifyReplyAccount = Just "kai"
    }
        |> withGate (\g -> { g | flow = TwoFactor "kai" TfaVerifying })


seedHex : String
seedHex =
    "0102030405060708090a0b0c0d0e0f10"


resetCode : String
resetCode =
    "0123456789abcdef0123456789abcdef"


welcome : String -> String
welcome nick =
    ":irc.onyx.test 001 " ++ nick ++ " :Welcome to the Onyx network"


testId : String -> Selector.Selector
testId value =
    Selector.attribute (Html.Attributes.attribute "data-testid" value)



-- CHALLENGE


challengeNotices : List Test
challengeNotices =
    [ test "pow notice carries the hex seed (server noticeChallenge)" <|
        \_ ->
            Expect.equal (Just (ChallengePow seedHex)) (AuthGate.parseChallengeNotice ("CHALLENGE pow " ++ seedHex))
    , test "question notice carries the whole question" <|
        \_ ->
            Expect.equal (Just (ChallengeQuestion "What is the capital of France?"))
                (AuthGate.parseChallengeNotice "CHALLENGE question What is the capital of France?")
    , test "a question is capped at the server's 160 characters" <|
        \_ ->
            case AuthGate.parseChallengeNotice ("CHALLENGE question " ++ String.repeat 300 "q") of
                Just (ChallengeQuestion q) ->
                    Expect.equal 160 (String.length q)

                other ->
                    Expect.fail (Debug.toString other)
    , test "failed, wait and not-required are recognised" <|
        \_ ->
            Expect.equal
                [ Just ChallengeFailed, Just ChallengeWait, Just ChallengeNotRequired ]
                [ AuthGate.parseChallengeNotice "CHALLENGE failed"
                , AuthGate.parseChallengeNotice "CHALLENGE wait"
                , AuthGate.parseChallengeNotice "CHALLENGE not required"
                ]
    , test "other NOTICE bodies are not challenge lines" <|
        \_ ->
            Expect.equal
                [ Nothing, Nothing, Nothing, Nothing, Nothing ]
                [ AuthGate.parseChallengeNotice "CHALLENGE"
                , AuthGate.parseChallengeNotice "CHALLENGE pow"
                , AuthGate.parseChallengeNotice "CHALLENGE question"
                , AuthGate.parseChallengeNotice "CHALLENGE disabled"
                , AuthGate.parseChallengeNotice "hello CHALLENGE pow abcd"
                ]
    ]


challengeAnswers : List Test
challengeAnswers =
    [ test "a nonce is one CHALLENGE parameter" <|
        \_ ->
            Expect.equal (Just "CHALLENGE 23\u{000D}\n") (AuthGate.challengeAnswerLine "23")
    , test "a multi-word answer rides the trailing parameter (server reads p[0])" <|
        \_ ->
            Expect.equal (Just "CHALLENGE :new york\u{000D}\n") (AuthGate.challengeAnswerLine "  new york ")
    , test "the answer is 1 to 64 bytes without control characters" <|
        \_ ->
            Expect.equal
                [ Nothing, Nothing, Nothing, Nothing ]
                [ AuthGate.challengeAnswerLine ""
                , AuthGate.challengeAnswerLine "   "
                , AuthGate.challengeAnswerLine (String.repeat 65 "a")
                , AuthGate.challengeAnswerLine "bad\u{0007}bell"
                ]
    , test "64 ASCII bytes are accepted; the limit counts UTF-8 bytes" <|
        \_ ->
            Expect.equal
                [ True, True, False ]
                [ AuthGate.challengeAnswerLine (String.repeat 64 "a") /= Nothing
                , AuthGate.challengeAnswerLine (String.repeat 32 "é") /= Nothing
                , AuthGate.challengeAnswerLine (String.repeat 33 "é") /= Nothing
                ]
    ]


challengeFlow : List Test
challengeFlow =
    [ test "CHALLENGE pow before 001 asks the ports to solve it" <|
        \_ ->
            let
                ( m, outs ) =
                    feed registering (":irc.onyx.test NOTICE * :CHALLENGE pow " ++ seedHex)
            in
            Expect.all
                [ \_ -> Expect.equal (PowSolving seedHex) m.authGate.challenge
                , \_ -> Expect.equal [ "solve" ] (portKinds outs)
                , \_ -> Expect.equal [ seedHex ] (portFields "seed" outs)
                , \_ -> Expect.equal [] (sentLines outs)
                ]
                ()
    , test "an uppercase seed is lowercased before it is solved" <|
        \_ ->
            let
                ( _, outs ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE pow 0A0B"
            in
            Expect.equal [ "0a0b" ] (portFields "seed" outs)
    , test "a malformed seed stops the attempt honestly instead of hanging" <|
        \_ ->
            let
                ( m, outs ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE pow nothex"
            in
            Expect.all
                [ \_ -> Expect.equal (ChallengeStopped StopPowRejected) m.authGate.challenge
                , \_ -> Expect.equal True (AuthGate.takesOver m.authGate)
                , \_ -> Expect.equal [] (portKinds outs)
                ]
                ()
    , test "the solved nonce is sent as CHALLENGE <answer>" <|
        \_ ->
            let
                ( solving, _ ) =
                    feed registering (":irc.onyx.test NOTICE * :CHALLENGE pow " ++ seedHex)

                ( sent, outs ) =
                    update (portIn [ ( "kind", "solved" ), ( "seed", seedHex ), ( "answer", "23" ) ]) solving
            in
            Expect.all
                [ \_ -> Expect.equal [ "CHALLENGE 23\u{000D}\n" ] (sentLines outs)
                , \_ -> Expect.equal PowSent sent.authGate.challenge
                ]
                ()
    , test "a stale solution for another seed is dropped" <|
        \_ ->
            let
                ( solving, _ ) =
                    feed registering (":irc.onyx.test NOTICE * :CHALLENGE pow " ++ seedHex)

                ( same, outs ) =
                    update (portIn [ ( "kind", "solved" ), ( "seed", "ffee" ), ( "answer", "9" ) ]) solving
            in
            Expect.all
                [ \_ -> Expect.equal (PowSolving seedHex) same.authGate.challenge
                , \_ -> Expect.equal [] (sentLines outs)
                ]
                ()
    , test "no solution in budget stops the attempt" <|
        \_ ->
            let
                ( solving, _ ) =
                    feed registering (":irc.onyx.test NOTICE * :CHALLENGE pow " ++ seedHex)

                ( stopped, outs ) =
                    update (portIn [ ( "kind", "solved" ), ( "seed", seedHex ), ( "answer", "" ) ]) solving
            in
            Expect.all
                [ \_ -> Expect.equal (ChallengeStopped StopPowRejected) stopped.authGate.challenge
                , \_ -> Expect.equal True (hasOutbound isDisconnect outs)
                ]
                ()
    , test "registration (001) after the answer clears the challenge" <|
        \_ ->
            let
                ( solving, _ ) =
                    feed registering (":irc.onyx.test NOTICE * :CHALLENGE pow " ++ seedHex)

                ( sent, _ ) =
                    update (portIn [ ( "kind", "solved" ), ( "seed", seedHex ), ( "answer", "23" ) ]) solving

                ( live, _ ) =
                    feed sent (welcome "Guest12345")
            in
            Expect.all
                [ \_ -> Expect.equal Live live.connection
                , \_ -> Expect.equal NoChallenge live.authGate.challenge
                ]
                ()
    , test "CHALLENGE failed after a proof of work stops with a retry" <|
        \_ ->
            let
                ( solving, _ ) =
                    feed registering (":irc.onyx.test NOTICE * :CHALLENGE pow " ++ seedHex)

                ( sent, _ ) =
                    update (portIn [ ( "kind", "solved" ), ( "seed", seedHex ), ( "answer", "23" ) ]) solving

                ( failed, outs ) =
                    feed sent ":irc.onyx.test NOTICE * :CHALLENGE failed"
            in
            Expect.all
                [ \_ -> Expect.equal (ChallengeStopped StopPowRejected) failed.authGate.challenge
                , \_ -> Expect.equal True (hasOutbound isDisconnect outs)
                ]
                ()
    , test "a question puts a prompt on the gate and the answer goes out as one line" <|
        \_ ->
            let
                ( asked, askOuts ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE question What colour is the sky?"

                ( typed, submitOuts ) =
                    run [ gateMsg (AuthGate.AnswerInput "  blue "), gateMsg AuthGate.AnswerSubmit ] asked
            in
            Expect.all
                [ \_ -> Expect.equal True (AuthGate.takesOver asked.authGate)
                , \_ -> Expect.equal [] (sentLines askOuts)
                , \_ -> Expect.equal [ "CHALLENGE blue\u{000D}\n" ] (sentLines submitOuts)
                , \_ ->
                    case typed.authGate.challenge of
                        QuestionAsked q ->
                            Expect.equal ( True, "What colour is the sky?" ) ( q.sent, q.question )

                        other ->
                            Expect.fail (Debug.toString other)
                , \_ -> Expect.equal "" typed.authGate.answer
                ]
                ()
    , test "an empty answer is refused locally" <|
        \_ ->
            let
                ( asked, _ ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE question Name a colour"

                ( m, outs ) =
                    update (gateMsg AuthGate.AnswerSubmit) asked
            in
            Expect.all
                [ \_ -> Expect.equal [] (sentLines outs)
                , \_ ->
                    case m.authGate.challenge of
                        QuestionAsked q ->
                            Expect.equal True (q.error /= Nothing)

                        other ->
                            Expect.fail (Debug.toString other)
                ]
                ()
    , test "CHALLENGE failed on a question keeps the prompt with an honest line" <|
        \_ ->
            let
                ( asked, _ ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE question Name a colour"

                ( sent, _ ) =
                    run [ gateMsg (AuthGate.AnswerInput "red"), gateMsg AuthGate.AnswerSubmit ] asked

                ( failed, _ ) =
                    feed sent ":irc.onyx.test NOTICE * :CHALLENGE failed"
            in
            case failed.authGate.challenge of
                QuestionAsked q ->
                    Expect.all
                        [ \_ -> Expect.equal False q.sent
                        , \_ -> Expect.equal True (q.error /= Nothing)
                        ]
                        ()

                other ->
                    Expect.fail (Debug.toString other)
    , test "CHALLENGE wait on a question asks for patience, not a new connection" <|
        \_ ->
            let
                ( asked, _ ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE question Name a colour"

                ( waited, outs ) =
                    feed asked ":irc.onyx.test NOTICE * :CHALLENGE wait"
            in
            case waited.authGate.challenge of
                QuestionAsked q ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "Please wait a few seconds before answering again.") q.error
                        , \_ -> Expect.equal False (hasOutbound isDisconnect outs)
                        ]
                        ()

                other ->
                    Expect.fail (Debug.toString other)
    , test "an unanswered question times out when the server closes the socket" <|
        \_ ->
            let
                ( asked, _ ) =
                    feed registering ":irc.onyx.test NOTICE * :CHALLENGE question Name a colour"

                ( closed, _ ) =
                    update (WsClosed { clean = True, reason = "registration timeout" }) asked
            in
            Expect.equal (ChallengeStopped StopTimedOut) closed.authGate.challenge
    , test "Try again redials; Back leaves the gate on the connect form" <|
        \_ ->
            let
                stopped =
                    withGate (\g -> { g | challenge = ChallengeStopped StopTimedOut })
                        { blank | connection = Offline, connectGate = True, ourNick = "kai" }

                ( retried, retryOuts ) =
                    update (gateMsg AuthGate.ChallengeRetry) stopped

                ( back, _ ) =
                    update (gateMsg AuthGate.ChallengeDismiss) stopped
            in
            Expect.all
                [ \_ -> Expect.equal True (hasOutbound isProbe retryOuts)
                , \_ -> Expect.equal NoChallenge retried.authGate.challenge
                , \_ -> Expect.equal NoChallenge back.authGate.challenge
                , \_ -> Expect.equal False (AuthGate.takesOver back.authGate)
                ]
                ()
    , test "an ordinary NOTICE before 001 is not swallowed" <|
        \_ ->
            let
                ( m, outs ) =
                    feed registering ":irc.onyx.test NOTICE * :*** Looking up your hostname..."
            in
            Expect.all
                [ \_ -> Expect.equal NoChallenge m.authGate.challenge
                , \_ -> Expect.equal [] (portKinds outs)
                ]
                ()
    ]



-- TWO-STEP SIGN-IN


twoFactorRefusal : String
twoFactorRefusal =
    ":irc.onyx.test 904 kai :Two-factor authentication required: log in with IDENTIFY <account> <password> <code>"


refused : ( Model, List Outbound )
refused =
    feed saslInFlight twoFactorRefusal


{-| After the 904 and the socket closing. -}
atCodeStep : Model
atCodeStep =
    Tuple.first (update (WsClosed { clean = True, reason = "" }) (Tuple.first refused))


twoFactor : List Test
twoFactor =
    [ test "the 2FA 904 asks for a code instead of failing the sign-in" <|
        \_ ->
            let
                ( m, outs ) =
                    refused
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                , \_ -> Expect.equal True (AuthGate.takesOver m.authGate)
                , \_ -> Expect.equal SaslIdle m.sasl
                , \_ -> Expect.equal True (hasOutbound isDisconnect outs)
                ]
                ()
    , test "the gate keeps the person: no guest auto-reconnect after the close" <|
        \_ ->
            Expect.all
                [ \m -> Expect.equal False m.autoReconnect
                , \m -> Expect.equal True m.connectGate
                , \m -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                ]
                atCodeStep
    , test "an ordinary 904 still fails the way it did" <|
        \_ ->
            let
                ( m, _ ) =
                    feed saslInFlight ":irc.onyx.test 904 kai :SASL authentication failed"
            in
            Expect.equal NoFlow m.authGate.flow
    , test "a 2FA 904 without a held SASL attempt is not claimed" <|
        \_ ->
            let
                ( m, _ ) =
                    feed registering twoFactorRefusal
            in
            Expect.equal NoFlow m.authGate.flow
    , test "the code is normalised and refused locally when it is not 6 to 8 digits" <|
        \_ ->
            Expect.equal
                [ Just "123456", Just "123456", Just "12345678", Nothing, Nothing, Nothing, Nothing ]
                [ AuthGate.normalizeTotpCode "123456"
                , AuthGate.normalizeTotpCode "123 456"
                , AuthGate.normalizeTotpCode "1234-5678"
                , AuthGate.normalizeTotpCode "12345"
                , AuthGate.normalizeTotpCode "123456789"
                , AuthGate.normalizeTotpCode "12a456"
                , AuthGate.normalizeTotpCode ""
                ]
    , test "submitting a code dials a plain guest connection (never the account nick)" <|
        \_ ->
            let
                ( m, outs ) =
                    run [ gateMsg (AuthGate.CodeInput "123 456"), gateMsg AuthGate.CodeSubmit ] atCodeStep
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaDialing) m.authGate.flow
                , \_ -> Expect.equal True (hasOutbound isProbe outs)
                , \_ ->
                    Expect.equal True
                        (case probeNick outs of
                            Just nick ->
                                String.startsWith "Guest" nick && nick /= "kai"

                            Nothing ->
                                False
                        )
                , \_ -> Expect.equal Nothing m.saslAccount
                , \_ -> Expect.equal False m.saslPasswordHeld
                ]
                ()
    , test "a bad code never dials" <|
        \_ ->
            let
                ( m, outs ) =
                    run [ gateMsg (AuthGate.CodeInput "12"), gateMsg AuthGate.CodeSubmit ] atCodeStep
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                , \_ -> Expect.equal True (m.authGate.error /= Nothing)
                , \_ -> Expect.equal False (hasOutbound isProbe outs)
                ]
                ()
    , test "on registration the ports compose IDENTIFY; the code is cleared from the model" <|
        \_ ->
            let
                ( dialing, _ ) =
                    run [ gateMsg (AuthGate.CodeInput "123456"), gateMsg AuthGate.CodeSubmit ] atCodeStep

                opened =
                    { dialing | connection = Registering, ourNick = "Guest12345" }

                ( live, outs ) =
                    feed opened (welcome "Guest12345")
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaVerifying) live.authGate.flow
                , \_ -> Expect.equal "" live.authGate.code
                , \_ -> Expect.equal [ "identify" ] (portKinds outs)
                , \_ -> Expect.equal [ "kai" ] (portFields "account" outs)
                , \_ -> Expect.equal [ "123456" ] (portFields "code" outs)
                , \_ -> Expect.equal [] (List.filter (String.startsWith "IDENTIFY") (sentLines outs))
                ]
                ()
    , test "on a live connection the code goes straight to the ports" <|
        \_ ->
            let
                atCode =
                    withGate (\g -> { g | flow = TwoFactor "kai" TfaCode })
                        { liveKai | accountName = Nothing }

                ( m, outs ) =
                    run [ gateMsg (AuthGate.CodeInput "654321"), gateMsg AuthGate.CodeSubmit ] atCode
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaVerifying) m.authGate.flow
                , \_ -> Expect.equal [ "654321" ] (portFields "code" outs)
                ]
                ()
    , test "NOTICE 'You are now identified as' completes the login" <|
        \_ ->
            let
                ( m, _ ) =
                    feed verifying ":irc.onyx.test NOTICE Guest12345 :You are now identified as kai"
            in
            Expect.all
                [ \_ -> Expect.equal (Just "kai") m.accountName
                , \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal False (AuthGate.takesOver m.authGate)
                , \_ -> Expect.equal (Just "kai") m.saslAccount
                , \_ -> Expect.equal True m.saslPasswordHeld
                ]
                ()
    , test "an identified notice for a login this client did not start is ignored" <|
        \_ ->
            let
                m0 =
                    { liveKai | accountName = Nothing, ourNick = "Guest12345" }

                ( m, _ ) =
                    feed m0 ":irc.onyx.test NOTICE Guest12345 :You are now identified as kai"
            in
            Expect.all
                [ \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal Nothing m.accountName
                ]
                ()
    , test "FAIL IDENTIFY TOTP_REQUIRED returns to the code step with a reason" <|
        \_ ->
            let
                ( m, _ ) =
                    feed verifying ":irc.onyx.test FAIL IDENTIFY TOTP_REQUIRED :Two-factor code required: IDENTIFY <account> <password> <6-digit-code>"
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                , \_ -> Expect.equal (Just "That code didn't work. Codes change every 30 seconds — enter the newest one.") m.authGate.error
                ]
                ()
    , test "the same refusal arrives as a NOTICE for a client without standard-replies" <|
        \_ ->
            let
                ( m, _ ) =
                    feed verifying ":irc.onyx.test NOTICE Guest12345 :FAIL IDENTIFY TOTP_REQUIRED: Two-factor code required: IDENTIFY <account> <password> <6-digit-code>"
            in
            Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
    , test "464 during the code step says the password was not accepted" <|
        \_ ->
            let
                ( m, _ ) =
                    feed verifying ":irc.onyx.test 464 Guest12345 :Invalid account or password"
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                , \_ -> Expect.equal (Just "Your password wasn't accepted. Go back and sign in again.") m.authGate.error
                ]
                ()
    , test "a login lockout 464 reports the wait" <|
        \_ ->
            Expect.equal "Too many sign-in attempts. Try again in 30s."
                (AuthGate.identifyFailCopy { code = "464", text = "Too many failed login attempts - retry in 30s" })
    , test "a refusal from the ports (password with a space) is explained" <|
        \_ ->
            let
                ( m, _ ) =
                    update (portIn [ ( "kind", "identifyRefused" ), ( "reason", "unsafe" ) ]) verifying
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                , \_ -> Expect.equal (Just (AuthGate.identifyFailCopy { code = "UNSAFE_PASSWORD", text = "" })) m.authGate.error
                ]
                ()
    , test "a line too long for IRC is explained as such" <|
        \_ ->
            let
                ( m, _ ) =
                    update (portIn [ ( "kind", "identifyRefused" ), ( "reason", "toolong" ) ]) verifying
            in
            Expect.equal (Just (AuthGate.identifyFailCopy { code = "TOO_LONG", text = "" })) m.authGate.error
    , test "the connection closing mid-verify returns to the code step" <|
        \_ ->
            let
                ( m, _ ) =
                    update (WsClosed { clean = False, reason = "lost" }) verifying
            in
            Expect.all
                [ \_ -> Expect.equal (TwoFactor "kai" TfaCode) m.authGate.flow
                , \_ -> Expect.equal True (m.authGate.error /= Nothing)
                , \_ -> Expect.equal False m.autoReconnect
                ]
                ()
    , test "Cancel forgets the held password and returns to sign in" <|
        \_ ->
            let
                ( m, outs ) =
                    update (gateMsg AuthGate.Cancel) atCodeStep
            in
            Expect.all
                [ \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal [ "forget" ] (portKinds outs)
                , \_ -> Expect.equal "kai" m.connectForm.nick
                , \_ -> Expect.equal Nothing m.saslAccount
                ]
                ()
    , test "recovery code instead opens the recovery field on sign in" <|
        \_ ->
            let
                ( m, outs ) =
                    update (gateMsg AuthGate.UseRecoveryCode) atCodeStep
            in
            Expect.all
                [ \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal True m.connectForm.recoveryOpen
                , \_ -> Expect.equal [ "forget" ] (portKinds outs)
                ]
                ()
    ]



-- SETPASS


typedPasswords : Model
typedPasswords =
    { liveKai
        | accountCurrentPassword = "old-pass"
        , accountNewPassword = "a brand new secret"
        , accountConfirmPassword = "a brand new secret"
    }


setPass : List Test
setPass =
    [ test "SETPASS <current> :<new> — the server's change-password command" <|
        \_ ->
            Expect.equal
                [ Just "SETPASS old-pass :longenough\u{000D}\n"
                , Just "SETPASS old-pass :a brand new secret\u{000D}\n"
                , Just "SETPASS p@ss! :ü€\u{000D}\n"
                ]
                [ Services.setPass "old-pass" "longenough"
                , Services.setPass "old-pass" "a brand new secret"
                , Services.setPass "p@ss!" "ü€"
                ]
    , test "SETPASS cannot carry a current password the server would re-split" <|
        \_ ->
            Expect.equal
                [ Nothing, Nothing, Nothing, Nothing, Nothing, Nothing ]
                [ Services.setPass "has space" "longenough"
                , Services.setPass ":lead" "longenough"
                , Services.setPass "tab\there" "longenough"
                , Services.setPass "" "longenough"
                , Services.setPass "old" ""
                , Services.setPass "old" "new\u{000D}\nQUIT"
                ]
    , test "submitting sends SETPASS, stages the new password ports-side and clears the fields" <|
        \_ ->
            let
                ( m, outs ) =
                    update AccountPasswordSubmitted typedPasswords
            in
            Expect.all
                [ \_ -> Expect.equal [ "SETPASS old-pass :a brand new secret\u{000D}\n" ] (sentLines outs)
                , \_ -> Expect.equal [ "stage" ] (portKinds outs)
                , \_ -> Expect.equal [ "a brand new secret" ] (portFields "password" outs)
                , \_ -> Expect.equal (SetPassPending "kai") m.authGate.setPass
                , \_ -> Expect.equal ( "", "", "" ) ( m.accountNewPassword, m.accountConfirmPassword, m.accountCurrentPassword )
                ]
                ()
    , test "a second submit while one is in flight is ignored" <|
        \_ ->
            let
                ( pending, _ ) =
                    update AccountPasswordSubmitted typedPasswords

                again =
                    { pending | accountCurrentPassword = "old-pass", accountNewPassword = "another secret!", accountConfirmPassword = "another secret!" }

                ( _, outs ) =
                    update AccountPasswordSubmitted again
            in
            Expect.equal [] outs
    , test "the same password is refused locally" <|
        \_ ->
            let
                same =
                    { typedPasswords | accountNewPassword = "old-pass", accountConfirmPassword = "old-pass" }

                ( m, outs ) =
                    update AccountPasswordSubmitted same
            in
            Expect.all
                [ \_ -> Expect.equal [] outs
                , \_ -> Expect.equal (Just "Choose a new password that's different from your current one.") m.accountPasswordError
                ]
                ()
    , test "a current password the server would re-split is refused with an explanation" <|
        \_ ->
            let
                spaced =
                    { typedPasswords | accountCurrentPassword = "old pass" }

                ( m, outs ) =
                    update AccountPasswordSubmitted spaced
            in
            Expect.all
                [ \_ -> Expect.equal [] outs
                , \_ -> Expect.equal (Just (AuthGate.setPassFailCopy { code = "UNSAFE_PASSWORD", text = "" })) m.accountPasswordError
                , \_ -> Expect.equal SetPassIdle m.authGate.setPass
                ]
                ()
    , test "the server's 8 to 512 byte policy is checked before sending" <|
        \_ ->
            Expect.equal
                [ Just "Choose a new password.", Just "Use at least 8 characters.", Nothing, Just "That password is too long (512 bytes at most).", Just "Passwords can't contain control characters." ]
                [ AuthGate.validateNewPassword ""
                , AuthGate.validateNewPassword "short"
                , AuthGate.validateNewPassword "exactly8"
                , AuthGate.validateNewPassword (String.repeat 513 "a")
                , AuthGate.validateNewPassword "tab\there-now"
                ]
    , test "the success NOTICE commits the staged password and says so" <|
        \_ ->
            let
                ( pending, _ ) =
                    update AccountPasswordSubmitted typedPasswords

                ( done, outs ) =
                    feed pending ":irc.onyx.test NOTICE kai :SETPASS: your password has been changed"
            in
            Expect.all
                [ \_ -> Expect.equal SetPassDone done.authGate.setPass
                , \_ -> Expect.equal [ "commit" ] (portKinds outs)
                , \_ -> Expect.equal [ "kai" ] (portFields "account" outs)
                , \_ -> Expect.equal Nothing done.accountPasswordError
                , \_ -> Expect.equal True (List.any (\t -> t.title == "Password changed") done.toasts)
                ]
                ()
    , test "editing a password field after success clears the confirmation" <|
        \_ ->
            let
                ( pending, _ ) =
                    update AccountPasswordSubmitted typedPasswords

                ( done, _ ) =
                    feed pending ":irc.onyx.test NOTICE kai :SETPASS: your password has been changed"

                ( edited, _ ) =
                    update (AccountNewPasswordInput "x") done
            in
            Expect.equal SetPassIdle edited.authGate.setPass
    , test "FAIL SETPASS WRONG_PASSWORD shows the reason and discards the staged password" <|
        \_ ->
            let
                ( pending, _ ) =
                    update AccountPasswordSubmitted typedPasswords

                ( failed, outs ) =
                    feed pending ":irc.onyx.test FAIL SETPASS WRONG_PASSWORD :Current password is incorrect"
            in
            Expect.all
                [ \_ -> Expect.equal SetPassIdle failed.authGate.setPass
                , \_ -> Expect.equal (Just "Your current password isn't right.") failed.accountPasswordError
                , \_ -> Expect.equal [ "drop" ] (portKinds outs)
                ]
                ()
    , test "the NOTICE form of FAIL SETPASS (no standard-replies) is folded too" <|
        \_ ->
            let
                ( pending, _ ) =
                    update AccountPasswordSubmitted typedPasswords

                ( failed, outs ) =
                    feed pending ":irc.onyx.test NOTICE kai :FAIL SETPASS INVALID_PASSWORD: New password rejected (8-512 chars, must differ from current)"
            in
            Expect.all
                [ \_ -> Expect.equal SetPassIdle failed.authGate.setPass
                , \_ -> Expect.equal [ "drop" ] (portKinds outs)
                , \_ -> Expect.equal True (failed.accountPasswordError /= Nothing)
                ]
                ()
    , test "a SETPASS reply with nothing in flight is not claimed" <|
        \_ ->
            let
                ( m, outs ) =
                    feed liveKai ":irc.onyx.test NOTICE kai :SETPASS: your password has been changed"
            in
            Expect.all
                [ \_ -> Expect.equal SetPassIdle m.authGate.setPass
                , \_ -> Expect.equal [] (portKinds outs)
                ]
                ()
    , test "closing before the server answers drops the staged password and warns" <|
        \_ ->
            let
                ( pending, _ ) =
                    update AccountPasswordSubmitted typedPasswords

                ( closed, outs ) =
                    update (WsClosed { clean = False, reason = "lost" }) pending
            in
            Expect.all
                [ \_ -> Expect.equal SetPassIdle closed.authGate.setPass
                , \_ -> Expect.equal True (closed.accountPasswordError /= Nothing)
                , \_ -> Expect.equal True (List.member "drop" (portKinds outs))
                ]
                ()
    , test "every FAIL SETPASS code has plain-language copy" <|
        \_ ->
            Expect.equal
                [ "Your current password isn't right."
                , "Choose a new password of 8 to 512 characters that's different from your current one."
                , "Sign in to change your password."
                , "Enter your current password to change it."
                , "Password changes are unavailable right now. Try again in a few minutes."
                , "Something odd."
                ]
                (List.map AuthGate.setPassFailCopy
                    [ { code = "WRONG_PASSWORD", text = "" }
                    , { code = "INVALID_PASSWORD", text = "" }
                    , { code = "ACCOUNT_REQUIRED", text = "" }
                    , { code = "RESET_NOT_AUTHORIZED", text = "" }
                    , { code = "TEMPORARILY_UNAVAILABLE", text = "" }
                    , { code = "WHAT", text = "Something odd." }
                    ]
                )
    ]



-- RESETPASS


offlineKai : Model
offlineKai =
    { blank
        | connection = Offline
        , connectGate = True
        , connectForm = (\f -> { f | nick = "kai" }) App.blankConnectForm
    }


{-| The reset code step, on a live guest socket. -}
resetEnter : Model
resetEnter =
    withGate (\g -> { g | flow = Reset ResetEnter, resetAccount = "kai" })
        { liveKai | accountName = Nothing, ourNick = "Guest12345" }


inReset : ResetPhase -> Model
inReset phase =
    withGate (\g -> { g | flow = Reset phase, resetAccount = "kai", resetCode = resetCode }) resetEnter


resetFlow : List Test
resetFlow =
    [ test "RESETPASS wire lines match the server's two forms" <|
        \_ ->
            Expect.equal
                [ "RESETPASS kai\u{000D}\n"
                , "RESETPASS kai " ++ resetCode ++ " :hunter22 hunter22\u{000D}\n"
                ]
                [ AuthGate.resetRequestLine "kai"
                , AuthGate.resetConfirmLine "kai" resetCode "hunter22 hunter22"
                ]
    , test "the reset code accepts a pasted 32-character code and nothing else" <|
        \_ ->
            Expect.equal
                [ Just resetCode, Just resetCode, Just resetCode, Nothing, Nothing, Nothing ]
                [ AuthGate.normalizeResetCode resetCode
                , AuthGate.normalizeResetCode ("  " ++ String.toUpper resetCode ++ "\n")
                , AuthGate.normalizeResetCode "01234567-89abcdef-01234567-89abcdef"
                , AuthGate.normalizeResetCode (String.dropRight 1 resetCode)
                , AuthGate.normalizeResetCode (resetCode ++ "0")
                , AuthGate.normalizeResetCode (String.repeat 32 "z")
                ]
    , test "Forgot password opens the reset step with the typed account name" <|
        \_ ->
            let
                ( m, _ ) =
                    update (gateMsg AuthGate.ResetOpen) offlineKai
            in
            Expect.all
                [ \_ -> Expect.equal (Reset ResetAsk) m.authGate.flow
                , \_ -> Expect.equal "kai" m.authGate.resetAccount
                , \_ -> Expect.equal True (AuthGate.takesOver m.authGate)
                ]
                ()
    , test "requesting a code dials a guest connection and sends RESETPASS <account> once registered" <|
        \_ ->
            let
                ( asking, dialOuts ) =
                    run [ gateMsg AuthGate.ResetOpen, gateMsg AuthGate.ResetRequestSubmit ] offlineKai

                opened =
                    { asking | connection = Registering, ourNick = "Guest12345" }

                ( live, liveOuts ) =
                    feed opened (welcome "Guest12345")
            in
            Expect.all
                [ \_ -> Expect.equal (Reset ResetAsking) asking.authGate.flow
                , \_ -> Expect.equal True (hasOutbound isProbe dialOuts)
                , \_ -> Expect.equal True (String.startsWith "Guest" (Maybe.withDefault "" (probeNick dialOuts)))
                , \_ -> Expect.equal True (List.member "RESETPASS kai\u{000D}\n" (sentLines liveOuts))
                , \_ -> Expect.equal Live live.connection
                ]
                ()
    , test "an empty or spaced account name is refused locally" <|
        \_ ->
            let
                blankName =
                    { offlineKai | connectForm = (\f -> { f | nick = "" }) offlineKai.connectForm }

                ( open, _ ) =
                    update (gateMsg AuthGate.ResetOpen) blankName

                ( empty, emptyOuts ) =
                    update (gateMsg AuthGate.ResetRequestSubmit) open

                ( spaced, spacedOuts ) =
                    run [ gateMsg (AuthGate.ResetAccountInput "two words"), gateMsg AuthGate.ResetRequestSubmit ] open
            in
            Expect.all
                [ \_ -> Expect.equal (Reset ResetAsk) empty.authGate.flow
                , \_ -> Expect.equal True (empty.authGate.error /= Nothing)
                , \_ -> Expect.equal False (hasOutbound isProbe emptyOuts)
                , \_ -> Expect.equal True (spaced.authGate.error /= Nothing)
                , \_ -> Expect.equal False (hasOutbound isProbe spacedOuts)
                ]
                ()
    , test "the generic RESETPASS notice moves to the code step without confirming the account exists" <|
        \_ ->
            let
                ( m, _ ) =
                    feed (inReset ResetAsking) ":irc.onyx.test NOTICE Guest12345 :RESETPASS: if that account has a verified email, a reset code has been sent."
            in
            Expect.equal (Reset ResetEnter) m.authGate.flow
    , test "confirming sends RESETPASS <account> <code> :<new password> and clears the secrets" <|
        \_ ->
            let
                ( m, outs ) =
                    run
                        [ gateMsg (AuthGate.ResetCodeInput (String.toUpper resetCode))
                        , gateMsg (AuthGate.ResetPasswordInput "brand new pw")
                        , gateMsg (AuthGate.ResetConfirmInput "brand new pw")
                        , gateMsg AuthGate.ResetConfirmSubmit
                        ]
                        resetEnter
            in
            Expect.all
                [ \_ -> Expect.equal [ "RESETPASS kai " ++ resetCode ++ " :brand new pw\u{000D}\n" ] (sentLines outs)
                , \_ -> Expect.equal (Reset ResetSetting) m.authGate.flow
                , \_ -> Expect.equal ( "", "" ) ( m.authGate.resetPassword, m.authGate.resetConfirm )
                ]
                ()
    , test "mismatched or weak passwords and a malformed code never reach the wire" <|
        \_ ->
            let
                attempt code pw confirm =
                    run
                        [ gateMsg (AuthGate.ResetCodeInput code)
                        , gateMsg (AuthGate.ResetPasswordInput pw)
                        , gateMsg (AuthGate.ResetConfirmInput confirm)
                        , gateMsg AuthGate.ResetConfirmSubmit
                        ]
                        resetEnter
            in
            Expect.all
                [ \_ -> Expect.equal [] (sentLines (Tuple.second (attempt resetCode "brand new pw" "different pw")))
                , \_ -> Expect.equal [] (sentLines (Tuple.second (attempt resetCode "short" "short")))
                , \_ -> Expect.equal [] (sentLines (Tuple.second (attempt "123" "brand new pw" "brand new pw")))
                , \_ -> Expect.equal (Just "The two new passwords don't match.") (Tuple.first (attempt resetCode "brand new pw" "different pw")).authGate.error
                ]
                ()
    , test "RESETPASS SUCCESS ends on the done step" <|
        \_ ->
            let
                ( m, _ ) =
                    feed (inReset ResetSetting) ":irc.onyx.test RESETPASS SUCCESS kai :Password reset; log in with your new password"
            in
            Expect.equal (Reset ResetDone) m.authGate.flow
    , test "Sign in after a reset prefills the account and hangs up the guest socket" <|
        \_ ->
            let
                ( m, outs ) =
                    update (gateMsg AuthGate.DoneSignIn) (inReset ResetDone)
            in
            Expect.all
                [ \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal "kai" m.connectForm.nick
                , \_ -> Expect.equal True (hasOutbound isDisconnect outs)
                ]
                ()
    , test "every FAIL RESETPASS code lands on the right step with its own copy" <|
        \_ ->
            let
                land code =
                    let
                        ( m, _ ) =
                            feed (inReset ResetSetting) (":irc.onyx.test FAIL RESETPASS " ++ code ++ " :server text")
                    in
                    ( m.authGate.flow, m.authGate.error /= Nothing )
            in
            Expect.equal
                [ ( Reset ResetEnter, True )
                , ( Reset ResetAsk, True )
                , ( Reset ResetAsk, True )
                , ( Reset ResetAsk, True )
                , ( Reset ResetAsk, True )
                , ( Reset ResetAsk, True )
                , ( Reset ResetEnter, True )
                ]
                (List.map land
                    [ "BAD_CODE"
                    , "EXPIRED"
                    , "NO_REQUEST"
                    , "TOO_MANY_ATTEMPTS"
                    , "INVALID_PASSWORD"
                    , "UNAVAILABLE"
                    , "TEMPORARILY_UNAVAILABLE"
                    ]
                )
    , test "RESETPASS UNAVAILABLE while requesting says reset email is not set up here" <|
        \_ ->
            let
                ( m, _ ) =
                    feed (inReset ResetAsking) ":irc.onyx.test FAIL RESETPASS UNAVAILABLE :Email password reset is not configured on this server"
            in
            Expect.all
                [ \_ -> Expect.equal (Reset ResetAsk) m.authGate.flow
                , \_ -> Expect.equal (Just (AuthGate.resetFailCopy { code = "UNAVAILABLE", text = "" })) m.authGate.error
                ]
                ()
    , test "a spent code (invalid new password) is cleared so it cannot be retried" <|
        \_ ->
            let
                ( m, _ ) =
                    feed (inReset ResetSetting) ":irc.onyx.test FAIL RESETPASS INVALID_PASSWORD :New password rejected (8-512 chars)"
            in
            Expect.equal "" m.authGate.resetCode
    , test "a wrong code keeps the code field so a typo can be fixed" <|
        \_ ->
            let
                ( m, _ ) =
                    feed (inReset ResetSetting) ":irc.onyx.test FAIL RESETPASS BAD_CODE :Incorrect reset code"
            in
            Expect.equal resetCode m.authGate.resetCode
    , test "a RESETPASS reply outside the reset flow is not claimed" <|
        \_ ->
            let
                ( m, _ ) =
                    feed liveKai ":irc.onyx.test RESETPASS SUCCESS kai :Password reset; log in with your new password"
            in
            Expect.equal NoFlow m.authGate.flow
    , test "a reset socket that closes returns to the form with an honest line" <|
        \_ ->
            let
                ( m, _ ) =
                    update (WsClosed { clean = False, reason = "lost" }) (inReset ResetAsking)
            in
            Expect.all
                [ \_ -> Expect.equal (Reset ResetAsk) m.authGate.flow
                , \_ -> Expect.equal True (m.authGate.error /= Nothing)
                , \_ -> Expect.equal False m.autoReconnect
                ]
                ()
    , test "Cancel leaves the reset flow and returns to sign in" <|
        \_ ->
            let
                ( m, _ ) =
                    update (gateMsg AuthGate.Cancel) resetEnter
            in
            Expect.all
                [ \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal "kai" m.connectForm.nick
                , \_ -> Expect.equal "" m.authGate.resetPassword
                ]
                ()
    ]



-- PASSKEY


passkeyFlow : List Test
passkeyFlow =
    [ test "WEBAUTHN wire lines: AUTH <account>, STATUS" <|
        \_ ->
            Expect.equal
                [ Just "WEBAUTHN AUTH kai\u{000D}\n", Nothing, Just "WEBAUTHN STATUS\u{000D}\n" ]
                [ Passkey.webauthnAuth "kai", Passkey.webauthnAuth "two words", Just Passkey.webauthnStatus ]
    , test "choosing passkey needs an account name" <|
        \_ ->
            let
                blankName =
                    { offlineKai | connectForm = (\f -> { f | nick = "" }) offlineKai.connectForm }

                ( m, outs ) =
                    update (gateMsg AuthGate.PasskeyStart) blankName
            in
            Expect.all
                [ \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal True (m.authGate.error /= Nothing)
                , \_ -> Expect.equal False (hasOutbound isProbe outs)
                ]
                ()
    , test "choosing passkey dials a guest connection and then asks WEBAUTHN AUTH" <|
        \_ ->
            let
                ( dialing, dialOuts ) =
                    update (gateMsg AuthGate.PasskeyStart) offlineKai

                opened =
                    { dialing | connection = Registering, ourNick = "Guest12345" }

                ( live, liveOuts ) =
                    feed opened (welcome "Guest12345")
            in
            Expect.all
                [ \_ -> Expect.equal (PasskeySignIn "kai" PkDialing) dialing.authGate.flow
                , \_ -> Expect.equal True (hasOutbound isProbe dialOuts)
                , \_ -> Expect.equal (PasskeySignIn "kai" PkWaiting) live.authGate.flow
                , \_ -> Expect.equal True (List.member "WEBAUTHN AUTH kai\u{000D}\n" (sentLines liveOuts))
                , \_ -> Expect.equal True live.passkey.busy
                ]
                ()
    , test "AUTH-CHALLENGE and ALLOW-CRED arrive as EVENT lines and are collected for the ceremony" <|
        \_ ->
            let
                waiting =
                    withGate (\g -> { g | flow = PasskeySignIn "kai" PkWaiting })
                        { liveKai | accountName = Nothing, ourNick = "Guest12345", identifyReplyAccount = Just "kai" }

                ( m, _ ) =
                    List.foldl
                        (\line ( acc, outs ) ->
                            let
                                ( next, out ) =
                                    feed acc line
                            in
                            ( next, outs ++ out )
                        )
                        ( waiting, [] )
                        [ ":irc.onyx.test EVENT Guest12345 WEBAUTHN AUTH-CHALLENGE AAAAAAAAAAAAAAAAAAAAAA irc.onyx.test :kai"
                        , ":irc.onyx.test EVENT Guest12345 WEBAUTHN ALLOW-CRED AQIDBAUGBwgJCgsMDQ4PEA"
                        ]
            in
            case m.passkey.pendingAuth of
                Just pending ->
                    Expect.equal ( "AAAAAAAAAAAAAAAAAAAAAA", "irc.onyx.test", [ "AQIDBAUGBwgJCgsMDQ4PEA" ] ) ( pending.challenge, pending.rpId, pending.allowCreds )

                Nothing ->
                    Expect.fail "no pending passkey challenge"
    , test "the server's identified notice completes a passkey login" <|
        \_ ->
            let
                waiting =
                    withGate (\g -> { g | flow = PasskeySignIn "kai" PkWaiting })
                        { liveKai | accountName = Nothing, ourNick = "Guest12345", identifyReplyAccount = Just "kai" }

                ( m, _ ) =
                    feed waiting ":irc.onyx.test NOTICE Guest12345 :You are now identified as kai"
            in
            Expect.all
                [ \_ -> Expect.equal (Just "kai") m.accountName
                , \_ -> Expect.equal NoFlow m.authGate.flow
                , \_ -> Expect.equal False m.passkey.busy
                ]
                ()
    , test "a refused passkey login stops with the server's reason and a retry" <|
        \_ ->
            let
                waiting =
                    withGate (\g -> { g | flow = PasskeySignIn "kai" PkWaiting })
                        { liveKai | accountName = Nothing, ourNick = "Guest12345", identifyReplyAccount = Just "kai" }

                ( m, _ ) =
                    feed waiting ":irc.onyx.test 464 Guest12345 :Too many failed login attempts - retry in 12s"
            in
            Expect.all
                [ \_ -> Expect.equal (PasskeySignIn "kai" PkStopped) m.authGate.flow
                , \_ -> Expect.equal (Just "Too many sign-in attempts. Try again in 12s.") m.authGate.error
                ]
                ()
    , test "the Account panel reports WEBAUTHN STATUS in plain words" <|
        \_ ->
            Expect.equal
                [ "No passkeys are on file for this account.", "1 passkey is on file for this account.", "3 passkeys are on file for this account." ]
                [ AuthGate.passkeyStatusCopy "0 passkey(s) registered"
                , AuthGate.passkeyStatusCopy "1 passkey(s) registered"
                , AuthGate.passkeyStatusCopy "3 passkey(s) registered"
                ]
    , test "the STATUS reply is remembered on the passkey session" <|
        \_ ->
            let
                ( m, _ ) =
                    feed liveKai ":irc.onyx.test EVENT kai WEBAUTHN STATUS :2 passkey(s) registered"
            in
            Expect.equal (Just "2 passkey(s) registered") m.passkey.statusText
    ]



-- 913 / custom status


noAccess : List Test
noAccess =
    [ test "913 on our own user entity is a visible status error, not a log line" <|
        \_ ->
            let
                ( m, _ ) =
                    feed liveKai ":irc.onyx.test 913 kai * :You do not have access to that object"
            in
            Expect.all
                [ \_ -> Expect.equal True (m.statusError /= Nothing)
                , \_ -> Expect.equal True (List.any (\t -> t.title == "Your status wasn't saved") m.toasts)
                ]
                ()
    , test "913 on another entity becomes an inbox error" <|
        \_ ->
            let
                ( m, _ ) =
                    feed liveKai ":irc.onyx.test 913 kai #lounge :No access"
            in
            Expect.equal True (List.any (\n -> String.contains "#lounge" n.text) m.notifications)
    ]



-- COPY


copyTests : List Test
copyTests =
    [ test "FAIL RESETPASS copy never blames the person for a server fault" <|
        \_ ->
            Expect.equal
                [ "That code isn't right. Check the email and try again."
                , "That code has expired. Request a new one."
                , "There's no reset waiting for that account. Request a code first."
                , "Too many incorrect codes. Request a new one."
                , "Email password reset isn't set up on this network. If you saved recovery codes, sign in with one instead."
                , "Password reset is unavailable right now. Try again in a few minutes."
                ]
                (List.map AuthGate.resetFailCopy
                    [ { code = "BAD_CODE", text = "" }
                    , { code = "EXPIRED", text = "" }
                    , { code = "NO_REQUEST", text = "" }
                    , { code = "TOO_MANY_ATTEMPTS", text = "" }
                    , { code = "UNAVAILABLE", text = "" }
                    , { code = "TEMPORARILY_UNAVAILABLE", text = "" }
                    ]
                )
    , test "an unknown code falls back to the server's text, then to the code" <|
        \_ ->
            Expect.equal
                [ "Server says no", "Password reset failed (ODD)." ]
                [ AuthGate.resetFailCopy { code = "ODD", text = "Server says no" }
                , AuthGate.resetFailCopy { code = "ODD", text = "" }
                ]
    , test "the real 2FA 904 text is recognised; other refusals are not" <|
        \_ ->
            Expect.equal
                [ True, True, False, False ]
                [ AuthGate.isTwoFactorRefusal "Two-factor authentication required: log in with IDENTIFY <account> <password> <code>"
                , AuthGate.isTwoFactorRefusal "two-factor code required"
                , AuthGate.isTwoFactorRefusal "SASL authentication failed"
                , AuthGate.isTwoFactorRefusal "Invalid account or password"
                ]
    , test "standard replies that reach a client as NOTICEs are split correctly" <|
        \_ ->
            Expect.equal
                (Just { kind = "FAIL", command = "SETPASS", code = "WRONG_PASSWORD", text = "Current password is incorrect" })
                (AuthGate.noticeStandardReply "FAIL SETPASS WRONG_PASSWORD: Current password is incorrect")
    , test "the server's login confirmation and SETPASS notices are recognised" <|
        \_ ->
            Expect.all
                [ \_ -> Expect.equal (Just "kai") (AuthGate.identifiedAccount "You are now identified as kai")
                , \_ -> Expect.equal Nothing (AuthGate.identifiedAccount "You are now logged in as kai")
                , \_ ->
                    Expect.equal [ True, True, False ]
                        [ AuthGate.setPassNotice "SETPASS: your password has been changed"
                        , AuthGate.setPassNotice "SETPASS: your password has been reset (verified by client certificate)"
                        , AuthGate.setPassNotice "SETPASS failed"
                        ]
                , \_ ->
                    Expect.equal [ True, False ]
                        [ AuthGate.isResetRequestNotice "RESETPASS: if that account has a verified email, a reset code has been sent."
                        , AuthGate.isResetRequestNotice "RESETPASS: something else"
                        ]
                ]
                ()
    , test "a guest nick for an auth step is never the account name" <|
        \_ ->
            Expect.all
                [ \n -> Expect.equal True (String.startsWith "Guest" n)
                , \n -> Expect.equal 10 (String.length n)
                ]
                (AuthGate.guestNick 1760000000000)
    ]



-- VIEWS


viewOf : Model -> Query.Single Msg
viewOf model =
    View.AuthGate.gate model |> Query.fromHtml


viewTests : List Test
viewTests =
    [ test "the code step shows its field, a verify button and the recovery alternative" <|
        \_ ->
            viewOf (withGate (\g -> { g | flow = TwoFactor "kai" TfaCode }) offlineKai)
                |> Expect.all
                    [ Query.has [ Selector.text "Two-step sign-in" ]
                    , Query.find [ Selector.id "auth-code" ] >> Query.has [ Selector.attribute (Html.Attributes.attribute "autocomplete" "one-time-code") ]
                    , Query.has [ testId "auth-code-submit" ]
                    , Query.has [ testId "auth-use-recovery" ]
                    ]
    , test "the code field takes input and the form submits" <|
        \_ ->
            let
                m =
                    withGate (\g -> { g | flow = TwoFactor "kai" TfaCode }) offlineKai
            in
            Expect.all
                [ \_ ->
                    viewOf m
                        |> Query.find [ Selector.id "auth-code" ]
                        |> Event.simulate (Event.input "123456")
                        |> Event.expect (AuthGateMsg (AuthGate.CodeInput "123456"))
                , \_ ->
                    viewOf m
                        |> Query.find [ Selector.tag "form" ]
                        |> Event.simulate Event.submit
                        |> Event.expect (AuthGateMsg AuthGate.CodeSubmit)
                ]
                ()
    , test "the question step shows the server's question and an answer field" <|
        \_ ->
            registering
                |> withGate (\g -> { g | challenge = QuestionAsked { question = "What colour is the sky?", error = Nothing, sent = False } })
                |> viewOf
                |> Expect.all
                    [ Query.has [ Selector.text "What colour is the sky?" ]
                    , Query.has [ Selector.id "auth-answer" ]
                    ]
    , test "the stopped step offers Try again" <|
        \_ ->
            offlineKai
                |> withGate (\g -> { g | challenge = ChallengeStopped StopTimedOut })
                |> viewOf
                |> Expect.all
                    [ Query.has [ Selector.text "That took too long" ]
                    , Query.has [ Selector.id "auth-retry" ]
                    ]
    , test "the reset steps are reachable and name the account" <|
        \_ ->
            let
                at phase =
                    withGate (\g -> { g | flow = Reset phase, resetAccount = "kai" }) offlineKai
            in
            Expect.all
                [ \_ -> viewOf (at ResetAsk) |> Query.has [ Selector.id "auth-reset-account" ]
                , \_ -> viewOf (at ResetEnter) |> Query.has [ Selector.id "auth-reset-code" ]
                , \_ -> viewOf (at ResetEnter) |> Query.has [ Selector.id "auth-reset-password" ]
                , \_ -> viewOf (at ResetDone) |> Query.has [ Selector.id "auth-done" ]
                ]
                ()
    , test "a reset failure is one alert above the button, not tied to a single field" <|
        \_ ->
            withGate (\g -> { g | flow = Reset ResetEnter, resetAccount = "kai", error = Just "That code isn't right. Check the email and try again." }) offlineKai
                |> viewOf
                |> Expect.all
                    [ Query.find [ Selector.id "auth-reset-error" ] >> Query.has [ Selector.text "That code isn't right." ]
                    , Query.findAll [ Selector.attribute (Html.Attributes.attribute "role" "alert") ] >> Query.count (Expect.equal 1)
                    ]
    , test "the two-step code step does not insist on a digit count in its copy" <|
        \_ ->
            withGate (\g -> { g | flow = TwoFactor "kai" TfaCode }) offlineKai
                |> viewOf
                |> Query.has [ Selector.text "enter the code for" ]
    , test "passwords are never rendered as readable values" <|
        \_ ->
            withGate (\g -> { g | flow = Reset ResetEnter, resetAccount = "kai" }) offlineKai
                |> viewOf
                |> Expect.all
                    [ Query.find [ Selector.id "auth-reset-password" ] >> Query.has [ Selector.attribute (Html.Attributes.type_ "password") ]
                    , Query.find [ Selector.id "auth-reset-confirm" ] >> Query.has [ Selector.attribute (Html.Attributes.type_ "password") ]
                    ]
    ]
