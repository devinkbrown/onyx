module Transcript exposing
    ( TranscriptDoc
    , TranscriptMessage
    , maxExportIdLength
    , maxExportMessages
    , maxExportSenderLength
    , maxExportTargetLength
    , maxExportTextLength
    , maxExportTypeLength
    , maxFilenamePartLength
    , chronologicalTail
    , encodeTranscript
    , safeFilenamePart
    , scrubExportText
    , transcriptFilename
    , transcriptToText
    )

{-| Local per-view transcript export — Elm port of the pure halves of
`src/lib/export/conversationExport.ts` (`buildConversationExport` minus
the row projection, `conversationExportToText`, `safeFilenamePart`).
The download itself rides the `TranscriptDownload` port (blob-anchor
bridge, mirroring `downloadConversationExport`); the file picker for
the way back already exists (`vaultImportPick`/`VaultImportFile`).

Bounds and copy mirror the oracle exactly: 5000 newest rows,
control-char scrub (newlines survive), `onyx-<room>-<date>.txt|json`
filenames, and the `this device only` header. The `network` field is
absent — the oracle only spreads it when set, and Elm holds no
network name. Times arrive preformatted (ISO via `App.millisToIso`);
the exporter never touches the clock.

-}

import Json.Encode as Encode


{-| Newest-row cap per transcript (mirroring `MAX_EXPORT_MESSAGES`). -}
maxExportMessages : Int
maxExportMessages =
    5000


{-| Field bounds mirroring the oracle `scrub` call sites. -}
maxExportTargetLength : Int
maxExportTargetLength =
    256


maxExportIdLength : Int
maxExportIdLength =
    128


maxExportSenderLength : Int
maxExportSenderLength =
    64


maxExportTypeLength : Int
maxExportTypeLength =
    32


maxExportTextLength : Int
maxExportTextLength =
    8192


maxFilenamePartLength : Int
maxFilenamePartLength =
    64


{-| One exported row (times preformatted ISO, text already scrubbed). -}
type alias TranscriptMessage =
    { id : String
    , time : String
    , from : String
    , type_ : String
    , text : String
    , edited : Bool
    }


{-| One transcript document. -}
type alias TranscriptDoc =
    { target : String
    , messageCount : Int
    , messages : List TranscriptMessage
    , exportedAt : String
    , ourNick : String
    }


{-| Strip the oracle CONTROL set (`\u{0000}`–`\u{0008}`, `\u{000B}`,
`\u{000C}`, `\u{000E}`–`\u{001F}`, `\u{007F}` — tabs, LFs, and CRs
survive) and cap the length (mirroring `scrub`). -}
scrubExportText : Int -> String -> String
scrubExportText maxLength value =
    String.filter (\c -> not (isExportControlChar c)) value
        |> String.left maxLength


isExportControlChar : Char -> Bool
isExportControlChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x00 && code <= 0x08)
        || code == 0x0B
        || code == 0x0C
        || (code >= 0x0E && code <= 0x1F)
        || code == 0x7F


{-| Filename-safe room part (mirroring `safeFilenamePart`: each run
outside `[A-Za-z0-9._#+-]` collapses to one `_`, capped at 64,
falling back to `conversation`). -}
safeFilenamePart : String -> String
safeFilenamePart raw =
    let
        allowed c =
            (c >= 'A' && c <= 'Z')
                || (c >= 'a' && c <= 'z')
                || (c >= '0' && c <= '9')
                || c == '.'
                || c == '_'
                || c == '#'
                || c == '+'
                || c == '-'

        dropDisallowed chars =
            case chars of
                [] ->
                    []

                c :: rest ->
                    if allowed c then
                        chars

                    else
                        dropDisallowed rest

        collapse chars =
            case chars of
                [] ->
                    []

                c :: rest ->
                    if allowed c then
                        c :: collapse rest

                    else
                        '_' :: collapse (dropDisallowed rest)

        cleaned =
            String.toList raw
                |> collapse
                |> String.fromList
                |> String.left maxFilenamePartLength
    in
    if String.isEmpty cleaned then
        "conversation"

    else
        cleaned


{-| Newest-5000 tail of a newest-first buffer, returned oldest-first
(mirroring `messages.slice(-MAX_EXPORT_MESSAGES)` over the oracle's
chronological store). -}
chronologicalTail : List a -> List a
chronologicalTail newestFirst =
    List.reverse (List.take maxExportMessages newestFirst)


{-| Download filename (mirroring `downloadConversationExport`:
`onyx-<room>-<YYYY-MM-DD>.<format>`). -}
transcriptFilename : String -> String -> String -> String
transcriptFilename target datePart format =
    "onyx-" ++ safeFilenamePart target ++ "-" ++ datePart ++ "." ++ format


{-| Plain-text transcript (mirroring `conversationExportToText` verbatim,
headers first, one `[time] <from> text` line per row). -}
transcriptToText : TranscriptDoc -> String
transcriptToText doc =
    let
        header =
            [ "# " ++ doc.target ++ " — local export"
            , "# network: unknown"
            , "# exported: " ++ doc.exportedAt
            , "# messages: " ++ String.fromInt doc.messageCount ++ " (this device only — not complete server history)"
            , ""
            ]

        row message =
            "["
                ++ message.time
                ++ "] <"
                ++ message.from
                ++ "> "
                ++ message.text
                ++ (if message.edited then
                        " (edited)"

                    else
                        ""
                   )
    in
    String.join "\n" (header ++ List.map row doc.messages) ++ "\n"


{-| JSON transcript document (mirroring the `json` branch: the caller
renders it with `Encode.encode 2` plus a trailing newline to match
`JSON.stringify(doc, null, 2) + \n`). -}
encodeTranscript : TranscriptDoc -> Encode.Value
encodeTranscript doc =
    Encode.object
        [ ( "kind", Encode.string "onyx.conversation-export" )
        , ( "version", Encode.int 1 )
        , ( "exportedAt", Encode.string doc.exportedAt )
        , ( "target", Encode.string doc.target )
        , ( "ourNick", Encode.string doc.ourNick )
        , ( "messageCount", Encode.int doc.messageCount )
        , ( "messages"
          , Encode.list encodeTranscriptMessage doc.messages
          )
        ]


encodeTranscriptMessage : TranscriptMessage -> Encode.Value
encodeTranscriptMessage message =
    let
        base =
            [ ( "id", Encode.string message.id )
            , ( "time", Encode.string message.time )
            , ( "from", Encode.string message.from )
            , ( "type", Encode.string message.type_ )
            , ( "text", Encode.string message.text )
            ]
    in
    Encode.object
        (if message.edited then
            base ++ [ ( "edited", Encode.bool True ) ]

         else
            base
        )
