module DmKeyHoldTest exposing (suite)

{-| Vectors for the DM key-lookup hold: with encrypted DMs on, a DM to a
peer whose `ocean.dm-key` lookup has not answered never goes out as
plaintext. It is held (draft kept, lookup re-sent) until a key, a
definitive "no key", or explicit per-peer consent to send unencrypted.
-}

import App exposing (..)
import Base64Url
import Dict
import Expect
import Set
import Test exposing (Test, describe, test)
import Wire


feed : Model -> String -> ( Model, List Outbound )
feed model line =
    update (WsLineReceived line) model


opened : Model
opened =
    Tuple.first (update (ChannelSelect "bob") { blank | nowMs = 1000 })


sendHello : Model -> ( Model, List Outbound )
sendHello model =
    update ComposerSend { model | composer = "hello" }


privmsgs : List Outbound -> List String
privmsgs =
    List.filterMap
        (\o ->
            case o of
                SendLine line ->
                    if String.contains "PRIVMSG" line then
                        Just line

                    else
                        Nothing

                _ ->
                    Nothing
        )


keyGets : List Outbound -> Int
keyGets =
    List.length
        << List.filter
            (\o ->
                case o of
                    SendLine line ->
                        String.startsWith "METADATA bob GET ocean.dm-key" line

                    _ ->
                        False
            )


