module ConnectTest exposing (suite)

{-| Vectors for the connect gate, mirroring `src/app/Connect.tsx`
(gate visibility through `connected || autoReconnect`, guest / sign-in /
register submit paths, nick + room + register validation, password
strength scoring, failure copy, Cancel and deliberate disconnect).
-}

import App exposing (..)
import Expect
import Route
import Test exposing (Test, describe, test)


armed : Model
armed =
    { blank | connectGate = True, route = Route.App, connection = Offline, autoReconnect = False }


withForm : (ConnectForm -> ConnectForm) -> Model -> Model
withForm f model =
    { model | connectForm = f model.connectForm }


guestNamed : String -> Model
guestNamed nick =
    withForm (\f -> { f | nick = nick }) armed


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


clearSasl : Outbound
clearSasl =
    SaslCredentialsStored { account = "", password = "", hasClientCert = False }


hasRegisterLine : List Outbound -> Bool
hasRegisterLine =
    List.any
        (\o ->
            case o of
                SendLine line ->
                    String.startsWith "REGISTER kai " line

                _ ->
                    False
        )


suite : Test
suite =
    describe "connect gate"
        [ describe "connectGateVisible"
            [ test "armed gate on /app while offline shows" <|
                \_ -> Expect.equal True (connectGateVisible armed)
            , test "an unarmed gate (boot ?nick=) never shows" <|
                \_ -> Expect.equal False (connectGateVisible { armed | connectGate = False })
            , test "other routes never show the gate" <|
                \_ -> Expect.equal False (connectGateVisible { armed | route = Route.Landing })
            , test "a live session shows the shell" <|
                \_ -> Expect.equal False (connectGateVisible { armed | connection = Live })
            , test "a drop with auto-reconnect armed keeps the shell" <|
                \_ -> Expect.equal False (connectGateVisible { armed | connection = Offline, autoReconnect = True })
            , test "the handshake keeps the gate up (connecting phase)" <|
                \_ ->
                    Expect.all
                        [ \m -> Expect.equal True (connectGateVisible m)
                        , \m -> Expect.equal ConnectConnecting (connectPhase m)
                        ]
                        { armed | connection = Registering }
            ]
        , describe "guest submit"
            [ test "probes under the chosen nick and clears held SASL" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit (guestNamed "  kai ")
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ clearSasl, ProbeNodes { nick = "kai" } ] out
                        , \_ -> Expect.equal "kai" next.ourNick
                        , \_ -> Expect.equal ConnectConnecting (connectPhase next)
                        , \_ -> Expect.equal Nothing next.saslAccount
                        , \_ -> Expect.equal False (connectCanSubmit next)
                        ]
                        ()
            , test "a ?ws= pin dials directly" <|
                \_ ->
                    Expect.equal [ clearSasl, WsConnect { url = "wss://pin.example/ws" } ]
                        (Tuple.second (update ConnectSubmit (withForm (\f -> { f | nick = "kai" }) { armed | wsPin = Just "wss://pin.example/ws" })))
            , test "an invalid nick refuses with the oracle copy" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit (guestNamed "9lives")
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.notEqual Nothing next.connectForm.nickError
                        , \_ -> Expect.equal ConnectIdle (connectPhase next)
                        ]
                        ()
            , test "a blank nick cannot submit" <|
                \_ -> Expect.equal False (connectCanSubmit (guestNamed "   "))
            , test "a bad room refuses with the room hint" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit (withForm (\f -> { f | room = "two words" }) (guestNamed "kai"))
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Room names look like #lounge — no spaces or commas.") next.connectForm.roomError
                        ]
                        ()
            , test "a bare room name gains # and becomes the pending join" <|
                \_ ->
                    let
                        ( next, _ ) =
                            update ConnectSubmit (withForm (\f -> { f | room = "lounge" }) (guestNamed "kai"))
                    in
                    Expect.equal (Just "#lounge") next.pendingDeepLinkJoin
            , test "a close before the socket opens reports the failure" <|
                \_ ->
                    let
                        ( next, _ ) =
                            run [ ConnectSubmit, WsClosed { clean = False, reason = "unreachable" } ] (guestNamed "kai")
                    in
                    Expect.all
                        [ \_ -> Expect.equal ConnectError (connectPhase next)
                        , \_ -> Expect.equal "Couldn’t reach Onyx just now. Try again in a moment." (connectStatusMessage next)
                        , \_ -> Expect.equal "Try again" (connectSubmitLabel next.connectForm.mode (connectPhase next))
                        , \_ -> Expect.equal True (connectGateVisible next)
                        ]
                        ()
            , test "the socket opening ends the dial and starts registration" <|
                \_ ->
                    let
                        ( next, out ) =
                            run [ ConnectSubmit, WsOpened { url = "wss://irc.example/ws" } ] (guestNamed "kai")
                    in
                    Expect.all
                        [ \_ -> Expect.equal False next.connectForm.dialing
                        , \_ -> Expect.equal Registering next.connection
                        , \_ ->
                            Expect.equal True
                                (List.any
                                    (\o ->
                                        case o of
                                            SendLine line ->
                                                String.startsWith "NICK" line && String.contains "kai" line

                                            _ ->
                                                False
                                    )
                                    out
                                )
                        ]
                        ()
            , test "Cancel abandons the dial without an error" <|
                \_ ->
                    let
                        ( next, out ) =
                            run [ ConnectSubmit, ConnectCancel ] (guestNamed "kai")
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (List.member WsDisconnect out)
                        , \_ -> Expect.equal ConnectIdle (connectPhase next)
                        ]
                        ()
            ]
        , describe "sign in"
            [ test "hands the password to ports SASL and never keeps it on the form" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit
                                (withForm (\f -> { f | mode = ConnectSignIn, nick = "kai", password = " p w " }) armed)
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ SaslCredentialsStored { account = "kai", password = " p w ", hasClientCert = False }
                                , ProbeNodes { nick = "kai" }
                                ]
                                out
                        , \_ -> Expect.equal "" next.connectForm.password
                        , \_ -> Expect.equal (Just "kai") next.saslAccount
                        , \_ -> Expect.equal True next.saslPasswordHeld
                        ]
                        ()
            , test "a missing password refuses" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit (withForm (\f -> { f | mode = ConnectSignIn, nick = "kai" }) armed)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Password is required to sign in.") next.connectForm.passwordError
                        ]
                        ()
            , test "a short recovery code refuses" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit
                                (withForm (\f -> { f | mode = ConnectSignIn, nick = "kai", recoveryOpen = True, recoveryCode = "AB-CD" }) armed)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Enter a recovery code from your saved list.") next.connectForm.passwordError
                        ]
                        ()
            , test "a recovery code queues the login for 001 and dials anonymously" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit
                                (withForm (\f -> { f | mode = ConnectSignIn, nick = "kai", recoveryOpen = True, recoveryCode = "ABCDE-FGHJK" }) armed)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ clearSasl, ProbeNodes { nick = "kai" } ] out
                        , \_ -> Expect.notEqual Nothing next.pendingRecoveryLogin
                        , \_ -> Expect.equal "" next.connectForm.recoveryCode
                        ]
                        ()
            , test "switching modes clears stale errors" <|
                \_ ->
                    let
                        ( next, _ ) =
                            update (ConnectModeSet ConnectRegister)
                                (withForm (\f -> { f | mode = ConnectSignIn, passwordError = Just "x", nickError = Just "y" }) armed)
                    in
                    Expect.all
                        [ \_ -> Expect.equal ConnectRegister next.connectForm.mode
                        , \_ -> Expect.equal Nothing next.connectForm.passwordError
                        , \_ -> Expect.equal Nothing next.connectForm.nickError
                        ]
                        ()
            ]
        , describe "register"
            [ test "validation errors surface per field" <|
                \_ ->
                    let
                        ( next, out ) =
                            update ConnectSubmit
                                (withForm (\f -> { f | mode = ConnectRegister, nick = "kai", email = "nope", password = "short", confirm = "other" }) armed)
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] out
                        , \_ -> Expect.equal (Just "Enter a valid email address.") next.connectForm.emailError
                        , \_ -> Expect.equal (Just "Use at least 8 characters.") next.connectForm.passwordError
                        , \_ -> Expect.equal (Just "Passwords do not match.") next.connectForm.confirmError
                        ]
                        ()
            , test "submit stages REGISTER, dials anonymously, then registers on 001" <|
                \_ ->
                    let
                        start =
                            withForm (\f -> { f | mode = ConnectRegister, nick = "kai", password = "longenough1", confirm = "longenough1" }) armed

                        ( staged, out1 ) =
                            update ConnectSubmit start

                        ( live, out2 ) =
                            run [ WsOpened { url = "wss://irc.example/ws" }, WsLineReceived ":irc.example 001 kai :Welcome" ] staged
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ clearSasl, ProbeNodes { nick = "kai" } ] out1
                        , \_ -> Expect.equal "" staged.connectForm.password
                        , \_ -> Expect.notEqual Nothing staged.connectForm.pendingRegister
                        , \_ -> Expect.equal Live live.connection
                        , \_ -> Expect.equal True (hasRegisterLine out2)
                        , \_ -> Expect.equal Nothing live.connectForm.pendingRegister
                        , \_ -> Expect.equal True live.guestClaimOpen
                        , \_ -> Expect.equal "" live.guestClaimPassword
                        , \_ -> Expect.equal False (connectGateVisible live)
                        ]
                        ()
            , test "email is optional" <|
                \_ -> Expect.equal Nothing (validateConnectEmail "  ")
            ]
        , describe "passwordStrength"
            [ test "empty" <|
                \_ -> Expect.equal { score = 0, label = "empty" } (passwordStrength "")
            , test "length only" <|
                \_ -> Expect.equal { score = 1, label = "weak" } (passwordStrength "abcdefgh")
            , test "long with a digit" <|
                \_ -> Expect.equal { score = 3, label = "good" } (passwordStrength "abcdefghijk1")
            , test "all classes clamp to 4" <|
                \_ -> Expect.equal { score = 4, label = "strong" } (passwordStrength "Abcdefghijk1!")
            ]
        , describe "SessionDisconnect"
            [ test "disarms auto-reconnect and returns to the form" <|
                \_ ->
                    let
                        ( next, out ) =
                            update SessionDisconnect { armed | connectGate = False, connection = Live, autoReconnect = True }

                        ( closed, _ ) =
                            update (WsClosed { clean = True, reason = "bye" }) next
                    in
                    Expect.all
                        [ \_ -> Expect.equal [ WsDisconnect ] out
                        , \_ -> Expect.equal False closed.autoReconnect
                        , \_ -> Expect.equal True (connectGateVisible closed)
                        , \_ -> Expect.equal ConnectIdle (connectPhase closed)
                        ]
                        ()
            ]
        ]
