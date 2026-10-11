module AttentionTest exposing (suite)

{-| v3/gap-organize — vectors for the pure attention policy: the
quiet-hours schedule (overnight wrap, zones, the stored shape the
oracle wrote), the Calm / Regular / Power presets, smart mute (whole
words, people, the stored shape) and the "Since you left" digest.

Oracle: `lib/notifications/quietHours.ts`, `calmMode.ts`,
`smartMute.ts` (+ `smartMuteMemory.ts`), `sinceDigest.ts`.
-}

import Attention exposing (Preset(..))
import Expect
import Fuzz
import Test exposing (Test, describe, fuzz, test)
import Time


quiet : Int -> Int -> Attention.QuietHours
quiet start end =
    { enabled = True, startHour = start, endHour = end }


at : Int -> Int -> Int
at hour minute =
    hour * 60 + minute


suite : Test
suite =
    describe "Attention"
        [ quietHours
        , presets
        , smartMute
        , digest
        ]


quietHours : Test
quietHours =
    describe "quiet hours"
        [ describe "window"
            [ test "an overnight window wraps midnight, half-open [start, end)" <|
                \_ ->
                    List.map (Attention.quietActiveAt (quiet 22 8))
                        [ at 21 59, at 22 0, at 23 59, at 0 0, at 7 59, at 8 0, at 12 0 ]
                        |> Expect.equal [ False, True, True, True, True, False, False ]
            , test "a same-day window is [start, end)" <|
                \_ ->
                    List.map (Attention.quietActiveAt (quiet 9 17))
                        [ at 8 59, at 9 0, at 16 59, at 17 0, at 23 0 ]
                        |> Expect.equal [ False, True, True, False, False ]
            , test "start == end never silences (an empty window fails open)" <|
                \_ ->
                    List.map (Attention.quietActiveAt (quiet 5 5)) [ at 0 0, at 5 0, at 12 0 ]
                        |> Expect.equal [ False, False, False ]
            , test "off never silences, whatever the hour" <|
                \_ ->
                    Attention.quietActiveAt { enabled = False, startHour = 0, endHour = 23 } (at 12 0)
                        |> Expect.equal False
            , test "minutes outside a day wrap" <|
                \_ ->
                    Attention.quietActiveAt (quiet 22 8) (at 23 0 + 1440) |> Expect.equal True
            ]
        , describe "local clock"
            [ test "uses the viewer's zone, not UTC" <|
                \_ ->
                    let
                        -- 03:00 UTC is 22:00 the evening before at UTC-5
                        threeUtc =
                            toFloat (3 * 3600 * 1000)

                        east =
                            Time.customZone -300 []
                    in
                    Expect.equal
                        { utc = Attention.quietActive Time.utc threeUtc (quiet 22 8)
                        , local = Attention.quietActive east threeUtc (quiet 22 8)
                        , minute = Attention.minuteOfDay east threeUtc
                        }
                        { utc = True, local = True, minute = at 22 0 }
            , test "noon UTC is awake in both zones" <|
                \_ ->
                    Attention.quietActive (Time.customZone 120 []) (toFloat (12 * 3600 * 1000)) (quiet 22 8)
                        |> Expect.equal False
            ]
        , describe "stored schedule"
            [ test "nothing stored is off, with the 22:00-08:00 suggestion" <|
                \_ ->
                    Attention.loadQuietHours { start = Nothing, end = Nothing, enabled = Nothing }
                        |> Expect.equal { enabled = False, startHour = 22, endHour = 8 }
            , test "a window the oracle wrote (start /= end, no flag) counts as on" <|
                \_ ->
                    Attention.loadQuietHours { start = Just "23", end = Just "7", enabled = Nothing }
                        |> Expect.equal { enabled = True, startHour = 23, endHour = 7 }
            , test "the oracle's equal default (0 = 0) stays off" <|
                \_ ->
                    Attention.loadQuietHours { start = Just "0", end = Just "0", enabled = Nothing }
                        |> .enabled
                        |> Expect.equal False
            , test "the flag wins and keeps the chosen hours when off" <|
                \_ ->
                    ( Attention.loadQuietHours { start = Just "23", end = Just "7", enabled = Just "false" }
                    , Attention.loadQuietHours { start = Just "23", end = Just "7", enabled = Just "true" }
                    )
                        |> Expect.equal
                            ( { enabled = False, startHour = 23, endHour = 7 }
                            , { enabled = True, startHour = 23, endHour = 7 }
                            )
            , test "an on flag over an empty window is off" <|
                \_ ->
                    Attention.loadQuietHours { start = Just "6", end = Just "6", enabled = Just "true" }
                        |> .enabled
                        |> Expect.equal False
            , test "hours that do not parse fall back to the suggestion" <|
                \_ ->
                    Attention.loadQuietHours { start = Just "25", end = Just "abc", enabled = Just "true" }
                        |> Expect.equal { enabled = True, startHour = 22, endHour = 8 }
            ]
        , describe "labels"
            [ test "12-hour and 24-hour hour labels" <|
                \_ ->
                    Expect.equal
                        [ "12 AM", "1 AM", "11 AM", "12 PM", "1 PM", "10 PM" ]
                        (List.map (Attention.hourLabel True) [ 0, 1, 11, 12, 13, 22 ])
            , test "24-hour labels pad" <|
                \_ ->
                    List.map (Attention.hourLabel False) [ 0, 8, 22 ]
                        |> Expect.equal [ "00:00", "08:00", "22:00" ]
            , test "summary and live status" <|
                \_ ->
                    let
                        nowQuiet =
                            toFloat (23 * 3600 * 1000)

                        nowAwake =
                            toFloat (12 * 3600 * 1000)
                    in
                    Expect.equal
                        [ "10 PM – 8 AM"
                        , "Off"
                        , "Quiet now — desktop and sound alerts resume at 8 AM."
                        , "Every day from 10 PM to 8 AM, alerts stay silent."
                        , "Alerts can reach you at any hour."
                        ]
                        [ Attention.quietSummary True (quiet 22 8)
                        , Attention.quietSummary True Attention.defaultQuietHours
                        , Attention.quietStatus True Time.utc nowQuiet (quiet 22 8)
                        , Attention.quietStatus True Time.utc nowAwake (quiet 22 8)
                        , Attention.quietStatus True Time.utc nowAwake Attention.defaultQuietHours
                        ]
            ]
        ]


