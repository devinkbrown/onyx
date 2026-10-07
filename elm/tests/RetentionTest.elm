module RetentionTest exposing (suite)

{-| Executable spec for the vault retention policy: sanitise
fail-closed bounds, idempotence, per-channel resolution, and the
stricter-wins prune selection (count cap, age cutoff, tie-breaks,
boundaries). Mirrors the oracle `retentionPolicy` suites.
-}

import Dict
import Expect
import Json.Encode as Encode
import Retention
import Test exposing (Test, describe, test)


candidate : String -> Float -> { id : String, time : Float }
candidate id time =
    { id = id, time = time }


suite : Test
suite =
    describe "Retention"
        [ describe "sanitizePolicy"
            [ test "hostile keep falls back to the flat cap" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 400 (Retention.sanitizePolicy { keep = -5, perChannel = Dict.empty, maxAgeDays = Nothing }).keep
                        , \_ -> Expect.equal 400 (Retention.sanitizePolicy { keep = 0 / 0, perChannel = Dict.empty, maxAgeDays = Nothing }).keep
                        , \_ -> Expect.equal 400 (Retention.sanitizePolicy { keep = 1 / 0, perChannel = Dict.empty, maxAgeDays = Nothing }).keep
                        ]
                        ()
            , test "keep clamps to the ceiling and floors fractions" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 5000 (Retention.sanitizePolicy { keep = 1000000, perChannel = Dict.empty, maxAgeDays = Nothing }).keep
                        , \_ -> Expect.equal 10 (Retention.sanitizePolicy { keep = 10.9, perChannel = Dict.empty, maxAgeDays = Nothing }).keep
                        , \_ -> Expect.equal 0 (Retention.sanitizePolicy { keep = 0, perChannel = Dict.empty, maxAgeDays = Nothing }).keep
                        ]
                        ()
            , test "per-channel overrides lowercase keys and drop hostile values" <|
                \_ ->
                    let
                        policy =
                            Retention.sanitizePolicy
                                { keep = 400
                                , perChannel = Dict.fromList [ ( "#C", 10.7 ), ( "#bad", 0 / 0 ), ( "#neg", -2 ), ( "#huge", 99999 ) ]
                                , maxAgeDays = Nothing
                                }
                    in
                    Expect.equal (Dict.fromList [ ( "#c", 10 ), ( "#huge", 5000 ) ]) policy.perChannel
            , test "maxAgeDays drops non-positive values and clamps" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Nothing (Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just 0 }).maxAgeDays
                        , \_ -> Expect.equal Nothing (Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just -3 }).maxAgeDays
                        , \_ -> Expect.equal Nothing (Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just (0 / 0) }).maxAgeDays
                        , \_ -> Expect.equal (Just 3650) (Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just 5000 }).maxAgeDays
                        , \_ -> Expect.equal (Just 1.5) (Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just 1.5 }).maxAgeDays
                        ]
                        ()
            , test "sanitise is idempotent" <|
                \_ ->
                    let
                        raw =
                            { keep = 25.9
                            , perChannel = Dict.fromList [ ( "#C", 7.2 ) ]
                            , maxAgeDays = Just 30
                            }

                        once =
                            Retention.sanitizePolicy raw

                        toRaw policy =
                            { keep = toFloat policy.keep
                            , perChannel = Dict.map (\_ v -> toFloat v) policy.perChannel
                            , maxAgeDays = policy.maxAgeDays
                            }
                    in
                    Expect.equal once (Retention.sanitizePolicy (toRaw once))
            ]
        , describe "effectiveKeep"
            [ test "override wins, otherwise the default, case-insensitively" <|
                \_ ->
                    let
                        policy =
                            Retention.sanitizePolicy
                                { keep = 400, perChannel = Dict.fromList [ ( "#c", 10 ) ], maxAgeDays = Nothing }
                    in
                    Expect.all
                        [ \_ -> Expect.equal 10 (Retention.effectiveKeep policy "#C")
                        , \_ -> Expect.equal 400 (Retention.effectiveKeep policy "#other")
                        ]
                        ()
            ]
        , describe "resolvePolicyForChannel"
            [ test "flattens the override and preserves the cutoff" <|
                \_ ->
                    let
                        policy =
                            Retention.sanitizePolicy
                                { keep = 400, perChannel = Dict.fromList [ ( "#c", 10 ) ], maxAgeDays = Just 7 }
                    in
                    Expect.equal
                        { keep = 10, perChannel = Dict.empty, maxAgeDays = Just 7 }
                        (Retention.resolvePolicyForChannel policy "#C")
            ]
        , describe "selectMessagesToPrune"
            [ test "count cap keeps the newest keep, oldest-first out" <|
                \_ ->
                    let
                        messages =
                            [ candidate "m3" 3000, candidate "m1" 1000, candidate "m5" 5000, candidate "m2" 2000, candidate "m4" 4000 ]

                        policy =
                            Retention.sanitizePolicy { keep = 2, perChannel = Dict.empty, maxAgeDays = Nothing }
                    in
                    Expect.equal [ "m1", "m2", "m3" ] (Retention.selectMessagesToPrune messages policy 9999)
            , test "age cutoff drops strictly older rows, boundary kept" <|
                \_ ->
                    let
                        nowMs =
                            10 * Retention.dayMs

                        messages =
                            [ candidate "old" (nowMs - 2 * Retention.dayMs)
                            , candidate "edge" (nowMs - Retention.dayMs)
                            , candidate "new" nowMs
                            ]

                        policy =
                            Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just 1 }
                    in
                    Expect.equal [ "old" ] (Retention.selectMessagesToPrune messages policy nowMs)
            , test "count and age compose by stricter-wins union" <|
                \_ ->
                    let
                        nowMs =
                            10 * Retention.dayMs

                        messages =
                            [ candidate "stale" 1000
                            , candidate "a" (nowMs - 1000)
                            , candidate "b" nowMs
                            ]

                        policy =
                            Retention.sanitizePolicy { keep = 1, perChannel = Dict.empty, maxAgeDays = Just 30 }
                    in
                    -- keep=1 drops stale+a; the age cutoff drops stale
                    -- (10-day-old clock vs a 30-day window keeps a+b).
                    -- Union: stale+a.
                    Expect.equal [ "stale", "a" ] (Retention.selectMessagesToPrune messages policy nowMs)
            , test "ties break by id regardless of input order" <|
                \_ ->
                    let
                        messages =
                            [ candidate "m-b" 1000, candidate "m-a" 1000, candidate "m-c" 1000 ]

                        policy =
                            Retention.sanitizePolicy { keep = 1, perChannel = Dict.empty, maxAgeDays = Nothing }
                    in
                    Expect.equal [ "m-a", "m-b" ] (Retention.selectMessagesToPrune messages policy 0)
            , test "non-finite nowMs skips the age cutoff" <|
                \_ ->
                    let
                        messages =
                            [ candidate "m1" 1000, candidate "m2" 2000 ]

                        policy =
                            Retention.sanitizePolicy { keep = 400, perChannel = Dict.empty, maxAgeDays = Just 1 }
                    in
                    Expect.all
                        [ \_ -> Expect.equal [] (Retention.selectMessagesToPrune messages policy (0 / 0))
                        , \_ -> Expect.equal [] (Retention.selectMessagesToPrune messages policy (1 / 0))
                        ]
                        ()
            , test "non-finite times bucket to oldest" <|
                \_ ->
                    let
                        messages =
                            [ candidate "weird" (0 / 0), candidate "new" 5000 ]

                        policy =
                            Retention.sanitizePolicy { keep = 1, perChannel = Dict.empty, maxAgeDays = Nothing }
                    in
                    Expect.equal [ "weird" ] (Retention.selectMessagesToPrune messages policy 9999)
            , test "empty input prunes nothing" <|
                \_ ->
                    let
                        policy =
                            Retention.sanitizePolicy { keep = 0, perChannel = Dict.empty, maxAgeDays = Just 1 }
                    in
                    Expect.equal [] (Retention.selectMessagesToPrune [] policy 9999)
            ]
        , describe "options and storage"
            [ test "keep and age options mirror the oracle sets" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal [ 200, 400, 1000, 5000 ] Retention.keepOptions
                        , \_ -> Expect.equal [ "200", "400", "1,000", "5,000" ] (List.map Retention.keepLabels Retention.keepOptions)
                        , \_ ->
                            Expect.equal [ "Any age", "7 days", "30 days", "90 days", "1 year" ]
                                (List.map Retention.ageLabels Retention.ageOptions)
                        ]
                        ()
            , test "default policy keeps 400 with no age cutoff" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal 400 Retention.defaultPolicy.keep
                        , \_ -> Expect.equal Nothing Retention.defaultPolicy.maxAgeDays
                        , \_ -> Expect.equal Dict.empty Retention.defaultPolicy.perChannel
                        ]
                        ()
            , test "encode and decode round-trip through sanitize" <|
                \_ ->
                    let
                        policy =
                            Retention.sanitizePolicy { keep = 1000, perChannel = Dict.fromList [ ( "#C", 50 ) ], maxAgeDays = Just 30 }

                        revived =
                            Retention.sanitizePolicy (Retention.decodeRawPolicy (Retention.encodePolicy policy))
                    in
                    Expect.all
                        [ \_ -> Expect.equal policy revived
                        , \_ -> Expect.equal (Just "#c") (List.head (Dict.keys revived.perChannel))
                        ]
                        ()
            , test "hostile stored JSON fails closed to defaults" <|
                \_ ->
                    let
                        revived =
                            Retention.sanitizePolicy (Retention.decodeRawPolicy (Encode.object [ ( "keep", Encode.string "lots" ) ]))
                    in
                    Expect.all
                        [ \_ -> Expect.equal 400 revived.keep
                        , \_ -> Expect.equal Nothing revived.maxAgeDays
                        ]
                        ()
            ]
        ]
