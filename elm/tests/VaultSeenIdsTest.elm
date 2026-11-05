module VaultSeenIdsTest exposing (suite)

import Expect
import Test exposing (Test, describe, test)
import VaultSeenIds


suite : Test
suite =
    describe "VaultSeenIds"
        [ test "preserves prepended batch order when the oldest ID is evicted" <|
            \_ ->
                let
                    padding =
                        List.range 1 (VaultSeenIds.capacity - 2)
                            |> List.map (\index -> "padding-" ++ String.fromInt index)

                    seen =
                        VaultSeenIds.empty
                            |> VaultSeenIds.remember [ "first", "second" ]
                            |> VaultSeenIds.remember padding
                            |> VaultSeenIds.remember [ "latest" ]
                in
                Expect.all
                    [ \_ -> Expect.equal True (VaultSeenIds.member "first" seen)
                    , \_ -> Expect.equal False (VaultSeenIds.member "second" seen)
                    , \_ -> Expect.equal True (VaultSeenIds.member "latest" seen)
                    ]
                    ()
        , test "keeps only the first capacity IDs from an oversized batch" <|
            \_ ->
                let
                    ids =
                        List.range 0 VaultSeenIds.capacity
                            |> List.map (\index -> "batch-" ++ String.fromInt index)

                    seen =
                        VaultSeenIds.remember ids VaultSeenIds.empty
                in
                Expect.all
                    [ \_ -> Expect.equal True (VaultSeenIds.member "batch-0" seen)
                    , \_ -> Expect.equal True (VaultSeenIds.member ("batch-" ++ String.fromInt (VaultSeenIds.capacity - 1)) seen)
                    , \_ -> Expect.equal False (VaultSeenIds.member ("batch-" ++ String.fromInt VaultSeenIds.capacity) seen)
                    ]
                    ()
        , test "keeps duplicate membership until the final retained copy is evicted" <|
            \_ ->
                let
                    padding =
                        List.range 1 (VaultSeenIds.capacity - 3)
                            |> List.map (\index -> "padding-" ++ String.fromInt index)

                    full =
                        VaultSeenIds.empty
                            |> VaultSeenIds.remember [ "duplicate", "middle", "duplicate" ]
                            |> VaultSeenIds.remember padding

                    afterOneEviction =
                        VaultSeenIds.remember [ "next-1" ] full

                    afterTwoEvictions =
                        VaultSeenIds.remember [ "next-2" ] afterOneEviction

                    afterThreeEvictions =
                        VaultSeenIds.remember [ "next-3" ] afterTwoEvictions
                in
                Expect.all
                    [ \_ -> Expect.equal True (VaultSeenIds.member "duplicate" afterOneEviction)
                    , \_ -> Expect.equal True (VaultSeenIds.member "duplicate" afterTwoEvictions)
                    , \_ -> Expect.equal False (VaultSeenIds.member "duplicate" afterThreeEvictions)
                    ]
                    ()
        , test "wraps the ring while retaining membership for the current window" <|
            \_ ->
                let
                    ids start =
                        List.range start (start + VaultSeenIds.capacity - 1)
                            |> List.map (\index -> "id-" ++ String.fromInt index)

                    seen =
                        VaultSeenIds.empty
                            |> VaultSeenIds.remember (ids 0)
                            |> VaultSeenIds.remember (ids VaultSeenIds.capacity)
                            |> VaultSeenIds.remember [ "after-wrap" ]
                in
                Expect.all
                    [ \_ -> Expect.equal False (VaultSeenIds.member ("id-" ++ String.fromInt (VaultSeenIds.capacity * 2 - 1)) seen)
                    , \_ -> Expect.equal True (VaultSeenIds.member ("id-" ++ String.fromInt VaultSeenIds.capacity) seen)
                    , \_ -> Expect.equal True (VaultSeenIds.member "after-wrap" seen)
                    ]
                    ()
        ]
