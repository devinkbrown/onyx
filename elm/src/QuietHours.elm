module QuietHours exposing
    ( Schedule
    , applyHours
    , formatQuietHour
    , isMinuteWithinWindow
    , isQuietHoursActive
    , localMinuteOfDay
    , minutesPerDay
    , quietHoursSummary
    )

{-| Standing quiet-hours window. Port of `src/lib/notifications/quietHours.ts`
plus the hour gate in `setDndQuietHours` (`src/lib/store/store.ts`).

Minutes are since local midnight. `start == end` is an empty window and
never silences. Overnight windows (`start > end`) wrap past midnight.
The caller supplies the local minute (`localMinuteOfDay`) so tests do not
need a timezone.
-}

import Time


type alias Schedule =
    { enabled : Bool
    , startMinute : Int
    , endMinute : Int
    }


minutesPerDay : Int
minutesPerDay =
    1440


{-| Positive modulo into `0 .. minutesPerDay - 1` (`modBy` matches the
oracle `((n % 1440) + 1440) % 1440`). -}
wrapMinute : Int -> Int
wrapMinute minute =
    modBy minutesPerDay minute


isMinuteWithinWindow : Int -> Int -> Int -> Bool
isMinuteWithinWindow minuteOfDay startMinute endMinute =
    let
        now =
            wrapMinute minuteOfDay

        start =
            wrapMinute startMinute

        end =
            wrapMinute endMinute
    in
    if start == end then
        False

    else if start < end then
        now >= start && now < end

    else
        now >= start || now < end


isQuietHoursActive : Schedule -> Int -> Bool
isQuietHoursActive schedule minuteOfDay =
    if not schedule.enabled then
        False

    else
        isMinuteWithinWindow minuteOfDay schedule.startMinute schedule.endMinute


localMinuteOfDay : Time.Zone -> Time.Posix -> Int
localMinuteOfDay zone posix =
    Time.toHour zone posix * 60 + Time.toMinute zone posix


isQuietHour : Int -> Bool
isQuietHour hour =
    hour >= 0 && hour <= 23


{-| Keep a prior hour when the next one is outside 0..23 (oracle
`setDndQuietHours` rejects non-integers and out-of-range fields per side). -}
applyHours : Int -> Int -> Int -> Int -> { start : Int, end : Int }
applyHours priorStart priorEnd nextStart nextEnd =
    { start =
        if isQuietHour nextStart then
            nextStart

        else
            priorStart
    , end =
        if isQuietHour nextEnd then
            nextEnd

        else
            priorEnd
    }


formatQuietHour : Int -> String
formatQuietHour hour =
    if hour == 0 then
        "12:00 AM"

    else if hour == 12 then
        "12:00 PM"

    else if hour > 0 && hour < 12 then
        String.fromInt hour ++ ":00 AM"

    else if hour > 12 && hour <= 23 then
        String.fromInt (hour - 12) ++ ":00 PM"

    else
        String.fromInt hour ++ ":00"


quietHoursSummary : Int -> Int -> String
quietHoursSummary start end =
    if start == end then
        "quiet hours off"

    else
        "quiet hours " ++ formatQuietHour start ++ " to " ++ formatQuietHour end
