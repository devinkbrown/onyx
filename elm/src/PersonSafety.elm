module PersonSafety exposing
    ( ReportReason(..)
    , SafetyPending(..)
    , reportRoom
    , maxReportNote
    , maxReceipts
    , maxReceiptChars
    , receiptsKey
    , reportReasons
    , reasonToString
    , reasonFromString
    , isReportReason
    , sanitizeToken
    , sanitizeMultiline
    , blockTitle
    , blockBody
    , unblockToast
    , reportTitle
    , reportHonesty
    , formatDraft
    , draftToast
    , ownerStorageKey
    , percentEncode
    , jsonString
    )

{-| Consumer Block + Report copy and policy (mirroring
`src/lib/people/personSafety.ts` plus the owner-scoped receipt key
from `personReportReceipt.ts` / `deviceMemoryOwner.ts`; storage
mechanics stay ports-side). -}

import Base64Url


{-| The shared report room (never a private inbox). -}
reportRoom : String
reportRoom =
    "#root"


{-| Note bound for a report draft. -}
maxReportNote : Int
maxReportNote =
    500


{-| Receipt journal bounds (mirroring the receipt module). -}
maxReceipts : Int
maxReceipts =
    20


maxReceiptChars : Int
maxReceiptChars =
    64 * 1024


{-| Receipt journal key before owner scoping. -}
receiptsKey : String
receiptsKey =
    "onyx:person-report-receipts"


{-| Report reasons. -}
type ReportReason
    = Harassment
    | Spam
    | Illegal
    | Other


{-| Reason menu in oracle order. -}
reportReasons : List ( ReportReason, String )
reportReasons =
    [ ( Harassment, "Harassment" )
    , ( Spam, "Spam" )
    , ( Illegal, "Illegal" )
    , ( Other, "Other" )
    ]


reasonToString : ReportReason -> String
reasonToString reason =
    case reason of
        Harassment ->
            "harassment"

        Spam ->
            "spam"

        Illegal ->
            "illegal"

        Other ->
            "other"


reasonFromString : String -> Maybe ReportReason
reasonFromString value =
    case value of
        "harassment" ->
            Just Harassment

        "spam" ->
            Just Spam

        "illegal" ->
            Just Illegal

        "other" ->
            Just Other

        _ ->
            Nothing


isReportReason : String -> Bool
isReportReason value =
    reasonFromString value /= Nothing


{-| Ephemeral safety sheet state (mirroring `PersonSafetyPending`). -}
type SafetyPending
    = SafetyBlock { nick : String, guest : Bool }
    | SafetyReport { nick : String, guest : Bool }


{-| Strip C0 controls + DEL, trim, bound (mirroring
`sanitizePersonToken`). -}
sanitizeToken : String -> Int -> String
sanitizeToken value max =
    String.left max
        (String.trim
            (String.filter (\c -> not (isControlChar c)) value)
        )


{-| Keep newlines in a local draft; strip other controls
(mirroring `sanitizePersonMultiline`). -}
sanitizeMultiline : String -> Int -> String
sanitizeMultiline value max =
    String.left max
        (String.trim
            (String.filter
                (\c ->
                    Char.toCode c == 10 || not (isControlChar c)
                )
                value
            )
        )


isControlChar : Char -> Bool
isControlChar c =
    let
        code =
            Char.toCode c
    in
    code < 32 || code == 127


blockTitle : String -> String
blockTitle nick =
    "Block " ++ sanitizeToken nick 128 ++ "?"


blockBody : String -> String
blockBody nick =
    "You will not see " ++ sanitizeToken nick 128 ++ " on this device. They are not told."


unblockToast : String -> { title : String, description : String }
unblockToast nick =
    { title = "Unblocked " ++ sanitizeToken nick 128
    , description = "Messages and notifications from this name resume on this device."
    }


reportTitle : String -> String
reportTitle nick =
    "Report " ++ sanitizeToken nick 128


