module Status exposing
    ( FeedState(..)
    , NetworkStatus
    , StatusPeer
    , communityVoice
    , feedLabel
    , feedState
    , feedStateKey
    , formatDuration
    , maxStatusPeerNameLength
    , maxStatusPeers
    , normalizeStatus
    , publicFeedFreshMs
    , publicFeedFutureSkewMs
    , statusPaths
    )

{-| Public mesh health feed, mirroring `lib/stats/status.ts` and the
`feedBounds` helpers: bounded normalization of the Onyx Server
`status.json` shape, freshness states, and the honest one-sentence
wording from `Status.tsx` (`communityStatusVoice`).

Numbers ride as `Float` (ms/epoch magnitudes exceed 32-bit `Int`).
`String.left` truncation counts code points, not UTF-16 units — the
same documented UTF discipline as the other Elm folds — and only
affects hostile over-long feed text at the cut point.
-}

import Json.Decode as Decode


{-| Max peer rows accepted from one feed. -}
maxStatusPeers : Int
maxStatusPeers =
    128


{-| Max peer name length. -}
maxStatusPeerNameLength : Int
maxStatusPeerNameLength =
    128


{-| Fresh window for a feed sample (2 minutes). -}
publicFeedFreshMs : Float
publicFeedFreshMs =
    120000


{-| Clock-skew allowance before a feed reads as from the future (5 minutes). -}
publicFeedFutureSkewMs : Float
publicFeedFutureSkewMs =
    300000


{-| Feed paths tried in order, mirroring `fetchNetworkStatus`. -}
statusPaths : List String
statusPaths =
    [ "/stats/data/status.json"
    , "/stats/status.json"
    , "/status.json"
    ]


{-| Feed freshness + health states. -}
type FeedState
    = Loading
    | Current
    | Degraded
    | Stale
    | Future
    | Unknown
    | Unavailable


{-| One mesh peer row. -}
type alias StatusPeer =
    { name : String
    , state : String
    , up : Bool
    , rttMs : Maybe Float
    , sinceSeconds : Int
    }


{-| A normalized network status sample. -}
type alias NetworkStatus =
    { generatedAt : Float
    , network : String
    , node : String
    , uptimeSeconds : Int
    , usersOnline : Int
    , quorum : Bool
    , partitioned : Bool
    , components : Int
    , peers : List StatusPeer
    , peersComplete : Bool
    }


{-| String capped at a code-point length (empty when not a string). -}
boundedFeedText : Decode.Value -> Int -> String
boundedFeedText raw maxLength =
    case Decode.decodeValue Decode.string raw of
        Ok text ->
            String.left maxLength text

        Err _ ->
            ""


{-| Non-negative finite number capped at max (anything else is zero). -}
boundedFeedNumber : Decode.Value -> Float -> Float
boundedFeedNumber raw max =
    case Decode.decodeValue Decode.float raw of
        Ok n ->
            if isNaN n || isInfinite n || n < 0 then
                0

            else
                min n max

        Err _ ->
            0


{-| Floored non-negative counter, clamped to 2^31-1: Elm `Int`
is 32-bit, so feed magnitudes past that (the oracle caps counters at
1e12) clamp rather than corrupt downstream `//` arithmetic. -}
boundedFeedInteger : Decode.Value -> Float -> Int
boundedFeedInteger raw max =
    min 2147483647 (floor (boundedFeedNumber raw max))


{-| Unix-seconds stamp within the feed range. -}
boundedUnixSeconds : Decode.Value -> Float
boundedUnixSeconds raw =
    boundedFeedNumber raw 8640000000000


{-| Feed freshness from a unix-seconds stamp and now-ms. -}
feedFreshness : Float -> Float -> FeedState
feedFreshness generatedAtUnixSec nowMs =
    if isNaN generatedAtUnixSec || isInfinite generatedAtUnixSec || generatedAtUnixSec <= 0 || generatedAtUnixSec > 8640000000000 || isNaN nowMs || isInfinite nowMs then
        Unknown

    else
        let
            ageMs =
                nowMs - generatedAtUnixSec * 1000
        in
        if ageMs < -publicFeedFutureSkewMs then
            Future

        else if ageMs <= publicFeedFreshMs then
            Current

        else
            Stale


