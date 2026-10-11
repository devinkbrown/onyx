module Attention exposing
    ( Digest
    , DigestInput
    , DigestRow
    , Preset(..)
    , QuietHours
    , Signal
    , SmartMute
    , allowsAlert
    , buildDigest
    , decodeSmartMute
    , defaultQuietHours
    , digestHeadline
    , digestRowLine
    , digestSpan
    , emptySmartMute
    , encodeSmartMute
    , hourLabel
    , loadQuietHours
    , maxKeywordLength
    , maxKeywords
    , maxMutedNicks
    , minuteOfDay
    , parseKeywordInput
    , parsePreset
    , presetDescription
    , presetLabel
    , presetToString
    , presets
    , quietActive
    , quietActiveAt
    , quietEnabledKey
    , quietEndKey
    , quietStartKey
    , quietStatus
    , quietSummary
    , calmKey
    , smartMuteKey
    , smartMuteSummary
    , smartMuted
    , windowLabel
    )

{-| v3/gap-organize — pure attention policy: the quiet-hours schedule,
the Calm / Regular / Power notification presets, smart mute, and the
"Since you left" catch-up digest.

Oracle: `lib/notifications/quietHours.ts` (+ the store's
`dndQuietStart` / `dndQuietEnd`), `calmMode.ts`, `smartMute.ts` +
`smartMuteMemory.ts`, `sinceDigest.ts` and `awayDigest.ts`.

Decisions (recorded in COVERAGE):

  - Quiet hours default OFF. The oracle meant 22:00–08:00 but its loader
    read a missing key as hour 0 (`Number(null)`), so every fresh
    install actually ran with quiet hours off. A stored window from the
    oracle (`onyx:dnd-quiet-start` ≠ `onyx:dnd-quiet-end`) still turns
    on; turning quiet hours on offers 22:00–08:00. A separate
    `onyx:dnd-quiet-enabled` flag lets the switch keep the chosen hours.
  - Power is a real tier here: any room message (outside muted rooms)
    may alert while you are away. The oracle's Power never differed
    from Regular because only mentions, DMs and follows reached it.
  - Smart mute matches whole words and phrases, not raw substrings
    ("art" no longer silences "party").
  - The digest skips your own lines and uses the live unread boundary.

-}

import Dict exposing (Dict)
import Json.Decode as Decode
import Json.Encode as Encode
import Set
import Time



-- QUIET HOURS


quietStartKey : String
quietStartKey =
    "onyx:dnd-quiet-start"


quietEndKey : String
quietEndKey =
    "onyx:dnd-quiet-end"


quietEnabledKey : String
quietEnabledKey =
    "onyx:dnd-quiet-enabled"


{-| A daily window in whole local hours, half-open `[start, end)`.
`start > end` wraps past midnight; `start == end` never silences. -}
type alias QuietHours =
    { enabled : Bool
    , startHour : Int
    , endHour : Int
    }


defaultQuietHours : QuietHours
defaultQuietHours =
    { enabled = False, startHour = 22, endHour = 8 }


parseHour : Maybe String -> Maybe Int
parseHour raw =
    raw
        |> Maybe.map String.trim
        |> Maybe.andThen String.toInt
        |> Maybe.andThen
            (\h ->
                if h >= 0 && h <= 23 then
                    Just h

                else
                    Nothing
            )


{-| Read the stored schedule. Hours that do not parse fall back to the
22–08 suggestion; with no explicit flag, an oracle-set window (start ≠
end) counts as on, and nothing stored counts as off. -}
loadQuietHours : { start : Maybe String, end : Maybe String, enabled : Maybe String } -> QuietHours
loadQuietHours raw =
    let
        start =
            parseHour raw.start

        end =
            parseHour raw.end

        startHour =
            Maybe.withDefault defaultQuietHours.startHour start

        endHour =
            Maybe.withDefault defaultQuietHours.endHour end

        enabled =
            case Maybe.map String.trim raw.enabled of
                Just "true" ->
                    True

                Just "false" ->
                    False

                _ ->
                    case ( start, end ) of
                        ( Just s, Just e ) ->
                            s /= e

                        _ ->
                            False
    in
    { enabled = enabled && startHour /= endHour, startHour = startHour, endHour = endHour }


