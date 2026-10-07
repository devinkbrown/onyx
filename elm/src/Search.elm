module Search exposing
    ( SearchResult
    , activePosition
    , announcedQuery
    , boundQueryInput
    , clampIndex
    , countLabel
    , filterLive
    , maxCorpusLength
    , maxQueryLength
    , maxRecallSuggestions
    , maxResultTextLength
    , maxSaveLabelLength
    , modeLabel
    , moveIndex
    , normalizeQuery
    , recallSuggestions
    , recallTermsFromText
    , resultText
    , safeSlice
    , statusLabel
    , visibleText
    )

{-| Message-search primitives, mirroring `src/shell/search/` (the
`useMessageSearch` live tier) plus the `searchBounds.ts` ceilings:

  - query input is sliced to 512 chars (surrogate-safe) with spaces
    preserved while editing;
  - candidates match case-insensitively over visible text (decrypted
    plaintext when held — locked envelopes never match) and sender;
  - result bodies are windowed to 4096 chars around the match;
  - navigation wraps; the index clamps to the result list;
  - device recall pivots suggest ranked terms from live matches
    (vault hits join once vault recall lands).

Documented narrowings: case folds with `String.toLower` (not locale
`toLocaleLowerCase`); the 80-code-point announcement bound counts
UTF-16 units; buffers keep append order (rows carry no timestamps, so
no time sort); recall tiebreaks compare code points (not locale);
ASCII-exact recall runs, non-ASCII letters pass except separator
ranges (other scripts' punctuation may over-merge); server SEARCH
and vault recall stay ahead — this tier covers the live conversation
plus the device-saved list.
-}

import Dict exposing (Dict)
import DmCipher
import GroupEnvelope
import Set exposing (Set)


{-| Maximum user query text (mirroring `SEARCH_QUERY_TEXT_MAX`). -}
maxQueryLength : Int
maxQueryLength =
    512


{-| Maximum message/sender text examined per candidate (mirroring
`SEARCH_CORPUS_TEXT_MAX`). -}
maxCorpusLength : Int
maxCorpusLength =
    32768


{-| Maximum body text carried into a result (mirroring
`SEARCH_RESULT_TEXT_MAX`). -}
maxResultTextLength : Int
maxResultTextLength =
    4096


{-| Maximum saved-search name (mirroring the save-input `maxlength`). -}
maxSaveLabelLength : Int
maxSaveLabelLength =
    120


{-| One live-conversation match (mirroring `MessageSearchResult` minus
the server/vault tiers: id, sender, windowed text). -}
type alias SearchResult =
    { id : Int
    , from : String
    , text : String
    }


{-| Surrogate-safe slice (mirroring `safeSlice`: never split a
surrogate pair at the cut). -}
safeSlice : Int -> String -> String
safeSlice max value =
    if String.length value <= max then
        value

    else
        let
            cut =
                String.slice 0 max value
        in
        if isHighSurrogate (String.right 1 cut) then
            String.dropRight 1 cut

        else
            cut


isHighSurrogate : String -> Bool
isHighSurrogate unit =
    -- NB: `String.uncons`/`toList`/`Char.toCode` all pair-decode a
    -- trailing lone surrogate into garbage (observed 70773), so
    -- compare the raw UTF-16 unit as a string instead.
    unit >= "\u{D800}" && unit <= "\u{DBFF}"


{-| Bound live input while preserving spaces during editing
(mirroring `boundedSearchQueryInput`). -}
boundQueryInput : String -> String
boundQueryInput value =
    safeSlice maxQueryLength value


{-| Match key: trimmed and case-folded (mirroring `normalized`). -}
normalizeQuery : String -> String
normalizeQuery value =
    String.trim value |> String.toLower


{-| Search/display text for a row. A locked envelope (ciphertext
held, no plaintext) is never useful user text and yields nothing;
otherwise the held plaintext wins over the raw body (mirroring
`visibleSearchText`). -}
visibleText : { a | body : String, plaintext : Maybe String } -> Maybe String
visibleText message =
    if message.plaintext == Nothing && (DmCipher.isEnvelope message.body || GroupEnvelope.isGroupEnvelope message.body) then
        Nothing

    else
        Just (Maybe.withDefault message.body message.plaintext)


{-| Filter one conversation's rows (mirroring the hook's `results`:
empty query matches nothing; text or sender contains the needle). -}
filterLive : String -> List { a | id : Int, from : String, body : String, plaintext : Maybe String } -> List SearchResult
filterLive query messages =
    let
        needle =
            normalizeQuery query
    in
    if String.isEmpty needle then
        []

    else
        List.filterMap
            (\message ->
                case visibleText message of
                    Nothing ->
                        Nothing

                    Just visible ->
                        let
                            hay =
                                safeSlice maxCorpusLength visible |> String.toLower

                            who =
                                safeSlice maxCorpusLength message.from |> String.toLower
                        in
                        if String.contains needle hay || String.contains needle who then
                            Just { id = message.id, from = message.from, text = resultText visible needle }

                        else
                            Nothing
            )
            messages