{-| Wire key for a feed state (the `data-feed-state` values). -}
feedStateKey : FeedState -> String
feedStateKey state =
    case state of
        Loading ->
            "loading"

        Current ->
            "current"

        Degraded ->
            "degraded"

        Stale ->
            "stale"

        Future ->
            "future"

        Unknown ->
            "unknown"

        Unavailable ->
            "unavailable"


{-| Overall feed state: freshness first, then topology health. -}
feedState : Maybe NetworkStatus -> Float -> FeedState
feedState status nowMs =
    case status of
        Nothing ->
            Unavailable

        Just sample ->
            case feedFreshness sample.generatedAt nowMs of
                Current ->
                    if sample.quorum && not sample.partitioned && sample.peersComplete then
                        Current

                    else
                        Degraded

                freshness ->
                    freshness


{-| Short machine label per state, mirroring `publicMeshFeedLabel`. -}
feedLabel : FeedState -> String
feedLabel state =
    case state of
        Loading ->
            "checking network"

        Current ->
            "network online"

        Degraded ->
            "network degraded"

        Stale ->
            "status stale"

        Future ->
            "status time mismatch"

        Unknown ->
            "status undated"

        Unavailable ->
            "status unavailable"


{-| One honest sentence per state, mirroring `communityStatusVoice`. -}
communityVoice : FeedState -> { label : String, sentence : String }
communityVoice state =
    case state of
        Loading ->
            { label = "Checking"
            , sentence = "Looking for a public report. No health claim yet."
            }

        Current ->
            { label = "Reachable"
            , sentence = "The rooms are reachable tonight."
            }

        Degraded ->
            { label = "Having trouble"
            , sentence = "The rooms are having trouble — some people may not get through."
            }

        Stale ->
            { label = "We cannot say"
            , sentence = "The last report is too old to claim that the rooms are up."
            }

        Future ->
            { label = "We cannot say"
            , sentence = "The report time does not make sense, so we cannot claim health."
            }

        Unknown ->
            { label = "We cannot say"
            , sentence = "The report has no usable time, so we cannot claim health."
            }

        Unavailable ->
            { label = "We cannot say"
            , sentence = "There is no public report, so we cannot claim health."
            }


{-| Compact duration for status rows. -}
formatDuration : Float -> String
formatDuration totalSeconds =
    let
        s =
            if isNaN totalSeconds || isInfinite totalSeconds || totalSeconds < 0 then
                0

            else
                floor totalSeconds

        days =
            s // 86400

        hours =
            modBy 86400 s // 3600

        minutes =
            modBy 3600 s // 60
    in
    if days > 0 then
        String.fromInt days ++ "d " ++ String.fromInt hours ++ "h"

    else if hours > 0 then
        String.fromInt hours ++ "h " ++ String.fromInt minutes ++ "m"

    else if minutes > 0 then
        String.fromInt minutes ++ "m"

    else
        String.fromInt s ++ "s"


{-| Control characters rejected in peer names. -}
isPeerBadChar : Char -> Bool
isPeerBadChar c =
    c <= '\u{001F}' || c == '\u{007F}'


{-| Field lookup on a raw object value. -}
field : String -> Decode.Value -> Maybe Decode.Value
field name raw =
    case Decode.decodeValue (Decode.field name Decode.value) raw of
        Ok value ->
            Just value

        Err _ ->
            Nothing


