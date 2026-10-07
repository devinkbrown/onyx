module CredentialsTest exposing (suite)

{-| Vectors for remembered-identity pure logic, mirroring
`src/lib/credentials.ts`. The `identityId` and `serverDisplayLabel`
tables are oracle dumps: each id/label was produced by the real
`saveCredentials` + `listRememberedIdentities` round-trip under jsdom
(scratch vitest, since removed), so the key derivation, hash, and
labels below are differentially verified, not hand-computed.
-}

import Credentials exposing (..)
import Expect
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "remembered identity"
        [ describe "identityId (oracle ids)"
            [ test "basic key" <|
                \_ -> Expect.equal "saved-4lt45h-1486a3t" (identityId "wss://example.com/irc|kai")
            , test "lowercased nick key" <|
                \_ -> Expect.equal "saved-3x00o4-kzf3ps" (identityId "wss://example.com|yuki_42")
            , test "chat path key" <|
                \_ -> Expect.equal "saved-15dklo1-obsmu5" (identityId "https://eshmaki.me/chat|guest123")
            , test "ipv6 key" <|
                \_ -> Expect.equal "saved-aa6o2e-rjs5uy" (identityId "wss://[::1]/mesh|a")
            , test "userinfo key" <|
                \_ -> Expect.equal "saved-xm5fgg-teabt0" (identityId "https://user:pass@example.com/p?q=1#h|u")
            , test "ws key" <|
                \_ -> Expect.equal "saved-1ruwt3g-1t681s" (identityId "ws://example.com/chat|w")
            , test "custom port key" <|
                \_ -> Expect.equal "saved-8ri2zj-1ischvv" (identityId "wss://example.com:8443/x|x")
            , test "double-slash key" <|
                \_ -> Expect.equal "saved-zm8puw-9mtsb8" (identityId "wss://example.com//a//b/|y")
            , test "bare host key" <|
                \_ -> Expect.equal "saved-ep02l7-1ev5wnr" (identityId "wss://example.com|z")
            , test "schemeless key" <|
                \_ -> Expect.equal "saved-1ocab5n-w1i89j" (identityId "mixedcase|q")
            ]
        , describe "normalizeServer"
            [ test "lowercases host, strips one slash" <|
                \_ -> Expect.equal "wss://example.com/irc" (normalizeServer "wss://Example.COM/irc/")
            , test "strips default wss port" <|
                \_ -> Expect.equal "wss://example.com" (normalizeServer "wss://example.com:443")
            , test "strips default ws port" <|
                \_ -> Expect.equal "ws://example.com/chat" (normalizeServer "ws://example.com:80/chat")
            , test "keeps a custom port" <|
                \_ -> Expect.equal "wss://example.com:8443/x" (normalizeServer "wss://example.com:8443/x")
            , test "lowercases scheme, keeps path verbatim" <|
                \_ -> Expect.equal "wss://example.com//a//b/" (normalizeServer "WSS://EXAMPLE.com//a//b//")
            , test "keeps userinfo, query, and hash" <|
                \_ ->
                    Expect.equal "https://user:pass@example.com/p?q=1#h"
                        (normalizeServer "https://user:pass@example.com:443/p?q=1#h")
            , test "strips default port on ipv6" <|
                \_ -> Expect.equal "wss://[::1]/mesh" (normalizeServer "wss://[::1]:443/mesh")
            , test "schemeless falls back to lowercase" <|
                \_ -> Expect.equal "mixedcase" (normalizeServer "  MixedCase  ")
            , test "credentialKey joins normalized server and nick" <|
                \_ -> Expect.equal "wss://example.com/irc|kai" (credentialKey "wss://Example.COM/irc/" "Kai")
            ]
        , describe "serverDisplayLabel (oracle labels)"
            [ test "lowercased host, path kept" <|
                \_ -> Expect.equal "wss://example.com/irc/" (serverDisplayLabel "wss://Example.COM/irc/")
            , test "default port dropped" <|
                \_ -> Expect.equal "wss://example.com" (serverDisplayLabel "wss://example.com:443")
            , test "chat path kept" <|
                \_ -> Expect.equal "https://eshmaki.me/chat/" (serverDisplayLabel "https://eshmaki.me/chat/")
            , test "ipv6 kept" <|
                \_ -> Expect.equal "wss://[::1]/mesh" (serverDisplayLabel "wss://[::1]:443/mesh")
            , test "credentials, query, and hash dropped" <|
                \_ -> Expect.equal "https://example.com/p" (serverDisplayLabel "https://user:pass@example.com:443/p?q=1#h")
            , test "ws port dropped" <|
                \_ -> Expect.equal "ws://example.com/chat" (serverDisplayLabel "ws://example.com:80/chat")
            , test "double slashes kept verbatim" <|
                \_ -> Expect.equal "wss://example.com//a//b//" (serverDisplayLabel "WSS://EXAMPLE.com//a//b//")
            , test "schemeless trims without lowercasing" <|
                \_ -> Expect.equal "MixedCase" (serverDisplayLabel "  MixedCase  ")
            ]
        , describe "sanitizers"
            [ test "nick accepts irc chars" <|
                \_ -> Expect.equal (Just "Yuki_42-x") (sanitizeCredentialNick " Yuki_42-x ")
            , test "nick rejects spaces" <|
                \_ -> Expect.equal Nothing (sanitizeCredentialNick "a b")
            , test "nick rejects a leading digit" <|
                \_ -> Expect.equal Nothing (sanitizeCredentialNick "4you")
            , test "nick rejects empties" <|
                \_ -> Expect.equal Nothing (sanitizeCredentialNick "   ")
            , test "server rejects spaces" <|
                \_ -> Expect.equal Nothing (sanitizeCredentialServer "not a url at all")
            , test "server accepts endpoints" <|
                \_ -> Expect.equal (Just "wss://example.com") (sanitizeCredentialServer "wss://example.com")
            , test "password allows empty but not controls" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "") (sanitizeCredentialPassword "")
                        , \_ -> Expect.equal Nothing (sanitizeCredentialPassword "a\nb")
                        ]
                        ()
            , test "token rejects whitespace" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "abc") (sanitizeResumeToken "abc")
                        , \_ -> Expect.equal Nothing (sanitizeResumeToken "")
                        , \_ -> Expect.equal Nothing (sanitizeResumeToken "a b")
                        ]
                        ()
            ]
        , describe "identityAccess"
            [ test "token wins, even without a password" <|
                \_ -> Expect.equal ResumeAccess (identityAccess True False)
            , test "password signs in" <|
                \_ -> Expect.equal SignInAccess (identityAccess False True)
            , test "neither is identity-only" <|
                \_ -> Expect.equal IdentityOnlyAccess (identityAccess False False)
            ]
        , describe "catalogue order and keep-set"
            [ test "active sorts first" <|
                \_ ->
                    Expect.equal [ "b", "a", "c" ]
                        (sortRememberedKeys (Just "b") [ "a", "b", "c" ])
            , test "keys sort ascending" <|
                \_ ->
                    Expect.equal [ "a", "b" ] (sortRememberedKeys Nothing [ "b", "a" ])
            , test "keep-set prefers active plus newest" <|
                \_ ->
                    Expect.equal [ "old-active", "new", "mid", "old" ]
                        (enforceCredentialKeep (Just "old-active")
                            [ ( "old", 1 ), ( "new", 3 ), ( "mid", 2 ), ( "old-active", 0 ) ]
                        )
            , test "keep-set caps at twelve" <|
                \_ ->
                    Expect.equal 12
                        (List.length
                            (enforceCredentialKeep Nothing
                                (List.map (\n -> ( "k" ++ String.fromInt n, n )) (List.range 1 20))
                            )
                        )
            ]
        ]
