module TranscriptRows exposing
    ( Away
    , JumpPill
    , RowEnv
    , RowFlags
    , RowView
    , awayAfterReport
    , flagsFromBits
    , flagsToBits
    , isContinuation
    , isSystemType
    , jumpPill
    , needsRichRow
    , rowKey
    , rowViews
    , scrollKey
    )

{-| v3/transcript — the pure half of the transcript engine (roadmap
2.0 / 2.0b).

  - **Row view-model.** `rowViews` derives one `RowView` per rendered
    row: a stable `Html.Keyed` key (server msgid, falling back to the
    local row id, de-duplicated), plus every per-row flag the row view
    reads (continuation, self, density, search-current, delivery
    uncertainty, thread parent, menu trigger, day / unread dividers).
    The view hands the flags to `Html.Lazy` as one `Int` (`flagsToBits`)
    because laziness compares arguments by reference: a freshly built
    record never matches, a primitive always does.
  - **Density.** Compact rows never group (every IRC line carries its
    nick) and drop the avatar; Default groups like the oracle
    `sameAuthorGroup`.
  - **Jump to latest.** `awayAfterReport` folds `scrollState` reports
    from the `scrollPolicy` bridge; `jumpPill` derives the pill
    (oracle copy from `src/shell/MessageView.tsx`).

Rows are generic extensible records so this module never imports
`App`.

-}

import Prefs
import Set exposing (Set)


{-| The fields of a chat row this module reads.
-}
type alias RowMessage a =
    { a
        | id : Int
        , msgid : Maybe String
        , from : String
        , at : Int
        , msgType : String
    }


{-| Inputs that are constant across one render of the transcript.
`uncertain` / `menuButton` are model-derived predicates supplied by
the view (outbox uncertainty, message-menu capability gate).
-}
type alias RowEnv m =
    { selfNick : String
    , density : Prefs.TranscriptDensity
    , searchCurrentId : Maybe Int
    , unreadDividerId : Maybe Int
    , threadParents : Set Int
    , uncertain : m -> Bool
    , menuButton : m -> Bool
    }


{-| The per-row booleans a row view reads (all of them fit in one
`Int` so `Html.Lazy` can compare them by value).
-}
type alias RowFlags =
    { continuation : Bool
    , self : Bool
    , compact : Bool
    , searchCurrent : Bool
    , uncertain : Bool
    , hasThread : Bool
    , menuButton : Bool
    }


type alias RowView =
    { key : String
    , system : Bool
    , flags : RowFlags
    , dayLabel : Maybe String
    , unreadAbove : Bool
    }


{-| System event rows (mirroring `isSystemMsg`).
-}
isSystemType : String -> Bool
isSystemType msgType =
    List.member msgType [ "join", "part", "quit", "kick", "mode", "topic", "nick", "system", "error" ]


{-| Continuation grouping (mirroring `sameAuthorGroup`: same author,
neither row systemic, within five minutes).
-}
isContinuation : RowMessage a -> RowMessage a -> Bool
isContinuation prev m =
    prev.from == m.from && not (isSystemType prev.msgType) && not (isSystemType m.msgType) && abs (m.at - prev.at) < 5 * 60 * 1000


{-| Stable key for `Html.Keyed`: the server msgid when present,
otherwise the local row id.
-}
rowKey : RowMessage a -> String
rowKey m =
    case Maybe.map String.trim m.msgid of
        Just msgid ->
            if String.isEmpty msgid then
                "r:" ++ String.fromInt m.id

            else
                "m:" ++ msgid

        Nothing ->
            "r:" ++ String.fromInt m.id


