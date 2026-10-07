module KeyringTest exposing (suite)

{-| Room-epoch keyring: install/conflict/no-replace semantics, active
promotion without demotion, lowest-first eviction at 8 epochs,
room/epoch/id validation, and explicit activation. Oracle
`lib/e2ee/groupKeyring.ts`. Keys are opaque `KeyRef` handles — Elm
never sees key bytes.
-}

import Expect
import Keyring exposing (..)
import Test exposing (Test, describe, test)


installEpochs : Keyring -> List Int -> Keyring
installEpochs keyring epochs =
    List.foldl
        (\epoch ( acc, _ ) ->
            install acc "#room" epoch ("key" ++ String.fromInt epoch) ("id" ++ String.fromInt epoch)
        )
        ( keyring, Installed )
        epochs
        |> Tuple.first


suite : Test
suite =
    describe "Keyring"
        [ describe "validation"
            [ test "room names trim and lowercase, reject empty" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Just "#room") (normalizeGroupRoom "  #Room ")
                        , \_ -> Expect.equal Nothing (normalizeGroupRoom "   ")
                        , \_ -> Expect.equal Nothing (normalizeGroupRoom "")
                        ]
                        ()
            , test "room names reject oversized UTF-8" <|
                \_ ->
                    Expect.equal Nothing
                        (normalizeGroupRoom ("#" ++ String.repeat 300 "é"))
            , test "epochs accept zero and reject negatives" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (validRoomEpoch 0)
                        , \_ -> Expect.equal True (validRoomEpoch 41)
                        , \_ -> Expect.equal False (validRoomEpoch -1)
                        ]
                        ()
            , test "authenticated ids are bounded tokens" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (validAuthenticatedId "abc_123-XYZ")
                        , \_ -> Expect.equal False (validAuthenticatedId "")
                        , \_ -> Expect.equal False (validAuthenticatedId "has space")
                        , \_ -> Expect.equal False (validAuthenticatedId (String.repeat 129 "a"))
                        ]
                        ()
            , test "install refuses bad rooms epochs and ids" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal Invalid (Tuple.second (install blankKeyring "" 0 "k" "id"))
                        , \_ -> Expect.equal Invalid (Tuple.second (install blankKeyring "#r" -1 "k" "id"))
                        , \_ -> Expect.equal Invalid (Tuple.second (install blankKeyring "#r" 0 "" "id"))
                        , \_ -> Expect.equal Invalid (Tuple.second (install blankKeyring "#r" 0 "k" "bad id"))
                        ]
                        ()
            ]
        , describe "install semantics"
            [ test "first install promotes to active" <|
                \_ ->
                    let
                        ( keyring, result ) =
                            install blankKeyring "#room" 3 "key3" "id3"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Installed result
                        , \_ -> Expect.equal (Just 3) (activeEpoch keyring "#room")
                        , \_ -> Expect.equal (Just "key3") (getActive keyring "#room")
                        , \_ -> Expect.equal (Just "key3") (getEpochKey keyring "#room" 3)
                        ]
                        ()
            , test "same key reinstalls as unchanged" <|
                \_ ->
                    let
                        ( keyring, _ ) =
                            install blankKeyring "#room" 3 "key3" "id3"
                    in
                    Expect.equal Unchanged
                        (Tuple.second (install keyring "#room" 3 "other-ref" "id3"))
            , test "conflicting keys never replace" <|
                \_ ->
                    let
                        ( keyring, _ ) =
                            install blankKeyring "#room" 3 "key3" "id3"

                        ( next, result ) =
                            install keyring "#room" 3 "evil" "other-id"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Conflict result
                        , \_ -> Expect.equal (Just "key3") (getEpochKey next "#room" 3)
                        ]
                        ()
            , test "higher installs promote, lower installs do not demote" <|
                \_ ->
                    let
                        keyring =
                            installEpochs blankKeyring [ 5, 9, 7 ]
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just 9) (activeEpoch keyring "#room")
                        , \_ -> Expect.equal (Just "key9") (getActive keyring "#room")
                        ]
                        ()
            , test "rooms are isolated by normalized name" <|
                \_ ->
                    let
                        ( keyring, _ ) =
                            install blankKeyring "#Room" 1 "k1" "id1"
                    in
                    Expect.all
                        [ \_ -> Expect.equal (Just 1) (activeEpoch keyring "#room")
                        , \_ -> Expect.equal Nothing (activeEpoch keyring "#other")
                        ]
                        ()
            ]
        , describe "retention"
            [ test "eviction drops the lowest past eight epochs" <|
                \_ ->
                    let
                        keyring =
                            installEpochs blankKeyring (List.range 1 9)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 8 (roomEpochCount keyring "#room")
                        , \_ -> Expect.equal Nothing (getEpochKey keyring "#room" 1)
                        , \_ -> Expect.equal True (getEpochKey keyring "#room" 9 /= Nothing)
                        ]
                        ()
            , test "evicting the active epoch re-points at the highest" <|
                \_ ->
                    let
                        ( first, _ ) =
                            install blankKeyring "#room" 1 "key1" "id1"

                        keyring =
                            installEpochs first (List.range 2 9)
                    in
                    Expect.equal (Just 9) (activeEpoch keyring "#room")
            , test "explicit activation selects a retained epoch" <|
                \_ ->
                    let
                        keyring =
                            installEpochs blankKeyring [ 4, 6 ]

                        ( activated, ok ) =
                            activate keyring "#room" 4

                        ( missing, okMissing ) =
                            activate keyring "#room" 99
                    in
                    Expect.all
                        [ \_ -> Expect.equal True ok
                        , \_ -> Expect.equal (Just 4) (activeEpoch activated "#room")
                        , \_ -> Expect.equal False okMissing
                        , \_ -> Expect.equal (Just 6) (activeEpoch missing "#room")
                        ]
                        ()
            , test "clearRoom drops one room only" <|
                \_ ->
                    let
                        keyring =
                            installEpochs blankKeyring [ 1 ]
                                |> (\k -> Tuple.first (install k "#other" 1 "k" "id"))

                        cleared =
                            clearRoom keyring "#room"
                    in
                    Expect.all
                        [ \_ -> Expect.equal Nothing (activeEpoch cleared "#room")
                        , \_ -> Expect.equal (Just 1) (activeEpoch cleared "#other")
                        ]
                        ()
            ]
        ]