{-| Window a long body around the match (mirroring
`boundedSearchResultText`: short bodies pass through; otherwise a
third of the window leads the match, with `…` affixes). -}
resultText : String -> String -> String
resultText value needle =
    if String.length value <= maxResultTextLength then
        value

    else
        let
            corpus =
                safeSlice maxCorpusLength value

            matchAt =
                if String.isEmpty needle then
                    -1

                else
                    indexOf needle (String.toLower corpus)
        in
        if matchAt < 0 || matchAt < maxResultTextLength then
            safeSlice maxResultTextLength value

        else
            let
                leading =
                    "…"

                trailing =
                    if matchAt + String.length needle < String.length value then
                        "…"

                    else
                        ""

                contentLength =
                    maxResultTextLength - String.length leading - String.length trailing

                start =
                    max 0 (matchAt - contentLength // 3)
            in
            leading ++ safeSlice contentLength (String.slice start (String.length value) value) ++ trailing


{-| Lowercased substring index (`String.indexes` head, -1 when
absent). -}
indexOf : String -> String -> Int
indexOf needle haystack =
    String.indexes needle haystack
        |> List.head
        |> Maybe.withDefault -1


{-| Step the active match with wraparound (mirroring `move`; an
empty list parks at zero). -}
moveIndex : Int -> Int -> Int -> Int
moveIndex delta count index =
    if count <= 0 then
        0

    else
        modBy count (index + delta)


{-| Clamp a stale index into the list (mirroring the count effect). -}
clampIndex : Int -> Int -> Int
clampIndex count index =
    if count <= 0 then
        0

    else
        min index (count - 1)


{-| 1-based position for the count readout (zero when empty). -}
activePosition : Int -> Int -> Int
activePosition count index =
    if count <= 0 then
        0

    else
        clampIndex count index + 1


{-| `3 of 12`, or `0 of 0` (mirroring `countLabel`). -}
countLabel : Int -> Int -> String
countLabel count position =
    if count > 0 then
        String.fromInt position ++ " of " ++ String.fromInt count

    else
        "0 of 0"


{-| `"query"` trimmed to 80 units for announcements (mirroring
`announcedQuery`). -}
announcedQuery : String -> String
announcedQuery query =
    let
        trimmed =
            String.trim query

        bounded =
            if String.length trimmed > 80 then
                String.slice 0 79 trimmed ++ "…"

            else
                trimmed
    in
    "“" ++ bounded ++ "”"


{-| Polite status line (mirroring `statusLabel`). -}
statusLabel : String -> String -> Int -> Int -> String
statusLabel query target count position =
    if String.isEmpty (String.trim query) then
        "Search " ++ target

    else if count == 0 then
        "No visible matches for " ++ announcedQuery query ++ " in " ++ target

    else
        countLabel count position ++ " for " ++ announcedQuery query ++ " in " ++ target


{-| `Exact text` / `Text + related terms` / `Related terms`
(mirroring the saved-row mode copy; modes arrive as wire strings). -}
modeLabel : String -> String
modeLabel mode =
    if mode == "exact" then
        "Exact text"

    else if mode == "hybrid" then
        "Text + related terms"

    else
        "Related terms"


{-| Cap on device-recall suggestion chips (mirroring
`SEARCH_RECALL_LIMIT`). -}
maxRecallSuggestions : Int
maxRecallSuggestions =
    5


{-| Terms the recall pivot never suggests (mirroring
`SEARCH_RECALL_STOP_WORDS`, verbatim). -}
recallStopWords : Set String
recallStopWords =
    Set.fromList
        [ "about"
        , "after"
        , "again"
        , "also"
        , "because"
        , "before"
        , "being"
        , "could"
        , "from"
        , "have"
        , "here"
        , "into"
        , "just"
        , "like"
        , "line"
        , "lines"
        , "message"
        , "messages"
        , "need"
        , "note"
        , "once"
        , "only"
        , "over"
        , "room"
        , "that"
        , "their"
        , "then"
        , "there"
        , "they"
        , "this"
        , "with"
        , "would"
        ]


{-| Split one text into candidate recall terms (mirroring
`recallTermsFromText`): lowercased runs of letters, numbers, and
interior hyphens, at least 3 chars after edge hyphens strip, minus
stop-words, deduplicated. -}
recallTermsFromText : String -> List String
recallTermsFromText text =
    text
        |> safeSlice maxCorpusLength
        |> String.toLower
        |> String.toList
        |> splitRecallRuns
        |> List.filterMap cleanRecallRun
        |> dedupeStrings


splitRecallRuns : List Char -> List String
splitRecallRuns chars =
    let
        step char ( current, acc ) =
            if isRecallWordChar char then
                ( char :: current, acc )

            else if List.isEmpty current then
                ( [], acc )

            else
                ( [], String.fromList (List.reverse current) :: acc )

        ( tail, runs ) =
            List.foldl step ( [], [] ) chars
    in
    if List.isEmpty tail then
        List.reverse runs

    else
        List.reverse (String.fromList (List.reverse tail) :: runs)


{-| Word char for recall runs: ASCII letters/digits plus `-`
(exact), and non-ASCII code points outside the separator ranges
(approximation of `\p{L}\p{N}` — see `isRecallSeparator`). -}
isRecallWordChar : Char -> Bool
isRecallWordChar char =
    Char.isAlphaNum char || char == '-' || (Char.toCode char >= 0x80 && not (isRecallSeparator char))


{-| Non-ASCII code points that still break a recall run: surrogates
(astral planes arrive pair-decoded, so each half breaks), general
punctuation, CJK symbols, fullwidth forms, and stray no-break
spaces / math signs. Other scripts' punctuation may over-merge —
documented narrowing against `\p{L}\p{N}`. -}
isRecallSeparator : Char -> Bool
isRecallSeparator char =
    let
        code =
            Char.toCode char
    in
    (code >= 0xD800 && code <= 0xDFFF)
        || (code >= 0x2000 && code <= 0x206F)
        || (code >= 0x3000 && code <= 0x303F)
        || (code >= 0xFF00 && code <= 0xFFEF)
        || code == 0xA0
        || code == 0xB7
        || code == 0xD7
        || code == 0xF7


cleanRecallRun : String -> Maybe String
cleanRecallRun run =
    let
        stripped =
            stripEdgeHyphens run
    in
    if String.length stripped < 3 || Set.member stripped recallStopWords then
        Nothing

    else
        Just stripped


stripEdgeHyphens : String -> String
stripEdgeHyphens run =
    run
        |> String.toList
        |> dropWhile (\c -> c == '-')
        |> List.reverse
        |> dropWhile (\c -> c == '-')
        |> List.reverse
        |> String.fromList


dropWhile : (a -> Bool) -> List a -> List a
dropWhile pred xs =
    case xs of
        [] ->
            []

        first :: rest ->
            if pred first then
                dropWhile pred rest

            else
                xs


dedupeStrings : List String -> List String
dedupeStrings xs =
    List.foldl
        (\x ( seen, out ) ->
            if Set.member x seen then
                ( seen, out )

            else
                ( Set.insert x seen, out ++ [ x ] )
        )
        ( Set.empty, [] )
        xs
        |> Tuple.second


{-| Device-only lexical pivots over matched result texts (mirroring
the `recallSuggestions` memo over live results; vault hits join the
input once vault recall lands): terms the query itself already
covers stay out, remaining terms rank by hit count then term, capped
at `maxRecallSuggestions`. -}
recallSuggestions : String -> List String -> List String
recallSuggestions query texts =
    let
        needle =
            normalizeQuery query
    in
    if String.length needle < 2 then
        []

    else
        let
            blocked =
                Set.insert needle (Set.fromList (recallTermsFromText needle))

            bump text counts =
                List.foldl
                    (\term acc ->
                        if Set.member term blocked then
                            acc

                        else
                            Dict.update term
                                (\prev -> Just (Maybe.withDefault 0 prev + 1))
                                acc
                    )
                    counts
                    (recallTermsFromText text)

            rank ( aTerm, aCount ) ( bTerm, bCount ) =
                case compare bCount aCount of
                    EQ ->
                        compare aTerm bTerm

                    ord ->
                        ord
        in
        List.foldl bump Dict.empty texts
            |> Dict.toList
            |> List.sortWith rank
            |> List.take maxRecallSuggestions
            |> List.map Tuple.first
