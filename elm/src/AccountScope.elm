module AccountScope exposing
    ( ListsSnapshot
    , PendingOps
    , Scope
    , applyOps
    , attentionCount
    , attentionTitle
    , emptyOps
    , isEmptyOps
    , isGuest
    , mergeOps
    , meshNetwork
    , networkOf
    , normalizeAccount
    , recordDiff
    , scopeFor
    , scopeKey
    , solidOwnerKeys
    )

{-| v3/gap-account — per-account device-memory scope.

Device memory (block / mute lists, keywords, per-room alert levels, the
local history vault and its outbox) belongs to ONE identity on this
browser. A scope is a network plus either an account authenticated on
the current socket, or the one guest scope of that network.

  - **Network.** Every node of the Onyx mesh registry (`Nodes.nodes`)
    is the same network, so hopping between nodes keeps the same
    scope (blocks never silently stop applying because the fastest
    node changed). Any other endpoint (a pinned `?ws=` dev server) is
    its own network, keyed by the exact endpoint.
  - **Account.** Only an account the server confirmed on this socket
    counts (the caller passes it); a stale name from an earlier socket
    never scopes a guest session.
  - **Guest.** All guest sessions of a network share one scope. A nick
    is not an identity (anyone can take a free nick), so a guest named
    like an account never reads that account's memory, and a guest's
    blocks survive a nick change.

The scope key is the JSON array `["onyx","account","kai"]` /
`["onyx","guest"]` — opaque to the ports bridge, which only compares it
and uses it as a storage-key suffix.

Migration (ports side, `gapScopedListsRequest`): a scope's list slot is
seeded once, when it does not exist yet, from the union of the old
device-global plain keys (`onyx:ignored-users`, …) and — for accounts —
the SolidJS owner-scoped slots `<base>:owner:<encodeURIComponent(
JSON.stringify([endpoint, account]))>` for every mesh endpoint. The
sources are copied, never deleted, so no identity on the device can lose
a block it had before the split.

-}

import Dict exposing (Dict)
import Json.Encode as Encode
import Nodes
import Set exposing (Set)


{-| One identity on one network. `account = Nothing` is the guest scope. -}
type alias Scope =
    { network : String
    , account : Maybe String
    }


{-| The network id every mesh registry node shares. -}
meshNetwork : String
meshNetwork =
    "onyx"


maxEndpointLength : Int
maxEndpointLength =
    2048


maxAccountLength : Int
maxAccountLength =
    256


{-| Network for an endpoint: the mesh id for registry nodes, else the
exact (trimmed) endpoint. Empty or oversized endpoints have no network.
-}
networkOf : String -> Maybe String
networkOf endpoint =
    let
        trimmed =
            String.trim endpoint
    in
    if String.isEmpty trimmed || String.length trimmed > maxEndpointLength then
        Nothing

    else if List.any (\node -> node.wss == trimmed) Nodes.nodes then
        Just meshNetwork

    else
        Just trimmed


isControl : Char -> Bool
isControl c =
    let
        code =
            Char.toCode c
    in
    code < 0x20 || code == 0x7F


{-| Lowercase, trimmed, bounded, control-free account name. -}
normalizeAccount : String -> Maybe String
normalizeAccount raw =
    let
        name =
            String.toLower (String.trim raw)
    in
    if String.isEmpty name || String.length name > maxAccountLength || String.any isControl name || name == "*" then
        Nothing

    else
        Just name


{-| Resolve the scope for an endpoint and the account authenticated on
the current socket. No endpoint → no scope (fail closed: nothing is
read or written). An account name that does not normalize falls back
to no scope rather than to the guest scope, so a garbled login never
lands in the shared guest memory either.
-}
scopeFor : { endpoint : Maybe String, account : Maybe String } -> Maybe Scope
scopeFor input =
    case Maybe.andThen networkOf input.endpoint of
        Nothing ->
            Nothing

        Just network ->
            case input.account of
                Nothing ->
                    Just { network = network, account = Nothing }

                Just raw ->
                    Maybe.map (\name -> { network = network, account = Just name }) (normalizeAccount raw)


isGuest : Scope -> Bool
isGuest scope =
    scope.account == Nothing


{-| Stable key for one scope (JSON array, see the module doc). -}
scopeKey : Scope -> String
scopeKey scope =
    Encode.encode 0
        (Encode.list Encode.string
            (case scope.account of
                Just name ->
                    [ scope.network, "account", name ]

                Nothing ->
                    [ scope.network, "guest" ]
            )
        )


{-| SolidJS owner keys (`deviceMemoryOwnerKey`, i.e.
`JSON.stringify([serverUrl, identity])`) that may hold this account's
lists from the deprecated client: every mesh endpoint plus the current
endpoint. Guests have none (the old client keyed guests by nick, which
is not an identity).
-}
solidOwnerKeys : Maybe String -> Scope -> List String
solidOwnerKeys endpoint scope =
    case scope.account of
        Nothing ->
            []

        Just name ->
            let
                endpoints =
                    List.map .wss Nodes.nodes
                        ++ (case Maybe.map String.trim endpoint of
                                Just ep ->
                                    if String.isEmpty ep then
                                        []

                                    else
                                        [ ep ]

                                Nothing ->
                                    []
                           )

                unique =
                    List.foldl
                        (\ep acc ->
                            if List.member ep acc then
                                acc

                            else
                                acc ++ [ ep ]
                        )
                        []
                        endpoints
            in
            List.map (\ep -> Encode.encode 0 (Encode.list Encode.string [ ep, name ])) unique