presets : Test
presets =
    describe "notification presets"
        [ test "parse plain, legacy JSON-quoted, any case; anything else is Regular" <|
            \_ ->
                List.map Attention.parsePreset [ "calm", "\"calm\"", " POWER ", "regular", "loud", "", String.repeat 40 "calm" ]
                    |> Expect.equal [ Calm, Calm, Power, Regular, Regular, Regular, Regular ]
        , test "string form round-trips" <|
            \_ ->
                List.map (Attention.presetToString >> Attention.parsePreset) Attention.presets
                    |> Expect.equal Attention.presets
        , test "Calm: only direct messages and mentions may alert" <|
            \_ ->
                List.map (Attention.allowsAlert Calm)
                    [ { dm = True, mention = False, followed = False }
                    , { dm = False, mention = True, followed = False }
                    , { dm = False, mention = False, followed = True }
                    , { dm = False, mention = False, followed = False }
                    ]
                    |> Expect.equal [ True, True, False, False ]
        , test "Regular adds followed topics" <|
            \_ ->
                List.map (Attention.allowsAlert Regular)
                    [ { dm = False, mention = False, followed = True }
                    , { dm = False, mention = False, followed = False }
                    ]
                    |> Expect.equal [ True, False ]
        , test "Power lets everything alert" <|
            \_ ->
                Attention.allowsAlert Power { dm = False, mention = False, followed = False } |> Expect.equal True
        , test "every preset has a label and a description" <|
            \_ ->
                List.map (\p -> ( Attention.presetLabel p, String.isEmpty (Attention.presetDescription p) )) Attention.presets
                    |> Expect.equal [ ( "Calm", False ), ( "Regular", False ), ( "Power", False ) ]
        ]


