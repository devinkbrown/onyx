module Multiline exposing
    ( Limits
    , Part
    , SendPlan
    , assembleMultilineText
    , buildMultilineLines
    , defaultLimits
    , limitMaxBytes
    , limitMaxLines
    , parseMultilineLimits
    , planMultilineBatches
    )

{-| IRCv3 `draft/multiline` send-side planning — Elm port of
`src/lib/irc/multiline.ts`.

When the composer submits text with newlines and the server ACKed
`draft/multiline`, the message goes out as a client-initiated batch.
The cap value advertises limits
(`draft/multiline=max-bytes=4096,max-lines=24`); both are respected,
chunking into as many batches as needed.

Purity note: the TypeScript `makeRef` closure (Date.now + counter) cannot
exist in pure Elm. `buildMultilineLines` therefore takes an explicit ref
per batch (callers supply uniqueness, e.g. from a port-provided timestamp
plus a model counter) and returns `Nothing` when refs run short rather
than silently dropping a batch.

`NaN`/`Infinity` direct-call limits from the TS tests are unrepresentable
as Elm `Int`s — the type makes them impossible, which is strictly stronger
than the runtime fallback.

-}

import Base64Url
import Wire


type alias Limits =
    { maxBytes : Int
    , maxLines : Int
    }


{-| Spec-suggested floor values — used when the server advertises no limits. -}
defaultLimits : Limits
defaultLimits =
    { maxBytes = 4096
    , maxLines = 24
    }


{-| Hard client work ceilings for untrusted CAP values and direct callers. -}
limitMaxBytes : Int
limitMaxBytes =
    64 * 1024


limitMaxLines : Int
limitMaxLines =
    256


type alias Part =
    { text : String
    , concat : Bool
    }


type alias SendPlan =
    { lines : List String
    }


boundedPositive : Int -> Int -> Int -> Int
boundedPositive value fallback maximum =
    if value > 0 then
        min value maximum

    else
        fallback


boundedLimits : Limits -> Limits
boundedLimits limits =
    { maxBytes = boundedPositive limits.maxBytes defaultLimits.maxBytes limitMaxBytes
    , maxLines = boundedPositive limits.maxLines defaultLimits.maxLines limitMaxLines
    }


{-| Parse a `draft/multiline` cap value (`max-bytes=4096,max-lines=24`)
into limits, falling back to defaults for absent or malformed tokens.
The integer prefix follows `Number.parseInt` (leading whitespace/sign,
decimal digit run) except hexadecimal/octal prefixes, which caps never
advertise.
-}
parseMultilineLimits : Maybe String -> Limits
parseMultilineLimits capValue =
    case capValue of
        Nothing ->
            defaultLimits

        Just raw ->
            if String.isEmpty raw then
                defaultLimits

            else
                List.foldl applyToken defaultLimits (String.split "," raw)


applyToken : String -> Limits -> Limits
applyToken token limits =
    case splitOnceEq token of
        Nothing ->
            limits

        Just ( key, val ) ->
            case parseIntPrefix val of
                Nothing ->
                    limits

                Just num ->
                    if num <= 0 then
                        limits

                    else if String.toLower (String.trim key) == "max-bytes" then
                        { limits | maxBytes = min num limitMaxBytes }

                    else if String.toLower (String.trim key) == "max-lines" then
                        { limits | maxLines = min num limitMaxLines }

                    else
                        limits


splitOnceEq : String -> Maybe ( String, String )
splitOnceEq token =
    case String.indexes "=" token of
        [] ->
            Nothing

        idx :: _ ->
            Just ( String.slice 0 idx token, String.dropLeft (idx + 1) token )


