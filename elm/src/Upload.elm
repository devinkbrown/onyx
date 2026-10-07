module Upload exposing
    ( AttachmentCapDecision
    , AttachmentCapInput
    , AttachmentKind(..)
    , AttachmentPresentation
    , LinkPreview
    , ParsedAttachment
    , UnfurlPrefs
    , attachmentCountCapCopy
    , attachmentSendFailed
    , attachmentSizeCapCopy
    , buildAttachmentMessage
    , buildUploadEndpoint
    , classifyAttachmentKind
    , defaultUnfurlPrivacy
    , extractAttachmentPresentation
    , compactPhotoJpegQuality
    , compactPhotoMaxEdge
    , formatAttachmentBytes
    , formatFileSize
    , hasJpegExif
    , hasPngExif
    , isPhotoFile
    , photoQualityOptions
    , isPreviewableUrl
    , linkPreviewDescriptionMax
    , linkPreviewHrefScanMax
    , linkPreviewSiteMax
    , linkPreviewTitleMax
    , linkPreviewUrlMax
    , maxAttachmentBytes
    , maxAttachmentCaption
    , maxAttachmentFiles
    , maxAttachmentName
    , maxAttachmentSizeLabel
    , mayUnfurlUrl
    , normalizePreview
    , parseAttachmentLine
    , parseUploadResponse
    , pickPreviewUrl
    , planAttachmentAccept
    , previewSsrfOnly
    , progressPercent
    , resolveUploadUrl
    , sanitizeAttachmentUrl
    , stripJpegExif
    , stripPngExif
    , sanitizeFileName
    , unfurlPrivacyFromLinkPreviews
    , uploadResponseMaxBytes
    , uploadUrlMaxLength
    )

{-| Upload + link-preview policy — Elm port of the pure surface in
`src/lib/upload/` (`attachmentCaps.ts`, `attachmentMessage.ts`,
`photoPolicy.ts` name check, `upload.ts` endpoint/response parsing)
and `src/lib/preview/` (`unfurlPrivacy.ts`,
`linkPreview.ts` validation/pick/normalize).

Byte transfer (multipart POST, preview fetch, EXIF byte scans) lives
behind ports; Elm owns every bound, sanitizer, fail-closed gate, and
response parse. URL parsing is hand-rolled (Elm has no `URL`
constructor): absolute http(s) URLs normalize like the oracle's
`new URL(...).toString()` for the shapes servers emit, and anything
unparseable is rejected.
-}

import Base64Url
import Json.Decode as Decode
import Regex


{-| Max staged files (mirrors `MAX_ATTACHMENT_FILES`). -}
maxAttachmentFiles : Int
maxAttachmentFiles =
    5


{-| Max bytes per file (mirrors `MAX_ATTACHMENT_BYTES`). -}
maxAttachmentBytes : Int
maxAttachmentBytes =
    26214400


{-| Human cap label (mirrors `MAX_ATTACHMENT_SIZE_LABEL`). -}
maxAttachmentSizeLabel : String
maxAttachmentSizeLabel =
    "25 MB"


{-| Count-cap copy (mirrors `ATTACHMENT_COUNT_CAP_COPY`). -}
attachmentCountCapCopy : String
attachmentCountCapCopy =
    "You can attach up to 5 files."


{-| Size-cap copy (mirrors `attachmentSizeCapCopy`). -}
attachmentSizeCapCopy : String -> String
attachmentSizeCapCopy name =
    name ++ " is larger than " ++ maxAttachmentSizeLabel ++ "."


{-| Max caption chars (mirrors `MAX_ATTACHMENT_CAPTION`). -}
maxAttachmentCaption : Int
maxAttachmentCaption =
    400


{-| Max file-name chars (mirrors `MAX_ATTACHMENT_NAME`). -}
maxAttachmentName : Int
maxAttachmentName =
    120


{-| Send-failure copy (mirrors `ATTACHMENT_SEND_FAILED`). -}
attachmentSendFailed : String
attachmentSendFailed =
    "Couldn't send. Try again."


{-| Upload response cap (mirrors `UPLOAD_RESPONSE_MAX_BYTES`). -}
uploadResponseMaxBytes : Int
uploadResponseMaxBytes =
    65536


{-| Upload URL length cap (mirrors `UPLOAD_URL_MAX_LENGTH`). -}
uploadUrlMaxLength : Int
uploadUrlMaxLength =
    2048


{-| Byte length for honest labels (mirrors `formatAttachmentBytes`:
`0 B` on garbage, `KB` below 100 with one decimal, `MB` likewise). -}
formatAttachmentBytes : Float -> String
formatAttachmentBytes bytes =
    if isNaN bytes || isInfinite bytes || bytes < 0 then
        "0 B"

    else if bytes < 1024 then
        String.fromInt (floor bytes) ++ " B"

    else
        let
            kb =
                bytes / 1024
        in
        if kb < 1024 then
            (if kb >= 100 then
                String.fromInt (round kb)

             else
                formatFixed1 kb
            )
                ++ " KB"

        else
            let
                mb =
                    kb / 1024
            in
            (if mb >= 100 then
                String.fromInt (round mb)

             else
                formatFixed1 mb
            )
                ++ " MB"


{-| One decimal, always shown (mirrors `toFixed(1)`). -}
formatFixed1 : Float -> String
formatFixed1 value =
    let
        scaled =
            round (value * 10)

        whole =
            scaled // 10

        frac =
            abs (remainderBy 10 scaled)
    in
    String.fromInt whole ++ "." ++ String.fromInt frac