{-| Derive the row view-models for the rendered slice (chronological,
oldest first). `dayLabels` pairs 1:1 with `rows` (missing labels read
as none). Duplicate keys (a msgid seen twice) get the local id
appended so the keyed list never holds two equal keys.
-}
rowViews : RowEnv (RowMessage a) -> List (Maybe String) -> List (RowMessage a) -> List RowView
rowViews env dayLabels rows =
    let
        compact =
            env.density == Prefs.TranscriptCompact

        labels =
            dayLabels ++ List.repeat (max 0 (List.length rows - List.length dayLabels)) Nothing

        step ( m, label ) ( prev, seen, acc ) =
            let
                base =
                    rowKey m

                key =
                    if Set.member base seen then
                        base ++ "#" ++ String.fromInt m.id

                    else
                        base

                cont =
                    not compact
                        && (case prev of
                                Just p ->
                                    isContinuation p m

                                Nothing ->
                                    False
                           )

                view =
                    { key = key
                    , system = isSystemType m.msgType
                    , flags =
                        { continuation = cont
                        , self = m.from == env.selfNick
                        , compact = compact
                        , searchCurrent = env.searchCurrentId == Just m.id
                        , uncertain = env.uncertain m
                        , hasThread = Set.member m.id env.threadParents
                        , menuButton = env.menuButton m
                        }
                    , dayLabel = label
                    , unreadAbove = env.unreadDividerId == Just m.id
                    }
            in
            ( Just m, Set.insert key seen, view :: acc )

        ( _, _, out ) =
            List.foldl step ( Nothing, Set.empty, [] ) (List.map2 Tuple.pair rows labels)
    in
    List.reverse out


bitList : RowFlags -> List Bool
bitList f =
    [ f.continuation, f.self, f.compact, f.searchCurrent, f.uncertain, f.hasThread, f.menuButton ]


{-| Pack the flags into one `Int` (bit 0 = continuation … bit 6 =
menuButton).
-}
flagsToBits : RowFlags -> Int
flagsToBits f =
    List.foldr
        (\b acc ->
            acc
                * 2
                + (if b then
                    1

                   else
                    0
                  )
        )
        0
        (bitList f)


flagsFromBits : Int -> RowFlags
flagsFromBits bits =
    let
        bit n =
            modBy 2 (bits // (2 ^ n)) == 1
    in
    { continuation = bit 0
    , self = bit 1
    , compact = bit 2
    , searchCurrent = bit 3
    , uncertain = bit 4
    , hasThread = bit 5
    , menuButton = bit 6
    }


{-| Rows whose body reads model state beyond the lazy arguments (link
previews, inline media, attachment cards) or that carry an open menu /
picker render eagerly; everything else is a lazy row. A superset
check: any `http` (case-insensitive) or `[file` marker opts out.
-}
needsRichRow : { body : String, menuOpen : Bool } -> Bool
needsRichRow { body, menuOpen } =
    let
        lower =
            String.toLower body
    in
    menuOpen || String.contains "http" lower || String.contains "[file" lower || String.contains "[onyx:block]" lower -- v3/gap-import: structured cards read model state


{-| Scroll-bridge key for a conversation (lowercased name, mirroring
the `channels` dict keys).
-}
scrollKey : String -> String
scrollKey name =
    String.toLower name


{-| Scrolled-away state: which conversation, and the newest row time
seen while pinned (rows newer than this count as "new below").
-}
type alias Away =
    { key : String
    , seenAt : Int
    }


{-| Fold one `scrollState` report. Back at the bottom clears; leaving
the bottom records the newest row time once (the baseline is kept
while the reader stays away, like the oracle `lastSeenCount`).
-}
awayAfterReport : { key : String, atBottom : Bool } -> Int -> Maybe Away -> Maybe Away
awayAfterReport report latestAt current =
    if report.atBottom then
        Nothing

    else
        case current of
            Just away ->
                if away.key == report.key then
                    current

                else
                    Just { key = report.key, seenAt = latestAt }

            Nothing ->
                Just { key = report.key, seenAt = latestAt }


type alias JumpPill =
    { unreadBelow : Int
    , label : String
    }


{-| The "Jump to latest" pill for the active conversation (oracle
copy). Hidden at the bottom, for another conversation's report, and
while a historical page hides newer rows (the existing "Back to
latest" control owns that case). Rows newer than the baseline count
as new.
-}
jumpPill : { activeKey : String, hiddenAfter : Int, rowTimes : List Int } -> Maybe Away -> Maybe JumpPill
jumpPill { activeKey, hiddenAfter, rowTimes } away =
    case away of
        Nothing ->
            Nothing

        Just a ->
            if a.key /= activeKey || hiddenAfter > 0 then
                Nothing

            else
                let
                    unread =
                        List.length (List.filter (\at -> at > a.seenAt) rowTimes)
                in
                Just
                    { unreadBelow = unread
                    , label =
                        if unread > 0 then
                            String.fromInt unread
                                ++ " new message"
                                ++ (if unread == 1 then
                                        ""

                                    else
                                        "s"
                                   )
                                ++ " below — jump to latest"

                        else
                            "Jump to latest messages"
                    }