parseIntPrefix : String -> Maybe Int
parseIntPrefix text =
    let
        trimmed =
            String.trimLeft text

        ( sign, rest ) =
            case String.uncons trimmed of
                Just ( '+', tail ) ->
                    ( 1, tail )

                Just ( '-', tail ) ->
                    ( -1, tail )

                _ ->
                    ( 1, trimmed )

        digits =
            takeDigits (String.toList rest)
    in
    case digits of
        [] ->
            Nothing

        _ ->
            List.foldl (\d acc -> acc * 10 + d) 0 digits
                |> (*) sign
                |> Just


takeDigits : List Char -> List Int
takeDigits chars =
    List.reverse (takeDigitsGo chars [])


takeDigitsGo : List Char -> List Int -> List Int
takeDigitsGo chars acc =
    case chars of
        [] ->
            acc

        c :: rest ->
            let
                code =
                    Char.toCode c
            in
            if code >= 0x30 && code <= 0x39 then
                takeDigitsGo rest ((code - 0x30) :: acc)

            else
                acc


{-| Plan the batches for a multiline message. Returns `Nothing` when the
text has no newline (caller should send a plain PRIVMSG).
-}
planMultilineBatches : String -> Limits -> Maybe (List (List Part))
planMultilineBatches text limits =
    let
        bounded =
            boundedLimits limits

        rawLines =
            text
                |> splitLogicalLines
                |> List.map (String.filter (\c -> Char.toCode c /= 0))
                |> List.filter (\l -> not (String.isEmpty (String.trim l)))
    in
    if List.length rawLines <= 1 then
        Nothing

    else
        Just (groupParts (explodeLines bounded rawLines) bounded)


{-| Split on every line-ending form (CRLF, lone CR, LF) so no bare `\r`
survives into a PRIVMSG payload.
-}
splitLogicalLines : String -> List String
splitLogicalLines text =
    splitGo (String.toList text) "" []


splitGo : List Char -> String -> List String -> List String
splitGo chars current acc =
    case chars of
        [] ->
            List.reverse (current :: acc)

        '\u{000D}' :: '\n' :: rest ->
            splitGo rest "" (current :: acc)

        '\u{000D}' :: rest ->
            splitGo rest "" (current :: acc)

        '\n' :: rest ->
            splitGo rest "" (current :: acc)

        c :: rest ->
            splitGo rest (current ++ String.fromChar c) acc


{-| Explode overlong lines into concat fragments of at most `maxBytes`
UTF-8 bytes without cutting a code point in half.
-}
explodeLines : Limits -> List String -> List Part
explodeLines limits rawLines =
    List.concatMap
        (\line ->
            if Base64Url.utf8ByteLength line <= limits.maxBytes then
                [ { text = line, concat = False } ]

            else
                List.indexedMap
                    (\i fragment -> { text = fragment, concat = i > 0 })
                    (splitLineByBytes line limits.maxBytes)
        )
        rawLines


{-| Fragment one line by UTF-8 byte budget, keeping surrogate pairs
(code points) intact.
-}
splitLineByBytes : String -> Int -> List String
splitLineByBytes line maxBytes =
    splitFragments (codePoints (String.toList line)) maxBytes "" 0 []


splitFragments : List String -> Int -> String -> Int -> List String -> List String
splitFragments cps maxBytes current currentBytes acc =
    case cps of
        [] ->
            if String.isEmpty current then
                List.reverse acc

            else
                List.reverse (current :: acc)

        cp :: rest ->
            let
                cpBytes =
                    Base64Url.utf8ByteLength cp
            in
            if currentBytes + cpBytes > maxBytes && not (String.isEmpty current) then
                splitFragments rest maxBytes cp cpBytes (current :: acc)

            else
                splitFragments rest maxBytes (current ++ cp) (currentBytes + cpBytes) acc


{-| Group UTF-16 units into code-point strings (surrogate pairs stay whole).
Tail-recursive: lines can be tens of kilobytes (hostile CAP ceilings).
-}
codePoints : List Char -> List String
codePoints units =
    List.reverse (codePointsGo units [])