smartMute : Test
smartMute =
    let
        rules =
            { keywords = [ "free nitro", "art", "c++" ], nicks = [ "deploy-bot" ], muteSystemNoise = False }

        hit text from =
            Attention.smartMuted rules { text = text, from = from }
    in
    describe "smart mute"
        [ describe "matching"
            [ test "a phrase matches in any case, anywhere in the line" <|
                \_ ->
                    hit "Get FREE nitro now!!" "spammer" |> Expect.equal True
            , test "a word matches whole words only (\"art\" is not \"party\")" <|
                \_ ->
                    List.map (\t -> hit t "x") [ "nice art!", "art", "party time", "smart move", "(art)", "start" ]
                        |> Expect.equal [ True, True, False, False, True, False ]
            , test "a term ending in punctuation only needs its start boundary" <|
                \_ ->
                    List.map (\t -> hit t "x") [ "I love c++ a lot", "xc++ is not it" ]
                        |> Expect.equal [ True, False ]
            , test "a muted person is silenced whatever they say (any case, trimmed)" <|
                \_ ->
                    List.map (\n -> hit "hello" n) [ "deploy-bot", " Deploy-Bot ", "someone" ]
                        |> Expect.equal [ True, True, False ]
            , test "no rules silence nothing" <|
                \_ ->
                    Attention.smartMuted Attention.emptySmartMute { text = "free nitro", from = "deploy-bot" }
                        |> Expect.equal False
            ]
        , describe "keyword input"
            [ test "splits on commas, semicolons and new lines; trims, lowers, dedupes" <|
                \_ ->
                    Attention.parseKeywordInput "Free Nitro, crypto;  AIRDROP\nfree nitro,, ,  two  words "
                        |> Expect.equal [ "free nitro", "crypto", "airdrop", "two words" ]
            , test "control characters drop out; over-long terms are refused" <|
                \_ ->
                    Attention.parseKeywordInput ("a\u{0007}b, " ++ String.repeat 65 "x" ++ ", ok")
                        |> Expect.equal [ "ab", "ok" ]
            , test "capped at 64 terms" <|
                \_ ->
                    List.range 1 80
                        |> List.map (\i -> "t" ++ String.fromInt i)
                        |> String.join ","
                        |> Attention.parseKeywordInput
                        |> List.length
                        |> Expect.equal Attention.maxKeywords
            ]
        , describe "stored shape"
            [ test "round-trips through encode / decode, in the oracle's key names" <|
                \_ ->
                    Attention.encodeSmartMute rules
                        |> Expect.equal (Just """{"keywords":["free nitro","art","c++"],"muteSystemNoise":false,"mutedNicks":["deploy-bot"]}""")
            , test "decode re-applies the rules (lowering, dedupe, junk dropped)" <|
                \_ ->
                    Attention.decodeSmartMute """{"keywords":["Crypto","crypto","",7,"  free   nitro "],"mutedNicks":["Bot","a b"],"muteSystemNoise":true}"""
                        |> Expect.equal { keywords = [ "crypto", "free nitro" ], nicks = [ "bot" ], muteSystemNoise = True }
            , test "nothing to keep removes the key" <|
                \_ ->
                    Attention.encodeSmartMute Attention.emptySmartMute |> Expect.equal Nothing
            , test "the system-noise flag alone is kept" <|
                \_ ->
                    Attention.encodeSmartMute { keywords = [], nicks = [], muteSystemNoise = True }
                        |> Expect.notEqual Nothing
            , test "bad JSON, wrong types and oversize values are empty rules" <|
                \_ ->
                    [ Attention.decodeSmartMute "nope"
                    , Attention.decodeSmartMute "[]"
                    , Attention.decodeSmartMute (String.repeat (16 * 1024 + 1) " ")
                    ]
                        |> Expect.equal [ Attention.emptySmartMute, Attention.emptySmartMute, Attention.emptySmartMute ]
            , test "summary counts words and people" <|
                \_ ->
                    Expect.equal
                        [ "Off", "1 word muted", "3 words · 1 person muted", "2 people muted" ]
                        [ Attention.smartMuteSummary Attention.emptySmartMute
                        , Attention.smartMuteSummary { keywords = [ "a" ], nicks = [], muteSystemNoise = False }
                        , Attention.smartMuteSummary rules
                        , Attention.smartMuteSummary { keywords = [], nicks = [ "a", "b" ], muteSystemNoise = False }
                        ]
            , fuzz Fuzz.string "decode never exceeds its caps on arbitrary text" <|
                \raw ->
                    Attention.decodeSmartMute raw
                        |> (\r -> List.length r.keywords <= Attention.maxKeywords && List.length r.nicks <= Attention.maxMutedNicks)
                        |> Expect.equal True
            , fuzz Fuzz.string "matching never throws on arbitrary lines" <|
                \line ->
                    Attention.smartMuted rules { text = line, from = line }
                        |> (\_ -> Expect.pass)
            ]
        ]


row : String -> Int -> Bool -> Maybe String -> { from : String, at : Int, highlight : Bool, text : Maybe String }
row from time highlight text =
    { from = from, at = time, highlight = highlight, text = text }