suite : Test
suite =
    describe "DM key-lookup hold"
        [ test "an unanswered peer is held: no PRIVMSG, draft kept, lookup re-sent, consent offered" <|
            \_ ->
                let
                    ( held, out ) =
                        sendHello opened
                in
                Expect.all
                    [ \_ -> Expect.equal [] (privmsgs out)
                    , \_ -> Expect.equal "hello" held.composer
                    , \_ -> Expect.equal 1 (keyGets out)
                    , \_ -> Expect.equal (Just "bob") held.dmKeyHold
                    , \_ -> Expect.equal (Just (holdDmCopy "bob")) held.composerError
                    ]
                    ()
        , test "repeat sends inside the retry window do not spam lookups" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( _, out ) =
                        sendHello held
                in
                Expect.equal 0 (keyGets out)
        , test "a 766 (no key) releases the hold and clears the notice; the next send is plaintext" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( answered, _ ) =
                        feed held ":s 766 me bob ocean.dm-key :key not set"

                    ( _, out ) =
                        sendHello answered
                in
                Expect.all
                    [ \_ -> Expect.equal Nothing answered.dmKeyHold
                    , \_ -> Expect.equal Nothing answered.composerError
                    , \_ -> Expect.equal [ "PRIVMSG bob hello\u{000D}\n" ] (privmsgs out)
                    ]
                    ()
        , test "a 761 key reply designates the peer: the send seals, never plaintext" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( keyed, _ ) =
                        feed held (":s 761 me bob ocean.dm-key pub :" ++ Base64Url.encode (0x04 :: List.repeat 64 7))

                    ( _, out ) =
                        sendHello keyed
                in
                Expect.equal [] (privmsgs out)
        , test "a malformed 761 key never unlocks plaintext" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( garbled, _ ) =
                        feed held ":s 761 me bob ocean.dm-key pub :not-a-key"

                    ( _, out ) =
                        sendHello garbled
                in
                Expect.all
                    [ \_ -> Expect.equal True (dmKeyUnresolved garbled "bob")
                    , \_ -> Expect.equal [] (privmsgs out)
                    ]
                    ()
        , test "FAIL METADATA KEY_NOT_SET settles the pending lookup" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( answered, _ ) =
                        feed held ":s FAIL METADATA KEY_NOT_SET bob ocean.dm-key :No such key"
                in
                Expect.equal False (dmKeyUnresolved answered "bob")
        , test "a transient FAIL (rate limit) never downgrades" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( after, _ ) =
                        feed held ":s FAIL METADATA RATE_LIMITED bob :Slow down"

                    ( _, out ) =
                        sendHello after
                in
                Expect.all
                    [ \_ -> Expect.equal True (dmKeyUnresolved after "bob")
                    , \_ -> Expect.equal [] (privmsgs out)
                    ]
                    ()
        , test "401 for the pending peer settles it" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( after, _ ) =
                        feed held ":s 401 me bob :No such nick"
                in
                Expect.equal False (dmKeyUnresolved after "bob")
        , test "explicit consent sends the held draft unencrypted, for that peer only" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( consented, out ) =
                        update (DmSendUnencrypted "bob") held
                in
                Expect.all
                    [ \_ -> Expect.equal [ "PRIVMSG bob hello\u{000D}\n" ] (privmsgs out)
                    , \_ -> Expect.equal Nothing consented.dmKeyHold
                    , \_ -> Expect.equal True (dmKeyUnresolved consented "carol")
                    ]
                    ()
        , test "encrypted DMs off: no hold (preference honoured)" <|
            \_ ->
                let
                    ( _, out ) =
                        sendHello { opened | e2eeDms = False }
                in
                Expect.equal [ "PRIVMSG bob hello\u{000D}\n" ] (privmsgs out)
        , test "rooms are never held" <|
            \_ ->
                Expect.equal False (dmKeyUnresolved blank "#lounge")
        , test "offline: an unresolved DM refuses to queue as plaintext" <|
            \_ ->
                let
                    ( after, out ) =
                        sendHello { opened | connection = Offline }

                    queued =
                        List.any
                            (\o ->
                                case o of
                                    OutboxQueue _ ->
                                        True

                                    _ ->
                                        False
                            )
                            out
                in
                Expect.all
                    [ \_ -> Expect.equal False queued
                    , \_ -> Expect.equal "hello" after.composer
                    ]
                    ()
        , test "a socket close drops in-flight lookups so the next send re-asks" <|
            \_ ->
                let
                    ( held, _ ) =
                        sendHello opened

                    ( closed, _ ) =
                        update (WsClosed { clean = False, reason = "x" }) held
                in
                Expect.equal Dict.empty closed.dmKeyPending
        , test "answered state is per peer" <|
            \_ ->
                let
                    m =
                        { blank | dmKeyAnswered = Set.singleton "bob" }
                in
                Expect.equal ( False, True ) ( dmKeyUnresolved m "Bob", dmKeyUnresolved m "carol" )
        , test "lookup line shape" <|
            \_ ->
                Expect.equal 1 (keyGets [ SendLine (Wire.formatIrcLine "METADATA" [ "bob", "GET", "ocean.dm-key" ]) ])
                , test "raw /notice and /privmsg to a designated peer are refused (no content on the wire)" <|
            \_ ->
                let
                    designated =
                        Tuple.first (feed opened (":s 761 me bob ocean.dm-key pub :" ++ Base64Url.encode (0x04 :: List.repeat 64 7)))

                    run text =
                        update ComposerSend { designated | activeChannel = Just "#c", composer = text }

                    ( after, out ) =
                        run "/notice bob secret"

                    ( _, out2 ) =
                        run "/privmsg bob secret"
                in
                -- v3/gap-commands: /notice now rides the composer seal path (it
                -- seals or refuses — GapCommandsTest), /privmsg stays a raw
                -- verb and is refused; neither puts content on the wire.
                Expect.all
                    [ \_ -> Expect.equal [] (List.filter (\o -> o /= SendLine "") out ++ out2 |> List.filter isSend)
                    , \_ -> Expect.equal "/notice bob secret" after.composer
                    ]
                    ()
        , test "raw /notice to an unresolved peer is refused too" <|
            \_ ->
                Tuple.second (update ComposerSend { opened | activeChannel = Just "#c", composer = "/notice bob secret" })
                    |> List.filter isSend
                    |> Expect.equal []
        , test "raw non-content verbs still pass" <|
            \_ ->
                Tuple.second (update ComposerSend { opened | activeChannel = Just "#c", composer = "/away brb" })
                    |> Expect.equal [ SendLine "AWAY brb\u{000D}\n" ]
        , test "protected DMs offer no plaintext EDIT" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (plaintextWouldLeak opened "bob")
                    , \_ -> Expect.equal False (plaintextWouldLeak { opened | dmKeyAnswered = Set.singleton "bob" } "bob")
                    ]
                    ()
        , test "offline: with encrypted DMs on, even an answered peer never queues plaintext" <|
            \_ ->
                let
                    ( _, out ) =
                        sendHello { opened | connection = Offline, dmKeyAnswered = Set.singleton "bob" }
                in
                Expect.equal False
                    (List.any
                        (\o ->
                            case o of
                                OutboxQueue _ ->
                                    True

                                _ ->
                                    False
                        )
                        out
                    )
        , test "a socket close resets answers and plaintext consent" <|
            \_ ->
                let
                    ( closed, _ ) =
                        update (WsClosed { clean = True, reason = "x" }) { opened | dmKeyAnswered = Set.singleton "bob", dmPlainConfirmed = Set.singleton "carol" }
                in
                Expect.equal ( Set.empty, Set.empty ) ( closed.dmKeyAnswered, closed.dmPlainConfirmed )
        ]


isSend : Outbound -> Bool
isSend o =
    case o of
        SendLine line ->
            String.contains "secret" line

        _ ->
            False