{-| Fixed decimals with trailing zeros (mirrors `toFixed(2)`). -}
formatFixed2 : Float -> String
formatFixed2 value =
    let
        scaled =
            round (value * 100)

        whole =
            scaled // 100

        frac =
            abs (remainderBy 100 scaled)
    in
    String.fromInt whole
        ++ "."
        ++ (if frac < 10 then
                "0" ++ String.fromInt frac

            else
                String.fromInt frac
           )


{-| File-size receipt label (mirrors `formatFileSize`). -}
formatFileSize : Maybe Float -> Maybe String
formatFileSize maybeBytes =
    case maybeBytes of
        Nothing ->
            Nothing

        Just bytes ->
            if isNaN bytes || isInfinite bytes || bytes < 0 then
                Nothing

            else if bytes < 1024 then
                Just (String.fromInt (floor bytes) ++ " B")

            else if bytes < 1048576 then
                Just (formatFixed1 (bytes / 1024) ++ " KB")

            else if bytes < 1073741824 then
                Just (formatFixed1 (bytes / 1048576) ++ " MB")

            else
                Just (formatFixed2 (bytes / 1073741824) ++ " GB")


{-| One candidate file for the cap planner. -}
type alias AttachmentCapInput =
    { name : String
    , size : Float
    }


{-| Cap verdict (mirrors `AttachmentCapDecision`). -}
type alias AttachmentCapDecision =
    { acceptIndexes : List Int
    , error : Maybe String
    }


{-| Decide which staged files fit the 5-file / 25 MB caps
(mirrors `planAttachmentAccept`: count-cap breaks with the count
copy; oversize files are skipped with the size copy). -}
planAttachmentAccept : List AttachmentCapInput -> Int -> AttachmentCapDecision
planAttachmentAccept files currentCount =
    let
        room =
            max 0 (maxAttachmentFiles - max 0 currentCount)
    in
    if room == 0 then
        { acceptIndexes = [], error = Just attachmentCountCapCopy }

    else
        List.foldl
            (\( index, file ) acc ->
                if List.length acc.acceptIndexes >= room then
                    { acc | error = Just attachmentCountCapCopy }

                else if file.size > toFloat maxAttachmentBytes then
                    { acc | error = Just (attachmentSizeCapCopy file.name) }

                else
                    { acc | acceptIndexes = acc.acceptIndexes ++ [ index ] }
            )
            { acceptIndexes = [], error = Nothing }
            (List.indexedMap Tuple.pair files)


{-| Attachment kind (mirrors `AttachmentKind`). -}
type AttachmentKind
    = KindImage
    | KindVideo
    | KindAudio
    | KindFile


{-| One parsed `[file]` receipt line (mirrors `ParsedAttachment`). -}
type alias ParsedAttachment =
    { url : String
    , name : Maybe String
    , sizeLabel : Maybe String
    , kind : AttachmentKind
    }


{-| Caption plus structured attachments (mirrors
`AttachmentPresentation`). -}
type alias AttachmentPresentation =
    { caption : String
    , attachments : List ParsedAttachment
    }


{-| C0/DEL control check (mirrors `CONTROL`). -}
hasControl : String -> Bool
hasControl value =
    List.any (\c -> Char.toCode c < 0x20 || Char.toCode c == 0x7F) (String.toList value)


{-| Drop the first control char (mirrors `replace(CONTROL, '')`
without the global flag: first occurrence only). -}
dropFirstControl : String -> String
dropFirstControl value =
    case String.toList value of
        [] ->
            ""

        c :: rest ->
            if Char.toCode c < 0x20 || Char.toCode c == 0x7F then
                String.fromList rest

            else
                String.fromChar c ++ dropFirstControl (String.fromList rest)


{-| Case-insensitive regex helper. -}
regexI : String -> Regex.Regex
regexI source =
    Maybe.withDefault Regex.never
        (Regex.fromStringWith { caseInsensitive = True, multiline = False } source)


imageExts : Regex.Regex
imageExts =
    regexI "\\.(png|jpe?g|gif|webp|avif)$"


videoExts : Regex.Regex
videoExts =
    regexI "\\.(mp4|webm)$"


audioExts : Regex.Regex
audioExts =
    regexI "\\.(mp3|ogg|wav)$"


photoMime : Regex.Regex
photoMime =
    regexI "^image/(jpeg|jpg|pjpeg|png|webp)$"


photoExt : Regex.Regex
photoExt =
    regexI "\\.(jpe?g|png|webp)$"


sizedLine : Regex.Regex
sizedLine =
    regexI "^(\\d+(?:\\.\\d+)?\\s(?:B|KB|MB|GB))\\s+(\\S+)$"


{-| Fail-closed URL sanitizer (mirrors `sanitizeAttachmentUrl`):
trimmed, ≤2048 chars, no controls, no `//` prefix; absolute URLs
must be credential-free http(s) and normalize; relative paths pass
through verbatim. -}
sanitizeAttachmentUrl : String -> Maybe String
sanitizeAttachmentUrl url =
    let
        trimmed =
            String.trim url
    in
    if String.isEmpty trimmed || String.length trimmed > 2048 || hasControl trimmed then
        Nothing

    else if String.startsWith "//" trimmed then
        Nothing

    else if String.contains "://" trimmed then
        case parseAbsoluteUrl trimmed of
            Just parsed ->
                if parsed.scheme /= "http" && parsed.scheme /= "https" then
                    Nothing

                else
                    Just (parsed.scheme ++ "://" ++ parsed.authority ++ parsed.rest)

            Nothing ->
                Nothing

    else
        -- No `://`: `new URL(trimmed, base)` still honors a bare
        -- `scheme:` head, so only http(s) pass through verbatim.
        case splitScheme trimmed of
            Just scheme ->
                if scheme == "http" || scheme == "https" then
                    Just trimmed

                else
                    Nothing

            Nothing ->
                Just trimmed


