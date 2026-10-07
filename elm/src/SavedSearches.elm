module SavedSearches exposing
    ( ExportSnapshot
    , SavedSearch
    , SearchInput
    , SearchMode(..)
    , StoredSearch
    , decodeSavedSearch
    , futureSkewMs
    , importScanLimit
    , isoFromMillis
    , maxIdLength
    , maxLabelLength
    , maxQueryLength
    , maxSequence
    , modeToString
    , normalizeLabel
    , parseExport
    , parseIsoMillis
    , publicRows
    , reviveStoredValue
    , safeImportedTimestamp
    , sanitizeId
    , savedSearchCap
    , scanLimit
    , sortNewestFirst
    , validSequence
    , validStoredTimestamp
    , validateSearchInput
    )

{-| Local-first saved searches — pure validation, ordering, and
portable-snapshot boundary, mirroring `lib/vault/savedSearches.ts`.
The IndexedDB sibling database (`onyx-vault-searches`), the seq/id
issuance, cross-tab sync, and the import merge walk stay ports-side
with the vault write path; this module is the shared truth for what
a row may contain and how snapshots validate.

Divergences (documented, all on hostile input only):
  - `normalizeLabel` uses Unicode default case mapping; the oracle's
    `toLocaleLowerCase` is host-locale-sensitive (e.g. Turkish dotted
    I). Labels compare equal under every other locale.
  - Imported `createdAt` strings parse the strict ISO-8601 shape the
    oracle itself writes (`toISOString`, plus numeric `±HH:MM`
    offsets). Other `Date.parse`-able forms fall back to `nowMs`;
    the oracle has a JS engine date parser we do not reimplement.
  - Missing ids consume a caller-supplied id supply (ports-side
    `ss-…` ids like the oracle's `genId`) instead of random
    generation, keeping this module pure and deterministic.
-}

import Json.Decode as Decode


{-| Max retained saved searches; oldest are pruned beyond this bound. -}
savedSearchCap : Int
savedSearchCap =
    50


{-| Reject labels/queries longer than these. -}
maxLabelLength : Int
maxLabelLength =
    120


{-| Reject labels/queries longer than these. -}
maxQueryLength : Int
maxQueryLength =
    512


{-| Opaque ids are local keys, not a place for unbounded metadata. -}
maxIdLength : Int
maxIdLength =
    128


{-| Inspect at most this many physical values during one bounded read. -}
scanLimit : Int
scanLimit =
    savedSearchCap * 4


{-| Imports inspect a bounded invalid prefix while collecting rows. -}
importScanLimit : Int
importScanLimit =
    savedSearchCap * 4


{-| Ordering metadata beyond this future skew is hostile/corrupt. -}
futureSkewMs : Float
futureSkewMs =
    24 * 60 * 60 * 1000


{-| A bounded same-millisecond tiebreaker. -}
maxSequence : Int
maxSequence =
    2147483647


{-| Which search surface a saved search drives. `semantic` is the
on-disk token; the UI describes it as related-term similarity. -}
type SearchMode
    = ExactMode
    | SemanticMode
    | HybridMode


{-| Validated user input: trimmed label/query plus a known mode. -}
type alias SearchInput =
    { label : String
    , query : String
    , mode : SearchMode
    }


{-| Public row (no ordering metadata). -}
type alias SavedSearch =
    { id : String
    , label : String
    , query : String
    , mode : SearchMode
    , createdAt : Float
    }


{-| On-disk row adds the monotonic ordering tiebreaker. -}
type alias StoredSearch =
    { id : String
    , label : String
    , query : String
    , mode : SearchMode
    , createdAt : Float
    , seq : Int
    }


{-| Portable export snapshot. -}
type alias ExportSnapshot =
    { kind : String
    , version : Int
    , exportedAt : String
    , searches : List SavedSearch
    }


modeToString : SearchMode -> String
modeToString mode =
    case mode of
        ExactMode ->
            "exact"

        SemanticMode ->
            "semantic"

        HybridMode ->
            "hybrid"


parseMode : String -> Maybe SearchMode
parseMode raw =
    case raw of
        "exact" ->
            Just ExactMode

        "semantic" ->
            Just SemanticMode

        "hybrid" ->
            Just HybridMode

        _ ->
            Nothing


{-| Case/space-insensitive dedupe key for a label. -}
normalizeLabel : String -> String
normalizeLabel label =
    String.toLower (String.trim label)


{-| Validate untrusted input at the boundary: trimmed fields, empty or
over-length label/query rejected, unknown mode rejected. The raw
pre-trim length guard (`+32`) mirrors the oracle exactly. -}
validateSearchInput : String -> String -> String -> Maybe SearchInput
validateSearchInput rawLabel rawQuery rawMode =
    if String.length rawLabel > maxLabelLength + 32 then
        Nothing

    else if String.length rawQuery > maxQueryLength + 32 then
        Nothing

    else
        let
            label =
                String.trim rawLabel

            query =
                String.trim rawQuery
        in
        if String.isEmpty label || String.length label > maxLabelLength then
            Nothing

        else if String.isEmpty query || String.length query > maxQueryLength then
            Nothing

        else
            case parseMode rawMode of
                Just mode ->
                    Just { label = label, query = query, mode = mode }

                Nothing ->
                    Nothing


isControlChar : Char -> Bool
isControlChar c =
    let
        code =
            Char.toCode c
    in
    code <= 0x1F || code == 0x7F


{-| Sanitize an opaque id: trimmed, nonempty, bounded, no control
characters. Untrimmed input is rejected (the oracle requires
`raw.id === id`), so callers must pass the raw string. -}
sanitizeId : String -> Maybe String
sanitizeId raw =
    let
        id =
            String.trim raw
    in
    if String.isEmpty raw then
        Nothing

    else if raw /= id then
        Nothing

    else if String.length id > maxIdLength then
        Nothing

    else if String.any isControlChar id then
        Nothing

    else
        Just id


{-| Stored timestamps must be finite numbers within
`[0, nowMs + futureSkewMs]`. -}
validStoredTimestamp : Float -> Float -> Bool
validStoredTimestamp value nowMs =
    not (isNaN value)
        && not (isInfinite value)
        && value
        >= 0
        && value
        <= nowMs
        + futureSkewMs


{-| A present sequence must be bounded and non-negative before it can
sort; callers map an absent sequence to the neutral tiebreaker 0. -}
validSequence : Int -> Bool
validSequence value =
    value >= 0 && value <= maxSequence


{-| Days from civil date (Hinnant's algorithm); epoch is day 0. -}
daysFromCivil : Int -> Int -> Int -> Int
daysFromCivil y m d =
    let
        yAdj =
            if m <= 2 then
                y - 1

            else
                y

        era =
            (if yAdj >= 0 then
                yAdj

             else
                yAdj - 399
            )
                // 400

        yoe =
            yAdj - era * 400

        mp =
            modBy 12 (m + 9)

        doy =
            (153 * mp + 2) // 5 + d - 1

        doe =
            yoe * 365 + yoe // 4 - yoe // 100 + doy
    in
    era * 146097 + doe - 719468


{-| Civil date from days since epoch (Hinnant's algorithm). -}
civilFromDays : Int -> { year : Int, month : Int, day : Int }
civilFromDays z =
    let
        zAdj =
            z + 719468

        era =
            (if zAdj >= 0 then
                zAdj

             else
                zAdj - 146096
            )
                // 146097

        doe =
            zAdj - era * 146097

        yoe =
            (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365

        y =
            yoe + era * 400

        doy =
            doe - (365 * yoe + yoe // 4 - yoe // 100)

        mp =
            (5 * doy + 2) // 153

        d =
            doy - (153 * mp + 2) // 5 + 1

        m =
            mp + 3 - 12 * (mp // 10)
    in
    { year =
        if m <= 2 then
            y + 1

        else
            y
    , month = m
    , day = d
    }


pad2 : Int -> String
pad2 n =
    if n < 10 then
        "0" ++ String.fromInt n

    else
        String.fromInt n


pad3 : Int -> String
pad3 n =
    if n < 10 then
        "00" ++ String.fromInt n

    else if n < 100 then
        "0" ++ String.fromInt n

    else
        String.fromInt n


padYear : Int -> String
padYear y =
    String.padLeft 4 '0' (String.fromInt y)


{-| Format epoch ms as an ISO-8601 UTC string, mirroring
`Date.toISOString` (`YYYY-MM-DDTHH:MM:SS.sssZ`). -}
isoFromMillis : Float -> String
isoFromMillis ms =
    let
        whole =
            floor (ms / 1000)

        millis =
            (floor ms - whole * 1000) |> max 0 |> min 999

        days =
            whole // 86400

        secs =
            whole - days * 86400

        date =
            civilFromDays days
    in
    padYear date.year
        ++ "-"
        ++ pad2 date.month
        ++ "-"
        ++ pad2 date.day
        ++ "T"
        ++ pad2 (secs // 3600)
        ++ ":"
        ++ pad2 (modBy 60 (secs // 60))
        ++ ":"
        ++ pad2 (modBy 60 secs)
        ++ "."
        ++ pad3 millis
        ++ "Z"


parseZoneOffset : String -> Maybe Int
parseZoneOffset zone =
    if zone == "Z" then
        Just 0

    else if String.length zone == 6 then
        let
            hh =
                String.toInt (String.slice 1 3 zone)

            mm =
                String.toInt (String.slice 4 6 zone)
        in
        case ( String.left 1 zone, hh, mm ) of
            ( "+", Just h, Just m ) ->
                if h > 23 || m > 59 then
                    Nothing

                else
                    Just (h * 3600000 + m * 60000)

            ( "-", Just h, Just m ) ->
                if h > 23 || m > 59 then
                    Nothing

                else
                    Just -(h * 3600000 + m * 60000)

            _ ->
                Nothing

    else
        Nothing


{-| Parse the strict ISO-8601 shape the oracle writes
(`YYYY-MM-DDTHH:MM:SS[.sss][Z|±HH:MM]`) to epoch ms. Anything else
is `Nothing` (the caller falls back to `nowMs`). -}
parseIsoMillis : String -> Maybe Float
parseIsoMillis s =
    if String.length s < 20 then
        Nothing

    else if String.slice 4 5 s /= "-" || String.slice 7 8 s /= "-" || String.slice 10 11 s /= "T" then
        Nothing

    else if String.slice 13 14 s /= ":" || String.slice 16 17 s /= ":" then
        Nothing

    else
        let
            year =
                String.toInt (String.slice 0 4 s)

            month =
                String.toInt (String.slice 5 7 s)

            day =
                String.toInt (String.slice 8 10 s)

            hour =
                String.toInt (String.slice 11 13 s)

            minute =
                String.toInt (String.slice 14 16 s)

            second =
                String.toInt (String.slice 17 19 s)

            rest =
                String.dropLeft 19 s

            frac =
                if String.startsWith "." rest && String.length rest >= 4 then
                    String.toInt (String.slice 1 4 rest)

                else if rest == "Z" || String.startsWith "+" rest || String.startsWith "-" rest then
                    Just 0

                else
                    Nothing

            fracLen =
                if String.startsWith "." rest then
                    4

                else
                    0

            zone =
                String.dropLeft fracLen rest
        in
        case Maybe.map3 (\y mo d -> { year = y, month = mo, day = d }) year month day of
            Just date ->
                case Maybe.map3 (\h mi se -> { hour = h, minute = mi, second = se }) hour minute second of
                    Just time ->
                        case frac of
                            Just f ->
                                if date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31 || time.hour > 23 || time.minute > 59 || time.second > 60 then
                                    Nothing

                                else
                                    case parseZoneOffset zone of
                                        Just offMs ->
                                            Just (toFloat (daysFromCivil date.year date.month date.day * 86400 + time.hour * 3600 + time.minute * 60 + time.second) * 1000 + toFloat f - toFloat offMs)

                                        Nothing ->
                                            Nothing

                            Nothing ->
                                Nothing

                    Nothing ->
                        Nothing

            Nothing ->
                Nothing


{-| Imported timestamps accept numbers or short ISO strings within
`[0, nowMs + futureSkewMs]`; anything else becomes `nowMs`
(mirrors `safeImportedTimestamp`). -}
safeImportedTimestamp : Decode.Value -> Float -> Float
safeImportedTimestamp raw nowMs =
    let
        inRange v =
            not (isNaN v)
                && not (isInfinite v)
                && v
                >= 0
                && v
                <= nowMs
                + futureSkewMs
    in
    case Decode.decodeValue Decode.float raw of
        Ok v ->
            if inRange v then
                v

            else
                nowMs

        Err _ ->
            case Decode.decodeValue Decode.string raw of
                Ok text ->
                    if String.length text > 64 then
                        nowMs

                    else
                        case parseIsoMillis text of
                            Just v ->
                                if inRange v then
                                    v

                                else
                                    nowMs

                            Nothing ->
                                nowMs

                Err _ ->
                    nowMs


{-| Revive one stored row: id must already be trimmed, input must
validate, the timestamp must be a finite in-range number, and a
present sequence must be bounded (absent reads as the neutral
tiebreaker 0, mirroring pre-sequence v1 rows). -}
reviveStoredValue : Decode.Value -> Float -> Maybe StoredSearch
reviveStoredValue raw nowMs =
    let
        opt name decoder =
            Decode.maybe (Decode.field name decoder)

        decoded =
            Decode.decodeValue
                (Decode.map5
                    (\i l q m c -> { id = i, label = l, query = q, mode = m, createdAt = c })
                    (opt "id" Decode.string)
                    (opt "label" Decode.string)
                    (opt "query" Decode.string)
                    (opt "mode" Decode.string)
                    (opt "createdAt" Decode.float)
                )
                raw

        seqPresent =
            Decode.decodeValue (Decode.field "seq" Decode.value) raw |> Result.toMaybe
    in
    case decoded of
        Ok fields ->
            case Maybe.map5 (\a b c d e -> { rawId = a, textLabel = b, textQuery = c, textMode = d, stamp = e }) fields.id fields.label fields.query fields.mode fields.createdAt of
                Just parts ->
                    case ( sanitizeId parts.rawId, validateSearchInput parts.textLabel parts.textQuery parts.textMode ) of
                        ( Just cleanId, Just input ) ->
                            if parts.rawId /= cleanId || not (validStoredTimestamp parts.stamp nowMs) then
                                Nothing

                            else
                                case seqPresent of
                                    Nothing ->
                                        Just { id = cleanId, label = input.label, query = input.query, mode = input.mode, createdAt = parts.stamp, seq = 0 }

                                    Just seqRaw ->
                                        case Decode.decodeValue Decode.int seqRaw of
                                            Ok seq ->
                                                if validSequence seq then
                                                    Just { id = cleanId, label = input.label, query = input.query, mode = input.mode, createdAt = parts.stamp, seq = seq }

                                                else
                                                    Nothing

                                            Err _ ->
                                                Nothing

                        _ ->
                            Nothing

                Nothing ->
                    Nothing

        Err _ ->
            Nothing


{-| Strict inbound port row: the same boundary as a stored row minus
the ordering tiebreaker. Anything ports-side cannot vouch for
(id, label, query, mode, timestamp) is dropped before it can reach
the visible list. -}
decodeSavedSearch : Decode.Value -> Float -> Maybe SavedSearch
decodeSavedSearch raw nowMs =
    case reviveStoredValue raw nowMs of
        Just stored ->
            Just { id = stored.id, label = stored.label, query = stored.query, mode = stored.mode, createdAt = stored.createdAt }

        Nothing ->
            Nothing


{-| Newest first: by createdAt desc, monotonic seq breaks same-ms ties. -}
sortNewestFirst : List StoredSearch -> List StoredSearch
sortNewestFirst rows =
    List.sortWith
        (\a b ->
            case compare b.createdAt a.createdAt of
                EQ ->
                    compare b.seq a.seq

                order ->
                    order
        )
        rows


{-| Public rows: newest first, deduped by normalized label, capped. -}
publicRows : List StoredSearch -> List SavedSearch
publicRows rows =
    let
        step row ( seen, acc ) =
            let
                norm =
                    normalizeLabel row.label
            in
            if List.member norm seen || List.length acc >= savedSearchCap then
                ( seen, acc )

            else
                ( norm :: seen
                , { id = row.id, label = row.label, query = row.query, mode = row.mode, createdAt = row.createdAt } :: acc
                )
    in
    List.reverse (Tuple.second (List.foldl step ( [], [] ) (sortNewestFirst rows)))


{-| Revive one imported row: invalid rows drop, missing ids consume
the caller-supplied supply (ports-side `ss-…` ids), timestamps fall
back to `nowMs`. A row whose supply is exhausted drops. -}
reviveImportedValue : Decode.Value -> Float -> List String -> Maybe ( SavedSearch, List String )
reviveImportedValue raw nowMs supply =
    let
        field name decoder =
            Decode.decodeValue (Decode.field name decoder) raw |> Result.toMaybe
    in
    case ( field "label" Decode.string, field "query" Decode.string, field "mode" Decode.string ) of
        ( Just label, Just query, Just mode ) ->
            case validateSearchInput label query mode of
                Just input ->
                    let
                        createdAt =
                            case field "createdAt" Decode.value of
                                Just stamp ->
                                    safeImportedTimestamp stamp nowMs

                                Nothing ->
                                    nowMs

                        takeId =
                            case field "id" Decode.string of
                                Just rawId ->
                                    case sanitizeId rawId of
                                        Just id ->
                                            Just ( id, supply )

                                        Nothing ->
                                            case supply of
                                                fresh :: rest ->
                                                    Just ( fresh, rest )

                                                [] ->
                                                    Nothing

                                Nothing ->
                                    case supply of
                                        fresh :: rest ->
                                            Just ( fresh, rest )

                                        [] ->
                                            Nothing
                    in
                    case takeId of
                        Just ( id, rest ) ->
                            Just ( { id = id, label = input.label, query = input.query, mode = input.mode, createdAt = createdAt }, rest )

                        Nothing ->
                            Nothing

                Nothing ->
                    Nothing

        _ ->
            Nothing


reviveAll : List Decode.Value -> Float -> List String -> List SavedSearch -> ( List SavedSearch, List String )
reviveAll raws nowMs supply acc =
    case raws of
        [] ->
            ( List.reverse acc, supply )

        raw :: rest ->
            case reviveImportedValue raw nowMs supply of
                Just ( row, remaining ) ->
                    reviveAll rest nowMs remaining (row :: acc)

                Nothing ->
                    reviveAll rest nowMs supply acc


{-| Validate untrusted JSON before it can be imported (allowlist
mode, drop invalid): kind/version gate, exportedAt repair, at most
`importScanLimit` rows inspected, at most `savedSearchCap` rows
kept. `nowMs` anchors timestamp repair; `idSupply` feeds rows that
arrive without a usable id. -}
parseExport : Decode.Value -> Float -> List String -> Maybe ExportSnapshot
parseExport raw nowMs idSupply =
    let
        field name decoder =
            Decode.decodeValue (Decode.field name decoder) raw |> Result.toMaybe
    in
    case ( field "kind" Decode.string, field "version" Decode.int, field "searches" (Decode.list Decode.value) ) of
        ( Just "onyx-saved-searches", Just 1, Just raws ) ->
            let
                exportedAt =
                    case field "exportedAt" Decode.value of
                        Just stamp ->
                            isoFromMillis (safeImportedTimestamp stamp nowMs)

                        Nothing ->
                            isoFromMillis nowMs

                ( revived, _ ) =
                    reviveAll (List.take importScanLimit raws) nowMs idSupply []
            in
            Just
                { kind = "onyx-saved-searches"
                , version = 1
                , exportedAt = exportedAt
                , searches = List.take savedSearchCap revived
                }

        _ ->
            Nothing