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
        , test "unknown and hostile tokens are ignored" <|
            \_ ->
                let
                    support =
                        applyIsupportLine defaultSupport
                            (line005 "FROBNICATE=1 lower=2 BAD KEY=1 =v")
                in
                Expect.equal defaultSupport support
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