{-| File-name sanitizer (mirrors `sanitizeFileName`): trims, strips
slashes, caps at 120 chars, rejects controls/empties. -}
sanitizeFileName : Maybe String -> Maybe String
sanitizeFileName maybeName =
    case maybeName of
        Nothing ->
            Nothing

        Just name ->
            let
                base =
                    String.left maxAttachmentName
                        (String.trim (Regex.replace slashBackslash (\_ -> "") name))
            in
            if String.isEmpty base || hasControl base then
                Nothing

            else
                Just base


slashBackslash : Regex.Regex
slashBackslash =
    Maybe.withDefault Regex.never (Regex.fromString "[/\\\\]")


{-| Build `caption\\n[file: name] size url` (mirrors
`buildAttachmentMessage`; null when the URL is unsafe). -}
buildAttachmentMessage : { url : String, name : Maybe String, mime : Maybe String, sizeBytes : Maybe Float, caption : Maybe String } -> Maybe String
buildAttachmentMessage spec =
    case sanitizeAttachmentUrl spec.url of
        Nothing ->
            Nothing

        Just url ->
            let
                name =
                    sanitizeFileName spec.name

                caption =
                    Maybe.map
                        (\c -> String.left maxAttachmentCaption (dropFirstControl (String.trim c)))
                        spec.caption
                        |> Maybe.andThen
                            (\c ->
                                if String.isEmpty c then
                                    Nothing

                                else
                                    Just c
                            )

                header =
                    case name of
                        Just n ->
                            "[file: " ++ n ++ "]"

                        Nothing ->
                            "[file]"

                receipt =
                    case formatFileSize spec.sizeBytes of
                        Just size ->
                            header ++ " " ++ size ++ " " ++ url

                        Nothing ->
                            header ++ " " ++ url
            in
            case caption of
                Just c ->
                    Just (c ++ "\n" ++ receipt)

                Nothing ->
                    Just receipt


{-| Pathname of a URL for kind sniffing (mirrors `urlPathname`;
relative paths pass through). -}
urlPathname : String -> String
urlPathname url =
    case parseAbsoluteUrl url of
        Just parsed ->
            parsed.rest
                |> String.split "?"
                |> List.head
                |> Maybe.withDefault ""
                |> String.split "#"
                |> List.head
                |> Maybe.withDefault ""

        Nothing ->
            url


{-| Kind sniff over pathname then name (mirrors
`classifyAttachmentKind`). -}
classifyAttachmentKind : String -> Maybe String -> AttachmentKind
classifyAttachmentKind url name =
    let
        candidates =
            [ urlPathname url, Maybe.withDefault "" name ]

        sniff value =
            if String.isEmpty value then
                Nothing

            else if Regex.contains imageExts value then
                Just KindImage

            else if Regex.contains videoExts value then
                Just KindVideo

            else if Regex.contains audioExts value then
                Just KindAudio

            else
                Nothing
    in
    case List.filterMap sniff candidates of
        kind :: _ ->
            kind

        [] ->
            KindFile


{-| Parse one `[file]` receipt line (mirrors
`parseAttachmentLine`). -}
parseAttachmentLine : String -> Maybe ParsedAttachment
parseAttachmentLine line =
    let
        trimmed =
            String.trim line
    in
    if not (String.startsWith "[file" trimmed) then
        Nothing

    else
        case String.indexes "]" trimmed of
            [] ->
                Nothing

            close :: _ ->
                if close < 5 then
                    Nothing

                else
                    let
                        header =
                            String.slice 1 close trimmed
                    in
                    if header /= "file" && not (String.startsWith "file:" header) then
                        Nothing

                    else
                        let
                            rest =
                                String.trim (String.dropLeft (close + 1) trimmed)
                        in
                        if String.isEmpty rest then
                            Nothing

                        else
                            let
                                ( sizeLabel, urlRaw ) =
                                    case Regex.find sizedLine rest of
                                        [ match ] ->
                                            case match.submatches of
                                                [ Just size, Just u ] ->
                                                    ( Just size, u )

                                                _ ->
                                                    ( Nothing, rest )

                                        _ ->
                                            if String.contains " " rest then
                                                ( Nothing, "" )

                                            else
                                                ( Nothing, rest )
                            in
                            if String.isEmpty urlRaw then
                                Nothing

                            else
                                case sanitizeAttachmentUrl urlRaw of
                                    Nothing ->
                                        Nothing

                                    Just url ->
                                        let
                                            name =
                                                if String.startsWith "file:" header then
                                                    sanitizeFileName (Just (String.dropLeft 5 header))

                                                else
                                                    Nothing
                                        in
                                        Just
                                            { url = url
                                            , name = name
                                            , sizeLabel = sizeLabel
                                            , kind = classifyAttachmentKind url name
                                            }


{-| Split a body into caption + attachments (mirrors
`extractAttachmentPresentation`). -}
extractAttachmentPresentation : String -> AttachmentPresentation
extractAttachmentPresentation text =
    let
        step line acc =
            case parseAttachmentLine line of
                Just parsed ->
                    { acc | attachments = acc.attachments ++ [ parsed ] }

                Nothing ->
                    { acc | kept = acc.kept ++ [ line ] }

        folded =
            List.foldl step
                { attachments = [], kept = [] }
                (String.split "\n" (String.replace "\u{000D}\n" "\n" text))
    in
    { caption = String.trimRight (String.join "\n" folded.kept)
    , attachments = folded.attachments
    }


{-| Photo check over name + MIME (mirrors `isPhotoFile`). -}
isPhotoFile : { name : String, mime : String } -> Bool
isPhotoFile file =
    Regex.contains photoMime file.mime || Regex.contains photoExt file.name


