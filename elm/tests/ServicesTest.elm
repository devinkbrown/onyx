module ServicesTest exposing (suite)

{-| Account/query builders (fail-closed validation), the offline-send
admission matrix, and the WHOIS fold — oracles `lib/store/store.ts`
(sendMessage offline branch, WHOIS numerics), `Account.tsx` wire
shapes, protocol §7.
-}

import Dict
import Expect
import Services exposing (..)
import Test exposing (Test, describe, test)
import Wire


ctx : { activeNick : String, ourNick : String }
ctx =
    { activeNick = "alice", ourNick = "me" }


feed : WhoisCache -> String -> WhoisFold
feed cache line =
    foldWhoisLine cache ctx (Wire.parseIrcMessage line)


begun : WhoisCache
begun =
    Tuple.first (beginWhois blankWhoisCache "alice" True)


cached : String -> WhoisCache -> Maybe WhoisInfo
cached nick cache =
    Dict.get (String.toLower nick) cache.entries


suite : Test
suite =
    describe "Services"
        [ describe "account builders"
            [ test "REGISTER shapes account email password" <|
                \_ ->
                    Expect.equal
                        (Just "REGISTER alice a@x.li s3cret\r\n")
                        (register "alice" "a@x.li" "s3cret")
            , test "REGISTER accepts * for no email" <|
                \_ ->
                    Expect.equal
                        (Just "REGISTER alice * s3cret\r\n")
                        (register "alice" "*" "s3cret")
            , test "REGISTER refuses empty account" <|
                \_ ->
                    Expect.equal Nothing (register "" "a@x.li" "pw")
            , test "VERIFY shapes account code" <|
                \_ ->
                    Expect.equal
                        (Just "VERIFY alice 482910\r\n")
                        (verifyCode "alice" "482910")
            , test "VERIFY refuses empty code" <|
                \_ ->
                    Expect.equal Nothing (verifyCode "alice" "")
            , test "IDENTIFY shapes account password" <|
                \_ ->
                    Expect.equal
                        (Just "IDENTIFY alice s3cret\r\n")
                        (identify "alice" "s3cret")
            , test "LOGOUT takes no params" <|
                \_ ->
                    Expect.equal "LOGOUT\r\n" logout
            , test "ACCOUNTINFO without a name asks for self" <|
                \_ ->
                    Expect.equal (Just "ACCOUNTINFO\r\n") (accountInfo Nothing)
            , test "ACCOUNTINFO with a name asks for it" <|
                \_ ->
                    Expect.equal (Just "ACCOUNTINFO bob\r\n") (accountInfo (Just "bob"))
            , test "ACCOUNTSET shapes all four fields" <|
                \_ ->
                    Expect.equal
                        (Just "ACCOUNTSET alice pw email a@x.li\r\n")
                        (accountSet "alice" "pw" "email" "a@x.li")
            , test "VERIFY sends the token" <|
                \_ ->
                    Expect.equal (Just "VERIFY tok123\r\n") (verifyAccount "tok123")
            , test "GHOST shapes nick password" <|
                \_ ->
                    Expect.equal (Just "GHOST stale pw\r\n") (ghost "stale" "pw")
            , test "RECOVER and RELEASE shape the nick" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "RECOVER stale\r\n") (recover "stale")
                        , \_ -> Expect.equal (Just "RELEASE alice\r\n") (releaseNick "alice")
                        ]
                        ()
            , test "SASLINFO takes no params" <|
                \_ ->
                    Expect.equal "SASLINFO\r\n" saslInfo
            , test "SEEN shapes the account" <|
                \_ ->
                    Expect.equal (Just "SEEN alice\r\n") (seen "alice")
            , test "CERTADD and CERTDEL shape the fingerprint" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "CERTADD AA:BB\r\n") (certAdd "AA:BB")
                        , \_ -> Expect.equal (Just "CERTDEL AA:BB\r\n") (certDel "AA:BB")
                        , \_ -> Expect.equal "CERTLIST\r\n" certList
                        ]
                        ()
            , test "builders refuse CR/LF injection" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (identify "alice\r\nBOGUS" "pw")
                        , \_ -> Expect.equal Nothing (accountSet "alice" "pw" "email" "a@x\nBOGUS")
                        , \_ -> Expect.equal Nothing (recover "a b")
                        ]
                        ()
            ]
        , describe "MEMO commands"
            [ test "SEND shapes account and trailing text" <|
                \_ ->
                    Expect.equal
                        (Just "MEMO SEND bob :hello there\r\n")
                        (memo "SEND" [ "bob", "hello there" ])
            , test "LIST CLEAR OFF take no args" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "MEMO LIST\r\n") (memo "LIST" [])
                        , \_ -> Expect.equal (Just "MEMO CLEAR\r\n") (memo "CLEAR" [])
                        , \_ -> Expect.equal (Just "MEMO OFF\r\n") (memo "OFF" [])
                        ]
                        ()
            , test "IGNORE ADD shapes the account" <|
                \_ ->
                    Expect.equal
                        (Just "MEMO IGNORE ADD spammer\r\n")
                        (memo "IGNORE" [ "ADD", "spammer" ])
            , test "FORWARD shapes the account" <|
                \_ ->
                    Expect.equal
                        (Just "MEMO FORWARD bob\r\n")
                        (memo "FORWARD" [ "bob" ])
            , test "unknown subcommands and arities refuse" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (memo "TEGAMI" [])
                        , \_ -> Expect.equal Nothing (memo "SEND" [ "bob" ])
                        , \_ -> Expect.equal Nothing (memo "LIST" [ "bob" ])
                        , \_ -> Expect.equal Nothing (memo "IGNORE" [ "FROBNICATE", "bob" ])
                        ]
                        ()
            ]
        , describe "query builders"
            [ test "WHOIS uses the double-nick form" <|
                \_ ->
                    Expect.equal (Just "WHOIS alice alice\r\n") (whois "alice")
            , test "WHOIS refuses a bad nick" <|
                \_ ->
                    Expect.equal Nothing (whois "a b")
            , test "ISON refuses an empty list" <|
                \_ ->
                    Expect.equal Nothing (ison [])
            , test "USERHOST caps at five nicks" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "USERHOST a\r\n") (userhost [ "a" ])
                        , \_ -> Expect.equal Nothing (userhost [ "a", "b", "c", "d", "e", "f" ])
                        ]
                        ()
            , test "AWAY without a message clears" <|
                \_ ->
                    Expect.equal (Just "AWAY\r\n") (away Nothing)
            , test "MONITOR L takes no args, +/- take nicks" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "MONITOR L\r\n") (monitor "L" [])
                        , \_ -> Expect.equal (Just "MONITOR + alice\r\n") (monitor "+" [ "alice" ])
                        , \_ -> Expect.equal Nothing (monitor "L" [ "alice" ])
                        , \_ -> Expect.equal Nothing (monitor "+" [])
                        ]
                        ()
            , test "SILENCE and ACCEPT take signed entries" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "SILENCE + *!*@*\r\n") (silenceEntry "+" "*!*@*")
                        , \_ -> Expect.equal (Just "ACCEPT - bob\r\n") (acceptEntry "-" "bob")
                        , \_ -> Expect.equal Nothing (silenceEntry "=" "*!*@*")
                        ]
                        ()
            , test "WHOX validates the selector like the server" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "WHO #c %n\r\n") (whox "#c" "%n")
                        , \_ -> Expect.equal (Just "WHO #c %tcuihsnfdlar,42\r\n") (whox "#c" "%tcuihsnfdlar,42")
                        , \_ -> Expect.equal Nothing (whox "#c" "n")
                        , \_ -> Expect.equal Nothing (whox "#c" "%")
                        , \_ -> Expect.equal Nothing (whox "#c" "%nn")
                        , \_ -> Expect.equal Nothing (whox "#c" "%nx")
                        , \_ -> Expect.equal Nothing (whox "#c" "%n,")
                        , \_ -> Expect.equal Nothing (whox "#c" "%n,a,b")
                        , \_ -> Expect.equal Nothing (whox "#c" "%n,a b")
                        , \_ -> Expect.equal Nothing (whox "" "%n")
                        ]
                        ()
            , test "HELP and HELPOP take an optional topic" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "HELP\r\n") (helpTopic Nothing)
                        , \_ -> Expect.equal (Just "HELP JOIN\r\n") (helpTopic (Just "JOIN"))
                        , \_ -> Expect.equal (Just "HELPOP\r\n") (helpOp Nothing)
                        , \_ -> Expect.equal (Just "HELPOP OPER\r\n") (helpOp (Just "OPER"))
                        , \_ -> Expect.equal Nothing (helpTopic (Just "a b"))
                        ]
                        ()
            , test "WELCOME show/clear/add" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "WELCOME\r\n" welcomeShow
                        , \_ -> Expect.equal "WELCOME CLEAR\r\n" welcomeClear
                        , \_ -> Expect.equal (Just "WELCOME ADD :hello new members\r\n") (welcomeAdd "hello new members")
                        , \_ -> Expect.equal Nothing (welcomeAdd "")
                        ]
                        ()
            ]
        , describe "offline-send admission"
            [ test "online input attempts the live send" <|
                \_ ->
                    Expect.equal AttemptLiveSend
                        (decideOfflineSend
                            { connected = True
                            , text = "hi"
                            , target = "#c"
                            , chantypes = "#&"
                            , requiredE2EE = False
                            , dmE2EEDesignated = False
                            , hasOwner = True
                            }
                        )
            , test "offline slash commands never queue" <|
                \_ ->
                    Expect.equal AttemptLiveSend
                        (decideOfflineSend
                            { connected = False
                            , text = "/join #c"
                            , target = "#c"
                            , chantypes = "#&"
                            , requiredE2EE = False
                            , dmE2EEDesignated = False
                            , hasOwner = True
                            }
                        )
            , test "offline required-E2EE rooms refuse" <|
                \_ ->
                    Expect.equal RefuseEncryptedRoom
                        (decideOfflineSend
                            { connected = False
                            , text = "hi"
                            , target = "#c"
                            , chantypes = "#&"
                            , requiredE2EE = True
                            , dmE2EEDesignated = False
                            , hasOwner = True
                            }
                        )
            , test "offline E2EE-designated DMs refuse" <|
                \_ ->
                    Expect.equal RefuseEncryptedDm
                        (decideOfflineSend
                            { connected = False
                            , text = "hi"
                            , target = "bob"
                            , chantypes = "#&"
                            , requiredE2EE = False
                            , dmE2EEDesignated = True
                            , hasOwner = True
                            }
                        )
            , test "offline sends without a vault owner refuse" <|
                \_ ->
                    Expect.equal RefuseNoOwner
                        (decideOfflineSend
                            { connected = False
                            , text = "hi"
                            , target = "#c"
                            , chantypes = "#&"
                            , requiredE2EE = False
                            , dmE2EEDesignated = False
                            , hasOwner = False
                            }
                        )
            , test "offline plaintext otherwise queues" <|
                \_ ->
                    Expect.equal QueuePlaintext
                        (decideOfflineSend
                            { connected = False
                            , text = "hi"
                            , target = "#c"
                            , chantypes = "#&"
                            , requiredE2EE = False
                            , dmE2EEDesignated = False
                            , hasOwner = True
                            }
                        )
            ]
        , describe "WHOIS working set"
            [ test "beginWhois emits WHOIS nick nick when connected" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "WHOIS alice alice\r\n")
                                (Tuple.second (beginWhois blankWhoisCache "alice" True))
                        , \_ ->
                            Expect.equal (Just True)
                                (Maybe.map .loading (cached "alice" begun))
                        ]
                        ()
            , test "beginWhois offline records the reconnect error" <|
                \_ ->
                    let
                        ( cache, line ) =
                            beginWhois blankWhoisCache "alice" False
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing line
                        , \_ ->
                            Expect.equal
                                (Just (Just "Reconnect to request profile details."))
                                (Maybe.map .error (cached "alice" cache))
                        ]
                        ()
            , test "beginWhois refuses a bad nick" <|
                \_ ->
                    Expect.equal ( blankWhoisCache, Nothing )
                        (beginWhois blankWhoisCache "a b" True)
            , test "boundedNumber follows parseInt prefix semantics" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 12 (boundedNumber (Just "12"))
                        , \_ -> Expect.equal 12 (boundedNumber (Just "12abc"))
                        , \_ -> Expect.equal 12 (boundedNumber (Just "  12"))
                        , \_ -> Expect.equal 12 (boundedNumber (Just "+12"))
                        , \_ -> Expect.equal 0 (boundedNumber (Just "-12"))
                        , \_ -> Expect.equal 0 (boundedNumber (Just "nope"))
                        , \_ -> Expect.equal 0 (boundedNumber (Just ""))
                        , \_ -> Expect.equal 0 (boundedNumber Nothing)
                        , \_ -> Expect.equal 0 (boundedNumber (Just "99999999999999999999"))
                        ]
                        ()
            , test "311 fills user host realname" <|
                \_ ->
                    case feed begun ":s 311 me alice auser ahost * :Alice Liddell" of
                        CacheUpdated cache ->
                            Expect.all
                                [ \_ -> Expect.equal (Just (Just "auser")) (Maybe.map .username (cached "alice" cache))
                                , \_ -> Expect.equal (Just (Just "ahost")) (Maybe.map .host (cached "alice" cache))
                                , \_ -> Expect.equal (Just (Just "Alice Liddell")) (Maybe.map .realname (cached "alice" cache))
                                ]
                                ()

                        _ ->
                            Expect.fail "expected CacheUpdated"
            , test "off-target numerics never plant data" <|
                \_ ->
                    Expect.equal NoChange
                        (feed begun ":s 311 me bob buser bhost * :Bob")
            , test "numerics without a sheet entry are ignored" <|
                \_ ->
                    Expect.equal NoChange
                        (feed blankWhoisCache ":s 311 me alice a u * :A")
            , test "313 strips the copula for the badge label" <|
                \_ ->
                    case feed begun ":s 313 me alice :is a Network Administrator" of
                        CacheUpdated cache ->
                            Expect.all
                                [ \_ -> Expect.equal (Just True) (Maybe.map .isOper (cached "alice" cache))
                                , \_ ->
                                    Expect.equal (Just (Just "Network Administrator"))
                                        (Maybe.map .operRole (cached "alice" cache))
                                ]
                                ()

                        _ ->
                            Expect.fail "expected CacheUpdated"
            , test "313 on self with an admin wording promotes the badge" <|
                \_ ->
                    let
                        selfCache =
                            Tuple.first (beginWhois blankWhoisCache "me" True)
                    in
                    case foldWhoisLine selfCache { activeNick = "me", ourNick = "me" } (Wire.parseIrcMessage ":s 313 me me :is the Network Administrator.") of
                        SelfOper { admin } ->
                            Expect.equal True admin

                        _ ->
                            Expect.fail "expected SelfOper"
            , test "317 parses prefix-tolerant non-negative numbers" <|
                \_ ->
                    case feed begun ":s 317 me alice 42x 100" of
                        CacheUpdated cache ->
                            Expect.all
                                [ \_ -> Expect.equal (Just (Just 42)) (Maybe.map .idleSecs (cached "alice" cache))
                                , \_ -> Expect.equal (Just (Just 100)) (Maybe.map .signOnTs (cached "alice" cache))
                                ]
                                ()

                        _ ->
                            Expect.fail "expected CacheUpdated"
            , test "319 merges fragments instead of replacing" <|
                \_ ->
                    let
                        step line cache =
                            case foldWhoisLine cache ctx (Wire.parseIrcMessage line) of
                                CacheUpdated next ->
                                    next

                                _ ->
                                    cache

                        merged =
                            begun
                                |> step ":s 319 me alice :#a #b"
                                |> step ":s 319 me alice :#b #c"
                    in
                    Expect.equal (Just [ "#a", "#b", "#c" ])
                        (Maybe.map .channels (cached "alice" merged))
            , test "320 keeps latest special with deduped notes" <|
                \_ ->
                    let
                        step line cache =
                            case foldWhoisLine cache ctx (Wire.parseIrcMessage line) of
                                CacheUpdated next ->
                                    next

                                _ ->
                                    cache

                        merged =
                            begun
                                |> step ":s 320 me alice :first"
                                |> step ":s 320 me alice :second"
                                |> step ":s 320 me alice :first"
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just (Just "first"))
                                (Maybe.map .special (cached "alice" merged))
                        , \_ ->
                            Expect.equal (Just [ "first", "second" ])
                                (Maybe.map .specialNotes (cached "alice" merged))
                        ]
                        ()
            , test "318 marks loading done" <|
                \_ ->
                    case feed begun ":s 318 me alice :End" of
                        CacheUpdated cache ->
                            Expect.equal (Just False) (Maybe.map .loading (cached "alice" cache))

                        _ ->
                            Expect.fail "expected CacheUpdated"
            , test "301 records the away message" <|
                \_ ->
                    case feed begun ":s 301 me alice :out to lunch" of
                        CacheUpdated cache ->
                            Expect.equal (Just (Just "out to lunch"))
                                (Maybe.map .awayMessage (cached "alice" cache))

                        _ ->
                            Expect.fail "expected CacheUpdated"
            , test "330 335 338 671 276 land on the sheet" <|
                \_ ->
                    let
                        step line cache =
                            case foldWhoisLine cache ctx (Wire.parseIrcMessage line) of
                                CacheUpdated next ->
                                    next

                                _ ->
                                    cache

                        merged =
                            begun
                                |> step ":s 330 me alice :alice-acct"
                                |> step ":s 335 me alice :is a bot"
                                |> step ":s 338 me alice :real.example"
                                |> step ":s 671 me alice :using TLSv1.3"
                                |> step ":s 276 me alice :has client certificate fingerprint AA:BB"
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just (Just "alice-acct")) (Maybe.map .account (cached "alice" merged))
                        , \_ -> Expect.equal (Just True) (Maybe.map .bot (cached "alice" merged))
                        , \_ -> Expect.equal (Just (Just "real.example")) (Maybe.map .realHost (cached "alice" merged))
                        , \_ -> Expect.equal (Just (Just "using TLSv1.3")) (Maybe.map .secureConnection (cached "alice" merged))
                        , \_ -> Expect.equal (Just (Just "has client certificate fingerprint AA:BB")) (Maybe.map .certfp (cached "alice" merged))
                        ]
                        ()
            , test "305 and 306 report self away state" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (SelfAway True) (feed begun ":s 306 me :You are now away")
                        , \_ -> Expect.equal (SelfAway False) (feed begun ":s 305 me :You are no longer away")
                        ]
                        ()
            , test "381 reports oper state with the admin badge" <|
                \_ ->
                    case feed begun ":s 381 me :You are now a network administrator" of
                        SelfOper { admin } ->
                            Expect.equal True admin

                        _ ->
                            Expect.fail "expected SelfOper"
            , test "the cache holds at most 64 sheets" <|
                \_ ->
                    let
                        insert i cache =
                            Tuple.first (beginWhois cache ("u" ++ String.fromInt i) True)

                        full =
                            List.foldl insert blankWhoisCache (List.range 1 65)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 64 (Dict.size full.entries)
                        , \_ -> Expect.equal Nothing (cached "u1" full)
                        , \_ ->
                            Expect.equal True
                                (cached "u65" full /= Nothing)
                        ]
                        ()
            ]
        ]