minuteOfDay : Time.Zone -> Float -> Int
minuteOfDay zone nowMs =
    let
        posix =
            Time.millisToPosix (round nowMs)
    in
    Time.toHour zone posix * 60 + Time.toMinute zone posix


{-| Is minute-of-day `minute` inside the window? -}
quietActiveAt : QuietHours -> Int -> Bool
quietActiveAt quiet minute =
    let
        start =
            quiet.startHour * 60

        end =
            quiet.endHour * 60

        m =
            modBy 1440 minute
    in
    if not quiet.enabled || start == end then
        False

    else if start < end then
        m >= start && m < end

    else
        m >= start || m < end


quietActive : Time.Zone -> Float -> QuietHours -> Bool
quietActive zone nowMs quiet =
    quietActiveAt quiet (minuteOfDay zone nowMs)


{-| "10 PM", "22:00" — the clock preference decides. -}
hourLabel : Bool -> Int -> String
hourLabel twelveHour hour =
    let
        h =
            modBy 24 hour
    in
    if twelveHour then
        let
            base =
                modBy 12 h
        in
        String.fromInt
            (if base == 0 then
                12

             else
                base
            )
            ++ (if h < 12 then
                    " AM"

                else
                    " PM"
               )

    else
        String.padLeft 2 '0' (String.fromInt h) ++ ":00"


quietSummary : Bool -> QuietHours -> String
quietSummary twelveHour quiet =
    if not quiet.enabled || quiet.startHour == quiet.endHour then
        "Off"

    else
        hourLabel twelveHour quiet.startHour ++ " – " ++ hourLabel twelveHour quiet.endHour


{-| The live line under the switch. -}
quietStatus : Bool -> Time.Zone -> Float -> QuietHours -> String
quietStatus twelveHour zone nowMs quiet =
    if not quiet.enabled || quiet.startHour == quiet.endHour then
        "Alerts can reach you at any hour."

    else if quietActive zone nowMs quiet then
        "Quiet now — desktop and sound alerts resume at " ++ hourLabel twelveHour quiet.endHour ++ "."

    else
        "Every day from " ++ hourLabel twelveHour quiet.startHour ++ " to " ++ hourLabel twelveHour quiet.endHour ++ ", alerts stay silent."



-- NOTIFICATION PRESETS


calmKey : String
calmKey =
    "onyx:calm"


type Preset
    = Calm
    | Regular
    | Power


presets : List Preset
presets =
    [ Calm, Regular, Power ]


presetToString : Preset -> String
presetToString preset =
    case preset of
        Calm ->
            "calm"

        Regular ->
            "regular"

        Power ->
            "power"


{-| Plain or legacy JSON-quoted; anything odd (or over 32 characters)
is Regular. -}
parsePreset : String -> Preset
parsePreset raw =
    let
        trimmed =
            String.trim raw

        bare =
            if String.length trimmed > 32 then
                ""

            else if String.startsWith "\"" trimmed && String.endsWith "\"" trimmed && String.length trimmed >= 2 then
                String.slice 1 -1 trimmed

            else
                trimmed
    in
    case String.toLower bare of
        "calm" ->
            Calm

        "power" ->
            Power

        _ ->
            Regular


presetLabel : Preset -> String
presetLabel preset =
    case preset of
        Calm ->
            "Calm"

        Regular ->
            "Regular"

        Power ->
            "Power"


presetDescription : Preset -> String
presetDescription preset =
    case preset of
        Calm ->
            "Only mentions and direct messages reach you."

        Regular ->
            "Mentions, direct messages and followed topics notify. The rest waits."

        Power ->
            "Every message in rooms you haven't muted can notify you."


type alias Signal =
    { dm : Bool
    , mention : Bool
    , followed : Bool
    }


{-| May this delivery raise a desktop / sound alert under the preset?
(Unread badges are never gated.) -}
allowsAlert : Preset -> Signal -> Bool
allowsAlert preset signal =
    case preset of
        Calm ->
            signal.dm || signal.mention

        Regular ->
            signal.dm || signal.mention || signal.followed

        Power ->
            True



-- SMART MUTE


smartMuteKey : String
smartMuteKey =
    "onyx:smart-mute"