{-| JPEG EXIF magic `Exif\0\0` (mirrors `JPEG_EXIF_MAGIC`). -}
jpegExifMagic : List Int
jpegExifMagic =
    [ 0x45, 0x78, 0x69, 0x66, 0x00, 0x00 ]


{-| True when JPEG bytes carry an APP1 EXIF segment (mirrors
`hasJpegExif` marker walk, including the strict no-fill-byte scan). -}
hasJpegExif : List Int -> Bool
hasJpegExif bytes =
    case bytes of
        0xFF :: 0xD8 :: rest ->
            hasJpegExifScan rest

        _ ->
            False


hasJpegExifScan : List Int -> Bool
hasJpegExifScan bytes =
    case bytes of
        markerPrefix :: marker :: _ ->
            if markerPrefix /= 0xFF then
                False

            else if marker == 0xDA || marker == 0xD9 then
                False

            else if marker >= 0xD0 && marker <= 0xD7 then
                hasJpegExifScan (List.drop 2 bytes)

            else
                case segmentLength (List.drop 2 bytes) of
                    Nothing ->
                        False

                    Just len ->
                        if len < 2 then
                            False

                        else if marker == 0xE1 && len >= 8 && exifPayloadAt (List.drop 2 bytes) then
                            True

                        else
                            hasJpegExifScan (List.drop (2 + len) bytes)

        _ ->
            False


{-| Big-endian u16 segment length from the two bytes after a marker. -}
segmentLength : List Int -> Maybe Int
segmentLength bytes =
    case bytes of
        hi :: lo :: _ ->
            Just (hi * 256 + lo)

        _ ->
            Nothing


exifPayloadAt : List Int -> Bool
exifPayloadAt bytes =
    List.take 6 (List.drop 2 bytes) == jpegExifMagic


{-| Strip every APP1 segment from JPEG bytes (mirrors `stripJpegExif`,
including fill-byte tolerance; non-APP1 segments pass through). -}
stripJpegExif : List Int -> List Int
stripJpegExif bytes =
    case bytes of
        0xFF :: 0xD8 :: imageRest ->
            0xFF :: 0xD8 :: stripJpegScan imageRest

        _ ->
            bytes


stripJpegScan : List Int -> List Int
stripJpegScan bytes =
    case bytes of
        [] ->
            []

        0xFF :: _ ->
            let
                fillSkipped =
                    skipFillBytes bytes
            in
            case List.drop 1 fillSkipped of
                marker :: afterMarker ->
                    let
                        start =
                            0xFF :: marker :: afterMarker

                        startLen =
                            List.length bytes - List.length fillSkipped
                    in
                    if marker == 0xD9 then
                        List.take 2 start

                    else if marker == 0xDA then
                        start

                    else if marker >= 0xD0 && marker <= 0xD7 then
                        List.take 2 start ++ stripJpegScan (List.drop (startLen + 2) bytes)

                    else
                        case segmentLength afterMarker of
                            Just len ->
                                let
                                    end =
                                        startLen + 2 + len
                                in
                                if len < 2 || end > List.length bytes then
                                    start

                                else if marker == 0xE1 then
                                    stripJpegScan (List.drop end bytes)

                                else
                                    List.take end bytes ++ stripJpegScan (List.drop end bytes)

                            Nothing ->
                                start

                [] ->
                    []

        _ ->
            bytes


{-| Drop leading `0xFF` fill bytes, keeping one (mirrors the oracle's
`while (data[markerAt] === 0xff) markerAt += 1` + `start = markerAt - 1`). -}
skipFillBytes : List Int -> List Int
skipFillBytes bytes =
    case bytes of
        0xFF :: 0xFF :: rest ->
            skipFillBytes (0xFF :: rest)

        _ ->
            bytes


{-| PNG signature (mirrors `isPng`). -}
pngSignature : List Int
pngSignature =
    [ 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A ]


isPngBytes : List Int -> Bool
isPngBytes bytes =
    List.take 8 bytes == pngSignature


{-| True when PNG bytes carry an `eXIf` chunk (mirrors `hasPngExif`). -}
hasPngExif : List Int -> Bool
hasPngExif bytes =
    if not (isPngBytes bytes) then
        False

    else
        hasPngExifScan (List.drop 8 bytes)


hasPngExifScan : List Int -> Bool
hasPngExifScan bytes =
    case pngChunkAt bytes of
        Nothing ->
            False

        Just { chunkType, rest, isIend } ->
            if chunkType == "eXIf" then
                True

            else if isIend then
                False

            else
                hasPngExifScan rest


{-| Strip every `eXIf` chunk from PNG bytes (mirrors `stripPngExif`). -}
stripPngExif : List Int -> List Int
stripPngExif bytes =
    if not (isPngBytes bytes) then
        bytes

    else
        pngSignature ++ stripPngScan (List.drop 8 bytes)


stripPngScan : List Int -> List Int
stripPngScan bytes =
    case pngChunkAt bytes of
        Nothing ->
            []

        Just { raw, chunkType, rest, isIend } ->
            if isIend then
                raw

            else if chunkType == "eXIf" then
                stripPngScan rest

            else
                raw ++ stripPngScan rest


type alias PngChunk =
    { raw : List Int
    , chunkType : String
    , rest : List Int
    , isIend : Bool
    }