{-| Normalize one peer row; `Nothing` marks an omitted row. -}
normalizePeer : List String -> Decode.Value -> ( List String, Maybe StatusPeer )
normalizePeer seen raw =
    case rawObject raw of
        Nothing ->
            ( seen, Nothing )

        Just _ ->
            case field "name" raw |> Maybe.andThen (\v -> Decode.decodeValue Decode.string v |> Result.toMaybe) of
                Nothing ->
                    ( seen, Nothing )

                Just rawName ->
                    if String.length rawName > maxStatusPeerNameLength then
                        ( seen, Nothing )

                    else
                        let
                            name =
                                String.trim rawName

                            key =
                                String.toLower name
                        in
                        if String.isEmpty name || List.any isPeerBadChar (String.toList name) || List.member key seen then
                            ( seen, Nothing )

                        else
                            let
                                stateText =
                                    case field "state" raw of
                                        Just v ->
                                            boundedFeedText v 32

                                        Nothing ->
                                            ""

                                up =
                                    case field "up" raw of
                                        Just v ->
                                            Decode.decodeValue Decode.bool v |> Result.withDefault False

                                        Nothing ->
                                            False

                                rtt =
                                    case field "rtt_ms" raw of
                                        Just v ->
                                            case Decode.decodeValue Decode.float v of
                                                Ok n ->
                                                    if isNaN n || isInfinite n || n < 0 then
                                                        Nothing

                                                    else
                                                        Just (min n 1000000000000)

                                                Err _ ->
                                                    Nothing

                                        Nothing ->
                                            Nothing

                                since =
                                    case field "since_seconds" raw of
                                        Just v ->
                                            boundedFeedInteger v 1000000000000

                                        Nothing ->
                                            0
                            in
                            ( key :: seen
                            , Just
                                { name = name
                                , state = if String.isEmpty stateText then "unknown" else stateText
                                , up = up
                                , rttMs = rtt
                                , sinceSeconds = since
                                }
                            )


rawObject : Decode.Value -> Maybe (List ( String, Decode.Value ))
rawObject raw =
    case Decode.decodeValue (Decode.keyValuePairs Decode.value) raw of
        Ok pairs ->
            Just pairs

        Err _ ->
            Nothing


{-| Normalize a raw `status.json` payload; `Nothing` on non-objects. -}
normalizeStatus : Decode.Value -> Maybe NetworkStatus
normalizeStatus raw =
    case rawObject raw of
        Nothing ->
            Nothing

        Just _ ->
            let
                meshRaw =
                    field "mesh" raw
                        |> Maybe.andThen rawObject
                        |> Maybe.withDefault []

                meshField name =
                    List.filter (\( k, _ ) -> k == name) meshRaw
                        |> List.head
                        |> Maybe.map Tuple.second

                strictTrue fieldValue =
                    case fieldValue of
                        Just v ->
                            Decode.decodeValue Decode.bool v |> Result.withDefault False

                        Nothing ->
                            False

                peersRaw =
                    case field "peers" raw of
                        Just v ->
                            case Decode.decodeValue (Decode.list Decode.value) v of
                                Ok items ->
                                    Just items

                                Err _ ->
                                    Nothing

                        Nothing ->
                            Nothing

                walk remaining seen acc incomplete =
                    case remaining of
                        [] ->
                            ( List.reverse acc, incomplete )

                        entry :: rest ->
                            let
                                ( nextSeen, peer ) =
                                    normalizePeer seen entry
                            in
                            case peer of
                                Just p ->
                                    walk rest nextSeen (p :: acc) incomplete

                                Nothing ->
                                    walk rest nextSeen acc True

                ( peers, peersIncomplete ) =
                    case peersRaw of
                        Nothing ->
                            ( [], True )

                        Just items ->
                            if List.length items > maxStatusPeers then
                                let
                                    ( kept, innerIncomplete ) =
                                        walk (List.take maxStatusPeers items) [] [] True
                                in
                                ( kept, innerIncomplete )

                            else
                                walk items [] [] False
            in
            Just
                { generatedAt = field "generated_at" raw |> Maybe.map boundedUnixSeconds |> Maybe.withDefault 0
                , network = field "network" raw |> Maybe.map (\v -> boundedFeedText v 256) |> Maybe.withDefault ""
                , node = field "node" raw |> Maybe.map (\v -> boundedFeedText v 256) |> Maybe.withDefault ""
                , uptimeSeconds = field "uptime_seconds" raw |> Maybe.map (\v -> boundedFeedInteger v 1000000000000) |> Maybe.withDefault 0
                , usersOnline = field "users_online" raw |> Maybe.map (\v -> boundedFeedInteger v 1000000000000) |> Maybe.withDefault 0
                , quorum = strictTrue (meshField "quorum")
                , partitioned = strictTrue (meshField "partitioned")
                , components =
                    max 1
                        (meshField "components"
                            |> Maybe.map (\v -> boundedFeedInteger v 1024)
                            |> Maybe.withDefault 0
                        )
                , peers = peers
                , peersComplete = not peersIncomplete
                }
