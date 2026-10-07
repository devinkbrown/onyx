module Webhook exposing
    ( WebhookBlock(..)
    , WebhookEmbed
    , WebhookEmbedField
    , WebhookPayload
    , containsWebhookWord
    , formatNoticeBody
    , maxCreateNameChars
    , maxJsonChars
    , maxLineChars
    , maxLines
    , parsePayloadJson
    , payloadToLines
    , payloadToMessage
    )

{-| Discord-compatible incoming webhooks: render webhook JSON payloads
as plain IRC-safe text (mirroring `webhookBlockKit.ts`).

Server-side webhooks already flatten at ingress. This is the parity
path for NOTICE (or imported) bodies that still carry raw Discord
webhook JSON — fail closed on non-JSON / non-webhook shapes and
scrub C0 controls. Pure: no ports, no storage.
-}

import Json.Decode as Decode


{-| Bound hostile JSON parse work (mirrors `MAX_JSON_CHARS`). -}
maxJsonChars : Int
maxJsonChars =
    12000


{-| Per-line scrub cap (mirrors `MAX_LINE`). -}
maxLineChars : Int
maxLineChars =
    400


{-| Flattened line cap (mirrors `MAX_LINES`). -}
maxLines : Int
maxLines =
    24


{-| Field-name scrub cap (mirrors the inline `80`). -}
maxFieldNameChars : Int
maxFieldNameChars =
    80


{-| Field-value scrub cap (mirrors the inline `200`). -}
maxFieldValueChars : Int
maxFieldValueChars =
    200


{-| Webhook create name cap (mirrors the `slice(0, 32)`). -}
maxCreateNameChars : Int
maxCreateNameChars =
    32


type WebhookBlock
    = BlockSection (Maybe String)
    | BlockHeader (Maybe String)
    | BlockDivider
    | BlockContext (List String)
    | BlockUnknown (Maybe String)


type alias WebhookEmbedField =
    { name : Maybe String
    , value : Maybe String
    }


type alias WebhookEmbed =
    { title : Maybe String
    , description : Maybe String
    , url : Maybe String
    , fields : List WebhookEmbedField
    }


type alias WebhookPayload =
    { content : Maybe String
    , username : Maybe String
    , embeds : List WebhookEmbed
    , blocks : List WebhookBlock
    }


{-| Discord Block Kit often nests `text: { type, text }` — accept
either form (mirrors `coerceTextField`). Never fails: unusable
shapes decode to `Nothing`.
-}
textValue : Decode.Decoder (Maybe String)
textValue =
    Decode.oneOf
        [ Decode.map Just Decode.string
        , Decode.map Just (Decode.field "text" Decode.string)
        , Decode.succeed Nothing
        ]


{-| An optional string field of a record (mirrors `readString`:
missing or non-string reads as absent).
-}
optionalTextField : String -> Decode.Decoder (Maybe String)
optionalTextField key =
    Decode.oneOf
        [ Decode.field key textValue
        , Decode.succeed Nothing
        ]


decodeOptionalText : Decode.Value -> String -> Maybe String
decodeOptionalText value key =
    Decode.decodeValue (Decode.field key textValue) value
        |> Result.toMaybe
        |> Maybe.andThen identity


isObjectValue : Decode.Value -> Bool
isObjectValue value =
    case Decode.decodeValue (Decode.keyValuePairs Decode.value) value of
        Ok _ ->
            True

        Err _ ->
            False


{-| One block (mirrors `parseBlock`): untyped or unshaped items are
skipped; `context` keeps only defined texts; anything else with a
text becomes `unknown`.
-}
parseBlockValue : Decode.Value -> Maybe WebhookBlock
parseBlockValue value =
    case Decode.decodeValue (Decode.field "type" Decode.string) value of
        Err _ ->
            Nothing

        Ok blockType ->
            case blockType of
                "divider" ->
                    Just BlockDivider

                "header" ->
                    Just (BlockHeader (decodeOptionalText value "text"))

                "section" ->
                    Just (BlockSection (decodeOptionalText value "text"))

                "context" ->
                    Just (BlockContext (decodeContextElements value))

                _ ->
                    Just (BlockUnknown (decodeOptionalText value "text"))


decodeContextElements : Decode.Value -> List String
decodeContextElements value =
    case Decode.decodeValue (Decode.field "elements" (Decode.list textValue)) value of
        Ok texts ->
            List.filterMap identity texts

        Err _ ->
            []


parseEmbedFieldValue : Decode.Value -> Maybe WebhookEmbedField
parseEmbedFieldValue value =
    if isObjectValue value then
        Just
            { name = decodeOptionalText value "name"
            , value = decodeOptionalText value "value"
            }

    else
        Nothing


{-| One embed (mirrors `parseEmbed`): non-objects are skipped, fields
default to empty, nameless/valueless fields are kept for the
render pass to decide.
-}
parseEmbedValue : Decode.Value -> Maybe WebhookEmbed
parseEmbedValue value =
    if isObjectValue value then
        Just
            { title = decodeOptionalText value "title"
            , description = decodeOptionalText value "description"
            , url = decodeOptionalText value "url"
            , fields = decodeEmbedFields value
            }

    else
        Nothing


decodeEmbedFields : Decode.Value -> List WebhookEmbedField
decodeEmbedFields value =
    case Decode.decodeValue (Decode.field "fields" (Decode.list Decode.value)) value of
        Ok raws ->
            List.filterMap parseEmbedFieldValue raws

        Err _ ->
            []


