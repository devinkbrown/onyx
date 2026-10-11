module AccountScopeTest exposing (suite)

{-| v3/gap-account — per-account device-memory scope: scope resolution,
scope keys, Solid owner-key migration sources, the pending-edit log that
replays onto a freshly loaded scope (the no-data-loss cases), and the
attention count behind the tab title and app badge.
-}

import AccountScope exposing (..)
import Dict
import Expect
import Set
import Test exposing (Test, describe, test)


mesh : String
mesh =
    "wss://ircx.us:8080"


snapshot :
    { ignored : List String, muted : List String, highlights : List String, notify : List ( String, String ) }
    -> ListsSnapshot
snapshot s =
    { ignored = Set.fromList s.ignored
    , muted = Set.fromList s.muted
    , highlights = s.highlights
    , notify = Dict.fromList s.notify
    }


none : ListsSnapshot
none =
    snapshot { ignored = [], muted = [], highlights = [], notify = [] }


suite : Test
suite =
    describe "AccountScope"
        [ describe "networkOf"
            [ test "every mesh registry node is the one mesh network" <|
                \_ ->
                    Expect.equal ( Just "onyx", Just "onyx" )
                        ( networkOf mesh, networkOf "wss://eshmaki.me:8080" )
            , test "a pinned endpoint is its own network (trimmed)" <|
                \_ -> Expect.equal (Just "ws://127.0.0.1:9000/ws") (networkOf "  ws://127.0.0.1:9000/ws ")
            , test "empty and oversized endpoints have no network" <|
                \_ ->
                    Expect.equal ( Nothing, Nothing )
                        ( networkOf "   ", networkOf (String.repeat 2049 "w") )
            ]
        , describe "normalizeAccount"
            [ test "lowercases and trims" <|
                \_ -> Expect.equal (Just "kai") (normalizeAccount "  KaI ")
            , test "rejects empty, star, controls and oversized names" <|
                \_ ->
                    Expect.equal [ Nothing, Nothing, Nothing, Nothing ]
                        [ normalizeAccount "  "
                        , normalizeAccount "*"
                        , normalizeAccount "a\u{0000}b"
                        , normalizeAccount (String.repeat 257 "a")
                        ]
            ]
        , describe "scopeFor"
            [ test "no endpoint, no scope: nothing is read or written" <|
                \_ -> Expect.equal Nothing (scopeFor { endpoint = Nothing, account = Just "kai" })
            , test "no account is the guest scope of the network" <|
                \_ ->
                    Expect.equal (Just { network = "onyx", account = Nothing })
                        (scopeFor { endpoint = Just mesh, account = Nothing })
            , test "an account scopes by normalized name" <|
                \_ ->
                    Expect.equal (Just { network = "onyx", account = Just "kai" })
                        (scopeFor { endpoint = Just mesh, account = Just "KAI" })
            , test "hopping between mesh nodes keeps the same scope" <|
                \_ ->
                    Expect.equal
                        (scopeFor { endpoint = Just mesh, account = Just "kai" })
                        (scopeFor { endpoint = Just "wss://eshmaki.me:8080", account = Just "kai" })
            , test "a garbled account name falls to NO scope, never the shared guest scope" <|
                \_ -> Expect.equal Nothing (scopeFor { endpoint = Just mesh, account = Just "bad\u{0007}name" })
            , test "a guest and an account of the same spelling never share a scope" <|
                \_ ->
                    Expect.notEqual
                        (Maybe.map scopeKey (scopeFor { endpoint = Just mesh, account = Nothing }))
                        (Maybe.map scopeKey (scopeFor { endpoint = Just mesh, account = Just "guest" }))
            ]
        , describe "scopeKey"
            [ test "guest and account keys are stable JSON arrays" <|
                \_ ->
                    Expect.equal ( "[\"onyx\",\"guest\"]", "[\"onyx\",\"account\",\"kai\"]" )
                        ( scopeKey { network = "onyx", account = Nothing }
                        , scopeKey { network = "onyx", account = Just "kai" }
                        )
            , test "a hostile account name cannot break out of the array" <|
                \_ ->
                    Expect.equal "[\"onyx\",\"account\",\"a\\\",\\\"guest\"]"
                        (scopeKey { network = "onyx", account = Just "a\",\"guest" })
            , test "different networks never collide" <|
                \_ ->
                    Expect.notEqual
                        (scopeKey { network = "onyx", account = Just "kai" })
                        (scopeKey { network = "ws://dev", account = Just "kai" })
            ]
        , describe "solidOwnerKeys"
            [ test "guests have no Solid owner slot (a nick is not an identity)" <|
                \_ -> Expect.equal [] (solidOwnerKeys (Just mesh) { network = "onyx", account = Nothing })
            , test "accounts read the Solid slot of every mesh endpoint, as JSON.stringify([url, name])" <|
                \_ ->
                    solidOwnerKeys Nothing { network = "onyx", account = Just "kai" }
                        |> Expect.equal
                            [ "[\"wss://ircx.us:8080\",\"kai\"]"
                            , "[\"wss://eshmaki.me:8080\",\"kai\"]"
                            ]
            , test "a pinned endpoint is added once, mesh endpoints are not duplicated" <|
                \_ ->
                    Expect.equal
                        [ "[\"wss://ircx.us:8080\",\"kai\"]"
                        , "[\"wss://eshmaki.me:8080\",\"kai\"]"
                        , "[\"ws://127.0.0.1:9/ws\",\"kai\"]"
                        ]
                        (solidOwnerKeys (Just "ws://127.0.0.1:9/ws") { network = "x", account = Just "kai" })
            , test "the current mesh endpoint is not repeated" <|
                \_ ->
                    Expect.equal 2
                        (List.length (solidOwnerKeys (Just mesh) { network = "onyx", account = Just "kai" }))
            ]
        , describe "pending edits (nothing typed before the scope loads is lost)"
            [ test "recordDiff notes adds and removes of every list" <|
                \_ ->
                    let
                        before =
                            snapshot { ignored = [ "a" ], muted = [], highlights = [ "x" ], notify = [ ( "#r", "none" ) ] }

                        after =
                            snapshot { ignored = [ "b" ], muted = [ "dm" ], highlights = [ "y" ], notify = [ ( "#s", "all" ) ] }

                        ops =
                            recordDiff before after emptyOps
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Set.fromList [ "b" ]) ops.addIgnored
                        , \_ -> Expect.equal (Set.fromList [ "a" ]) ops.delIgnored
                        , \_ -> Expect.equal (Set.fromList [ "dm" ]) ops.addMuted
                        , \_ -> Expect.equal [ "y" ] ops.addWords
                        , \_ -> Expect.equal (Set.fromList [ "x" ]) ops.delWords
                        , \_ -> Expect.equal (Dict.fromList [ ( "#r", "" ), ( "#s", "all" ) ]) ops.notify
                        ]
                        ()
            , test "an unchanged snapshot records nothing" <|
                \_ ->
                    Expect.equal True
                        (isEmptyOps (recordDiff none none emptyOps))
            , test "applyOps replays a block onto stored lists without dropping stored blocks" <|
                \_ ->
                    let
                        ops =
                            recordDiff none (snapshot { ignored = [ "newbie" ], muted = [], highlights = [ "kw" ], notify = [ ( "#r", "none" ) ] }) emptyOps

                        stored =
                            snapshot { ignored = [ "old" ], muted = [ "dm1" ], highlights = [ "stored" ], notify = [ ( "#q", "mentions" ) ] }

                        merged =
                            applyOps ops stored
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Set.fromList [ "old", "newbie" ]) merged.ignored
                        , \_ -> Expect.equal (Set.fromList [ "dm1" ]) merged.muted
                        , \_ -> Expect.equal [ "stored", "kw" ] merged.highlights
                        , \_ -> Expect.equal (Dict.fromList [ ( "#q", "mentions" ), ( "#r", "none" ) ]) merged.notify
                        ]
                        ()
            , test "an unblock typed before the load removes the stored block" <|
                \_ ->
                    let
                        ops =
                            recordDiff
                                (snapshot { ignored = [ "gone" ], muted = [], highlights = [], notify = [] })
                                none
                                emptyOps
                    in
                    Expect.equal (Set.fromList [ "keep" ])
                        (applyOps ops (snapshot { ignored = [ "gone", "keep" ], muted = [], highlights = [], notify = [] })).ignored
            , test "a removed per-room override ('') clears the stored level" <|
                \_ ->
                    let
                        ops =
                            recordDiff (snapshot { ignored = [], muted = [], highlights = [], notify = [ ( "#r", "none" ) ] }) none emptyOps
                    in
                    Expect.equal Dict.empty
                        (applyOps ops (snapshot { ignored = [], muted = [], highlights = [], notify = [ ( "#r", "none" ) ] })).notify
            , test "a later edit of the same name wins (block, unblock, block again)" <|
                \_ ->
                    let
                        a =
                            snapshot { ignored = [ "x" ], muted = [], highlights = [], notify = [] }

                        ops =
                            emptyOps
                                |> recordDiff none a
                                |> recordDiff a none
                                |> recordDiff none a
                    in
                    Expect.equal (Set.fromList [ "x" ]) (applyOps ops none).ignored
            , test "block then unblock nets to nothing" <|
                \_ ->
                    let
                        a =
                            snapshot { ignored = [ "x" ], muted = [], highlights = [ "w" ], notify = [] }

                        ops =
                            emptyOps |> recordDiff none a |> recordDiff a none
                    in
                    Expect.equal ( Set.empty, [] )
                        (let
                            r =
                                applyOps ops none
                         in
                         ( r.ignored, r.highlights )
                        )
            , test "mergeOps keeps the newer side's verdict" <|
                \_ ->
                    let
                        older =
                            { emptyOps | addIgnored = Set.fromList [ "x", "y" ] }

                        newer =
                            { emptyOps | delIgnored = Set.fromList [ "x" ] }

                        merged =
                            mergeOps older newer
                    in
                    Expect.equal ( Set.fromList [ "y" ], Set.fromList [ "x" ] ) ( merged.addIgnored, merged.delIgnored )
            ]
        , describe "attention (tab title and app badge)"
            [ test "rooms count mentions, DMs count unread, muted DMs count nothing" <|
                \_ ->
                    Expect.equal 6
                        (attentionCount
                            [ { isChannel = True, unread = 40, highlights = 2, muted = False }
                            , { isChannel = False, unread = 3, highlights = 0, muted = False }
                            , { isChannel = False, unread = 9, highlights = 0, muted = True }
                            , { isChannel = True, unread = 5, highlights = 1, muted = False }
                            ]
                        )
            , test "ordinary room chatter never counts" <|
                \_ ->
                    Expect.equal 0 (attentionCount [ { isChannel = True, unread = 500, highlights = 0, muted = False } ])
            , test "negative counters clamp at zero" <|
                \_ ->
                    Expect.equal 0 (attentionCount [ { isChannel = False, unread = -4, highlights = -1, muted = False } ])
            , test "title gains (N) only with attention and caps at 999" <|
                \_ ->
                    Expect.equal [ "Onyx", "(3) Onyx", "(999) Onyx" ]
                        [ attentionTitle 0 "Onyx", attentionTitle 3 "Onyx", attentionTitle 5000 "Onyx" ]
            ]
        ]