type alias SmartMute =
    { keywords : List String
    , nicks : List String
    , muteSystemNoise : Bool
    }


emptySmartMute : SmartMute
emptySmartMute =
    { keywords = [], nicks = [], muteSystemNoise = False }


maxKeywords : Int
maxKeywords =
    64


maxKeywordLength : Int
maxKeywordLength =
    64


maxMutedNicks : Int
maxMutedNicks =
    256


isControl : Char -> Bool
isControl c =
    Char.toCode c < 0x20 || Char.toCode c == 0x7F


cleanTerm : String -> Maybe String
cleanTerm raw =
    let
        term =
            raw
                |> String.filter (not << isControl)
                |> String.words
                |> String.join " "
                |> String.toLower
    in
    if String.isEmpty term || String.length term > maxKeywordLength then
        Nothing

    else
        Just term


dedupeTake : Int -> List String -> List String
dedupeTake cap items =
    List.foldl
        (\item ( seen, acc ) ->
            if Set.member item seen || List.length acc >= cap then
                ( seen, acc )

            else
                ( Set.insert item seen, acc ++ [ item ] )
        )
        ( Set.empty, [] )
        items
        |> Tuple.second


{-| Split a typed list on commas, semicolons or new lines; trim,
lower, drop blanks / control characters / over-long terms, dedupe,
cap at 64. -}
parseKeywordInput : String -> List String
parseKeywordInput raw =
    raw
        |> String.replace ";" ","
        |> String.replace "\n" ","
        |> String.split ","
        |> List.filterMap cleanTerm
        |> dedupeTake maxKeywords


cleanNick : String -> Maybe String
cleanNick raw =
    let
        nick =
            String.toLower (String.trim raw)
    in
    if String.isEmpty nick || String.length nick > 64 || String.any (\c -> isControl c || c == ' ') nick then
        Nothing

    else
        Just nick


decodeSmartMute : String -> SmartMute
decodeSmartMute raw =
    if String.length raw > 16 * 1024 then
        emptySmartMute

    else
        let
            strings =
                Decode.list (Decode.oneOf [ Decode.string, Decode.succeed "" ])

            decoder =
                Decode.map3 SmartMute
                    (Decode.oneOf [ Decode.field "keywords" strings, Decode.succeed [] ])
                    (Decode.oneOf [ Decode.field "mutedNicks" strings, Decode.succeed [] ])
                    (Decode.oneOf [ Decode.field "muteSystemNoise" Decode.bool, Decode.succeed False ])
        in
        case Decode.decodeString decoder raw of
            Ok rules ->
                { keywords = rules.keywords |> List.filterMap cleanTerm |> dedupeTake maxKeywords
                , nicks = rules.nicks |> List.filterMap cleanNick |> dedupeTake maxMutedNicks
                , muteSystemNoise = rules.muteSystemNoise
                }

            Err _ ->
                emptySmartMute


{-| Nothing to keep removes the key. -}
encodeSmartMute : SmartMute -> Maybe String
encodeSmartMute rules =
    if List.isEmpty rules.keywords && List.isEmpty rules.nicks && not rules.muteSystemNoise then
        Nothing

    else
        Just
            (Encode.encode 0
                (Encode.object
                    [ ( "keywords", Encode.list Encode.string rules.keywords )
                    , ( "muteSystemNoise", Encode.bool rules.muteSystemNoise )
                    , ( "mutedNicks", Encode.list Encode.string rules.nicks )
                    ]
                )
            )


isWordChar : Char -> Bool
isWordChar c =
    Char.isAlphaNum c || c == '_' || Char.toCode c > 0x7F


{-| Whole-word / whole-phrase containment, case-insensitive. -}
containsTerm : String -> String -> Bool
containsTerm haystack term =
    let
        hay =
            String.toLower haystack

        needle =
            String.toLower term

        len =
            String.length needle

        boundaryOk index =
            let
                before =
                    String.slice (index - 1) index hay |> String.toList |> List.head

                after =
                    String.slice (index + len) (index + len + 1) hay |> String.toList |> List.head

                edgeOk ch =
                    case ch of
                        Nothing ->
                            True

                        Just c ->
                            not (isWordChar c)

                startsWord =
                    String.left 1 needle |> String.toList |> List.all isWordChar

                endsWord =
                    String.right 1 needle |> String.toList |> List.all isWordChar
            in
            (not startsWord || index == 0 || edgeOk before)
                && (not endsWord || edgeOk after)
    in
    if String.isEmpty needle then
        False

    else
        List.any boundaryOk (String.indexes needle hay)


