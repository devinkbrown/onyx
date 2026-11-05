module IsupportTest exposing (suite)

{-| Vectors derived from the `_parseISUPPORT` fold in
`src/lib/irc/client.ts` (no dedicated TS suite exists; the oracle is the
fold itself plus `docs/reference/protocol/isupport.md`).
-}

import Dict
import Expect
import Isupport exposing (..)
import Test exposing (Test, describe, test)
import Wire


line005 : String -> List String
line005 body =
    (Wire.parseIrcMessage (":eshmaki.me 005 alice " ++ body ++ " :are supported by this server")).params


suite : Test
suite =
    describe "Isupport"
        [ test "defaults mirror the live server" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Onyx" defaultSupport.network
                    , \_ -> Expect.equal "#&" defaultSupport.chantypes
                    , \_ -> Expect.equal 64 defaultSupport.nicklen
                    , \_ -> Expect.equal 390 defaultSupport.topiclen
                    , \_ -> Expect.equal 4 defaultSupport.modesPerLine
                    , \_ -> Expect.equal 50 defaultSupport.maxchannels
                    , \_ -> Expect.equal False defaultSupport.ircx
                    , \_ -> Expect.equal "" defaultSupport.statusmsg
                    , \_ -> Expect.equal 0 defaultSupport.silence
                    , \_ -> Expect.equal "ascii" defaultSupport.casemapping
                    , \_ -> Expect.equal Nothing defaultSupport.attributionNode
                    ]
                    ()
        , test "a full 005 line updates every known token" <|
            \_ ->
                let
                    support =
                        applyIsupportLine defaultSupport
                            (line005 "PREFIX=(YQqov)*!.@+ NETWORK=Onyx CHANTYPES=#& CASEMAPPING=ascii NICKLEN=64 TOPICLEN=390 CHANLIMIT=#&:50 MODES=1 CHANMODES=beIZ,k,lfj,imnstCTNMSgWOAVUFD IRCX SILENCE=32 VAPID=key123 ACCOUNTRESIDENCE=0123456789abcdef STATUSMSG=!.@+")
                in
                Expect.all
                    [ \_ -> Expect.equal (Just '*') (Dict.get 'Y' support.modeToPrefix)
                    , \_ -> Expect.equal (Just 'o') (Dict.get '@' support.prefixToMode)
                    , \_ -> Expect.equal "Onyx" support.network
                    , \_ -> Expect.equal "#&" support.chantypes
                    , \_ -> Expect.equal 64 support.nicklen
                    , \_ -> Expect.equal 390 support.topiclen
                    , \_ -> Expect.equal (Just 50) (Dict.get '#' support.chanlimits)
                    , \_ -> Expect.equal 50 support.maxchannels
                    , \_ -> Expect.equal 1 support.modesPerLine
                    , \_ -> Expect.equal "beIZ" support.chanGroups.lists
                    , \_ -> Expect.equal True support.ircx
                    , \_ -> Expect.equal 32 support.silence
                    , \_ -> Expect.equal "key123" support.vapid
                    , \_ -> Expect.equal (Just "0123456789abcdef") support.attributionNode
                    , \_ -> Expect.equal "!.@+" support.statusmsg
                    ]
                    ()
        , test "STATUSMSG splits audience targets" <|
            \_ ->
                let
                    advertised =
                        applyIsupportToken defaultSupport "STATUSMSG" "!.@+"
                in
                Expect.all
                    [ \_ -> Expect.equal "!.@+" advertised.statusmsg
                    , \_ ->
                        Expect.equal
                            (Just { prefix = '@', channel = "#c" })
                            (statusmsgChannel advertised "@#c")
                    , \_ ->
                        Expect.equal
                            (Just { prefix = '+', channel = "#c" })
                            (statusmsgChannel advertised "+#c")
                    , \_ -> Expect.equal Nothing (statusmsgChannel advertised "#c")
                    , \_ -> Expect.equal Nothing (statusmsgChannel advertised "@bob")
                    , \_ -> Expect.equal Nothing (statusmsgChannel advertised "@")
                    , \_ -> Expect.equal Nothing (statusmsgChannel advertised "")
                    , \_ -> Expect.equal Nothing (statusmsgChannel defaultSupport "@#c")
                    , \_ -> Expect.equal (Just "!.@+") (parseStatusmsgSymbols "!.@+")
                    , \_ -> Expect.equal Nothing (parseStatusmsgSymbols "")
                    , \_ -> Expect.equal Nothing (parseStatusmsgSymbols "toolongvalue")
                    , \_ -> Expect.equal Nothing (parseStatusmsgSymbols "@ #c")
                    ]
                    ()
        , test "malformed tokens keep last known-good values" <|
            \_ ->
                let
                    support =
                        applyIsupportLine defaultSupport
                            (line005 "PREFIX=(ov)@+! NICKLEN=potato CHANTYPES=#&9 CHANLIMIT=bogus CASEMAPPING=weird MODES=0 CHANMODES=bb,k,lfj,imnst")
                in
                Expect.all
                    [ \_ -> Expect.equal defaultSupport.modeToPrefix support.modeToPrefix
                    , \_ -> Expect.equal 64 support.nicklen
                    , \_ -> Expect.equal "#&" support.chantypes
                    , \_ -> Expect.equal Dict.empty support.chanlimits
                    , \_ -> Expect.equal "ascii" support.casemapping
                    , \_ -> Expect.equal 4 support.modesPerLine
                    , \_ -> Expect.equal "beIZ" support.chanGroups.lists
                    ]
                    ()
        , test "valid unknown tokens are retained while hostile tokens are ignored" <|
            \_ ->
                let
                    support =
                        applyIsupportLine defaultSupport
                            (line005 "FROBNICATE=1 lower=2 BAD! =v")
                in
                Expect.all
                    [ \_ -> Expect.equal defaultSupport.network support.network
                    , \_ -> Expect.equal (Dict.singleton "FROBNICATE" (Just "1")) (unknownTokens support)
                    ]
                    ()
        , test "decodes escaped values after splitting and merges multiline inventory" <|
            \_ ->
                let
                    first =
                        applyIsupportLine defaultSupport
                            (line005 "NETWORK=Onyx\\x20Net ESCAPE=a\\x5Cb\\x3Dc EMPTY= BARE")

                    second =
                        applyIsupportLine first (line005 "NETWORK=Onyx\\x20Mesh")
                in
                Expect.all
                    [ \_ -> Expect.equal "Onyx Net" first.network
                    , \_ -> Expect.equal "Onyx Mesh" second.network
                    , \_ -> Expect.equal (Just (Just "a\\b=c")) (Dict.get "ESCAPE" second.tokens)
                    , \_ -> Expect.equal (Just (Just "")) (Dict.get "EMPTY" second.tokens)
                    , \_ -> Expect.equal (Just Nothing) (Dict.get "BARE" second.tokens)
                    , \_ -> Expect.equal (Just (Just "café")) (Dict.get "UTF8" (applyIsupportLine second (line005 "UTF8=caf\\xC3\\xA9")).tokens)
                    , \_ -> Expect.equal (Just (Just "a\\b=c")) (Dict.get "ESCAPE" (unknownTokens second))
                    ]
                    ()
        , test "malformed escapes and decoded controls preserve the last good token" <|
            \_ ->
                let
                    initial =
                        applyIsupportLine defaultSupport (line005 "NETWORK=Onyx\\x20Net")

                    malformed =
                        applyIsupportLine initial (line005 "NETWORK=bad\\xQ0")

                    control =
                        applyIsupportLine malformed (line005 "NETWORK=bad\\x0D")

                    invalidUtf8 =
                        applyIsupportLine control (line005 "NETWORK=bad\\xC0\\xAF")
                in
                Expect.all
                    [ \_ -> Expect.equal "Onyx Net" malformed.network
                    , \_ -> Expect.equal "Onyx Net" control.network
                    , \_ -> Expect.equal "Onyx Net" invalidUtf8.network
                    , \_ -> Expect.equal (Just (Just "Onyx Net")) (Dict.get "NETWORK" control.tokens)
                    ]
                    ()
        , test "valid removals reset projections and remove diagnostic tokens" <|
            \_ ->
                let
                    advertised =
                        applyIsupportLine defaultSupport
                            (line005 "STATUSMSG=!.@+ PREFIX=(ov)@+ CHANLIMIT=#&:12 MAXCHANNELS=30 UNKNOWN=retained")

                    removedStatus =
                        applyIsupportLine advertised (line005 "-STATUSMSG -UNKNOWN")

                    removedPrefix =
                        applyIsupportLine removedStatus (line005 "-PREFIX")

                    removedLimits =
                        applyIsupportLine removedPrefix (line005 "-CHANLIMIT")
                in
                Expect.all
                    [ \_ -> Expect.equal "!.@+" advertised.statusmsg
                    , \_ -> Expect.equal "" removedStatus.statusmsg
                    , \_ -> Expect.equal Nothing (Dict.get "UNKNOWN" (unknownTokens removedStatus))
                    , \_ -> Expect.equal defaultSupport.modeToPrefix removedPrefix.modeToPrefix
                    , \_ -> Expect.equal 30 removedLimits.maxchannels
                    , \_ -> Expect.equal Dict.empty removedLimits.chanlimits
                    ]
                    ()
        , test "repeated token updates retain last-arrival precedence after unrelated removal" <|
            \_ ->
                let
                    initial =
                        applyIsupportLine defaultSupport
                            (line005 "CHANLIMIT=#&:12 MAXCHANNELS=30 UNKNOWN=old")

                    latest =
                        applyIsupportLine initial (line005 "CHANLIMIT=#&:14")

                    afterRemoval =
                        applyIsupportLine latest (line005 "-UNKNOWN")
                in
                Expect.all
                    [ \_ -> Expect.equal 14 latest.maxchannels
                    , \_ -> Expect.equal 14 afterRemoval.maxchannels
                    , \_ -> Expect.equal (Just 14) (Dict.get '#' afterRemoval.chanlimits)
                    ]
                    ()
        , test "distinct token cap allows updates to existing keys" <|
            \_ ->
                let
                    filler =
                        List.range 1 255 |> List.map (\n -> "X" ++ String.fromInt n ++ "=v")

                    full =
                        applyIsupportLine defaultSupport ("alice" :: ("NICKLEN=65" :: filler) ++ [ "are supported" ])

                    updated =
                        applyIsupportLine full (line005 "NICKLEN=77")

                    rejected =
                        applyIsupportLine updated (line005 "TOONEW=val")
                in
                Expect.all
                    [ \_ -> Expect.equal maxTokenCount (Dict.size full.tokens)
                    , \_ -> Expect.equal 77 updated.nicklen
                    , \_ -> Expect.equal Nothing (Dict.get "TOONEW" rejected.tokens)
                    , \_ -> Expect.equal maxTokenCount (Dict.size rejected.tokens)
                    ]
                    ()
        , test "bare SILENCE means 20" <|
            \_ ->
                Expect.equal 20 (applyIsupportLine defaultSupport (line005 "SILENCE")).silence
        , test "honors at most 256 tokens" <|
            \_ ->
                let
                    params =
                        "alice" :: List.repeat 300 "NICKLEN=99" ++ [ "are supported" ]

                    support =
                        applyIsupportLine { defaultSupport | nicklen = 64 } params
                in
                Expect.equal 99 support.nicklen
        , test "token cap drops tokens past the 256th" <|
            \_ ->
                let
                    params =
                        "alice" :: List.repeat 256 "NICKLEN=99" ++ [ "TOPICLEN=77", "are supported" ]

                    support =
                        applyIsupportLine defaultSupport params
                in
                Expect.all
                    [ \_ -> Expect.equal 99 support.nicklen
                    , \_ -> Expect.equal 390 support.topiclen
                    ]
                    ()
        , test "positive ints reject zeros, leading zeros, and huge values" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (parsePositiveInt "0")
                    , \_ -> Expect.equal Nothing (parsePositiveInt "007")
                    , \_ -> Expect.equal (Just 1) (parsePositiveInt "1")
                    , \_ -> Expect.equal (Just 1000000) (parsePositiveInt "1000000")
                    , \_ -> Expect.equal Nothing (parsePositiveInt "1000001")
                    , \_ -> Expect.equal Nothing (parsePositiveInt "12x")
                    , \_ -> Expect.equal Nothing (parsePositiveInt "")
                    ]
                    ()
        , test "first CHANLIMIT class feeds MAXCHANNELS" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal (Just 50) (firstChanLimit "#&:50")
                    , \_ -> Expect.equal Nothing (firstChanLimit "bogus")
                    ]
                    ()
        ]
