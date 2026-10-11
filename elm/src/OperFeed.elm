module OperFeed exposing
    ( Draft
    , Entry
    , Feed
    , Filter
    , Kind(..)
    , admitPerWindow
    , blankFilter
    , categories
    , clear
    , droppedCount
    , empty
    , filterIsActive
    , heldCount
    , isPaused
    , kindLabel
    , maxEntries
    , parseEvent
    , pause
    , push
    , resume
    , setFilter
    , severities
    , severityRank
    , visible
    , windowMs
    )

{-| v3/gap-oper — the operator's live Event Spine feed.

Until now `Spine.foldEventLine` dropped everything an operator
subscription delivers: the category planes
(`@onyx_server.io/category=FLOOD;onyx_server.io/severity=warn :srv EVENT
<oper> FLOOD …`), the OBSERVE pushes, `EVENT BROADCAST` announces and
the `AUDIT` rows. This module turns those lines into a bounded,
rate-limited, filterable feed:

  - **bounded** — never more than `maxEntries` rows are kept; the oldest
    fall off the tail.
  - **rate-limited** — a sliding `windowMs` window admits at most
    `admitPerWindow` low-severity rows; `warn` and above always pass,
    because the server never collapses those and an operator must not
    miss them. Rows turned away are counted, not stored.
  - **repeat-collapsed** — an identical row arriving within
    `repeatWindowMs` of the previous one bumps a counter instead of
    adding a line (a flood of the same notice stays one line).
  - **pausable** — pausing freezes the visible list at the newest row
    seen so far; rows keep arriving into the same bounded ring and the
    desk shows how many are waiting. Resume releases them.
  - **filterable** — by category (a set), by minimum severity and by
    text, all local and all case-insensitive; a filter never sends a
    server command.

Pure: the model owns one `Feed`, `parseEvent` is the only wire-aware
function, and it never touches `Model`.

-}

import Dict
import Set exposing (Set)
import Wire


{-| The Event Spine categories (`event_spine.zig`) plus the two
pseudo-planes this feed also carries. -}
categories : List String
categories =
    [ "CONNECT"
    , "DISCONNECT"
    , "SERVER_LINK"
    , "FLOOD"
    , "ERROR"
    , "ANNOUNCE"
    , "OPER_ACTION"
    , "KILL"
    , "SPAM"
    , "DEBUG"
    , "POLICY"
    , "SERVICE"
    , "SECURITY"
    , "OBSERVE"
    , "AUDIT"
    ]


{-| Ascending order: `debug` is the quietest, `critical` the loudest. -}
severities : List String
severities =
    [ "debug", "info", "notice", "warn", "error", "critical" ]


