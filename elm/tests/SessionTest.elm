module SessionTest exposing (suite)

{-| Vectors ported from `src/lib/irc/sessionReclaim.test.ts`,
`src/lib/irc/sessionList.test.ts`, and
`src/lib/irc/capabilityMatrix.test.ts`. The TypeScript suites are the
oracle.

Float-expiry vectors (`NaN`, infinities) are representable as Elm
`Float`s and covered directly. `formatSessionSignon` is not ported
(locale-dependent rendering stays in the view layer).
-}

import Expect
import Session exposing (..)
import Test exposing (Test, describe, test)


nowMs : Float
nowMs =
    1783857600000


meshBearer : String
meshBearer =
    "mesh-token-abcdef0123456789"


localBearer : String
localBearer =
    "0123456789abcdef0123456789abcdef"


held : ReclaimTokens -> ReclaimPlan
held tokens =
    planSessionReclaim tokens { now = nowMs, authenticated = True }


suite : Test
suite =
    describe "Session"
        [ describe "cap negotiation core"
            [ test "parses name and name=value tokens" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just { name = "sasl", value = "PLAIN" }) (parseCapToken "sasl=PLAIN")
                        , \_ -> Expect.equal (Just { name = "message-tags", value = "" }) (parseCapToken "message-tags")
                        , \_ -> Expect.equal (Just { name = "a", value = "b=c" }) (parseCapToken "a=b=c")
                        ]
                        ()
            , test "rejects hostile tokens" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseCapToken "")
                        , \_ -> Expect.equal Nothing (parseCapToken "has space=x")
                        , \_ -> Expect.equal Nothing (parseCapToken "has,comma")
                        , \_ -> Expect.equal Nothing (parseCapToken (String.repeat 129 "n"))
                        , \_ -> Expect.equal Nothing (parseCapToken ("ok=" ++ String.repeat 4097 "v"))
                        ]
                        ()
            , test "wantedCaps drops always-off caps and dedupes" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ "draft/multiline", "message-tags" ]
                                (wantedCaps False [ "sasl", "tls", "sts", "no-implicit-names", "draft/file-upload", "bot", "draft/multiline", "message-tags", "draft/multiline" ])
                        , \_ ->
                            Expect.equal
                                [ "sasl", "draft/multiline" ]
                                (wantedCaps True [ "sasl", "tls", "draft/multiline" ])
                        ]
                        ()
            , test "chunkCapReq splits past 380 chars" <|
                \_ ->
                    let
                        caps =
                            List.map (\i -> "cap-" ++ String.fromInt i ++ "-padding-to-grow-the-line") (List.range 1 30)

                        chunks =
                            chunkCapReq caps
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (List.length chunks > 1)
                        , \_ -> Expect.equal True (List.all (\c -> String.length c <= capReqChunkLength) chunks)
                        , \_ -> Expect.equal caps (String.split " " (String.join " " chunks))
                        ]
                        ()
            , test "chunkCapReq keeps a single short line whole" <|
                \_ ->
                    Expect.equal [ "a b c" ] (chunkCapReq [ "a", "b", "c" ])
            ]
        , describe "planSessionReclaim preference"
            [ test "prefers the mesh Bearer [REDACTED] both are held" <|
                \_ ->
                    Expect.equal
                        (Attempt { token = meshBearer, kind = MeshBearer, meshExpired = False })
                        (held { sessionToken = Just localBearer, meshToken = Just meshBearer, meshTokenExpiresAt = Nothing })
            , test "uses the local Bearer [REDACTED] no mesh token is held" <|
                \_ ->
                    Expect.equal
                        (Attempt { token = localBearer, kind = LocalBearer, meshExpired = False })
                        (held { sessionToken = Just localBearer, meshToken = Nothing, meshTokenExpiresAt = Nothing })
            , test "uses the mesh Bearer [REDACTED] no local token is held" <|
                \_ ->
                    Expect.equal
                        (Attempt { token = meshBearer, kind = MeshBearer, meshExpired = False })
                        (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Nothing })
            , test "treats an absent expiry as a live mesh bearer" <|
                \_ ->
                    case held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Nothing } of
                        Attempt _ ->
                            Expect.pass

                        Skip _ ->
                            Expect.fail "expected an attempt"
            ]
        , describe "expiry falls through instead of torching"
            [ test "falls back to a valid local token when the mesh Bearer [REDACTED] lapsed" <|
                \_ ->
                    Expect.equal
                        (Attempt { token = localBearer, kind = LocalBearer, meshExpired = True })
                        (held { sessionToken = Just localBearer, meshToken = Just meshBearer, meshTokenExpiresAt = Just (nowMs - 1) })
            , test "refuses a mesh Bearer [REDACTED] inside the safety skew" <|
                \_ ->
                    Expect.equal
                        (Skip { reason = Expired, meshExpired = True })
                        (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (nowMs + reclaimExpirySkewMs - 1) })
            , test "offers a mesh Bearer [REDACTED] outlives the safety skew" <|
                \_ ->
                    Expect.equal
                        (Attempt { token = meshBearer, kind = MeshBearer, meshExpired = False })
                        (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (nowMs + reclaimExpirySkewMs + 1) })
            , test "fails closed on a non-finite expiry" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Skip { reason = Expired, meshExpired = True })
                                (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (0 / 0) })
                        , \_ ->
                            Expect.equal
                                (Skip { reason = Expired, meshExpired = True })
                                (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (1 / 0) })
                        , \_ ->
                            Expect.equal
                                (Skip { reason = Expired, meshExpired = True })
                                (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (-1 / 0) })
                        ]
                        ()
            , test "reports expired when a lapsed mesh token was the only bearer" <|
                \_ ->
                    Expect.equal
                        (Skip { reason = Expired, meshExpired = True })
                        (held { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (nowMs - 1) })
            ]
        , describe "fail-closed gates"
            [ test "never offers a Bearer [REDACTED] the socket has account proof" <|
                \_ ->
                    Expect.equal
                        (Skip { reason = Unauthenticated, meshExpired = False })
                        (planSessionReclaim
                            { sessionToken = Just localBearer, meshToken = Just meshBearer, meshTokenExpiresAt = Nothing }
                            { now = nowMs, authenticated = False }
                        )
            , test "reports none-held for a guest with no saved bearer" <|
                \_ ->
                    Expect.equal
                        (Skip { reason = NoneHeld, meshExpired = False })
                        (held { sessionToken = Nothing, meshToken = Nothing, meshTokenExpiresAt = Nothing })
            , test "refuses structurally invalid bearers" <|
                \_ ->
                    let
                        bad =
                            [ "", "   ", "two words", "tab\there", "nl\nhere", "cr\rhere", "\u{0000}nul" ]
                    in
                    Expect.equal True
                        (List.all
                            (\token ->
                                case held { sessionToken = Just token, meshToken = Nothing, meshTokenExpiresAt = Nothing } of
                                    Attempt _ ->
                                        False

                                    Skip _ ->
                                        True
                            )
                            bad
                            && List.all
                                (\token ->
                                    case held { sessionToken = Nothing, meshToken = Just token, meshTokenExpiresAt = Nothing } of
                                        Attempt _ ->
                                            False

                                        Skip _ ->
                                            True
                                )
                                bad
                        )
            , test "falls through to a valid local token when the mesh token is malformed" <|
                \_ ->
                    Expect.equal
                        (Attempt { token = localBearer, kind = LocalBearer, meshExpired = False })
                        (held { sessionToken = Just localBearer, meshToken = Just "bad token", meshTokenExpiresAt = Nothing })
            ]
        , describe "reclaimOffered"
            [ test "is true only when a Bearer [REDACTED] actually held and live" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (reclaimOffered { sessionToken = Just localBearer, meshToken = Nothing, meshTokenExpiresAt = Nothing } nowMs)
                        , \_ -> Expect.equal True (reclaimOffered { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Nothing } nowMs)
                        , \_ -> Expect.equal False (reclaimOffered { sessionToken = Nothing, meshToken = Nothing, meshTokenExpiresAt = Nothing } nowMs)
                        ]
                        ()
            , test "is false once the only mesh Bearer [REDACTED] lapsed" <|
                \_ ->
                    Expect.equal False
                        (reclaimOffered { sessionToken = Nothing, meshToken = Just meshBearer, meshTokenExpiresAt = Just (nowMs - 1) } nowMs)
            ]
        , describe "sessionList parse helpers"
            [ test "parses attached current and detached sibling rows" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                (Just { index = 1, current = True, signonMs = 1710000000, state = Attached, sid = Nothing })
                                (parseSessionListLine "SESSION LIST * #1 signon=1710000000 attached")
                        , \_ ->
                            Expect.equal
                                (Just { index = 2, current = False, signonMs = 1710000100, state = Detached, sid = Nothing })
                                (parseSessionListLine "SESSION LIST - #2 signon=1710000100 detached")
                        ]
                        ()
            , test "accepts a validated physical SID and rejects a bad one" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just "0123456789abcdeffedcba9876543210")
                                (Maybe.andThen .sid
                                    (parseSessionListLine "SESSION LIST - #2 signon=1710000100 attached sid=0123456789ABCDEFfedcba9876543210")
                                )
                        , \_ ->
                            Expect.equal Nothing
                                (parseSessionListLine "SESSION LIST - #2 signon=1 attached sid=bad")
                        ]
                        ()
            , test "rejects hostile or malformed list lines" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseSessionListLine "SESSION LIST * #0 signon=1 attached")
                        , \_ -> Expect.equal Nothing (parseSessionListLine "SESSION LIST * #1 signon=x attached")
                        , \_ -> Expect.equal Nothing (parseSessionListLine "SESSION LIST * #1 signon=1 evil")
                        , \_ -> Expect.equal Nothing (parseSessionListLine "hi SESSION LIST * #1 signon=1 attached")
                        ]
                        ()
            , test "detects list end and DROP ok" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (isSessionListEnd "SESSION: end of session list")
                        , \_ -> Expect.equal True (isSessionListEnd "SESSION: end of session list ")
                        , \_ -> Expect.equal False (isSessionListEnd "SESSION LIST * #1 signon=1 attached")
                        , \_ -> Expect.equal (Just 3) (parseSessionDropOk "SESSION DROP #3 ok")
                        , \_ -> Expect.equal Nothing (parseSessionDropOk "SESSION DROP ok")
                        , \_ -> Expect.equal True (isSessionDropSuccess "SESSION DROP sid=0123456789abcdefFEDCBA9876543210 ok")
                        , \_ -> Expect.equal False (isSessionDropSuccess "SESSION DROP sid=bad ok")
                        , \_ -> Expect.equal True (isSessionDropSuccess "SESSION DROP ok client=42 signon=100")
                        , \_ -> Expect.equal False (isSessionDropSuccess "SESSION DROP ok")
                        ]
                        ()
            , test "formats session age and lists other attached devices" <|
                \_ ->
                    let
                        now =
                            1700000000000

                        rows =
                            [ { index = 1, current = True, signonMs = now, state = Attached, sid = Nothing }
                            , { index = 2, current = False, signonMs = now, state = Attached, sid = Nothing }
                            , { index = 3, current = False, signonMs = now, state = Detached, sid = Nothing }
                            ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal "just now" (formatSessionAge (now - 30000) now)
                        , \_ -> Expect.equal "10m active" (formatSessionAge (now - 10 * 60000) now)
                        , \_ -> Expect.equal "5h active" (formatSessionAge (now - 5 * 3600000) now)
                        , \_ -> Expect.equal [ 2 ] (List.map .index (otherAttachedSessions rows))
                        , \_ ->
                            Expect.equal "This connection"
                                (sessionRowLabel
                                    { index = 1, current = True, signonMs = now, state = Attached, sid = Nothing }
                                )
                        ]
                        ()
            , test "labels rows for UI without inventing device names" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal "This connection"
                                (sessionRowLabel { index = 1, current = True, signonMs = 1, state = Attached, sid = Nothing })
                        , \_ ->
                            Expect.equal "Detached session #2"
                                (sessionRowLabel { index = 2, current = False, signonMs = 1, state = Detached, sid = Nothing })
                        ]
                        ()
            ]
        , describe "capabilityMatrix"
            [ test "marks negotiated vs available vs missing" <|
                \_ ->
                    let
                        rows =
                            buildCapabilityMatrix
                                { negotiated = [ "sasl", "message-tags" ]
                                , available = [ "sasl", "message-tags", "draft/chathistory", "onyx/e2ee" ]
                                }
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just Active) (Maybe.map .status (findCap "sasl" rows))
                        , \_ -> Expect.equal (Just Available) (Maybe.map .status (findCap "draft/chathistory" rows))
                        , \_ -> Expect.equal (Just Missing) (Maybe.map .status (findCap "onyx/media" rows))
                        , \_ -> Expect.equal True (String.startsWith "2/" (capabilitySummary rows))
                        ]
                        ()
            , test "reports unknown when nothing is known yet" <|
                \_ ->
                    Expect.equal (Just Unknown)
                        (Maybe.map .status
                            (findCap "sasl" (buildCapabilityMatrix { negotiated = [], available = [] }))
                        )
            ]
        ]


findCap : String -> List CapRow -> Maybe CapRow
findCap id rows =
    List.head (List.filter (\r -> r.id == id) rows)