{-| Honest destination copy: this path drafts a note, never files
one. -}
reportHonesty : String
reportHonesty =
    "This creates a draft in the shared #root report room. It is visible to people in that room or operators, not a private inbox or police report. Nothing is sent automatically."


{-| Build the composer draft lines (mirroring
`formatPersonReportDraft`). -}
formatDraft :
    { nick : String
    , reason : ReportReason
    , note : String
    , from : String
    , guest : Bool
    }
    -> String
formatDraft input =
    let
        nick =
            case sanitizeToken input.nick 128 of
                "" ->
                    "unknown"

                clean ->
                    clean

        from =
            sanitizeToken input.from 128

        note =
            sanitizeToken input.note maxReportNote

        lines =
            [ "Report"
            , "About: " ++ nick
            , "What: " ++ reasonToString input.reason
            ]
                ++ (if String.isEmpty from then
                        []

                    else
                        [ "From: " ++ from ]
                   )
                ++ (if input.guest then
                        [ "Guest: yes" ]

                    else
                        []
                   )
                ++ (if String.isEmpty note then
                        []

                    else
                        [ "Note: " ++ note ]
                   )
    in
    String.join "\n" lines


draftToast : { title : String, description : String }
draftToast =
    { title = "Draft is in #root"
    , description = "Review the draft in the shared room, then send it yourself if you choose."
    }


{-| Owner-scoped receipt key (mirroring `deviceMemoryStorageKey`:
`base:owner:` + percent-encoded JSON pair; Nothing when the
owner is unusable so legacy plaintext is never claimed). -}
ownerStorageKey : { serverUrl : String, identity : String } -> Maybe String
ownerStorageKey owner =
    let
        url =
            String.trim owner.serverUrl

        identity =
            String.toLower (String.trim owner.identity)
    in
    if String.isEmpty url || String.length url > 2048 then
        Nothing

    else if String.isEmpty identity || String.length identity > 256 then
        Nothing

    else
        Just (receiptsKey ++ ":owner:" ++ percentEncode ("[" ++ jsonString url ++ "," ++ jsonString identity ++ "]"))


{-| JSON string literal for trusted-shape ASCII/UTF-8 text
(quotes, backslashes, and C0 controls escaped). -}
jsonString : String -> String
jsonString value =
    "\""
        ++ String.concat (List.map jsonChar (String.toList value))
        ++ "\""


jsonChar : Char -> String
jsonChar c =
    case c of
        '"' ->
            "\\\""

        '\\' ->
            "\\\\"

        _ ->
            let
                code =
                    Char.toCode c
            in
            if code < 32 then
                "\\u" ++ hex4 code

            else
                String.fromChar c


hex4 : Int -> String
hex4 code =
    String.fromList
        (List.map
            (\shift -> hexDigit (modBy 16 (code // shift)))
            [ 4096, 256, 16, 1 ]
        )


hexDigit : Int -> Char
hexDigit nibble =
    case nibble of
        10 ->
            'A'

        11 ->
            'B'

        12 ->
            'C'

        13 ->
            'D'

        14 ->
            'E'

        15 ->
            'F'

        _ ->
            case String.uncons (String.fromInt nibble) of
                Just ( digit, _ ) ->
                    digit

                Nothing ->
                    '0'


{-| Percent-encoding over UTF-8 bytes (the `encodeURIComponent`
subset: unreserved marks stay literal). -}
percentEncode : String -> String
percentEncode value =
    String.concat (List.map percentByte (Base64Url.utf8Bytes value))


percentByte : Int -> String
percentByte byte =
    if
        (byte >= 65 && byte <= 90)
            || (byte >= 97 && byte <= 122)
            || (byte >= 48 && byte <= 57)
            || List.member byte [ 45, 46, 95, 126, 33, 39, 40, 41, 42 ]
    then
        String.fromChar (Char.fromCode byte)

    else
        "%" ++ hex2 byte


hex2 : Int -> String
hex2 byte =
    String.fromList [ hexDigit (byte // 16), hexDigit (modBy 16 byte) ]
