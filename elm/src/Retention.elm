module Retention exposing
    ( RetentionPolicy
    , RawPolicy
    , dayMs
    , defaultKeep
    , maxAgeDaysCeiling
    , maxKeep
    , storageKey
    , effectiveKeep
    , resolvePolicyForChannel
    , sanitizePolicy
    , selectMessagesToPrune
    )

{-| Device vault retention policy, mirroring the pure oracle
`src/lib/vault/retentionPolicy.ts`. Decides *how much* scrollback a
device keeps per conversation: a default per-target count cap (`keep`),
optional per-conversation overrides (`perChannel`, lowercased keys),
and an optional age cutoff (`maxAgeDays`). The two constraints compose
by stricter-wins: a message is pruned when the count cap OR the age
cutoff would drop it.

The IndexedDB save/prune path stays ports-side (`ports.js` carries a
structurally-identical mirror, exercised by `vaultHistory.smoke.mjs`);
this module is the shared truth for validation and selection, and the
executable spec lives in `tests/RetentionTest.elm`. There is no
preferences UI in the Elm client yet, so no Elm caller sets a policy —
the ports mirror reads `storageKey` live on every trim, which is also
how a future UI (or a manually-stored value) takes effect.
-}

import Dict exposing (Dict)
import Set


{-| Hard ceiling on any keep-count, so a bad config cannot request
unbounded storage. -}
maxKeep : Int
maxKeep =
    5000


{-| Hard ceiling on the age cutoff (~10 years); larger values clamp down. -}
maxAgeDaysCeiling : Float
maxAgeDaysCeiling =
    3650


{-| Flat per-target cap when no policy (or no usable `keep`) is stored. -}
defaultKeep : Int
defaultKeep =
    400


{-| Milliseconds per day for the age cutoff. -}
dayMs : Float
dayMs =
    86400000


{-| Browser-local persistence key for the device vault policy. -}
storageKey : String
storageKey =
    "onyx:vault-retention-policy"


{-| Untrusted policy shape (e.g. parsed localStorage JSON). Counts
arrive as floats because JSON has no integers and hostile values
(`NaN`, infinities, negatives) must fail closed to the defaults. -}
type alias RawPolicy =
    { keep : Float
    , perChannel : Dict String Float
    , maxAgeDays : Maybe Float
    }


{-| Validated policy. -}
type alias RetentionPolicy =
    { keep : Int
    , perChannel : Dict String Int
    , maxAgeDays : Maybe Float
    }


{-| Coerce a count to a finite, non-negative, floored, clamped keep. -}
sanitizeKeep : Float -> Int -> Int
sanitizeKeep value fallback =
    if isNaN value || isInfinite value || value < 0 then
        fallback

    else
        min (floor value) maxKeep


{-| Coerce an age cutoff; non-positive / non-finite drops it entirely.
Fractional days survive (no floor), clamped to the ceiling. -}
sanitizeMaxAgeDays : Maybe Float -> Maybe Float
sanitizeMaxAgeDays maybeDays =
    case maybeDays of
        Nothing ->
            Nothing

        Just days ->
            if isNaN days || isInfinite days || days <= 0 then
                Nothing

            else
                Just (min days maxAgeDaysCeiling)


{-| Validate and normalise an untrusted policy. Pure and idempotent:
sanitising twice deep-equals sanitising once. -}
sanitizePolicy : RawPolicy -> RetentionPolicy
sanitizePolicy raw =
    let
        overrides =
            Dict.foldl
                (\rawKey rawValue acc ->
                    if isNaN rawValue || isInfinite rawValue || rawValue < 0 then
                        acc

                    else
                        Dict.insert (String.toLower rawKey) (min (floor rawValue) maxKeep) acc
                )
                Dict.empty
                raw.perChannel
    in
    { keep = sanitizeKeep raw.keep defaultKeep
    , perChannel = overrides
    , maxAgeDays = sanitizeMaxAgeDays raw.maxAgeDays
    }


{-| The effective keep-count for a channel: its override, else the default. -}
effectiveKeep : RetentionPolicy -> String -> Int
effectiveKeep policy channel =
    case Dict.get (String.toLower channel) policy.perChannel of
        Just override ->
            override

        Nothing ->
            policy.keep


{-| Flatten a policy for a single channel: resolve the per-channel
override into `keep` and preserve the age cutoff. -}
resolvePolicyForChannel : RetentionPolicy -> String -> RetentionPolicy
resolvePolicyForChannel policy channel =
    { keep = effectiveKeep policy channel
    , perChannel = Dict.empty
    , maxAgeDays = policy.maxAgeDays
    }


{-| Epoch ms from a candidate; non-finite coerces to the oldest bucket (0). -}
toEpochMs : Float -> Float
toEpochMs time =
    if isNaN time || isInfinite time then
        0

    else
        time


{-| Deterministically select the ids to prune for one target. A message
is dropped when EITHER constraint would drop it (stricter wins): the
count cap keeps only the newest `keep` by time, and the age cutoff
drops anything strictly older than `nowMs - maxAgeDays` (the boundary
is inclusive-keep; skipped when `nowMs` is non-finite). Returned ids
are chronological, oldest-first, ties broken by id. -}
selectMessagesToPrune : List { id : String, time : Float } -> RetentionPolicy -> Float -> List String
selectMessagesToPrune messages policy nowMs =
    if List.isEmpty messages then
        []

    else
        let
            ordered =
                List.sortBy (\m -> ( toEpochMs m.time, m.id )) messages

            dropByCount =
                max 0 (List.length ordered - policy.keep)

            countDropped =
                List.map .id (List.take dropByCount ordered)

            ageDropped =
                case policy.maxAgeDays of
                    Nothing ->
                        []

                    Just days ->
                        if isNaN nowMs || isInfinite nowMs then
                            []

                        else
                            let
                                cutoff =
                                    nowMs - days * dayMs
                            in
                            List.map .id (List.filter (\m -> toEpochMs m.time < cutoff) ordered)

            drop =
                Set.fromList (countDropped ++ ageDropped)
        in
        List.map .id (List.filter (\m -> Set.member m.id drop) ordered)