{-| Does a smart-mute rule silence this delivery's alert? -}
smartMuted : SmartMute -> { text : String, from : String } -> Bool
smartMuted rules input =
    List.member (String.toLower (String.trim input.from)) rules.nicks
        || List.any (containsTerm input.text) rules.keywords


smartMuteSummary : SmartMute -> String
smartMuteSummary rules =
    let
        count n one many =
            String.fromInt n
                ++ " "
                ++ (if n == 1 then
                        one

                    else
                        many
                   )

        parts =
            List.filterMap identity
                [ if List.isEmpty rules.keywords then
                    Nothing

                  else
                    Just (count (List.length rules.keywords) "word" "words")
                , if List.isEmpty rules.nicks then
                    Nothing

                  else
                    Just (count (List.length rules.nicks) "person" "people")
                ]
    in
    if List.isEmpty parts then
        "Off"

    else
        String.join " · " parts ++ " muted"



-- SINCE YOU LEFT


{-| One conversation's unread tail: the rows after the unread
boundary, newest first, as the transcript keeps them. `text` is
`Nothing` for encrypted rows (they count but never feed the terms). -}
type alias DigestInput =
    { name : String
    , unread : Int
    , highlights : Int
    , rows : List { from : String, at : Int, highlight : Bool, text : Maybe String }
    }


type alias DigestRow =
    { name : String
    , count : Int
    , mentions : Int
    , people : List String
    , morePeople : Int
    , firstAt : Int
    , lastAt : Int
    , terms : List String
    }


type alias Digest =
    { rows : List DigestRow
    , total : Int
    , mentions : Int
    , rooms : Int
    , people : Int
    , firstAt : Int
    , lastAt : Int
    }


stopWords : Set.Set String
stopWords =
    Set.fromList
        [ "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "way", "who", "did", "get", "got", "let", "say", "she", "too", "use", "yes", "yeah", "this", "that", "with", "have", "from", "they", "will", "would", "there", "their", "what", "about", "which", "when", "make", "like", "just", "over", "such", "into", "than", "them", "then", "some", "could", "been", "were", "your", "also", "here", "more", "very", "much", "only", "well", "even", "back", "after", "still", "should", "going", "think", "know", "want", "really", "thanks", "okay", "lol", "https", "http", "www", "com" ]


tokens : String -> List String
tokens text =
    text
        |> String.toLower
        |> String.map
            (\c ->
                if Char.isAlphaNum c || c == '-' then
                    c

                else
                    ' '
            )
        |> String.words
        |> List.filter
            (\w ->
                String.length w >= 3
                    && String.length w <= 32
                    && (String.left 1 w |> String.toList |> List.all Char.isAlphaNum)
                    && not (Set.member w stopWords)
                    && not (String.all Char.isDigit w)
            )


topTerms : Int -> List String -> List String
topTerms n texts =
    let
        counts =
            List.foldl
                (\word acc -> Dict.update word (\c -> Just (Maybe.withDefault 0 c + 1)) acc)
                Dict.empty
                (List.concatMap (tokens >> dedupeTake 64) texts)
    in
    counts
        |> Dict.toList
        |> List.filter (\( _, c ) -> c >= 2 || List.length texts <= 2)
        |> List.sortWith
            (\( a, ca ) ( b, cb ) ->
                case compare cb ca of
                    EQ ->
                        compare a b

                    other ->
                        other
            )
        |> List.take n
        |> List.map Tuple.first


{-| Summarize each conversation's unread tail (own lines skipped),
busiest attention first: mentions, then message count, then name.
Totals cover every conversation even when `maxRows` cuts the list. -}
buildDigest : { self : String, maxRows : Int } -> List DigestInput -> Digest
buildDigest cfg inputs =
    let
        selfKey =
            String.toLower cfg.self

        theirsOf input =
            List.filter (\r -> String.toLower r.from /= selfKey) input.rows

        summarize input =
            let
                theirs =
                    theirsOf input

                -- oldest first for "first seen" people order
                chrono =
                    List.reverse theirs

                people =
                    dedupeTake 64 (List.map .from chrono)

                stamps =
                    List.map .at theirs |> List.filter (\t -> t > 0)

                count =
                    max input.unread (List.length theirs)

                mentions =
                    max input.highlights (List.length (List.filter .highlight theirs))
            in
            if count <= 0 && mentions <= 0 then
                Nothing

            else
                Just
                    { name = input.name
                    , count = count
                    , mentions = mentions
                    , people = List.take 3 people
                    , morePeople = max 0 (List.length people - 3)
                    , firstAt = List.minimum stamps |> Maybe.withDefault 0
                    , lastAt = List.maximum stamps |> Maybe.withDefault 0
                    , terms = topTerms 3 (List.filterMap .text chrono)
                    }

        rows =
            List.filterMap summarize inputs
                |> List.sortWith
                    (\a b ->
                        case compare b.mentions a.mentions of
                            EQ ->
                                case compare b.count a.count of
                                    EQ ->
                                        compare (String.toLower a.name) (String.toLower b.name)

                                    other ->
                                        other

                            other ->
                                other
                    )

        everyone =
            inputs
                |> List.concatMap theirsOf
                |> List.map (.from >> String.toLower)
                |> Set.fromList
                |> Set.size
    in
    { rows = List.take cfg.maxRows rows
    , total = List.sum (List.map .count rows)
    , mentions = List.sum (List.map .mentions rows)
    , rooms = List.length rows
    , people = everyone
    , firstAt = rows |> List.map .firstAt |> List.filter (\t -> t > 0) |> List.minimum |> Maybe.withDefault 0
    , lastAt = rows |> List.map .lastAt |> List.maximum |> Maybe.withDefault 0
    }


plural : Int -> String -> String -> String
plural n one many =
    String.fromInt n
        ++ " "
        ++ (if n == 1 then
                one

            else
                many
           )


{-| "12 messages across 3 conversations · 2 mentions" / "All caught up". -}
digestHeadline : Digest -> String
digestHeadline digest =
    if digest.rooms == 0 then
        "All caught up"

    else
        plural digest.total "message" "messages"
            ++ (if digest.rooms > 1 then
                    " across " ++ plural digest.rooms "conversation" "conversations"

                else
                    ""
               )
            ++ (if digest.mentions > 0 then
                    " · " ++ plural digest.mentions "mention" "mentions"

                else
                    ""
               )


{-| The head line under the kicker: "20:55–00:03 · 7 people wrote". -}
digestSpan : (Int -> String) -> Digest -> String
digestSpan clock digest =
    let
        span =
            if digest.firstAt <= 0 then
                ""

            else if clock digest.firstAt == clock digest.lastAt then
                "at " ++ clock digest.lastAt

            else
                clock digest.firstAt ++ "–" ++ clock digest.lastAt

        who =
            if digest.people <= 0 then
                ""

            else
                plural digest.people "person" "people" ++ " wrote"
    in
    [ span, who ] |> List.filter (not << String.isEmpty) |> String.join " · "


{-| "9:01–9:30" or "at 9:30" with the caller's clock formatter. -}
windowLabel : (Int -> String) -> DigestRow -> String
windowLabel clock row =
    if row.firstAt <= 0 then
        ""

    else if clock row.firstAt == clock row.lastAt then
        "at " ++ clock row.lastAt

    else
        clock row.firstAt ++ "–" ++ clock row.lastAt


{-| "mara, jun +2 · 9:01–9:30 · release, staging". -}
digestRowLine : (Int -> String) -> DigestRow -> String
digestRowLine clock row =
    let
        people =
            case row.people of
                [] ->
                    ""

                names ->
                    String.join ", " names
                        ++ (if row.morePeople > 0 then
                                " +" ++ String.fromInt row.morePeople

                            else
                                ""
                           )
    in
    [ people, windowLabel clock row, String.join ", " row.terms ]
        |> List.filter (not << String.isEmpty)
        |> String.join " · "
