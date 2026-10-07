module PushTest exposing (suite)

{-| Web push gates: strict VAPID shape validation, the enable gate
order with typed reasons, the recover intent check, and the
owner-key encoding. Oracle `src/lib/notifications/webPush.ts`.
-}

import Expect
import Push exposing (..)
import Test exposing (Test, describe, test)


{-| 65 bytes: 0x04 followed by 1..64, base64url without padding. -}
validVapid : String
validVapid =
    "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A"


suite : Test
suite =
    describe "Push"
        [ describe "VAPID shape"
            [ test "accepts a 65-byte uncompressed point" <|
                \_ ->
                    Expect.equal
                        (Just (4 :: List.range 1 64))
                        (vapidKeyBytes validVapid)
            , test "rejects standard-base64 aliases, padding, and emptiness" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (vapidKeyBytes "")
                        , \_ -> Expect.equal Nothing (vapidKeyBytes (validVapid ++ "="))
                        , \_ -> Expect.equal Nothing (vapidKeyBytes ("BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A+"))
                        , \_ -> Expect.equal Nothing (vapidKeyBytes "not key material!!")
                        ]
                        ()
            , test "rejects wrong lengths and a non-0x04 head" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (vapidKeyBytes (String.dropLeft 4 validVapid))
                        , \_ -> Expect.equal Nothing (vapidKeyBytes ("A" ++ String.dropLeft 1 validVapid))
                        , \_ -> Expect.equal Nothing (vapidKeyBytes "BEE")
                        ]
                        ()
            ]
        , describe "enable gates"
            [ test "gate order carries the oracle reasons" <|
                \_ ->
                    let
                        base =
                            { supported = True, account = Just "alice", connected = True, vapid = validVapid }
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Err "This browser does not support push.")
                                (enableReadiness { base | supported = False })
                        , \_ ->
                            Expect.equal
                                (Err "Sign in first — push is tied to your account.")
                                (enableReadiness { base | account = Nothing })
                        , \_ ->
                            Expect.equal
                                (Err "Sign in first — push is tied to your account.")
                                (enableReadiness { base | account = Just "  " })
                        , \_ ->
                            Expect.equal
                                (Err "Reconnect first.")
                                (enableReadiness { base | connected = False })
                        , \_ ->
                            Expect.equal
                                (Err "Push is not enabled on this server.")
                                (enableReadiness { base | vapid = "" })
                        , \_ ->
                            Expect.equal
                                (Err "Push is misconfigured on this server.")
                                (enableReadiness { base | vapid = "BEE" })
                        , \_ ->
                            Expect.equal
                                (Ok (4 :: List.range 1 64))
                                (enableReadiness base)
                        ]
                        ()
            , test "recover needs the prior opt-in" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok ()) (recoverReadiness { intentDesired = True })
                        , \_ ->
                            Expect.equal
                                (Err "Push is not enabled on this browser.")
                                (recoverReadiness { intentDesired = False })
                        ]
                        ()
            ]
        , describe "owner key"
            [ test "encodes the lowercased pair like deviceMemoryOwnerKey" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just "[\"wss://irc.example\",\"alice\"]")
                                (ownerKey { serverUrl = "wss://irc.example", identity = "Alice" })
                        , \_ ->
                            Expect.equal
                                (Just "[\"wss://irc.example\",\"a\\\"b\\\\c\"]")
                                (ownerKey { serverUrl = "wss://irc.example", identity = "a\"b\\c" })
                        , \_ -> Expect.equal Nothing (ownerKey { serverUrl = "", identity = "alice" })
                        , \_ -> Expect.equal Nothing (ownerKey { serverUrl = "wss://irc.example", identity = "  " })
                        , \_ -> Expect.equal Nothing (ownerKey { serverUrl = String.repeat 2049 "x", identity = "alice" })
                        ]
                        ()
            ]
        , describe "toast copy"
            [ test "toggle verdicts match the oracle" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "Push on" pushOnToast.title
                        , \_ -> Expect.equal "Push off" pushOffToast.title
                        , \_ ->
                            Expect.equal
                                { title = "Push unavailable", description = "nope" }
                                (pushUnavailableToast "nope")
                        ]
                        ()
            ]
        ]
