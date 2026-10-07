module GroupSession exposing
    ( ApplyFailure(..)
    , SessionHead
    , blankSessionHead
    , checkGenesis
    , maxSeen
    , rememberCommit
    , validatePrepared
    )

{-| Group session apply guards — Elm port of the pure ordering core in
`lib/e2ee/groupSession.ts` (`validatePrepared`, `rememberCommit`, the
genesis checks).

Everything cryptographic (routing verification, commit hashing, key
commitments, welcomes, seal/open) stays behind ports; what Elm owns is
the fail-closed commit-chain discipline:

  - duplicates replay the same hash → accepted-as-seen, never re-applied;
  - a reused commit id or epoch with a DIFFERENT hash is equivocation;
  - stale epochs, gaps, and prior-hash mismatches refuse;
  - seen caches hold 64 entries, oldest-inserted evicted first.

Epochs are `Int` with the `GroupCommit` 32-bit convention; hashes ride
as byte lists (`List Int`, 0–255).

-}

import Dict exposing (Dict)


maxSeen : Int
maxSeen =
    64


type ApplyFailure
    = Destroyed
    | InvalidCommit
    | StaleEpoch
    | EpochGap
    | PriorHashMismatch
    | Equivocation
    | DuplicateCommit


type alias SeenCommit =
    { hash : List Int
    , epoch : Int
    }


{-| Session head plus seen caches. The order lists hold keys
oldest-inserted-first so the 64-entry bound evicts like the oracle's
insertion-ordered `Map` (re-setting a known id refreshes its age).
-}
type alias SessionHead =
    { epoch : Int
    , commitHash : List Int
    , destroyed : Bool
    , seenCommits : Dict String SeenCommit
    , seenOrder : List String
    , seenEpochs : Dict Int (List Int)
    , epochOrder : List Int
    }


blankSessionHead : SessionHead
blankSessionHead =
    { epoch = 0
    , commitHash = List.repeat 32 0
    , destroyed = False
    , seenCommits = Dict.empty
    , seenOrder = []
    , seenEpochs = Dict.empty
    , epochOrder = []
    }


mapKey : List Int -> String
mapKey bytes =
    String.concat (List.map byteHex bytes)


byteHex : Int -> String
byteHex byte =
    String.fromChar (hexDigit (byte // 16)) ++ String.fromChar (hexDigit (modBy 16 byte))


hexDigit : Int -> Char
hexDigit n =
    case n of
        0 ->
            '0'

        1 ->
            '1'

        2 ->
            '2'

        3 ->
            '3'

        4 ->
            '4'

        5 ->
            '5'

        6 ->
            '6'

        7 ->
            '7'

        8 ->
            '8'

        9 ->
            '9'

        10 ->
            'a'

        11 ->
            'b'

        12 ->
            'c'

        13 ->
            'd'

        14 ->
            'e'

        _ ->
            'f'


{-| Genesis (epoch-1) checks: the commit must step 0 → 1 with a zero
prior hash.
-}
checkGenesis : { priorEpoch : Int, nextEpoch : Int, priorCommitHash : List Int } -> Maybe ApplyFailure
checkGenesis record =
    if record.nextEpoch /= 1 then
        Just EpochGap

    else if record.priorEpoch /= 0 then
        Just EpochGap

    else if List.any (\b -> b /= 0) record.priorCommitHash then
        Just PriorHashMismatch

    else
        Nothing


{-| Steady-state guard for a prepared commit against the session head.
`Nothing` means the commit may advance the chain.
-}
validatePrepared :
    SessionHead
    -> { commitId : List Int, priorEpoch : Int, nextEpoch : Int, priorCommitHash : List Int }
    -> List Int
    -> Maybe ApplyFailure
validatePrepared head record hash =
    if head.destroyed then
        Just Destroyed

    else if head.epoch > 0 && not (List.any (\b -> b /= 0) head.commitHash) then
        Just InvalidCommit

    else
        case Dict.get (mapKey record.commitId) head.seenCommits of
            Just seen ->
                if seen.hash == hash then
                    Just DuplicateCommit

                else
                    Just Equivocation

            Nothing ->
                case Dict.get record.nextEpoch head.seenEpochs of
                    Just seenHash ->
                        if seenHash == hash then
                            Just DuplicateCommit

                        else
                            Just Equivocation

                    Nothing ->
                        if record.priorEpoch < head.epoch || record.nextEpoch <= head.epoch then
                            Just StaleEpoch

                        else if record.priorEpoch > head.epoch then
                            Just EpochGap

                        else if record.nextEpoch /= head.epoch + 1 then
                            Just EpochGap

                        else if record.priorCommitHash /= head.commitHash then
                            Just PriorHashMismatch

                        else
                            Nothing


{-| Record an applied commit in both seen caches, refreshing age on
re-set and evicting oldest-inserted past 64 entries.
-}
rememberCommit :
    SessionHead
    -> { commitId : List Int, priorEpoch : Int, nextEpoch : Int, priorCommitHash : List Int }
    -> List Int
    -> SessionHead
rememberCommit head record hash =
    let
        id =
            mapKey record.commitId

        freshSeenOrder =
            List.filter (\k -> k /= id) head.seenOrder ++ [ id ]

        droppedCommits =
            List.filter (\k -> not (List.member k (takeLast maxSeen freshSeenOrder))) head.seenOrder

        keptCommits =
            List.foldl Dict.remove head.seenCommits droppedCommits

        freshEpochOrder =
            List.filter (\e -> e /= record.nextEpoch) head.epochOrder ++ [ record.nextEpoch ]

        droppedEpochs =
            List.filter (\e -> not (List.member e (takeLast maxSeen freshEpochOrder))) head.epochOrder

        keptEpochs =
            List.foldl Dict.remove head.seenEpochs droppedEpochs
    in
    { head
        | seenCommits = Dict.insert id { hash = hash, epoch = record.nextEpoch } keptCommits
        , seenOrder = takeLast maxSeen freshSeenOrder
        , seenEpochs = Dict.insert record.nextEpoch hash keptEpochs
        , epochOrder = takeLast maxSeen freshEpochOrder
    }


takeLast : Int -> List a -> List a
takeLast n list =
    List.drop (max 0 (List.length list - n)) list