{-| Split one PNG chunk: length u32 + 4 type bytes + payload + 4 CRC
bytes (mirrors the oracle's `12 + length` stride). -}
pngChunkAt : List Int -> Maybe PngChunk
pngChunkAt bytes =
    case bytes of
        b0 :: b1 :: b2 :: b3 :: t0 :: t1 :: t2 :: t3 :: _ ->
            let
                len =
                    b0 * 16777216 + b1 * 65536 + b2 * 256 + b3

                total =
                    12 + len

                chunkType =
                    String.fromList (List.map Char.fromCode [ t0, t1, t2, t3 ])
            in
            if total > List.length bytes then
                Nothing

            else
                Just
                    { raw = List.take total bytes
                    , chunkType = chunkType
                    , rest = List.drop total bytes
                    , isIend = chunkType == "IEND"
                    }

        _ ->
            Nothing


{-| Compact-path long-edge cap (mirrors `compactPhoto` `maxEdge`). -}
compactPhotoMaxEdge : Int
compactPhotoMaxEdge =
    1600


{-| Compact-path JPEG quality (mirrors `compactPhoto` `toBlob` quality). -}
compactPhotoJpegQuality : Float
compactPhotoJpegQuality =
    0.72


{-| Original/Compact picker labels with honest sizes (mirrors
`photoQualityOptions`; Compact appears only when recompression
succeeded — callers must show sizes, never silently swap). -}
photoQualityOptions : Float -> Maybe Float -> List { quality : String, label : String, bytes : Float }
photoQualityOptions originalBytes compactBytes =
    let
        original =
            { quality = "original"
            , label = "Original · " ++ formatAttachmentBytes originalBytes
            , bytes = originalBytes
            }
    in
    case compactBytes of
        Nothing ->
            [ original ]

        Just compact ->
            [ original
            , { quality = "compact"
              , label = "Compact · " ++ formatAttachmentBytes compact
              , bytes = compact
              }
            ]


{-| Split absolute URL (mirrors `new URL` for the shapes servers
emit): `scheme://authority` + rest. Rejects missing scheme,
credentials (`@`), empty hosts, and bad ports fail-closed. -}
type alias ParsedUrl =
    { scheme : String
    , authority : String
    , host : String
    , rest : String
    }


parseAbsoluteUrl : String -> Maybe ParsedUrl
parseAbsoluteUrl raw =
    case String.indexes "://" raw of
        [] ->
            Nothing

        sep :: _ ->
            let
                scheme =
                    String.toLower (String.left sep raw)

                after =
                    String.dropLeft (sep + 3) raw
            in
            if not (Regex.contains schemeShape scheme) then
                Nothing

            else
                let
                    ( authority, rest ) =
                        splitAuthority after
                in
                if String.isEmpty authority || String.contains "@" authority then
                    Nothing

                else
                    case splitHostPort authority of
                        Nothing ->
                            Nothing

                        Just ( host, portText ) ->
                            let
                                clean =
                                    stripTrailingDots (String.toLower host)
                            in
                            if String.isEmpty clean then
                                Nothing

                            else
                                Just
                                    { scheme = scheme
                                    , authority = clean ++ portText
                                    , host = clean
                                    , rest = rest
                                    }


schemeShape : Regex.Regex
schemeShape =
    Maybe.withDefault Regex.never (Regex.fromString "^[a-z][a-z0-9+.-]*$")


splitAuthority : String -> ( String, String )
splitAuthority after =
    let
        cuts =
            List.filterMap
                (\sep ->
                    case String.indexes sep after of
                        i :: _ ->
                            Just i

                        [] ->
                            Nothing
                )
                [ "/", "?", "#" ]
    in
    case List.minimum cuts of
        Just i ->
            ( String.left i after, String.dropLeft i after )

        Nothing ->
            ( after, "" )


splitHostPort : String -> Maybe ( String, String )
splitHostPort authority =
    if String.startsWith "[" authority then
        case String.indexes "]" authority of
            [] ->
                Nothing

            close :: _ ->
                let
                    inner =
                        String.slice 1 close authority

                    tail =
                        String.dropLeft (close + 1) authority
                in
                if String.isEmpty tail then
                    Just ( "[" ++ inner ++ "]", "" )

                else if String.startsWith ":" tail && allDigits (String.dropLeft 1 tail) && not (String.isEmpty (String.dropLeft 1 tail)) then
                    Just ( "[" ++ inner ++ "]", tail )

                else
                    Nothing

    else
        case String.indexes ":" authority of
            [] ->
                Just ( authority, "" )

            _ ->
                let
                    parts =
                        String.split ":" authority

                    portPart =
                        Maybe.withDefault "" (List.head (List.reverse parts))

                    host =
                        String.join ":" (List.take (List.length parts - 1) parts)
                in
                if String.contains ":" host || String.isEmpty portPart || not (allDigits portPart) then
                    Nothing

                else
                    Just ( host, ":" ++ portPart )


allDigits : String -> Bool
allDigits value =
    not (String.isEmpty value)
        && List.all (\c -> Char.toCode c >= 0x30 && Char.toCode c <= 0x39) (String.toList value)


stripTrailingDots : String -> String
stripTrailingDots host =
    if String.endsWith "." host then
        stripTrailingDots (String.dropRight 1 host)

    else
        host


{-| Scheme of a `scheme:...` string (mirrors the oracle
`/^[a-z][a-z\d+.-]*:/` head test), lowercased. -}
splitScheme : String -> Maybe String
splitScheme raw =
    if Regex.contains schemePrefix raw then
        case String.indexes ":" raw of
            sep :: _ ->
                Just (String.toLower (String.left sep raw))

            [] ->
                Nothing

    else
        Nothing


{-| POST endpoint for the configured media URL (mirrors
`buildUploadEndpoint`; `Nothing` is the unset default `/upload`). -}
buildUploadEndpoint : Maybe String -> Result String String
buildUploadEndpoint maybeMediaUrl =
    case maybeMediaUrl of
        Nothing ->
            Ok "/upload"

        Just configured ->
            let
                base =
                    String.trim configured
            in
            if String.isEmpty base then
                Err "Media upload URL is not configured."

            else
                let
                    normalized =
                        stripTrailingSlashes base
                in
                if String.startsWith "//" normalized then
                    Err "Media upload URL must use HTTP(S) or a root-relative path."

                else
                    case splitScheme normalized of
                        Just scheme ->
                            if scheme /= "http" && scheme /= "https" then
                                Err "Media upload URL must use HTTP(S)."

                            else if String.contains "://" normalized then
                                case parseAbsoluteUrl normalized of
                                    Just _ ->
                                        if String.endsWith "/upload" normalized then
                                            Ok normalized

                                        else
                                            Ok (normalized ++ "/upload")

                                    Nothing ->
                                        Err "Media upload URL is invalid."

                            else if String.endsWith "/upload" normalized then
                                Ok normalized

                            else
                                Ok (normalized ++ "/upload")

                        Nothing ->
                            if not (String.startsWith "/" normalized) then
                                Err "Media upload URL must be absolute or root-relative."

                            else if String.endsWith "/upload" normalized then
                                Ok normalized

                            else
                                Ok (normalized ++ "/upload")


schemePrefix : Regex.Regex
schemePrefix =
    regexI "^[a-z][a-z0-9+.-]*:"


stripTrailingSlashes : String -> String
stripTrailingSlashes value =
    if String.endsWith "/" value && String.length value > 1 then
        stripTrailingSlashes (String.dropRight 1 value)

    else
        value


{-| Origin of an absolute media URL (`scheme://host`), or nothing
for the default root-relative endpoint (mirrors `baseOrigin`). -}
mediaOrigin : String -> Maybe String
mediaOrigin mediaUrl =
    case parseAbsoluteUrl (String.trim mediaUrl) of
        Just parsed ->
            if parsed.scheme == "http" || parsed.scheme == "https" then
                Just (parsed.scheme ++ "://" ++ parsed.authority)

            else
                Nothing

        Nothing ->
            Nothing


{-| Resolve a served file URL (mirrors `resolveUploadUrl`). -}
resolveUploadUrl : String -> String -> Result String String
resolveUploadUrl mediaUrl returnedUrl =
    if String.length returnedUrl > uploadUrlMaxLength then
        Err "Upload response file URL is too long."

    else
        let
            raw =
                String.trim returnedUrl
        in
        if String.isEmpty raw then
            Err "Upload response did not include a file URL."

        else if String.startsWith "//" raw then
            Err "Upload response returned an unsafe file URL."

        else if String.contains "://" raw then
            case parseAbsoluteUrl raw of
                Just parsed ->
                    if parsed.scheme /= "http" && parsed.scheme /= "https" then
                        Err "Upload response returned an unsafe file URL."

                    else
                        Ok (parsed.scheme ++ "://" ++ parsed.authority ++ parsed.rest)

                Nothing ->
                    Err "Upload response returned an unsafe file URL."

        else
            case splitScheme raw of
                Just scheme ->
                    if scheme /= "http" && scheme /= "https" then
                        Err "Upload response returned an unsafe file URL."

                    else
                        -- Bare `http:host` serializes with a root slash
                        -- (mirrors `new URL(...).toString()`).
                        let
                            host =
                                String.dropLeft (String.length scheme + 1) raw
                        in
                        if String.isEmpty host || hasControl host || String.contains " " host || String.contains "@" host then
                            Err "Upload response returned an unsafe file URL."

                        else if String.contains "/" host || String.contains "?" host || String.contains "#" host then
                            Err "Upload response returned an unsafe file URL."

                        else
                            Ok (scheme ++ "://" ++ String.toLower host ++ "/")

                Nothing ->
                    case mediaOrigin mediaUrl of
                        Nothing ->
                            if String.startsWith "/" raw then
                                Ok raw

                            else if String.startsWith "uploads/" raw then
                                Ok ("/" ++ raw)

                            else
                                Ok ("/uploads/" ++ stripLeadingSlashes raw)

                        Just origin ->
                            if String.startsWith "/" raw then
                                Ok (origin ++ raw)

                            else if String.startsWith "uploads/" raw then
                                Ok (origin ++ "/" ++ raw)

                            else
                                Ok (origin ++ "/uploads/" ++ stripLeadingSlashes raw)


stripLeadingSlashes : String -> String
stripLeadingSlashes value =
    if String.startsWith "/" value then
        stripLeadingSlashes (String.dropLeft 1 value)

    else
        value


{-| Upload progress percent (mirrors the oracle `percent` rule). -}
progressPercent : Int -> Maybe Int -> Maybe Int
progressPercent loaded total =
    case total of
        Just t ->
            if t > 0 then
                Just (round (toFloat loaded / toFloat t * 100))

            else
                Nothing

        Nothing ->
            Nothing


{-| Parse an upload response body (mirrors `parseUploadResponse`:
64 KiB cap, JSON shape with ordered candidates, else trimmed
text). -}
parseUploadResponse : String -> String -> String -> Result String String
parseUploadResponse mediaUrl body contentType =
    if Base64Url.utf8ByteLength body > uploadResponseMaxBytes then
        Err "Upload service response was too large."

    else if String.contains "application/json" (String.toLower contentType) then
        case Decode.decodeString Decode.value body of
            Err _ ->
                Err "Upload service returned invalid JSON."

            Ok value ->
                case firstCandidate (responseCandidates value) of
                    Nothing ->
                        Err "Upload response did not include a file URL."

                    Just url ->
                        resolveUploadUrl mediaUrl url

    else
        let
            text =
                String.trim body
        in
        if String.isEmpty text then
            Err "Upload response did not include a file URL."

        else
            resolveUploadUrl mediaUrl text


responseCandidates : Decode.Value -> List (Maybe String)
responseCandidates value =
    let
        soft field scope =
            case Decode.decodeValue (Decode.maybe (Decode.field field Decode.string)) scope of
                Ok (Just s) ->
                    Just s

                _ ->
                    Nothing

        softPath fields =
            case fields of
                [ last ] ->
                    soft last value

                first :: rest ->
                    case Decode.decodeValue (Decode.maybe (Decode.field first Decode.value)) value of
                        Ok (Just nested) ->
                            softNested nested rest

                        _ ->
                            Nothing

                [] ->
                    Nothing

        softNested nested fields =
            case fields of
                [ last ] ->
                    soft last nested

                _ ->
                    Nothing
    in
    [ soft "url" value
    , soft "href" value
    , soft "path" value
    , softPath [ "file", "url" ]
    , softPath [ "file", "path" ]
    , soft "filename" value
    , soft "name" value
    ]


firstCandidate : List (Maybe String) -> Maybe String
firstCandidate candidates =
    case candidates of
        [] ->
            Nothing

        Nothing :: rest ->
            firstCandidate rest

        (Just raw) :: rest ->
            if String.isEmpty (String.trim raw) then
                firstCandidate rest

            else
                Just raw


{-| Unfurl privacy prefs (mirrors `UnfurlPrivacyPrefs`). -}
type alias UnfurlPrefs =
    { linkPreviews : Bool
    , httpsOnly : Bool
    , blockedHosts : List String
    }


{-| Fail-closed defaults (mirrors `DEFAULT_UNFURL_PRIVACY`). -}
defaultUnfurlPrivacy : UnfurlPrefs
defaultUnfurlPrivacy =
    { linkPreviews = True, httpsOnly = True, blockedHosts = [] }


{-| Scheme-only gate defaults (mirrors `PREVIEW_SSRF_ONLY`). -}
previewSsrfOnly : UnfurlPrefs
previewSsrfOnly =
    { linkPreviews = True, httpsOnly = False, blockedHosts = [] }


{-| Map the `linkPreviews` switch onto full prefs (mirrors
`unfurlPrivacyFromLinkPreviews`). -}
unfurlPrivacyFromLinkPreviews : Bool -> { httpsOnly : Bool, blockedHosts : List String } -> UnfurlPrefs
unfurlPrivacyFromLinkPreviews linkPreviews overrides =
    { linkPreviews = linkPreviews
    , httpsOnly = overrides.httpsOnly
    , blockedHosts = overrides.blockedHosts
    }


{-| Normalize a hostname (mirrors `normalizeHost`). -}
normalizeHost : String -> String
normalizeHost host =
    stripTrailingDots (String.toLower host)


{-| Shared privacy gate (mirrors `mayUnfurlUrl`). -}
mayUnfurlUrl : String -> UnfurlPrefs -> Bool
mayUnfurlUrl url prefs =
    if not prefs.linkPreviews then
        False

    else
        case parseAbsoluteUrl url of
            Nothing ->
                False

            Just parsed ->
                if parsed.scheme /= "http" && parsed.scheme /= "https" then
                    False

                else if prefs.httpsOnly && parsed.scheme /= "https" then
                    False

                else
                    let
                        host =
                            normalizeHost parsed.host
                    in
                    if host == "localhost" || String.endsWith ".localhost" host || String.endsWith ".local" host || host == "127.0.0.1" || host == "[::1]" || String.endsWith ".internal" host then
                        False

                    else if Regex.contains privateV4Prefix host then
                        False

                    else
                        not (blockedBySuffix host prefs.blockedHosts)


privateV4Prefix : Regex.Regex
privateV4Prefix =
    Maybe.withDefault Regex.never (Regex.fromString "^10\\.|^192\\.168\\.|^172\\.(1[6-9]|2\\d|3[0-1])\\.")


blockedBySuffix : String -> List String -> Bool
blockedBySuffix host blockedHosts =
    List.any
        (\suffix ->
            let
                s =
                    String.toLower (String.trim suffix)
            in
            not (String.isEmpty s) && (host == s || String.endsWith ("." ++ s) host)
        )
        blockedHosts


{-| Non-routable host names (mirrors `BLOCKED_HOSTNAMES`). -}
blockedHostnames : List String
blockedHostnames =
    [ "localhost", "ip6-localhost", "ip6-loopback", "broadcasthost" ]


{-| Hosts whose uploads render inline (mirrors `SKIP_HOSTS`). -}
skipHosts : List String
skipHosts =
    [ "eshmaki.me", "www.eshmaki.me" ]


{-| Href scan cap (mirrors `LINK_PREVIEW_HREF_SCAN_MAX`). -}
linkPreviewHrefScanMax : Int
linkPreviewHrefScanMax =
    64


{-| Field caps (mirrors `LINK_PREVIEW_*_MAX`). -}
linkPreviewUrlMax : Int
linkPreviewUrlMax =
    2048


linkPreviewTitleMax : Int
linkPreviewTitleMax =
    512


linkPreviewDescriptionMax : Int
linkPreviewDescriptionMax =
    2048


linkPreviewSiteMax : Int
linkPreviewSiteMax =
    128


{-| Private IPv4 literal (mirrors `isPrivateIPv4`, malformed quads
included). -}
isPrivateIPv4 : String -> Bool
isPrivateIPv4 host =
    case Regex.find ipv4Quad host of
        [ match ] ->
            case List.map (Maybe.withDefault "999" >> String.toInt >> Maybe.withDefault 999) match.submatches of
                [ a, b, c, d ] ->
                    if a > 255 || b > 255 || c > 255 || d > 255 then
                        True

                    else
                        a == 0 || a == 10 || a == 127 || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 100 && b >= 64 && b <= 127)

                _ ->
                    False

        _ ->
            False


ipv4Quad : Regex.Regex
ipv4Quad =
    Maybe.withDefault Regex.never (Regex.fromString "^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")


{-| Private IPv6 literal (mirrors `isPrivateIPv6`). -}
isPrivateIPv6 : String -> Bool
isPrivateIPv6 host =
    if not (String.startsWith "[" host) || not (String.endsWith "]" host) then
        False

    else
        let
            inner =
                String.toLower (String.slice 1 -1 host)
        in
        if inner == "::1" || inner == "::" then
            True

        else if Regex.contains uniqueLocalV6 inner then
            True

        else if Regex.contains linkLocalV6 inner then
            True

        else
            case Regex.find mappedDottedV6 inner of
                [ match ] ->
                    case match.submatches of
                        [ Just dotted ] ->
                            isPrivateIPv4 dotted

                        _ ->
                            mappedHexV6 inner

                _ ->
                    mappedHexV6 inner


uniqueLocalV6 : Regex.Regex
uniqueLocalV6 =
    regexI "^f[cd][0-9a-f]{2}:"


linkLocalV6 : Regex.Regex
linkLocalV6 =
    regexI "^fe[89ab][0-9a-f]:"


mappedDottedV6 : Regex.Regex
mappedDottedV6 =
    Maybe.withDefault Regex.never (Regex.fromString "::ffff:(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})$")


mappedHexV6 : String -> Bool
mappedHexV6 inner =
    case Regex.find (Maybe.withDefault Regex.never (Regex.fromString "::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$")) inner of
        [ match ] ->
            case match.submatches of
                [ Just hiHex, Just loHex ] ->
                    case ( hexValue hiHex, hexValue loHex ) of
                        ( Just hi, Just lo ) ->
                            isPrivateIPv4
                                (String.fromInt (hi // 256)
                                    ++ "."
                                    ++ String.fromInt (remainderBy 256 hi)
                                    ++ "."
                                    ++ String.fromInt (lo // 256)
                                    ++ "."
                                    ++ String.fromInt (remainderBy 256 lo)
                                )

                        _ ->
                            False

                _ ->
                    False

        _ ->
            False


hexValue : String -> Maybe Int
hexValue digits =
    List.foldl
        (\c acc ->
            case acc of
                Nothing ->
                    Nothing

                Just n ->
                    let
                        code =
                            Char.toCode (Char.toLower c)
                    in
                    if code >= 0x30 && code <= 0x39 then
                        Just (n * 16 + (code - 0x30))

                    else if code >= 0x61 && code <= 0x66 then
                        Just (n * 16 + (code - 0x61 + 10))

                    else
                        Nothing
        )
        (Just 0)
        (String.toList digits)


{-| Safe preview target gate (mirrors `isPreviewableUrl`). -}
isPreviewableUrl : String -> UnfurlPrefs -> Bool
isPreviewableUrl href prefs =
    if String.isEmpty href || String.length href > linkPreviewUrlMax then
        False

    else if not (mayUnfurlUrl href prefs) then
        False

    else
        case parseAbsoluteUrl href of
            Nothing ->
                False

            Just parsed ->
                if parsed.scheme /= "http" && parsed.scheme /= "https" then
                    False

                else
                    let
                        host =
                            normalizeHost parsed.host
                    in
                    if String.isEmpty host then
                        False

                    else if List.member host blockedHostnames then
                        False

                    else if String.endsWith ".local" host || String.endsWith ".internal" host || String.endsWith ".localhost" host then
                        False

                    else if isPrivateIPv4 parsed.host then
                        False

                    else if isPrivateIPv6 parsed.host then
                        False

                    else
                        True


{-| Pick the preview URL from message hrefs (mirrors
`pickPreviewUrl`). -}
pickPreviewUrl : List String -> UnfurlPrefs -> Maybe String
pickPreviewUrl hrefs prefs =
    List.foldl
        (\href found ->
            case found of
                Just _ ->
                    found

                Nothing ->
                    if not (isPreviewableUrl href prefs) then
                        Nothing

                    else
                        case parseAbsoluteUrl href of
                            Nothing ->
                                Nothing

                            Just parsed ->
                                let
                                    skipHost =
                                        normalizeHost parsed.host

                                    path =
                                        urlPathname href
                                in
                                if List.member skipHost skipHosts && String.startsWith "/uploads/" path then
                                    Nothing

                                else
                                    Just href
        )
        Nothing
        (List.take linkPreviewHrefScanMax hrefs)


{-| Fetched preview card (mirrors `LinkPreview`). -}
type alias LinkPreview =
    { url : String
    , title : String
    , description : String
    , image : String
    , site : String
    }


{-| Validate a fetched preview payload (mirrors `normalize`:
bounds, canonical/image re-validation, empty cards are null). -}
normalizePreview : Decode.Value -> String -> Maybe LinkPreview
normalizePreview value fallbackUrl =
    let
        field name cap =
            Result.withDefault ""
                (Decode.decodeValue
                    (Decode.oneOf
                        [ Decode.field name (Decode.map (\s -> String.left cap (String.trim s)) Decode.string)
                        , Decode.succeed ""
                        ]
                    )
                    value
                )

        canonical =
            field "url" linkPreviewUrlMax

        image =
            field "image" linkPreviewUrlMax

        preview =
            { url =
                if not (String.isEmpty canonical) && isPreviewableUrl canonical previewSsrfOnly then
                    canonical

                else
                    fallbackUrl
            , title = field "title" linkPreviewTitleMax
            , description = field "description" linkPreviewDescriptionMax
            , image =
                if not (String.isEmpty image) && isPreviewableUrl image previewSsrfOnly then
                    image

                else
                    ""
            , site = field "site" linkPreviewSiteMax
            }
    in
    if String.isEmpty preview.title && String.isEmpty preview.description && String.isEmpty preview.image then
        Nothing

    else
        Just preview