-- LIST EDITS WHILE A SCOPE IS NOT LOADED


{-| The four scoped lists as the model holds them. -}
type alias ListsSnapshot =
    { ignored : Set String
    , muted : Set String
    , highlights : List String
    , notify : Dict String String
    }


{-| Edits made while no scope's lists were loaded (before the first
connect, or between a scope change and its load answer). They replay
onto the loaded lists so nothing typed meanwhile is lost; `notify`
maps a channel to its new level, `""` meaning the override was removed.
-}
type alias PendingOps =
    { addIgnored : Set String
    , delIgnored : Set String
    , addMuted : Set String
    , delMuted : Set String
    , addWords : List String
    , delWords : Set String
    , notify : Dict String String
    }


emptyOps : PendingOps
emptyOps =
    { addIgnored = Set.empty
    , delIgnored = Set.empty
    , addMuted = Set.empty
    , delMuted = Set.empty
    , addWords = []
    , delWords = Set.empty
    , notify = Dict.empty
    }


isEmptyOps : PendingOps -> Bool
isEmptyOps ops =
    ops == emptyOps


setDiff : Set String -> Set String -> ( Set String, Set String )
setDiff before after =
    ( Set.diff after before, Set.diff before after )


{-| Fold one before → after change into the pending log. A later edit
of the same name wins (add after remove cancels the remove, and so on).
-}
recordDiff : ListsSnapshot -> ListsSnapshot -> PendingOps -> PendingOps
recordDiff before after ops =
    let
        ( ignAdd, ignDel ) =
            setDiff before.ignored after.ignored

        ( muteAdd, muteDel ) =
            setDiff before.muted after.muted

        ( wordAdd, wordDel ) =
            setDiff (Set.fromList before.highlights) (Set.fromList after.highlights)

        notifyChanges =
            Dict.merge
                (\ch _ acc -> Dict.insert ch "" acc)
                (\ch old new acc ->
                    if old == new then
                        acc

                    else
                        Dict.insert ch new acc
                )
                (\ch new acc -> Dict.insert ch new acc)
                before.notify
                after.notify
                Dict.empty
    in
    mergeOps ops
        { addIgnored = ignAdd
        , delIgnored = ignDel
        , addMuted = muteAdd
        , delMuted = muteDel
        , addWords = List.filter (\w -> Set.member w wordAdd) after.highlights
        , delWords = wordDel
        , notify = notifyChanges
        }


{-| Concatenate two pending logs (the second is newer and wins). -}
mergeOps : PendingOps -> PendingOps -> PendingOps
mergeOps older newer =
    let
        newerAddWords =
            Set.fromList newer.addWords
    in
    { addIgnored = Set.union newer.addIgnored (Set.diff older.addIgnored newer.delIgnored)
    , delIgnored = Set.union newer.delIgnored (Set.diff older.delIgnored newer.addIgnored)
    , addMuted = Set.union newer.addMuted (Set.diff older.addMuted newer.delMuted)
    , delMuted = Set.union newer.delMuted (Set.diff older.delMuted newer.addMuted)
    , addWords =
        List.filter (\w -> not (Set.member w newer.delWords) && not (Set.member w newerAddWords)) older.addWords
            ++ newer.addWords
    , delWords = Set.union newer.delWords (Set.diff older.delWords newerAddWords)
    , notify = Dict.union newer.notify older.notify
    }


{-| Replay pending edits onto lists loaded from storage. -}
applyOps : PendingOps -> ListsSnapshot -> ListsSnapshot
applyOps ops lists =
    { ignored = Set.union ops.addIgnored (Set.diff lists.ignored ops.delIgnored)
    , muted = Set.union ops.addMuted (Set.diff lists.muted ops.delMuted)
    , highlights =
        List.filter (\w -> not (Set.member w ops.delWords)) lists.highlights
            ++ List.filter (\w -> not (List.member w lists.highlights)) ops.addWords
    , notify =
        Dict.foldl
            (\ch level acc ->
                if String.isEmpty level then
                    Dict.remove ch acc

                else
                    Dict.insert ch level acc
            )
            lists.notify
            ops.notify
    }



-- ATTENTION (tab title + app badge)


{-| Interrupt-worthy unread count, mirroring the oracle's
`totalUnreadMentions`: mentions in rooms plus unread direct messages.
Muted conversations and ordinary room chatter never count, so the title
and the installed-app badge stay calm.
-}
attentionCount : List { isChannel : Bool, unread : Int, highlights : Int, muted : Bool } -> Int
attentionCount rows =
    List.foldl
        (\row acc ->
            if row.muted then
                acc

            else if row.isChannel then
                acc + max 0 row.highlights

            else
                acc + max 0 row.unread
        )
        0
        rows


{-| `(N) title` while there is attention, capped at 999 like the
oracle's `formatAttentionTitle`. -}
attentionTitle : Int -> String -> String
attentionTitle count title =
    if count <= 0 then
        title

    else
        "(" ++ String.fromInt (min 999 count) ++ ") " ++ title