payloadDecoder : Decode.Decoder WebhookPayload
payloadDecoder =
    Decode.map4 WebhookPayload
        (optionalTextField "content")
        (optionalTextField "username")
        (Decode.oneOf
            [ Decode.field "embeds" (Decode.list Decode.value)
                |> Decode.map (List.filterMap parseEmbedValue)
            , Decode.succeed []
            ]
        )
        (Decode.oneOf
            [ Decode.field "blocks" (Decode.list Decode.value)
                |> Decode.map (List.filterMap parseBlockValue)
            , Decode.succeed []
            ]
        )


hasSurface : WebhookPayload -> Bool
hasSurface payload =
    case payload.content of
        Just content ->
            if not (String.isEmpty content) then
                True

            else
                not (List.isEmpty payload.embeds) || not (List.isEmpty payload.blocks)

        Nothing ->
            not (List.isEmpty payload.embeds) || not (List.isEmpty payload.blocks)


{-| Parse a raw NOTICE/message body as Discord-compatible webhook
JSON (mirrors `parseWebhookPayloadJson`). `Nothing` when the body
is not JSON or not webhook-shaped — bare `{}` and unrelated
objects stay as the original message body.
-}
parsePayloadJson : String -> Maybe WebhookPayload
parsePayloadJson raw =
    let
        trimmed =
            String.trim raw
    in
    if String.length trimmed < 2 || String.length trimmed > maxJsonChars then
        Nothing

    else if not (String.startsWith "{" trimmed && String.endsWith "}" trimmed) then
        Nothing

    else
        case Decode.decodeString payloadDecoder trimmed of
            Err _ ->
                Nothing

            Ok payload ->
                if hasSurface payload then
                    Just payload

                else
                    Nothing


isControlChar : Char -> Bool
isControlChar char =
    let
        code =
            Char.toCode char
    in
    code < 0x20 || code == 0x7F


{-| Scrub one line (mirrors `clean`): C0/DEL to space, whitespace
runs collapsed, trimmed, capped.
-}
scrubLine : Int -> String -> String
scrubLine max text =
    String.left max (String.join " " (String.words (String.map (\c -> if isControlChar c then ' ' else c) text)))


appendLine : Maybe String -> List String -> List String
appendLine maybeText lines =
    case maybeText of
        Nothing ->
            lines

        Just text ->
            case scrubLine maxLineChars text of
                "" ->
                    lines

                cleaned ->
                    lines ++ [ cleaned ]


appendBlock : WebhookBlock -> List String -> List String
appendBlock block lines =
    case block of
        BlockDivider ->
            appendLine (Just "———") lines

        BlockHeader text ->
            appendLine (Maybe.map (\s -> "## " ++ s) text) lines

        BlockSection text ->
            appendLine text lines

        BlockContext elements ->
            List.foldl (\el acc -> appendLine (Just el) acc) lines elements

        BlockUnknown text ->
            appendLine text lines


appendField : WebhookEmbedField -> List String -> List String
appendField field lines =
    let
        name =
            scrubLine maxFieldNameChars (Maybe.withDefault "" field.name)

        value =
            scrubLine maxFieldValueChars (Maybe.withDefault "" field.value)
    in
    if not (String.isEmpty name) && not (String.isEmpty value) then
        lines ++ [ name ++ ": " ++ value ]

    else if not (String.isEmpty name) then
        lines ++ [ name ]

    else if not (String.isEmpty value) then
        lines ++ [ value ]

    else
        lines


appendEmbed : WebhookEmbed -> List String -> List String
appendEmbed embed lines =
    List.foldl appendField
        (appendLine embed.url (appendLine embed.description (appendLine embed.title lines)))
        embed.fields


{-| Flatten a payload to IRC-safe lines (mirrors
`webhookPayloadToLines`): author, content, blocks, then embeds,
capped at 24 lines.
-}
payloadToLines : WebhookPayload -> List String
payloadToLines payload =
    List.take maxLines
        (List.foldl appendEmbed
            (List.foldl appendBlock
                (appendLine payload.content
                    (appendLine (Maybe.map (\u -> "• " ++ u) payload.username) [])
                )
                payload.blocks
            )
            payload.embeds
        )


{-| Flatten a payload to one multiline message (mirrors
`webhookPayloadToMessage`).
-}
payloadToMessage : WebhookPayload -> String
payloadToMessage payload =
    String.join "\n" (payloadToLines payload)


{-| Format a NOTICE body (mirrors `formatWebhookNoticeBody`): when it
is Discord webhook JSON, flatten to IRC-safe multiline text;
otherwise return the original body unchanged.
-}
formatNoticeBody : String -> String
formatNoticeBody text =
    case parsePayloadJson text of
        Nothing ->
            text

        Just payload ->
            let
                flat =
                    payloadToMessage payload
            in
            if String.isEmpty flat then
                text

            else
                flat


{-| The oracle service-source gate (`/\bWEBHOOK\b/` over the
uppercased text): word tokens are runs of `[A-Za-z0-9_]`, matching
the JS `\w` word class behind `\b`.
-}
containsWebhookWord : String -> Bool
containsWebhookWord text =
    List.member "WEBHOOK" (wordTokens (String.toUpper text))


wordTokens : String -> List String
wordTokens text =
    let
        step char ( current, done ) =
            if isWordChar char then
                ( String.cons char current, done )

            else if String.isEmpty current then
                ( "", done )

            else
                ( "", current :: done )

        ( tail, parts ) =
            String.foldr step ( "", [] ) text
    in
    if String.isEmpty tail then
        parts

    else
        tail :: parts


isWordChar : Char -> Bool
isWordChar char =
    (char >= 'A' && char <= 'Z')
        || (char >= 'a' && char <= 'z')
        || (char >= '0' && char <= '9')
        || char == '_'