codePointsGo : List Char -> List String -> List String
codePointsGo units acc =
    case units of
        [] ->
            acc

        h :: rest ->
            let
                hi =
                    Char.toCode h
            in
            if hi >= 0xD800 && hi <= 0xDBFF then
                case rest of
                    l :: tail ->
                        let
                            lo =
                                Char.toCode l
                        in
                        if lo >= 0xDC00 && lo <= 0xDFFF then
                            codePointsGo tail ((String.fromChar h ++ String.fromChar l) :: acc)

                        else
                            codePointsGo rest (String.fromChar h :: acc)

                    [] ->
                        String.fromChar h :: acc

            else
                codePointsGo rest (String.fromChar h :: acc)


groupParts : List Part -> Limits -> List (List Part)
groupParts parts limits =
    groupGo parts limits [] 0 []


groupGo : List Part -> Limits -> List Part -> Int -> List (List Part) -> List (List Part)
groupGo parts limits current currentBytes acc =
    case parts of
        [] ->
            if List.isEmpty current then
                List.reverse acc

            else
                List.reverse (List.reverse current :: acc)

        part :: rest ->
            let
                partBytes =
                    Base64Url.utf8ByteLength part.text

                wouldOverflow =
                    not (List.isEmpty current)
                        && (List.length current + 1 > limits.maxLines
                                || currentBytes + partBytes > limits.maxBytes
                           )
            in
            if wouldOverflow then
                groupGo (part :: rest) limits [] 0 (List.reverse current :: acc)

            else
                let
                    -- A concat fragment opening a new batch loses its join
                    -- partner and becomes a standalone line: the split point
                    -- degrades to a newline, never corrupts.
                    placed =
                        if List.isEmpty current then
                            { part | concat = False }

                        else
                            part
                in
                groupGo rest limits (placed :: current) (currentBytes + partBytes) acc


{-| Build the raw IRC lines for a multiline send. One caller-supplied ref
per batch; `Nothing` when refs run short (fail closed — never drop a
batch). Extra tags (e.g. `+draft/reply=<id>`) go on the FIRST batch's
BATCH command, per spec.
-}
buildMultilineLines : String -> List (List Part) -> List String -> List ( String, String ) -> Maybe SendPlan
buildMultilineLines target batches refs firstLineTags =
    if List.length refs < List.length batches then
        Nothing

    else
        Just
            { lines =
                List.concat
                    (List.map2 (batchLines target firstLineTags)
                        (List.indexedMap Tuple.pair batches)
                        refs
                    )
            }


batchLines : String -> List ( String, String ) -> ( Int, List Part ) -> String -> List String
batchLines target firstLineTags ( batchIdx, batch ) ref =
    let
        tagStr =
            if batchIdx == 0 then
                firstLineTags
                    |> List.map
                        (\( k, v ) ->
                            if String.isEmpty v then
                                k

                            else
                                k ++ "=" ++ Wire.escapeTagValue v
                        )
                    |> String.join ";"

            else
                ""

        openLine =
            (if String.isEmpty tagStr then
                ""

             else
                "@" ++ tagStr ++ " "
            )
                ++ "BATCH +"
                ++ ref
                ++ " draft/multiline "
                ++ target
                ++ "\r\n"

        partLine part =
            (if part.concat then
                "@batch=" ++ ref ++ ";draft/multiline-concat"

             else
                "@batch=" ++ ref
            )
                ++ " PRIVMSG "
                ++ target
                ++ " :"
                ++ part.text
                ++ "\r\n"
    in
    openLine :: List.map partLine batch ++ [ "BATCH -" ++ ref ++ "\r\n" ]


{-| Join collected multiline parts back into one message body: concat
parts append without a separator, everything else joins with `\n`.
-}
assembleMultilineText : List Part -> String
assembleMultilineText parts =
    case parts of
        [] ->
            ""

        first :: rest ->
            List.foldl
                (\part acc -> acc ++ ((if part.concat then "" else "\n") ++ part.text))
                first.text
                rest
