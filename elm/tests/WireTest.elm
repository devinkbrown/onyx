module WireTest exposing (suite)

{-| Behavioral vectors ported from `src/lib/irc/*.test.ts`. The TypeScript
suite is the oracle; these vectors must agree with it.
-}

import Char
import Dict
import Expect
import Set
import Test exposing (Test, describe, test)
import Wire exposing (..)


suite : Test
suite =
    describe "Wire"
        [ describe "splitWireFrame"
            [ test "splits a CRLF-less Onyx Server frame" <|
                \_ ->
                    splitWireFrame ":eshmaki.me CAP * LS :multi-prefix"
                        |> Expect.equal [ ":eshmaki.me CAP * LS :multi-prefix" ]
            , test "splits CRLF frames and drops empty segments" <|
                \_ ->
                    splitWireFrame "PING :a\r\n\r\n:eshmaki.me PONG :a\r\n"
                        |> Expect.equal [ "PING :a", ":eshmaki.me PONG :a" ]
            , test "tolerates LF-only separators" <|
                \_ ->
                    splitWireFrame "a\nb\n"
                        |> Expect.equal [ "a", "b" ]
            , test "empty frame yields nothing" <|
                \_ ->
                    splitWireFrame ""
                        |> Expect.equal []
            ]
        , describe "parseIrcMessage"
            [ test "parses tags, prefix nick/host, command, trailing" <|
                \_ ->
                    let
                        msg =
                            parseIrcMessage "@time=2024-01-01;+typing=active :alice!u@h PRIVMSG #c :hello world"
                    in
                    Expect.all
                        [ \m -> Expect.equal "PRIVMSG" m.command
                        , \m -> Expect.equal (Just "alice") m.nick
                        , \m -> Expect.equal (Just "h") m.host
                        , \m -> Expect.equal [ "#c", "hello world" ] m.params
                        , \m -> Expect.equal (Just "2024-01-01") (Dict.get "time" m.tags)
                        , \m -> Expect.equal (Just "active") (Dict.get "+typing" m.tags)
                        ]
                        msg
            , test "dotted prefix is a server host, bare prefix is a nick" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseIrcMessage ":eshmaki.me 001 a :hi").nick
                        , \_ -> Expect.equal (Just "eshmaki.me") (parseIrcMessage ":eshmaki.me 001 a :hi").host
                        , \_ -> Expect.equal (Just "alice") (parseIrcMessage ":alice JOIN #c").nick
                        ]
                        ()
            , test "round-trips all five IRCv3 tag escapes exactly once" <|
                \_ ->
                    let
                        wireValue =
                            "slash\\\\colon\\:space\\scarriage\\rline\\n"

                        decodedValue =
                            "slash\\colon;space carriage\rline\n"

                        message =
                            parseIrcMessage ("@v=" ++ wireValue ++ " CMD")
                    in
                    Expect.all
                        [ \_ -> Expect.equal "CMD" message.command
                        , \_ -> Expect.equal (Just decodedValue) (Dict.get "v" message.tags)
                        , \_ -> Expect.equal ("@v=" ++ wireValue ++ " CMD\r\n") (formatTaggedLine message.tags message.command message.params)
                        ]
                        ()
            , test "preserves absent versus empty trailing parameters" <|
                \_ ->
                    let
                        absent =
                            parseIrcMessage "CMD"

                        empty =
                            parseIrcMessage "CMD :"

                        spaced =
                            parseIrcMessage "CMD :hello world"
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] absent.params
                        , \_ -> Expect.equal [ "" ] empty.params
                        , \_ -> Expect.equal [ "hello world" ] spaced.params
                        , \_ -> Expect.equal "CMD\r\n" (formatIrcLine absent.command absent.params)
                        , \_ -> Expect.equal "CMD :\r\n" (formatIrcLine empty.command empty.params)
                        ]
                        ()
            , test "rejects invalid commands" <|
                \_ ->
                    parseIrcMessage "PRIV-MSG #c :x"
                        |> .command
                        |> Expect.equal ""
            , test "strips trailing CRLF" <|
                \_ ->
                    parseIrcMessage ":s PING :a\r\n"
                        |> .params
                        |> Expect.equal [ "a" ]
            , test "rejects embedded NUL and line breaks without sanitizing into a command" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "" (parseIrcMessage "PING\u{0000} :a").command
                        , \_ -> Expect.equal "" (parseIrcMessage "PING :a\rX").command
                        , \_ -> Expect.equal "" (parseIrcMessage "PING :a\nJOIN #x").command
                        , \_ -> Expect.equal "" (parseIrcMessage ("PING :" ++ String.fromChar (Char.fromCode 0xD800))).command
                        ]
                        ()
            , test "measures prefix bounds in UTF-8 bytes" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "PING" (parseIrcMessage (":" ++ String.repeat 256 "é" ++ " PING")).command
                        , \_ -> Expect.equal "" (parseIrcMessage (":" ++ String.repeat 257 "é" ++ " PING")).command
                        ]
                        ()
            , test "rejects excess parameters and oversized tag values as whole lines" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "" (parseIrcMessage ("CMD " ++ String.join " " (List.repeat 513 "x"))).command
                        , \_ -> Expect.equal "" (parseIrcMessage ("@k=" ++ String.repeat 16385 "😀" ++ " PING")).command
                        ]
                        ()
            , test "rejects 257 tags rather than keeping a valid prefix" <|
                \_ ->
                    parseIrcMessage ("@" ++ String.join ";" (List.repeat 257 "k=v") ++ " PING")
                        |> .command
                        |> Expect.equal ""
            , test "rejects lines above the transport UTF-8 byte ceiling" <|
                \_ ->
                    parseIrcMessage ("PING :" ++ String.repeat 131072 "😀")
                        |> .command
                        |> Expect.equal ""
            , test "rejects a frame beyond the line-count bound instead of taking a prefix" <|
                \_ ->
                    splitWireFrame (String.join "\n" (List.repeat 513 "PING"))
                        |> Expect.equal []
            ]
        , describe "formatIrcLine"
            [ test "emits exactly one line and neutralizes injection" <|
                \_ ->
                    formatIrcLine "PRIVMSG" [ "#c", "hi\r\nJOIN #evil" ]
                        |> Expect.equal "PRIVMSG #c :hiJOIN #evil\r\n"
            , test "colon-prefixes trailing params with spaces" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "JOIN #a #b\r\n" (formatIrcLine "JOIN" [ "#a", "#b" ])
                        , \_ -> Expect.equal "PART #a :bye now\r\n" (formatIrcLine "PART" [ "#a", "bye now" ])
                        ]
                        ()
            , test "tagged lines escape values" <|
                \_ ->
                    formatTaggedLine (Dict.fromList [ ( "k", "a;b c" ) ]) "PING" [ "x" ]
                        |> Expect.equal "@k=a\\:b\\sc PING x\r\n"
            ]
        , describe "checked client line encoding"
            [ test "encodes Unicode bodies by UTF-8 byte length and permits CTCP control bodies" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok "PRIVMSG #c 😀\r\n") (encodeIrcLine "PRIVMSG" [ "#c", "😀" ])
                        , \_ -> Expect.equal (Ok "NOTICE nick \u{0001}PING\u{0001}\r\n") (encodeIrcLine "NOTICE" [ "nick", "\u{0001}PING\u{0001}" ])
                        ]
                        ()
            , test "rejects controls before flattening command and parameter fields" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Err InvalidCommand) (encodeIrcLine "JOIN #evil" [])
                        , \_ -> Expect.equal (Err InvalidParameter) (encodeIrcLine "PRIVMSG" [ "#c", "safe\r\nJOIN #evil" ])
                        , \_ -> Expect.equal (Err InvalidParameter) (encodeIrcLine "JOIN" [ "#c", "middle value", "tail" ])
                        ]
                        ()
            , test "enforces the live daemon 8191-byte line-body ceiling" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (Result.map (always True) (encodeIrcLine "PRIVMSG" [ "#c", String.repeat 8179 "a" ]) == Ok True)
                        , \_ -> Expect.equal True (Result.map (always True) (encodeIrcLine "PRIVMSG" [ "#c", String.repeat 8180 "a" ]) == Ok True)
                        , \_ -> Expect.equal (Err LineTooLong) (encodeIrcLine "PRIVMSG" [ "#c", String.repeat 8181 "a" ])
                        ]
                        ()
            , test "enforces the live daemon client tag count and accepts leading plus keys" <|
                \_ ->
                    let
                        thirtyTwo = Dict.fromList (List.map (\n -> ( "k" ++ String.fromInt n, "v" )) (List.range 1 30) ++ [ ( "+draft/reply", "parent" ), ( "+onyx/e2ee", "mls" ) ])
                        thirtyThree = Dict.insert "last" "v" thirtyTwo
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (Result.map (always True) (encodeTaggedLine thirtyTwo "PING" [ "x" ]) == Ok True)
                        , \_ -> Expect.equal (Err InvalidTags) (encodeTaggedLine thirtyThree "PING" [ "x" ])
                        , \_ -> Expect.equal (Err InvalidTags) (encodeTaggedLine (Dict.singleton "+bad_key" "v") "PING" [ "x" ])
                        ]
                        ()
            , test "validates already encoded lines without rewriting CTCP bodies" <|
                \_ ->
                    validateClientLine "NOTICE nick :\u{0001}PING\u{0001}\r\n"
                        |> Expect.equal (Ok "NOTICE nick :\u{0001}PING\u{0001}\r\n")
            , test "outbound boundary accepts an unframed legacy line without rewriting it" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok "MODEX #c") (validateClientOutboundLine "MODEX #c")
                        , \_ -> Expect.equal (Ok "JOIN #c\r\n") (validateClientOutboundLine "JOIN #c\r\n")
                        , \_ -> Expect.equal (Err InvalidFraming) (validateClientOutboundLine "PING\nJOIN #evil")
                        , \_ -> Expect.equal (Err LineTooLong) (validateClientOutboundLine ("PRIVMSG #c :" ++ String.repeat 8180 "a"))
                        ]
                        ()
            , test "validates semantic journal text without imposing single-line wire framing" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok ()) (validateSemanticMessage "first\nsecond")
                        , \_ -> Expect.equal (Err InvalidFraming) (validateSemanticMessage "first\rsecond")
                        , \_ -> Expect.equal (Err InvalidFraming) (validateSemanticMessage ("nul" ++ String.fromChar (Char.fromCode 0)))
                        , \_ -> Expect.equal (Err InvalidParameter) (validateSemanticMessage (String.fromChar (Char.fromCode 0xD800)))
                        , \_ -> Expect.equal (Ok ()) (validateSemanticMessage (String.repeat 65536 "a"))
                        , \_ -> Expect.equal (Err LineTooLong) (validateSemanticMessage (String.repeat 65537 "a"))
                        ]
                        ()
            ]
        , describe "prefix maps"
            [ test "parses exotic PREFIX and nick prefixes" <|
                \_ ->
                    let
                        m =
                            parsePrefix "(YQqov)*!.@+"

                        row =
                            parseNamesPrefix "@alice" m.prefixToMode
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just '*') (Dict.get 'Y' m.modeToPrefix)
                        , \_ -> Expect.equal (Just 'o') (Dict.get '@' m.prefixToMode)
                        , \_ -> Expect.equal "alice" row.nick
                        , \_ -> Expect.equal (Set.fromList [ 'o' ]) row.modes
                        , \_ -> Expect.equal [ 'Y', 'Q', 'q', 'o', 'v' ] m.modeOrder
                        ]
                        ()
            , test "rejects mismatched PREFIX maps whole" <|
                \_ ->
                    parsePrefix "(ov)@+!"
                        |> .modeToPrefix
                        |> Expect.equal Dict.empty
            , test "rejects bad CHANLIMIT whole" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Dict.empty (parseChanLimit "#:10,&:x")
                        , \_ ->
                            Expect.equal
                                (Dict.fromList [ ( '#', 10 ), ( '&', 5 ) ])
                                (parseChanLimit "#:10,&:5")
                        ]
                        ()
            ]
        , describe "sasl and replies"
            [ test "prefers SCRAM when a password exists" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just ScramSha256)
                                (selectSaslMechanism [ "PLAIN", "SCRAM-SHA-256" ] True False)
                        , \_ ->
                            Expect.equal
                                Nothing
                                (selectSaslMechanism [ "PLAIN" ] False False)
                        , \_ ->
                            Expect.equal
                                (Just External)
                                (selectSaslMechanism [ "EXTERNAL" ] False True)
                        ]
                        ()
            , test "parses advertised sasl mechanisms with bounds" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ "PLAIN", "SCRAM-SHA-256", "EXTERNAL" ]
                                (parseSaslMechanisms "PLAIN,SCRAM-SHA-256,EXTERNAL")
                        , \_ ->
                            Expect.equal
                                [ "PLAIN", "ok_under-dash" ]
                                (parseSaslMechanisms "PLAIN,PLAIN,,has space,has.dot,ok_under-dash")
                        , \_ ->
                            Expect.equal
                                16
                                (List.length
                                    (parseSaslMechanisms
                                        (String.join ","
                                            (List.map (\i -> "M" ++ String.fromInt i) (List.range 1 20))
                                        )
                                    )
                                )
                        , \_ ->
                            Expect.equal
                                []
                                (parseSaslMechanisms ("TOOLONG" ++ String.repeat 64 "x"))
                        ]
                        ()
            , test "chunks AUTHENTICATE payloads at 400 bytes" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ "abc" ]
                                (chunkSaslPayload "abc")
                        , \_ -> Expect.equal [ "+" ] (chunkSaslPayload "")
                        , \_ ->
                            Expect.equal
                                [ String.repeat 400 "a", "+" ]
                                (chunkSaslPayload (String.repeat 400 "a"))
                        , \_ ->
                            Expect.equal
                                [ String.repeat 400 "a", String.repeat 399 "b" ]
                                (chunkSaslPayload (String.repeat 400 "a" ++ String.repeat 399 "b"))
                        , \_ ->
                            Expect.equal
                                [ String.repeat 400 "c", String.repeat 400 "c", "+" ]
                                (chunkSaslPayload (String.repeat 800 "c"))
                        ]
                        ()
            , test "unsupported commands are ignored by the standard reply parser" <|
                \_ ->
                    Expect.equal Nothing (parseStandardReply (parseIrcMessage ":s BOGUS REGISTER DONE :ok"))
            , test "session resume line is one clean line" <|
                \_ ->
                    buildSessionResumeLine "tok"
                        |> Expect.equal "SESSION RESUME tok\r\n"
            , test "rejects CRLF-laced session tokens" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (isValidSessionCredential (Just "a\r\nb"))
                        , \_ -> Expect.equal True (isValidSessionCredential (Just "tok123"))
                        ]
                        ()
            , test "parses server NOTICE credential envelopes case-insensitively" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just { token = "tok123", expiresAt = Nothing })
                                (parseSessionTokenNotice (parseIrcMessage ":irc.example NOTICE me :SESSION TOKEN tok123"))
                        , \_ ->
                            Expect.equal
                                (Just { token = "hex9", expiresAt = Just 99 })
                                (parseSessionMeshTokenNotice (parseIrcMessage ":irc.example NOTICE me :session mtoken hex9 expires=99"))
                        , \_ ->
                            Expect.equal
                                Nothing
                                (parseSessionTokenNotice (parseIrcMessage ":irc.example NOTICE me :SESSION MTOKEN hex9"))
                        , \_ ->
                            Expect.equal
                                Nothing
                                (parseSessionTokenNotice (parseIrcMessage ":irc.example NOTICE me :hello world"))
                        , \_ ->
                            Expect.equal
                                Nothing
                                (parseSessionTokenNotice (parseIrcMessage ":irc.example BOGUS SESSION TOKEN tok123"))
                        ]
                        ()
            ]
        , describe "account info and monitor"
            [ test "extracts only sent keys" <|
                \_ ->
                    case parseAccountInfo "account=alice flags=3 secure=on" of
                        Just f ->
                            Expect.all
                                [ \x -> Expect.equal (Just "alice") x.account
                                , \x -> Expect.equal (Just 3) x.flags
                                , \x -> Expect.equal (Just True) x.secure
                                , \x -> Expect.equal Nothing x.email
                                ]
                                f

                        Nothing ->
                            Expect.fail "expected account fields"
            , test "duplicate keys fail closed" <|
                \_ ->
                    parseAccountInfo "account=a account=b"
                        |> Expect.equal Nothing
            , test "monitor online kind with targets" <|
                \_ ->
                    case parseMonitorNumeric (parseIrcMessage ":s 730 a :alice,bob") of
                        Just m ->
                            Expect.all
                                [ \x -> Expect.equal Online x.kind
                                , \x -> Expect.equal [ "alice", "bob" ] x.targets
                                ]
                                m

                        Nothing ->
                            Expect.fail "expected monitor numeric"
            , test "non-monitor numerics are ignored" <|
                \_ ->
                    parseMonitorNumeric (parseIrcMessage ":s 001 a :x")
                        |> Expect.equal Nothing
            ]
        , describe "casemapping"
            [ test "rfc1459 folds brackets" <|
                \_ ->
                    normalizeCase "A[B\\C^" "rfc1459"
                        |> Expect.equal "a{b|c~"
            , test "ascii folds case only" <|
                \_ ->
                    normalizeCase "AbC" "ascii"
                        |> Expect.equal "abc"
            , test "ASCII mapping leaves non-ASCII case pairs distinct" <|
                \_ ->
                    normalizeCase "ΣσÄä" "rfc1459"
                        |> Expect.equal "ΣσÄä"
            , test "strict RFC mapping keeps caret distinct from tilde" <|
                \_ ->
                    normalizeCase "A^~[]\\" "strict-rfc1459"
                        |> Expect.equal "a^~{}|"
            ]
        , describe "server time"
            [ test "epoch parses to zero" <|
                \_ ->
                    parseServerTime "1970-01-01T00:00:00Z"
                        |> Expect.equal (Just 0)
            , test "canonical Z stamp" <|
                \_ ->
                    parseServerTime "2026-10-04T12:00:00Z"
                        |> Expect.equal (Just 1791115200000)
            , test "fractional seconds truncate to millis" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 1791115200789) (parseServerTime "2026-10-04T12:00:00.7899Z")
                        , \_ -> Expect.equal (Just 1791115200500) (parseServerTime "2026-10-04T12:00:00.5Z")
                        ]
                        ()
            , test "numeric offsets shift to UTC" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 1791115200000) (parseServerTime "2026-10-04T14:00:00+02:00")
                        , \_ -> Expect.equal (Just 1791115200000) (parseServerTime "2026-10-04T07:00:00-05:00")
                        , \_ -> Expect.equal (Just 1791106200000) (parseServerTime "2026-10-04T12:00:00+0230")
                        ]
                        ()
            , test "leap days validate against the calendar" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just 1709251199999) (parseServerTime "2024-02-29T23:59:59.999Z")
                        , \_ -> Expect.equal (Just 951782400000) (parseServerTime "2000-02-29T00:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2023-02-29T00:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "1900-02-29T00:00:00Z")
                        ]
                        ()
            , test "out-of-range fields reject" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseServerTime "2026-13-01T00:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-00-10T00:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04T24:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04T12:60:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04T12:00:60Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04T12:00:00+24:00")
                        ]
                        ()
            , test "malformed shapes reject" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseServerTime "")
                        , \_ -> Expect.equal Nothing (parseServerTime "not-a-date")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04 12:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04T12:00:00")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-10-04T12:00:00.")
                        , \_ -> Expect.equal Nothing (parseServerTime "2026-1-04T12:00:00Z")
                        , \_ -> Expect.equal Nothing (parseServerTime "1969-12-31T23:59:59Z")
                        , \_ -> Expect.equal Nothing (parseServerTime ("2026-10-04T12:00:00Z" ++ String.repeat 64 "x"))
                        ]
                        ()
            ]
        , describe "E10 empty values and parameter limits"
            [ test "empty and valueless tags both decode to the empty string and empty trailing survives middles" <|
                \_ ->
                    let
                        message =
                            parseIrcMessage "@a=;b CMD x :"
                    in
                    Expect.all
                        [ \m -> Expect.equal "CMD" m.command
                        , \m -> Expect.equal (Just "") (Dict.get "a" m.tags)
                        , \m -> Expect.equal (Just "") (Dict.get "b" m.tags)
                        , \m -> Expect.equal [ "a", "b" ] (Dict.keys m.tags)
                        , \m -> Expect.equal [ "x", "" ] m.params
                        ]
                        message
            , test "a doubled separator before an empty trailing keeps exactly one middle and one empty trailing" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [ "a", "" ] (parseIrcMessage "CMD a  :").params
                        , \_ -> Expect.equal [ "a", "" ] (parseIrcMessage "CMD a :").params
                        , \_ -> Expect.equal [ "a" ] (parseIrcMessage "CMD a").params
                        ]
                        ()
            , test "encodeIrcLine accepts 15 parameters and rejects 16" <|
                \_ ->
                    let
                        middles n =
                            List.map (\i -> "p" ++ String.fromInt i) (List.range 1 n)
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Ok ("CMD " ++ String.join " " (middles 15) ++ "\r\n")) (encodeIrcLine "CMD" (middles 15))
                        , \_ -> Expect.equal (Err TooManyParameters) (encodeIrcLine "CMD" (middles 16))
                        ]
                        ()
            , test "encodeIrcLineWithTrailing counts the trailing: 14 middles plus trailing pass, 15 plus trailing fail" <|
                \_ ->
                    let
                        middles n =
                            List.map (\i -> "p" ++ String.fromInt i) (List.range 1 n)
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Ok ("CMD " ++ String.join " " (middles 14) ++ " :tail\r\n")) (encodeIrcLineWithTrailing "CMD" (middles 14) "tail")
                        , \_ -> Expect.equal (Err TooManyParameters) (encodeIrcLineWithTrailing "CMD" (middles 15) "tail")
                        ]
                        ()
            ]
        ]
