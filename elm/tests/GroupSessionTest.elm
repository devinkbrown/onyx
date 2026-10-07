module GroupSessionTest exposing (suite)

{-| Session apply guards: duplicate vs equivocation, stale/gap
detection, prior-hash binding, genesis rules, and the 64-entry seen
caches. Oracle `lib/e2ee/groupSession.ts`.
-}

import Dict
import Expect
import GroupSession exposing (..)
import Test exposing (Test, describe, test)


hashOf : Int -> List Int
hashOf fill =
    List.repeat 32 fill


liveHead : SessionHead
liveHead =
    { blankSessionHead | epoch = 5, commitHash = hashOf 7 }


nextRecord : { commitId : List Int, priorEpoch : Int, nextEpoch : Int, priorCommitHash : List Int }
nextRecord =
    { commitId = hashOf 1, priorEpoch = 5, nextEpoch = 6, priorCommitHash = hashOf 7 }


suite : Test
suite =
    describe "GroupSession"
        [ describe "validatePrepared"
            [ test "the next chained commit passes" <|
                \_ ->
                    Expect.equal Nothing (validatePrepared liveHead nextRecord (hashOf 9))
            , test "destroyed sessions refuse everything" <|
                \_ ->
                    Expect.equal (Just Destroyed)
                        (validatePrepared { liveHead | destroyed = True } nextRecord (hashOf 9))
            , test "replayed hashes are duplicates, changed hashes equivocate" <|
                \_ ->
                    let
                        remembered =
                            rememberCommit liveHead nextRecord (hashOf 9)
                    in
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just DuplicateCommit)
                                (validatePrepared remembered nextRecord (hashOf 9))
                        , \_ ->
                            Expect.equal (Just Equivocation)
                                (validatePrepared remembered nextRecord (hashOf 10))
                        , \_ ->
                            Expect.equal (Just Equivocation)
                                (validatePrepared remembered
                                    { nextRecord | commitId = hashOf 2 }
                                    (hashOf 11)
                                )
                        , \_ ->
                            Expect.equal (Just DuplicateCommit)
                                (validatePrepared remembered
                                    { nextRecord | commitId = hashOf 2 }
                                    (hashOf 9)
                                )
                        ]
                        ()
            , test "stale epochs refuse" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just StaleEpoch)
                                (validatePrepared liveHead { nextRecord | priorEpoch = 4, nextEpoch = 5 } (hashOf 9))
                        , \_ ->
                            Expect.equal (Just StaleEpoch)
                                (validatePrepared liveHead { nextRecord | priorEpoch = 5, nextEpoch = 5 } (hashOf 9))
                        ]
                        ()
            , test "gaps refuse" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just EpochGap)
                                (validatePrepared liveHead { nextRecord | priorEpoch = 6, nextEpoch = 7 } (hashOf 9))
                        , \_ ->
                            Expect.equal (Just EpochGap)
                                (validatePrepared liveHead { nextRecord | priorEpoch = 5, nextEpoch = 7 } (hashOf 9))
                        ]
                        ()
            , test "prior-hash mismatches refuse" <|
                \_ ->
                    Expect.equal (Just PriorHashMismatch)
                        (validatePrepared liveHead { nextRecord | priorCommitHash = hashOf 8 } (hashOf 9))
            , test "zero head hash past genesis is invalid" <|
                \_ ->
                    Expect.equal (Just InvalidCommit)
                        (validatePrepared { liveHead | commitHash = List.repeat 32 0 } nextRecord (hashOf 9))
            ]
        , describe "checkGenesis"
            [ test "genesis steps 0 to 1 with a zero prior hash" <|
                \_ ->
                    Expect.equal Nothing
                        (checkGenesis { priorEpoch = 0, nextEpoch = 1, priorCommitHash = List.repeat 32 0 })
            , test "non-1 targets and nonzero priors refuse" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal (Just EpochGap)
                                (checkGenesis { priorEpoch = 0, nextEpoch = 2, priorCommitHash = List.repeat 32 0 })
                        , \_ ->
                            Expect.equal (Just EpochGap)
                                (checkGenesis { priorEpoch = 1, nextEpoch = 1, priorCommitHash = List.repeat 32 0 })
                        , \_ ->
                            Expect.equal (Just PriorHashMismatch)
                                (checkGenesis { priorEpoch = 0, nextEpoch = 1, priorCommitHash = hashOf 1 })
                        ]
                        ()
            ]
        , describe "rememberCommit"
            [ test "evicts oldest-inserted past 64 entries" <|
                \_ ->
                    let
                        insert i head =
                            rememberCommit head
                                { commitId = [ i, i, i ]
                                , priorEpoch = 99 + i
                                , nextEpoch = 100 + i
                                , priorCommitHash = hashOf i
                                }
                                (hashOf i)

                        full =
                            List.foldl insert blankSessionHead (List.range 1 65)
                    in
                    Expect.all
                        [ \_ -> Expect.equal 64 (Dict.size full.seenCommits)
                        , \_ -> Expect.equal 64 (Dict.size full.seenEpochs)
                        , \_ -> Expect.equal Nothing (Dict.get "010101" full.seenCommits)
                        , \_ ->
                            Expect.equal True
                                (Dict.get "414141" full.seenCommits /= Nothing)
                        ]
                        ()
            ]
        ]