digest : Test
digest =
    let
        cfg =
            { self = "kn", maxRows = 24 }

        design =
            { name = "#design"
            , unread = 3
            , highlights = 1
            , rows =
                -- newest first, as the transcript keeps them
                [ row "mara" 3000 False (Just "release headings look tighter now")
                , row "theo" 2000 False (Just "release headings: ship them")
                , row "iris" 1000 True (Just "kn can you check the release headings?")
                ]
            }

        lounge =
            { name = "#lounge"
            , unread = 2
            , highlights = 0
            , rows = [ row "kip" 2500 False (Just "voice call works for me"), row "nova" 1500 False (Just "up for the voice call at 6?") ]
            }
    in
    describe "since you left"
        [ test "orders rooms by mentions, then count, then name; totals cover everything" <|
            \_ ->
                let
                    d =
                        Attention.buildDigest cfg [ lounge, design ]
                in
                Expect.equal
                    { names = List.map .name d.rows, total = d.total, mentions = d.mentions, rooms = d.rooms, people = d.people }
                    { names = [ "#design", "#lounge" ], total = 5, mentions = 1, rooms = 2, people = 5 }
        , test "your own lines never count as news" <|
            \_ ->
                let
                    mine =
                        { name = "#a", unread = 1, highlights = 0, rows = [ row "KN" 10 False (Just "my own line") ] }

                    d =
                        Attention.buildDigest cfg [ mine ]
                in
                -- the unread count is the server's; only people and terms skip you
                Expect.equal ( d.rooms, d.people ) ( 1, 0 )
        , test "a room with nothing unread is left out" <|
            \_ ->
                Attention.buildDigest cfg [ { name = "#quiet", unread = 0, highlights = 0, rows = [] } ]
                    |> .rooms
                    |> Expect.equal 0
        , test "who wrote (oldest first, three then +n), the span, and what about" <|
            \_ ->
                let
                    clock t =
                        String.fromInt (t // 1000) ++ "s"

                    d =
                        Attention.buildDigest cfg [ design ]
                in
                case d.rows of
                    [ r ] ->
                        Expect.equal
                            { people = r.people, more = r.morePeople, window = Attention.windowLabel clock r, terms = r.terms }
                            { people = [ "iris", "theo", "mara" ], more = 0, window = "1s–3s", terms = [ "headings", "release" ] }

                    _ ->
                        Expect.fail "expected one row"
        , test "more than three people collapse to +n" <|
            \_ ->
                let
                    crowd =
                        { name = "#busy"
                        , unread = 5
                        , highlights = 0
                        , rows = List.map (\n -> row n 100 False Nothing) [ "e", "d", "c", "b", "a" ]
                        }
                in
                Attention.buildDigest cfg [ crowd ]
                    |> .rows
                    |> List.map (\r -> ( r.people, r.morePeople ))
                    |> Expect.equal [ ( [ "a", "b", "c" ], 2 ) ]
        , test "encrypted rows count but never feed the topic terms" <|
            \_ ->
                let
                    sealed =
                        { name = "mara", unread = 2, highlights = 0, rows = [ row "mara" 5 False Nothing, row "mara" 4 False Nothing ] }
                in
                Attention.buildDigest cfg [ sealed ]
                    |> .rows
                    |> List.map (\r -> ( r.count, r.terms ))
                    |> Expect.equal [ ( 2, [] ) ]
        , test "maxRows cuts the list but not the totals" <|
            \_ ->
                Attention.buildDigest { self = "kn", maxRows = 1 } [ design, lounge ]
                    |> (\d -> ( List.length d.rows, d.rooms, d.total ))
                    |> Expect.equal ( 1, 2, 5 )
        , test "headline and span copy" <|
            \_ ->
                let
                    d =
                        Attention.buildDigest cfg [ design, lounge ]

                    clock t =
                        String.fromInt (t // 1000)
                in
                Expect.equal
                    [ "5 messages across 2 conversations · 1 mention"
                    , "All caught up"
                    , "1–3 · 5 people wrote"
                    ]
                    [ Attention.digestHeadline d
                    , Attention.digestHeadline (Attention.buildDigest cfg [])
                    , Attention.digestSpan clock d
                    ]
        , test "a row line reads who · when · what about" <|
            \_ ->
                let
                    clock t =
                        String.fromInt (t // 1000)
                in
                Attention.buildDigest cfg [ design ]
                    |> .rows
                    |> List.map (Attention.digestRowLine clock)
                    |> Expect.equal [ "iris, theo, mara · 1–3 · headings, release" ]
        ]
