module Nodes exposing
    ( IrcNode
    , ProbeResult
    , boundedTimeout
    , customEndpointHost
    , defaultMaxConcurrency
    , defaultProbeTimeoutMs
    , envNode
    , nodes
    , pickFastest
    , probeConcurrency
    )

{-| Onyx node registry + automatic node selection — Elm port of
`src/app/nodes.ts`.

The network is a single mesh, so which node a client attaches to is
purely a routing/latency concern. A pin (`?ws=`, mirroring
`VITE_IRC_WS`) always wins and disables probing; otherwise every node
is timed with a bodyless HTTPS HEAD against its web tier and the
lowest-latency reachable node wins, with a random node as the
inconclusive-probe fallback so there is always a target.

Latency itself is measured ports-side (`ports.js` `probeNodes`,
mirroring `pingNode`: HEAD, `no-cors`, cache-buster, bounded
timeout, `Infinity` on error/timeout/abort). This module owns the
registry, the pin rule, the fastest-pick, and the concurrency bound —
all pure and unit-tested.
-}


{-| One mesh node: registry id, web-tier host (probed), WS endpoint. -}
type alias IrcNode =
    { id : String
    , host : String
    , wss : String
    }


{-| One probe outcome: the node plus its round-trip ms (`Infinity`
when the probe failed — never selected). -}
type alias ProbeResult =
    { node : IrcNode
    , ms : Float
    }


{-| Per-node probe deadline (mirrors `DEFAULT_PROBE_TIMEOUT_MS`). -}
defaultProbeTimeoutMs : Int
defaultProbeTimeoutMs =
    4000


{-| Max simultaneous probes (mirrors
`DEFAULT_MAX_CONCURRENT_PROBES`). -}
defaultMaxConcurrency : Int
defaultMaxConcurrency =
    4


{-| The mesh registry (mirrors `NODES`). -}
nodes : List IrcNode
nodes =
    [ { id = "b", host = "eshmaki.me", wss = "wss://eshmaki.me:8080" }
    ]


{-| Endpoint pinned via `?ws=`, if any: a recognised node or a
synthesised `env` entry (mirrors `envNode`). -}
envNode : Maybe String -> Maybe IrcNode
envNode pin =
    case Maybe.map String.trim pin of
        Just pinned ->
            if String.isEmpty pinned then
                Nothing

            else
                Just
                    (case List.filter (\n -> n.wss == pinned) nodes of
                        found :: _ ->
                            found

                        [] ->
                            { id = "env", host = "custom", wss = pinned }
                    )

        Nothing ->
            Nothing


{-| Clamp a caller-supplied probe timeout to the bounded default
(mirrors the `boundedTimeout` rule in `pingNode`: only non-negative
values are honored — Elm `Int` is always finite, so no finiteness
guard is needed). -}
boundedTimeout : Maybe Int -> Int
boundedTimeout timeoutMs =
    case timeoutMs of
        Just ms ->
            if ms >= 0 then
                ms

            else
                defaultProbeTimeoutMs

        Nothing ->
            defaultProbeTimeoutMs


{-| Bounded worker count for a probe sweep (mirrors
`probeConcurrency`: at least 1, at most the node count). -}
probeConcurrency : Maybe Int -> Int -> Int
probeConcurrency requested nodeCount =
    min nodeCount (max 1 (Maybe.withDefault defaultMaxConcurrency requested))


{-| Lowest-latency reachable node (mirrors the `selectBestNode`
scan: non-finite measurements never win; ties keep the earlier
node). Nothing when no probe answered — the caller falls back to a
random node like the oracle `randomNode` leg. -}
pickFastest : List ProbeResult -> Maybe IrcNode
pickFastest results =
    List.foldl
        (\result fastest ->
            if isFinite result.ms then
                case fastest of
                    Just ( _, best ) ->
                        if result.ms < best then
                            Just ( result.node, result.ms )

                        else
                            fastest

                    Nothing ->
                        Just ( result.node, result.ms )

            else
                fastest
        )
        Nothing
        results
        |> Maybe.map Tuple.first


isFinite : Float -> Bool
isFinite ms =
    ms /= (1 / 0) && ms /= (-1 / 0) && ms == ms


{-| The host of a connected endpoint that is NOT one of the Onyx nodes
(a `?ws=` pin to someone else's server), so sign-in forms can warn before
a password is typed. Known nodes, with or without a trailing slash, and an
unknown/absent endpoint give `Nothing`.
-}
customEndpointHost : Maybe String -> Maybe String
customEndpointHost endpoint =
    let
        strip url =
            if String.endsWith "/" url then
                String.dropRight 1 url

            else
                url
    in
    case Maybe.map (String.trim >> strip >> String.toLower) endpoint of
        Nothing ->
            Nothing

        Just "" ->
            Nothing

        Just url ->
            if List.any (\node -> strip (String.toLower node.wss) == url) nodes then
                Nothing

            else
                let
                    afterScheme =
                        case String.indexes "://" url of
                            i :: _ ->
                                String.dropLeft (i + 3) url

                            [] ->
                                url

                    host =
                        afterScheme
                            |> String.split "/"
                            |> List.head
                            |> Maybe.withDefault afterScheme
                in
                Just (String.left 253 host)
