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
import Ids
import Session exposing (..)
import Test exposing (Test, describe, test)


nowMs : Float
nowMs =
    1783857600000


credential : String -> CredentialKind -> Maybe Float -> CredentialMetadata
credential raw kind expiresAtMs =
    { credentialRef = mustCredentialRef raw
    , kind = kind
    , expiresAtMs = expiresAtMs
    , restorable = kind /= UnknownCredential
    }


mustCredentialRef : String -> Ids.CredentialRef
mustCredentialRef raw =
    case Ids.credentialRefFromRuntime raw of
        Just reference -> reference
        Nothing -> Debug.todo "fixture credential reference must be valid"


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
                        , \_ -> Expect.equal (Just { name = "max-bytes", value = "12,max-lines=2" }) (parseCapToken "max-bytes=12,max-lines=2")
                        ]
                        ()
            , test "cap name and value limits count checked UTF-8 bytes" <|
                \_ ->
                    let
                        exactName =
                            String.repeat 64 "é"

                        longName =
                            String.repeat 65 "é"

                        exactValue =
                            String.repeat 2048 "é"

                        longValue =
                            String.repeat 2048 "é" ++ "a"
                    in
                    Expect.all
                        [ \_ -> Expect.equal True (parseCapToken exactName /= Nothing)
                        , \_ -> Expect.equal Nothing (parseCapToken longName)
                        , \_ -> Expect.equal (Just { name = "x", value = exactValue }) (parseCapToken ("x=" ++ exactValue))
                        , \_ -> Expect.equal Nothing (parseCapToken ("x=" ++ longValue))
                        ]
                        ()
            , test "cap parsing rejects malformed surrogate strings" <|
                \_ ->
                    let
                        malformed =
                            String.fromChar (Char.fromCode 0xD800)
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (parseCapToken ("x=" ++ malformed))
                        , \_ -> Expect.equal Nothing (parseCapToken (malformed ++ "=x"))
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
            , test "wantedCaps requests draft/metadata-2 so METADATA is accepted" <|
                \_ ->
                    wantedCaps False [ "draft/metadata-2", "server-time" ]
                        |> List.member "draft/metadata-2"
                        |> Expect.equal True
            , test "wantedCaps drops always-off caps and dedupes" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ "no-implicit-names", "draft/multiline", "message-tags", "onyx/session-sync" ]
                                (wantedCaps False [ "sasl", "tls", "sts", "no-implicit-names", "draft/file-upload", "bot", "draft/multiline", "message-tags", "draft/multiline", "onyx/session-sync", "unknown/server-cap" ])
                        , \_ ->
                            Expect.equal
                                [ "sasl", "draft/multiline" ]
                                (wantedCaps True [ "sasl", "tls", "draft/multiline", "unknown/server-cap" ])
                        ]
                        ()
            , test "accepts server canonical capability names and client draft aliases" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal
                                [ "multiline", "chathistory", "read-marker", "channel-rename", "typing", "react", "reply", "message-editing", "message-redaction", "msgid", "draft/no-implicit-names" ]
                                (wantedCaps True [ "multiline", "chathistory", "read-marker", "channel-rename", "typing", "react", "reply", "message-editing", "message-redaction", "msgid", "draft/no-implicit-names" ])
                        , \_ -> Expect.equal True (hasCapability [ "read-marker" ] "draft/read-marker")
                        , \_ -> Expect.equal True (hasCapability [ "draft/multiline" ] "multiline")
                        ]
                        ()
            , test "requests only one spelling for the shared no-implicit-names capability" <|
                \_ ->
                    Expect.equal
                        [ "draft/no-implicit-names" ]
                        (wantedCaps False [ "no-implicit-names", "draft/no-implicit-names" ])
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
        , describe "credential reference planning"
            [ test "prefers mesh exact metadata and returns only its opaque reference" <|
                \_ ->
                    let
                        local = credential "CCCCCCCCCCCCCCCCCCCCCCCC" Session.LocalExact Nothing
                        mesh = credential "DDDDDDDDDDDDDDDDDDDDDDDD" Session.MeshExact Nothing
                    in
                    Expect.equal
                        (Attempt { credentialRef = mesh.credentialRef, kind = MeshBearer, credentialKind = Session.MeshExact, meshExpired = False })
                        (held { credentials = [ local, mesh ] })
            , test "prefers exact local metadata over logical metadata" <|
                \_ ->
                    let
                        logical = credential "EEEEEEEEEEEEEEEEEEEEEEEE" Session.LocalLogical Nothing
                        exact = credential "FFFFFFFFFFFFFFFFFFFFFFFF" Session.LocalExact Nothing
                    in
                    Expect.equal
                        (Attempt { credentialRef = exact.credentialRef, kind = LocalBearer, credentialKind = Session.LocalExact, meshExpired = False })
                        (held { credentials = [ logical, exact ] })
            , test "expired mesh metadata falls through to a local reference" <|
                \_ ->
                    let
                        expired = credential "GGGGGGGGGGGGGGGGGGGGGGGG" Session.MeshExact (Just (nowMs - 1))
                        local = credential "HHHHHHHHHHHHHHHHHHHHHHHH" Session.LocalLogical Nothing
                    in
                    Expect.equal
                        (Attempt { credentialRef = local.credentialRef, kind = LocalBearer, credentialKind = Session.LocalLogical, meshExpired = True })
                        (held { credentials = [ expired, local ] })
            , test "expiry inside safety skew is refused" <|
                \_ ->
                    Expect.equal
                        (Skip { reason = Expired, meshExpired = True })
                        (held { credentials = [ credential "IIIIIIIIIIIIIIIIIIIIIIII" Session.MeshLogical (Just (nowMs + reclaimExpirySkewMs - 1)) ] })
            , test "unauthenticated state never sends a credential reference" <|
                \_ ->
                    let
                        local = credential "JJJJJJJJJJJJJJJJJJJJJJJJ" Session.LocalLogical Nothing
                    in
                    Expect.equal
                        (Skip { reason = Unauthenticated, meshExpired = False })
                        (planSessionReclaim { credentials = [ local ] } { now = nowMs, authenticated = False })
            , test "unknown credential metadata is never restorable authority" <|
                \_ ->
                    let
                        unknown = credential "KKKKKKKKKKKKKKKKKKKKKKKK" Session.UnknownCredential Nothing
                    in
                    Expect.equal
                        (Skip { reason = NoneHeld, meshExpired = False })
                        (held { credentials = [ unknown ] })
            , test "reclaim offered uses metadata presence and expiry" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (reclaimOffered { credentials = [ credential "LLLLLLLLLLLLLLLLLLLLLLLL" Session.LocalLogical Nothing ] } nowMs)
                        , \_ -> Expect.equal False (reclaimOffered { credentials = [ credential "MMMMMMMMMMMMMMMMMMMMMMMM" Session.MeshExact (Just (nowMs - 1)) ] } nowMs)
                        , \_ -> Expect.equal False (reclaimOffered { credentials = [] } nowMs)
                        ]
                        ()
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
