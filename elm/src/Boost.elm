module Boost exposing
    ( JumpPreset
    , dateTimeAtUtc
    , formatUtcDate
    , formatUtcTime
    , jumpPresets
    , utcDateDaysAgo
    )

{-| Boost bar + jump-to-date pure layer (slice `boost`, roadmap 2.5 + 2.6).

Mirrors the date helpers in `src/shell/JumpToDateSheet.tsx`
(`formatUtcDate`, `formatUtcTime`, `dateTimeAtUtc`, `utcDateDaysAgo`,
`JUMP_DATE_PRESETS`) so the sheet resolves the same UTC moments the
oracle `travelTo` receives. All math is UTC civil-date arithmetic
(Hinnant's algorithms, also used by `SavedSearches`); no local zone
is ever consulted. Millisecond epochs stay `Float` (`floor` keeps
full double precision — never `truncate` or `(//)` on large values).

-}


{-| Quick-date preset (mirrors `JumpPreset`: days before UTC today). -}
type alias JumpPreset =
    { id : String
    , label : String
    , daysAgo : Int
    }


{-| Preset row (mirrors `JUMP_DATE_PRESETS`). -}
jumpPresets : List JumpPreset
jumpPresets =
    [ { id = "today", label = "Today", daysAgo = 0 }
    , { id = "yesterday", label = "Yesterday", daysAgo = 1 }
    , { id = "week", label = "7 days ago", daysAgo = 7 }
    ]


pad2 : Int -> String
pad2 n =
    if n < 10 then
        "0" ++ String.fromInt n

    else
        String.fromInt n


pad4 : Int -> String
pad4 n =
    if n < 10 then
        "000" ++ String.fromInt n

    else if n < 100 then
        "00" ++ String.fromInt n

    else if n < 1000 then
        "0" ++ String.fromInt n

    else
        String.fromInt n


{-| Days since the Unix epoch from a civil date (Hinnant's algorithm). -}
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


{-| Civil date from days since the Unix epoch (Hinnant's algorithm). -}
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


{-| Whole UTC days since the epoch for an ms instant. -}
dayIndex : Float -> Int
dayIndex ms =
    floor (ms / 86400000)


{-| Seconds within the UTC day for an ms instant. -}
secsOfDay : Float -> Int
secsOfDay ms =
    modBy 86400 (floor (ms / 1000))


{-| Format an ms instant as `YYYY-MM-DD` in UTC (mirrors `formatUtcDate`). -}
formatUtcDate : Float -> String
formatUtcDate ms =
    let
        civil =
            civilFromDays (dayIndex ms)
    in
    pad4 civil.year ++ "-" ++ pad2 civil.month ++ "-" ++ pad2 civil.day


{-| Format an ms instant as `HH:mm` in UTC (mirrors `formatUtcTime`). -}
formatUtcTime : Float -> String
formatUtcTime ms =
    let
        secs =
            secsOfDay ms
    in
    pad2 (secs // 3600) ++ ":" ++ pad2 (modBy 60 (secs // 60))


isAsciiDigit : Char -> Bool
isAsciiDigit c =
    c >= '0' && c <= '9'


digitPair : String -> Maybe Int
digitPair raw =
    case String.toList raw of
        [ a, b ] ->
            if isAsciiDigit a && isAsciiDigit b then
                String.toInt raw

            else
                Nothing

        _ ->
            Nothing


digitQuad : String -> Maybe Int
digitQuad raw =
    case String.toList raw of
        [ a, b, c, d ] ->
            if isAsciiDigit a && isAsciiDigit b && isAsciiDigit c && isAsciiDigit d then
                String.toInt raw

            else
                Nothing

        _ ->
            Nothing


{-| Parse the `YYYY-MM-DD` date field (mirrors `DATE_RE`). -}
parseDateField : String -> Maybe { year : Int, month : Int, day : Int }
parseDateField raw =
    case String.split "-" raw of
        [ ys, ms, ds ] ->
            case ( digitQuad ys, digitPair ms, digitPair ds ) of
                ( Just year, Just month, Just day ) ->
                    if String.length raw == 10 && month >= 1 && month <= 12 && day >= 1 && day <= 31 then
                        Just { year = year, month = month, day = day }

                    else
                        Nothing

                _ ->
                    Nothing

        _ ->
            Nothing


{-| Parse the `HH:mm` time field (mirrors `TIME_RE` over the trimmed
value; a blank field defaults to noon like the oracle). -}
parseTimeField : String -> Maybe { hour : Int, minute : Int }
parseTimeField raw =
    let
        trimmed =
            String.trim raw
    in
    if String.isEmpty trimmed then
        Just { hour = 12, minute = 0 }

    else
        case String.split ":" trimmed of
            [ hs, mins ] ->
                case ( digitPair hs, digitPair mins ) of
                    ( Just hour, Just minute ) ->
                        if String.length trimmed == 5 && hour <= 23 && minute <= 59 then
                            Just { hour = hour, minute = minute }

                        else
                            Nothing

                    _ ->
                        Nothing

            _ ->
                Nothing


{-| Build a UTC ms instant from date (`YYYY-MM-DD`) + time (`HH:mm`)
strings (mirrors `dateTimeAtUtc`). Invalid calendar days (e.g.
`2026-02-31`) and bad times return `Nothing`; the round-trip through
`daysFromCivil`/`civilFromDays` rejects the overflow exactly like the
oracle `Date.UTC` field check. -}
dateTimeAtUtc : String -> String -> Maybe Float
dateTimeAtUtc dateValue timeValue =
    case ( parseDateField dateValue, parseTimeField timeValue ) of
        ( Just date, Just time ) ->
            let
                days =
                    daysFromCivil date.year date.month date.day

                roundTrip =
                    civilFromDays days
            in
            if roundTrip.year /= date.year || roundTrip.month /= date.month || roundTrip.day /= date.day then
                Nothing

            else
                Just (toFloat (days * 86400 + time.hour * 3600 + time.minute * 60) * 1000)

        _ ->
            Nothing


{-| UTC midnight `YYYY-MM-DD` for `daysAgo` days before the reference
instant (mirrors `utcDateDaysAgo`: negative counts clamp to today). -}
utcDateDaysAgo : Int -> Float -> String
utcDateDaysAgo daysAgo nowMs =
    let
        safeDays =
            max 0 daysAgo

        midnightDays =
            dayIndex nowMs - safeDays

        civil =
            civilFromDays midnightDays
    in
    pad4 civil.year ++ "-" ++ pad2 civil.month ++ "-" ++ pad2 civil.day
