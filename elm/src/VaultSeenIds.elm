module VaultSeenIds exposing (VaultSeenIds, capacity, empty, member, remember)

import Array
import Dict exposing (Dict)


type VaultSeenIds
    = VaultSeenIds Ring


type alias Ring =
    { slots : Array.Array String
    , oldest : Int
    , counts : Dict String Int
    }


capacity : Int
capacity =
    2000


empty : VaultSeenIds
empty =
    VaultSeenIds
        { slots = Array.empty
        , oldest = 0
        , counts = Dict.empty
        }


member : String -> VaultSeenIds -> Bool
member id (VaultSeenIds ring) =
    Dict.member id ring.counts


{-| Remember IDs in the same order as `List.take capacity (ids ++ oldIds)`.
The input is already newest-first, so the ring appends its bounded prefix in
reverse order and evicts from the oldest end.
-}
remember : List String -> VaultSeenIds -> VaultSeenIds
remember ids (VaultSeenIds ring) =
    List.take capacity ids
        |> List.reverse
        |> List.foldl appendOldestToNewest ring
        |> VaultSeenIds


appendOldestToNewest : String -> Ring -> Ring
appendOldestToNewest id ring =
    if Array.length ring.slots < capacity then
        { ring
            | slots = Array.push id ring.slots
            , counts = increment id ring.counts
        }

    else
        case Array.get ring.oldest ring.slots of
            Just evicted ->
                { ring
                    | slots = Array.set ring.oldest id ring.slots
                    , oldest = modBy capacity (ring.oldest + 1)
                    , counts = ring.counts |> decrement evicted |> increment id
                }

            Nothing ->
                -- The opaque type keeps `oldest` inside the populated ring.
                -- Retain the existing state if that invariant is ever broken.
                ring


increment : String -> Dict String Int -> Dict String Int
increment id counts =
    Dict.update id
        (\current -> Just (Maybe.withDefault 0 current + 1))
        counts


decrement : String -> Dict String Int -> Dict String Int
decrement id counts =
    case Dict.get id counts of
        Just occurrences ->
            if occurrences <= 1 then
                Dict.remove id counts

            else
                Dict.insert id (occurrences - 1) counts

        Nothing ->
            counts
