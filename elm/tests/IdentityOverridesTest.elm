module IdentityOverridesTest exposing (suite)

{-| Oracle-mirrored vectors for identity overrides (mirroring
`src/lib/identityOverrides.test.ts`; owner-scoped storage
mechanics are covered by the bridge smoke). -}

import Dict
import Expect
import IdentityOverrides exposing (..)
import Set
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "IdentityOverrides"
        [ test "normalizes, bounds, and sanitizes every nick-indexed record" <|
            \_ ->
                let
                    oversizedKeys =
                        List.map (\index -> "nick" ++ String.fromInt index) (List.range 0 (maxOverrides + 19))

                    softIgnores =
                        parseSoftIgnore
                            ([ " Alice ", "alice", "bad nick", "bad" ++ String.fromChar (Char.fromCode 0) ++ "nick" ]
                                ++ oversizedKeys
                            )

                    colors =
                        parseNickColors
                            ([ ( "Alice", "#AABBCC" )
                             , ( "unsafe", "red; background: url(https://example.test)" )
                             , ( "bad nick", "#123456" )
                             ]
                                ++ List.map (\nick -> ( nick, "#123456" )) oversizedKeys
                            )

                    displayNames =
                        parseDisplayNames
                            ([ ( "Alice", "  Trusted alias  " )
                             , ( "control", "spoof\nnext row" )
                             , ( "bad nick", "Bad nick key" )
                             ]
                                ++ List.map (\nick -> ( nick, "Alias " ++ nick )) oversizedKeys
                            )
                in
                Expect.all
                    [ \_ -> Expect.equal maxOverrides (Set.size softIgnores)
                    , \_ -> Expect.equal True (Set.member "alice" softIgnores)
                    , \_ -> Expect.equal maxOverrides (Dict.size colors)
                    , \_ -> Expect.equal (Just "#aabbcc") (Dict.get "alice" colors)
                    , \_ -> Expect.equal False (Dict.member "unsafe" colors)
                    , \_ -> Expect.equal maxOverrides (Dict.size displayNames)
                    , \_ -> Expect.equal (Just "Trusted alias") (Dict.get "alice" displayNames)
                    , \_ -> Expect.equal Nothing (Dict.get "control" displayNames)
                    ]
                    ()
        , test "rejects bad colors, names, and nicks at the boundary" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (normalizeNickColor "#abcde")
                    , \_ -> Expect.equal (Just "#1234") (normalizeNickColor "#1234")
                    , \_ -> Expect.equal (Just "#aabbcc") (normalizeNickColor "#AABBCC")
                    , \_ -> Expect.equal Nothing (normalizeDisplayName "  ")
                    , \_ -> Expect.equal Nothing (normalizeDisplayName ("x" ++ String.fromChar (Char.fromCode 127)))
                    , \_ -> Expect.equal Nothing (normalizeOverrideNick "has space")
                    , \_ -> Expect.equal Nothing (normalizeOverrideNick "has,comma")
                    , \_ -> Expect.equal Nothing (normalizeOverrideNick ("a" ++ String.fromChar (Char.fromCode 160) ++ "b"))
                    , \_ -> Expect.equal (Just "alice") (normalizeOverrideNick " Alice ")
                    ]
                    ()
        , test "serializes the sorted journal shapes" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "[\"a\",\"b\"]" (encodeSoftIgnore (Set.fromList [ "b", "a" ]))
                    , \_ ->
                        Expect.equal "{\"a\":\"#123\",\"b\":\"#456\"}"
                            (encodeStringMap (Dict.fromList [ ( "b", "#456" ), ( "a", "#123" ) ]))
                    ]
                    ()
        , test "scopes keys by owner and fails closed without one" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal
                            (Just "onyx:display-names:owner:%5B%22wss%3A%2F%2Fidentity.example%2Fws%22%2C%22alice%22%5D")
                            (scopedKey displayNamesKey { serverUrl = "wss://identity.example/ws", identity = "Alice" })
                    , \_ -> Expect.equal Nothing (scopedKey softIgnoreKey { serverUrl = "", identity = "alice" })
                    , \_ -> Expect.equal Nothing (scopedKey nickColorsKey { serverUrl = "wss://x", identity = "  " })
                    ]
                    ()
        ]