{-| Rank of a severity token; an unknown token ranks as `notice`
(the server's default for untagged operator events). -}
severityRank : String -> Int
severityRank severity =
    case severity of
        "debug" ->
            0

        "info" ->
            1

        "notice" ->
            2

        "warn" ->
            3

        "error" ->
            4

        "critical" ->
            5

        _ ->
            2


type Kind
    = CategoryEvent
    | ObserveEvent
    | AnnounceEvent
    | AuditEvent


kindLabel : Kind -> String
kindLabel kind =
    case kind of
        CategoryEvent ->
            "Event"

        ObserveEvent ->
            "Watch"

        AnnounceEvent ->
            "Announcement"

        AuditEvent ->
            "Audit"


{-| One parsed line, before the feed assigns it an id and a time. -}
type alias Draft =
    { category : String
    , severity : String
    , origin : String
    , text : String
    , kind : Kind
    , eventId : Maybe String
    }


type alias Entry =
    { id : Int
    , atMs : Float
    , category : String
    , severity : String
    , origin : String
    , text : String
    , kind : Kind
    , repeat : Int
    }


type alias Filter =
    { categories : Set String
    , minSeverity : String
    , text : String
    }


blankFilter : Filter
blankFilter =
    { categories = Set.empty, minSeverity = "", text = "" }


filterIsActive : Filter -> Bool
filterIsActive filter =
    not (Set.isEmpty filter.categories) || filter.minSeverity /= "" || String.trim filter.text /= ""


{-| `entries` is newest first. `pausedAt` is the id of the newest row
that was visible when the feed paused. `windowStartMs` / `windowCount`
are the rate limiter's current window; `dropped` counts rows the limiter
turned away since the last clear. `seenIds` is a short ring of recent
server event ids so a row delivered twice is stored once. -}
type alias Feed =
    { entries : List Entry
    , nextId : Int
    , pausedAt : Maybe Int
    , filter : Filter
    , windowStartMs : Float
    , windowCount : Int
    , dropped : Int
    , seenIds : List String
    }


empty : Feed
empty =
    { entries = []
    , nextId = 1
    , pausedAt = Nothing
    , filter = blankFilter
    , windowStartMs = 0
    , windowCount = 0
    , dropped = 0
    , seenIds = []
    }


maxEntries : Int
maxEntries =
    400


{-| Rate limiter: at most this many low-severity rows per `windowMs`. -}
admitPerWindow : Int
admitPerWindow =
    24


windowMs : Float
windowMs =
    1000


repeatWindowMs : Float
repeatWindowMs =
    5000


maxSeenIds : Int
maxSeenIds =
    128


maxTextLength : Int
maxTextLength =
    600



-- WIRE


{-| Fold one raw `EVENT` line into a feed draft. The MEDIA and WEBAUTHN
planes belong to other folds (`Spine.foldEventLine` re-dispatches them),
and an `EVENT` whose body names none of the operator planes is ignored,
so a non-operator subscription can never leak into the desk.

  - tagged: `@onyx_server.io/category=FLOOD;onyx_server.io/severity=warn
    :srv EVENT me FLOOD raid on #c`
  - observe: `:srv EVENT me OBSERVE connect n!u@h acct=bob`
  - audit: `:srv EVENT me AUDIT #5 root SHUN *!*@bad proof=ab12 :spam`

-}
parseEvent : Wire.IrcMessage -> Maybe Draft
parseEvent message =
    if message.command /= "EVENT" then
        Nothing

    else
        case message.params of
            _ :: bodyParams ->
                let
                    body =
                        bound (String.trim (String.join " " bodyParams))

                    first =
                        String.toUpper (Maybe.withDefault "" (List.head bodyParams))

                    origin =
                        Maybe.withDefault "" message.prefix

                    tagCategory =
                        Dict.get "onyx_server.io/category" message.tags
                            |> Maybe.map String.toUpper

                    tagSeverity =
                        Dict.get "onyx_server.io/severity" message.tags
                            |> Maybe.map String.toLower
                            |> Maybe.withDefault ""

                    eventId =
                        Dict.get "msgid" message.tags

                    categoryDraft cat =
                        { category = cat
                        , severity = normalizeSeverity tagSeverity
                        , origin = origin
                        , text = stripCategoryPrefix cat body
                        , kind =
                            if cat == "ANNOUNCE" then
                                AnnounceEvent

                            else
                                CategoryEvent
                        , eventId = eventId
                        }
                in
                if String.isEmpty body || first == "MEDIA" || first == "WEBAUTHN" then
                    Nothing

                else if first == "OBSERVE" then
                    Just
                        { category = "OBSERVE"
                        , severity = "info"
                        , origin = origin
                        , text = observeText (List.drop 1 bodyParams)
                        , kind = ObserveEvent
                        , eventId = eventId
                        }

                else if first == "AUDIT" then
                    Just
                        { category = "AUDIT"
                        , severity = "notice"
                        , origin = origin
                        , text = auditText (List.drop 1 bodyParams)
                        , kind = AuditEvent
                        , eventId = eventId
                        }

                else
                    case tagCategory of
                        Just cat ->
                            if List.member cat categories then
                                Just (categoryDraft cat)

                            else
                                Nothing

                        Nothing ->
                            -- Without message-tags the category is the body's
                            -- leading token, as the daemon writes it.
                            if List.member first categories then
                                Just (categoryDraft first)

                            else
                                Nothing

            [] ->
                Nothing


normalizeSeverity : String -> String
normalizeSeverity token =
    if List.member token severities then
        token

    else
        "notice"


{-| `FLOOD possible raid…` already sits under a FLOOD chip; the
category word would only repeat it. -}
stripCategoryPrefix : String -> String -> String
stripCategoryPrefix category body =
    let
        prefix =
            category ++ " "
    in
    if String.startsWith prefix (String.toUpper body) then
        String.trim (String.dropLeft (String.length prefix) body)

    else
        body


observeText : List String -> String
observeText params =
    case params of
        "watching" :: mask :: _ ->
            "Watching " ++ mask

        "filter" :: mask :: _ ->
            "Watch mask " ++ mask

        "present" :: subject :: rest ->
            subject ++ " is online" ++ detailSuffix rest

        action :: subject :: rest ->
            subject ++ " · " ++ action ++ detailSuffix rest

        _ ->
            String.join " " params


detailSuffix : List String -> String
detailSuffix rest =
    case List.filter (not << String.isEmpty) rest of
        [] ->
            ""

        parts ->
            " · " ++ String.join " " parts


{-| `#5 root SHUN *!*@bad proof=ab12 :spam` → `#5 root SHUN *!*@bad
(proof ab12) — spam`. -}
auditText : List String -> String
auditText params =
    case params of
        seq :: oper :: action :: target :: rest ->
            let
                ( proofs, others ) =
                    List.partition (String.startsWith "proof=") rest

                proof =
                    case proofs of
                        first :: _ ->
                            " (proof " ++ String.dropLeft 6 first ++ ")"

                        [] ->
                            ""

                reason =
                    case others of
                        [] ->
                            ""

                        _ ->
                            " — " ++ String.join " " others
            in
            seq ++ " " ++ oper ++ " " ++ action ++ " " ++ target ++ proof ++ reason

        _ ->
            String.join " " params


bound : String -> String
bound text =
    if String.length text > maxTextLength then
        String.left (maxTextLength - 1) text ++ "…"

    else
        text



-- STATE


{-| Add a row at `nowMs`. Order of checks: a repeated server event id
is ignored; a low-severity row over the rate budget is counted and
dropped; an identical recent head row (and the feed not paused) bumps
its repeat counter; otherwise the row is stored and the ring trimmed. -}
push : Float -> Draft -> Feed -> Feed
push nowMs draft feed =
    if isDuplicate draft feed then
        feed

    else
        let
            ( windowStart, windowCount ) =
                if nowMs - feed.windowStartMs >= windowMs || nowMs < feed.windowStartMs then
                    ( nowMs, 0 )

                else
                    ( feed.windowStartMs, feed.windowCount )

            loud =
                severityRank draft.severity >= severityRank "warn"
        in
        if not loud && windowCount >= admitPerWindow then
            { feed | windowStartMs = windowStart, windowCount = windowCount, dropped = feed.dropped + 1 }

        else
            let
                counted =
                    { feed
                        | windowStartMs = windowStart
                        , windowCount = windowCount + 1
                        , seenIds = rememberId draft.eventId feed.seenIds
                    }
            in
            case counted.entries of
                head :: rest ->
                    if counted.pausedAt == Nothing && sameRow head draft && nowMs - head.atMs <= repeatWindowMs then
                        { counted | entries = { head | repeat = head.repeat + 1, atMs = nowMs } :: rest }

                    else
                        store nowMs draft counted

                [] ->
                    store nowMs draft counted


store : Float -> Draft -> Feed -> Feed
store nowMs draft feed =
    let
        entry =
            { id = feed.nextId
            , atMs = nowMs
            , category = draft.category
            , severity = draft.severity
            , origin = draft.origin
            , text = draft.text
            , kind = draft.kind
            , repeat = 1
            }
    in
    { feed
        | entries = List.take maxEntries (entry :: feed.entries)
        , nextId = feed.nextId + 1
    }


sameRow : Entry -> Draft -> Bool
sameRow entry draft =
    entry.category == draft.category
        && entry.severity == draft.severity
        && entry.origin == draft.origin
        && entry.text == draft.text


isDuplicate : Draft -> Feed -> Bool
isDuplicate draft feed =
    case draft.eventId of
        Just id ->
            List.member id feed.seenIds

        Nothing ->
            False


rememberId : Maybe String -> List String -> List String
rememberId id seen =
    case id of
        Just value ->
            List.take maxSeenIds (value :: seen)

        Nothing ->
            seen


{-| Freeze the visible list at the newest row. Pausing twice keeps the
first marker. -}
pause : Feed -> Feed
pause feed =
    case feed.pausedAt of
        Just _ ->
            feed

        Nothing ->
            { feed | pausedAt = Just (feed.nextId - 1) }


resume : Feed -> Feed
resume feed =
    { feed | pausedAt = Nothing }


isPaused : Feed -> Bool
isPaused feed =
    feed.pausedAt /= Nothing


{-| Rows that arrived while paused. -}
heldCount : Feed -> Int
heldCount feed =
    case feed.pausedAt of
        Just marker ->
            List.length (List.filter (\e -> e.id > marker) feed.entries)

        Nothing ->
            0


droppedCount : Feed -> Int
droppedCount feed =
    feed.dropped


{-| Empty the list and the counters; the filter and the pause state
stay (a paused, cleared feed is still paused). -}
clear : Feed -> Feed
clear feed =
    { feed
        | entries = []
        , dropped = 0
        , seenIds = []
        , pausedAt =
            case feed.pausedAt of
                Just _ ->
                    Just (feed.nextId - 1)

                Nothing ->
                    Nothing
    }


setFilter : Filter -> Feed -> Feed
setFilter filter feed =
    { feed | filter = filter }


{-| The rows the desk shows, newest first: frozen at the pause marker
while paused, then narrowed by the filter. -}
visible : Feed -> List Entry
visible feed =
    let
        frozen =
            case feed.pausedAt of
                Just marker ->
                    List.filter (\e -> e.id <= marker) feed.entries

                Nothing ->
                    feed.entries
    in
    List.filter (matches feed.filter) frozen


matches : Filter -> Entry -> Bool
matches filter entry =
    let
        needle =
            String.toLower (String.trim filter.text)

        categoryOk =
            Set.isEmpty filter.categories || Set.member entry.category filter.categories

        severityOk =
            filter.minSeverity == "" || severityRank entry.severity >= severityRank filter.minSeverity

        textOk =
            needle
                == ""
                || String.contains needle
                    (String.toLower (String.join " " [ entry.category, entry.severity, entry.origin, entry.text ]))
    in
    categoryOk && severityOk && textOk
