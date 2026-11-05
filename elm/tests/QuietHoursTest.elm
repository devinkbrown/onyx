module QuietHoursTest exposing (suite)

import Expect
import QuietHours exposing (applyHours, formatQuietHour, isQuietHoursActive, quietHoursSummary)
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "quiet hours"
        [ test "default overnight window covers 23:00 and not noon" <|
            \_ ->
                let
                    schedule =
                        { enabled = True, startMinute = 22 * 60, endMinute = 8 * 60 }
                in
                Expect.all
                    [ \_ -> Expect.equal True (isQuietHoursActive schedule (23 * 60))
                    , \_ -> Expect.equal False (isQuietHoursActive schedule (12 * 60))
                    ]
                    ()
        , test "a disabled schedule never silences" <|
            \_ ->
                Expect.equal False
                    (isQuietHoursActive { enabled = False, startMinute = 22 * 60, endMinute = 8 * 60 } (23 * 60))
        , test "equal hours are an empty window" <|
            \_ ->
                Expect.equal False
                    (isQuietHoursActive { enabled = True, startMinute = 22 * 60, endMinute = 22 * 60 } (23 * 60))
        , test "out-of-range hours keep the previous field" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal { start = 21, end = 9 } (applyHours 21 7 99 9)
                    , \_ -> Expect.equal { start = 20, end = 8 } (applyHours 21 7 20 8)
                    , \_ -> Expect.equal { start = 22, end = 8 } (applyHours 22 8 -1 30)
                    ]
                    ()
        , test "same-day window is half-open" <|
            \_ ->
                let
                    schedule =
                        { enabled = True, startMinute = 9 * 60, endMinute = 17 * 60 }
                in
                Expect.all
                    [ \_ -> Expect.equal True (isQuietHoursActive schedule (9 * 60))
                    , \_ -> Expect.equal True (isQuietHoursActive schedule (16 * 60 + 59))
                    , \_ -> Expect.equal False (isQuietHoursActive schedule (17 * 60))
                    ]
                    ()
        , test "summary copy matches the notify control" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "quiet hours 10:00 PM to 8:00 AM" (quietHoursSummary 22 8)
                    , \_ -> Expect.equal "quiet hours off" (quietHoursSummary 22 22)
                    , \_ -> Expect.equal "12:00 AM" (formatQuietHour 0)
                    , \_ -> Expect.equal "12:00 PM" (formatQuietHour 12)
                    ]
                    ()
        ]
