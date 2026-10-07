module Wire exposing
    ( AccountInfoFields
    , IrcMessage
    , MonitorKind(..)
    , MonitorNumeric
    , SaslMechanism(..)
    , SessionCredential
    , StandardReply
    , StandardReplyKind(..)
    , buildSessionResumeLine
    , chunkSaslPayload
    , escapeTagValue
    , formatIrcLine
    , formatTaggedLine
    , isValidSessionCredential
    , maxServerTimeBytes
    , maxServerTimeMs
    , maxClientSaslMechanisms
    , maxIrcCommandLength
    , maxIrcMessageParams
    , maxIrcPrefixLength
    , maxIrcv3MessageTags
    , maxIrcv3TagKeyLength
    , maxIrcv3TagValueLength
    , maxSessionCredentialLength
    , maxStandardReplyParams
    , maxStandardReplyTokenLength
    , maxWireFrameLines
    , normalizeCase
    , parseAccountInfo
    , parseChanLimit
    , parseIrcMessage
    , parseMonitorNumeric
    , parseNamesPrefix
    , parsePrefix
    , parseSaslMechanisms
    , parseServerTime
    , parseSessionMeshTokenNote
    , parseSessionTokenNote
    , parseStandardReply
    , saslChunkBytes
    , saslMechanismName
    , selectSaslMechanism
    , splitWireFrame
    , unescapeTagValue
    )

{-| IRC wire framing, parsing, and formatting — Elm port of
`src/lib/irc/parser.ts` (+ the `IRCMessage`/`StandardReply` subset of
`src/lib/irc/types.ts`).

Identical bounds, identical fail-closed behavior, pure functions. The
TypeScript sources remain the web-behavior oracle; the test suite in
`tests/WireTest.elm` mirrors its vectors.
-}

import Dict exposing (Dict)
import Regex exposing (Regex)
import Set exposing (Set)


maxIrcv3MessageTags : Int
maxIrcv3MessageTags =
    256


maxIrcv3TagKeyLength : Int
maxIrcv3TagKeyLength =
    256


maxIrcv3TagValueLength : Int
maxIrcv3TagValueLength =
    64 * 1024


maxIrcv3TagBlockLength : Int
maxIrcv3TagBlockLength =
    128 * 1024


maxWireFrameLines : Int
maxWireFrameLines =
    512


maxIrcPrefixLength : Int
maxIrcPrefixLength =
    512


maxIrcCommandLength : Int
maxIrcCommandLength =
    64


maxIrcMessageParams : Int
maxIrcMessageParams =
    512


maxStandardReplyParams : Int
maxStandardReplyParams =
    32


maxStandardReplyTokenLength : Int
maxStandardReplyTokenLength =
    4 * 1024


maxStandardReplyMemoLength : Int
maxStandardReplyMemoLength =
    128 * 1024


maxSessionCredentialLength : Int
maxSessionCredentialLength =
    4 * 1024


type alias IrcMessage =
    { tags : Dict String String
    , prefix : Maybe String
    , nick : Maybe String
    , host : Maybe String
    , command : String
    , params : List String
    , raw : String
    }


type StandardReplyKind
    = Note
    | Fail
    | Warn


type alias StandardReply =
    { kind : StandardReplyKind
    , command : String
    , code : String
    , context : List String
    , description : String
    }


type alias SessionCredential =
    { token : String
    , expiresAt : Maybe Int
    }


{-| Split result of `parsePrefixPart`: raw prefix, derived nick/host,
and the unconsumed remainder of the line.
-}
type alias PrefixPart =
    { prefix : Maybe String
    , nick : Maybe String
    , host : Maybe String
    , afterPrefix : String
    }


type MonitorKind
    = Online
    | Offline
    | Full


type alias MonitorNumeric =
    { kind : MonitorKind
    , targets : List String
    , limit : Maybe Int
    , description : Maybe String
    }


type alias AccountInfoFields =
    { account : Maybe String
    , flags : Maybe Int
    , email : Maybe String
    , secure : Maybe Bool
    , enforce : Maybe Bool
    , registered : Maybe String
    }


type SaslMechanism
    = ScramSha256
    | Plain
    | External



-- helpers


charAt : Int -> String -> Maybe Char
charAt pos line =
    String.slice pos (pos + 1) line
        |> String.uncons
        |> Maybe.map Tuple.first


{-| Control bytes illegal on the wire: C0, space-and-below, DEL. -}
isWireBad : Char -> Bool
isWireBad c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F


regex : String -> Regex
regex pattern =
    Regex.fromString pattern
        |> Maybe.withDefault Regex.never


{-| Case-insensitive variant (the oracle's `/i` flag — JS has no
inline `(?i)`, so this needs its own constructor). -}
ciRegex : String -> Regex
ciRegex pattern =
    Regex.fromStringWith { caseInsensitive = True, multiline = False } pattern
        |> Maybe.withDefault Regex.never


commandChars : Regex
commandChars =
    regex "^[A-Za-z0-9]+$"


stripLineEnd : String -> String
stripLineEnd raw =
    if String.endsWith "\n" raw then
        let
            noNl =
                String.dropRight 1 raw
        in
        if String.endsWith "\r" noNl then
            String.dropRight 1 noNl

        else
            noNl

    else
        raw


nul : Char
nul =
    Char.fromCode 0


{-| Split a received WebSocket text frame into complete IRC lines.

Pure: no state, no remainder across calls. Splits on LF, strips one
trailing CR, drops empty segments, caps at `maxWireFrameLines`.
-}
splitWireFrame : String -> List String
splitWireFrame frame =
    frame
        |> String.split "\n"
        |> List.map
            (\seg ->
                if String.endsWith "\r" seg then
                    String.dropRight 1 seg

                else
                    seg
            )
        |> List.filter (not << String.isEmpty)
        |> List.take maxWireFrameLines


unescapeTagValue : String -> String
unescapeTagValue val =
    Regex.replace
        (regex "\\\\([\\s\\S]?)")
        (\m ->
            case m.submatches of
                (Just c) :: _ ->
                    case c of
                        ":" ->
                            ";"

                        "s" ->
                            " "

                        "\\" ->
                            "\\"

                        "r" ->
                            "\r"

                        "n" ->
                            "\n"

                        "" ->
                            ""

                        other ->
                            other

                _ ->
                    ""
        )
        val


escapeTagValue : String -> String
escapeTagValue val =
    val
        |> String.replace "\\" "\\\\"
        |> String.replace ";" "\\:"
        |> String.replace " " "\\s"
        |> String.replace "\r" "\\r"
        |> String.replace "\n" "\\n"


stripWireControl : String -> String
stripWireControl field =
    String.filter (\c -> c /= '\r' && c /= '\n' && c /= nul) field


{-| Parse a single IRC line. Grammar:
`['@' tags SP] [':' prefix SP] command [SP params] [SP ':' trailing]`
-}
parseIrcMessage : String -> IrcMessage
parseIrcMessage raw =
    let
        line =
            raw |> stripLineEnd |> String.filter (\c -> c /= nul)

        ( tags, afterTags ) =
            parseTags line

        { prefix, nick, host, afterPrefix } =
            parsePrefixPart afterTags

        ( command, afterCommand ) =
            parseCommand afterPrefix

        params =
            parseParams afterCommand
    in
    { tags = tags
    , prefix = prefix
    , nick = nick
    , host = host
    , command = command
    , params = params
    , raw = line
    }


parseTags : String -> ( Dict String String, String )
parseTags line =
    case String.uncons line of
        Just ( '@', _ ) ->
            let
                rest =
                    String.dropLeft 1 line

                spaceIdx =
                    indexOf " " rest

                tagStr =
                    case spaceIdx of
                        Just i ->
                            String.slice 0 i rest

                        Nothing ->
                            rest

                after =
                    case spaceIdx of
                        Just i ->
                            String.dropLeft (i + 1) rest

                        Nothing ->
                            ""
            in
            if String.length tagStr > maxIrcv3TagBlockLength then
                ( Dict.empty, after )

            else
                ( tagStr
                    |> String.split ";"
                    |> List.take maxIrcv3MessageTags
                    |> List.filter (not << String.isEmpty)
                    |> List.foldl
                        (\tag acc ->
                            let
                                ( key, value ) =
                                    case splitOnce "=" tag of
                                        Just ( k, v ) ->
                                            ( k, v )

                                        Nothing ->
                                            ( tag, "" )
                            in
                            if String.length key > maxIrcv3TagKeyLength then
                                acc

                            else if String.length value > maxIrcv3TagValueLength then
                                acc

                            else if String.any isWireBad key then
                                acc

                            else
                                Dict.insert key (unescapeTagValue value) acc
                        )
                        Dict.empty
                , after
                )

        _ ->
            ( Dict.empty, line )


parsePrefixPart : String -> PrefixPart
parsePrefixPart line =
    case String.uncons line of
        Just ( ':', _ ) ->
            let
                rest =
                    String.dropLeft 1 line

                spaceIdx =
                    indexOf " " rest

                rawPrefix =
                    case spaceIdx of
                        Just i ->
                            String.slice 0 i rest

                        Nothing ->
                            rest

                after =
                    case spaceIdx of
                        Just i ->
                            String.dropLeft (i + 1) rest

                        Nothing ->
                            ""
            in
            if String.length rawPrefix > maxIrcPrefixLength then
                { prefix = Nothing, nick = Nothing, host = Nothing, afterPrefix = after }

            else if String.any (\c -> c == ',' || isWireBad c) rawPrefix then
                { prefix = Nothing, nick = Nothing, host = Nothing, afterPrefix = after }

            else
                { prefix = Just rawPrefix
                , nick = nickOfPrefix rawPrefix
                , host = hostOfPrefix rawPrefix
                , afterPrefix = after
                }

        _ ->
            { prefix = Nothing, nick = Nothing, host = Nothing, afterPrefix = line }


nickOfPrefix : String -> Maybe String
nickOfPrefix prefix =
    case indexOf "!" prefix of
        Just bang ->
            Just (String.slice 0 bang prefix)

        Nothing ->
            case indexOf "@" prefix of
                Just at ->
                    Just (String.slice 0 at prefix)

                Nothing ->
                    if String.contains "." prefix then
                        Nothing

                    else
                        Just prefix


hostOfPrefix : String -> Maybe String
hostOfPrefix prefix =
    case indexOf "!" prefix of
        Just bang ->
            case indexOfFrom "@" (bang + 1) prefix of
                Just at ->
                    Just (String.dropLeft (at + 1) prefix)

                Nothing ->
                    Nothing

        Nothing ->
            case indexOf "@" prefix of
                Just at ->
                    Just (String.dropLeft (at + 1) prefix)

                Nothing ->
                    if String.contains "." prefix then
                        Just prefix

                    else
                        Nothing


parseCommand : String -> ( String, String )
parseCommand line =
    let
        rawCommand =
            case indexOf " " line of
                Just i ->
                    String.slice 0 i line

                Nothing ->
                    line

        after =
            case indexOf " " line of
                Just i ->
                    String.dropLeft (i + 1) line

                Nothing ->
                    ""
    in
    if
        String.length rawCommand
            <= maxIrcCommandLength
            && Regex.contains commandChars rawCommand
            && not (String.isEmpty rawCommand)
    then
        ( String.toUpper rawCommand, after )

    else
        ( "", after )


parseParams : String -> List String
parseParams line =
    parseParamsHelp (String.trimLeft line) []


parseParamsHelp : String -> List String -> List String
parseParamsHelp line acc =
    if List.length acc >= maxIrcMessageParams then
        List.reverse acc

    else
        case String.uncons (String.trimLeft line) of
            Nothing ->
                List.reverse acc

            Just ( ':', _ ) ->
                List.reverse (String.dropLeft 1 (String.trimLeft line) :: acc)

            Just _ ->
                let
                    rest =
                        String.trimLeft line
                in
                case indexOf " " rest of
                    Nothing ->
                        List.reverse (rest :: acc)

                    Just i ->
                        parseParamsHelp
                            (String.dropLeft (i + 1) rest)
                            (String.slice 0 i rest :: acc)


indexOf : String -> String -> Maybe Int
indexOf needle haystack =
    indexOfFrom needle 0 haystack


indexOfFrom : String -> Int -> String -> Maybe Int
indexOfFrom needle from haystack =
    let
        len =
            String.length needle

        total =
            String.length haystack

        go i =
            if i + len > total then
                Nothing

            else if String.slice i (i + len) haystack == needle then
                Just i

            else
                go (i + 1)
    in
    if len == 0 then
        Just from

    else
        go from


splitOnce : String -> String -> Maybe ( String, String )
splitOnce needle haystack =
    case indexOf needle haystack of
        Just i ->
            Just
                ( String.slice 0 i haystack
                , String.dropLeft (i + String.length needle) haystack
                )

        Nothing ->
            Nothing


{-| Format a raw IRC line. Appends CR LF. Every field is stripped of
CR/LF/NUL first so one call always emits EXACTLY ONE wire line.
-}
formatIrcLine : String -> List String -> String
formatIrcLine command params =
    let
        cmd =
            stripWireControl command

        clean =
            List.map stripWireControl params

        middle =
            case List.reverse clean of
                [] ->
                    []

                last :: rest ->
                    let
                        trailing =
                            if last == "" || String.contains " " last || String.startsWith ":" last then
                                ":" ++ last

                            else
                                last
                    in
                    List.reverse rest ++ [ trailing ]
    in
    String.join " " (cmd :: middle) ++ "\r\n"


{-| Format a client-tagged IRC line. Tag values are IRCv3-escaped;
an empty tag dict yields `formatIrcLine`.
-}
formatTaggedLine : Dict String String -> String -> List String -> String
formatTaggedLine tags command params =
    let
        line =
            formatIrcLine command params

        tagStr =
            tags
                |> Dict.toList
                |> List.map
                    (\( key, value ) ->
                        if String.isEmpty value then
                            stripWireControl key

                        else
                            stripWireControl key ++ "=" ++ escapeTagValue value
                    )
                |> String.join ";"
    in
    if String.isEmpty tagStr then
        line

    else
        "@" ++ tagStr ++ " " ++ line


{-| Parse NAMES list prefix characters into mode letters + bare nick. -}
parseNamesPrefix : String -> Dict Char Char -> { nick : String, modes : Set Char }
parseNamesPrefix prefixStr prefixMap =
    let
        go chars modes =
            case chars of
                c :: rest ->
                    case Dict.get c prefixMap of
                        Just mode ->
                            go rest (Set.insert mode modes)

                        Nothing ->
                            ( String.fromList (c :: rest), modes )

                [] ->
                    ( "", modes )

        ( full, foundModes ) =
            go (String.toList prefixStr) Set.empty

        nick =
            case String.split "!" full of
                n :: _ ->
                    n

                [] ->
                    ""
    in
    { nick = nick, modes = foundModes }


{-| Parse 005 ISUPPORT PREFIX `(qaohv)~&@%+`. Mismatched maps are
rejected whole so callers keep their last known-good map. `modeOrder`
preserves the server's declaration rank (highest first) — a `Dict`
cannot, and role resolution must follow wire order, not key order.
-}
parsePrefix : String -> { modeToPrefix : Dict Char Char, prefixToMode : Dict Char Char, modeOrder : List Char }
parsePrefix value =
    case Regex.find (regex "^\\(([^)]+)\\)(.+)$") value of
        m :: _ ->
            case m.submatches of
                [ Just modes, Just prefixes ] ->
                    let
                        modeList =
                            String.toList modes

                        prefixList =
                            String.toList prefixes

                        punct code =
                            (code >= 0x21 && code <= 0x2F)
                                || (code >= 0x3A && code <= 0x40)
                                || (code >= 0x5B && code <= 0x60)
                                || (code >= 0x7B && code <= 0x7E)
                    in
                    if List.length modeList /= List.length prefixList then
                        emptyPrefixMaps

                    else if List.length modeList > 32 then
                        emptyPrefixMaps

                    else if not (List.all (\c -> Char.isAlpha c) modeList) then
                        emptyPrefixMaps

                    else if not (List.all (\c -> punct (Char.toCode c)) prefixList) then
                        emptyPrefixMaps

                    else if Set.size (Set.fromList modeList) /= List.length modeList then
                        emptyPrefixMaps

                    else if Set.size (Set.fromList prefixList) /= List.length prefixList then
                        emptyPrefixMaps

                    else
                        List.map2 Tuple.pair modeList prefixList
                            |> List.foldl
                                (\( mo, pre ) acc ->
                                    { modeToPrefix = Dict.insert mo pre acc.modeToPrefix
                                    , prefixToMode = Dict.insert pre mo acc.prefixToMode
                                    , modeOrder = acc.modeOrder ++ [ mo ]
                                    }
                                )
                                emptyPrefixMaps

                _ ->
                    emptyPrefixMaps

        [] ->
            emptyPrefixMaps


emptyPrefixMaps : { modeToPrefix : Dict Char Char, prefixToMode : Dict Char Char, modeOrder : List Char }
emptyPrefixMaps =
    { modeToPrefix = Dict.empty, prefixToMode = Dict.empty, modeOrder = [] }


{-| CHANLIMIT type characters: printable ASCII except `,` and `:`. -}
isChanLimitChar : Char -> Bool
isChanLimitChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x21 && code <= 0x2B)
        || (code >= 0x2D && code <= 0x39)
        || (code >= 0x3B && code <= 0x7E)


{-| Parse 005 CHANLIMIT. Rejects the whole value on ambiguity. -}
parseChanLimit : String -> Dict Char Int
parseChanLimit value =
    let
        maxValueLength =
            1024

        maxGroups =
            32

        maxTypesPerGroup =
            16

        maxLimit =
            1000000
    in
    if String.isEmpty value || String.length value > maxValueLength then
        Dict.empty

    else
        let
            parts =
                String.split "," value
        in
        if List.length parts > maxGroups then
            Dict.empty

        else
            parseChanGroups parts Dict.empty Set.empty


parseChanGroups : List String -> Dict Char Int -> Set Char -> Dict Char Int
parseChanGroups parts out seen =
    case parts of
        [] ->
            out

        part :: rest ->
            case splitOnce ":" part of
                Just ( types, rawLimit ) ->
                    if
                        String.isEmpty types
                            || String.contains ":" rawLimit
                            || String.length types > 16
                            || not (String.all isChanLimitChar types)
                            || not (Regex.contains (regex "^(?:0|[1-9][0-9]*)$") rawLimit)
                    then
                        Dict.empty

                    else
                        case String.toInt rawLimit of
                            Just limit ->
                                if limit > 1000000 then
                                    Dict.empty

                                else
                                    let
                                        chars =
                                            String.toList types
                                    in
                                    if List.any (\c -> Set.member c seen) chars then
                                        Dict.empty

                                    else
                                        parseChanGroups rest
                                            (List.foldl (\c acc -> Dict.insert c limit acc) out chars)
                                            (Set.union seen (Set.fromList chars))

                            Nothing ->
                                Dict.empty

                Nothing ->
                    Dict.empty


{-| RFC 1459 case-mapping fold. -}
normalizeCase : String -> String -> String
normalizeCase value casemapping =
    if String.toLower casemapping == "ascii" then
        String.toLower value

    else
        value
            |> String.toLower
            |> String.replace "[" "{"
            |> String.replace "]" "}"
            |> String.replace "\\" "|"
            |> String.replace "^" "~"


{-| Prefer SCRAM-SHA-256, then PLAIN, then EXTERNAL — each only when the
client actually holds the credential it needs.
-}
selectSaslMechanism : List String -> Bool -> Bool -> Maybe SaslMechanism
selectSaslMechanism offered hasPassword hasClientCert =
    let
        mechs =
            offered |> List.map String.toUpper |> Set.fromList
    in
    if Set.member "SCRAM-SHA-256" mechs && hasPassword then
        Just ScramSha256

    else if Set.member "PLAIN" mechs && hasPassword then
        Just Plain

    else if Set.member "EXTERNAL" mechs && hasClientCert then
        Just External

    else
        Nothing


{-| Wire name of a SASL mechanism, for `AUTHENTICATE <mech>` selects. -}
saslMechanismName : SaslMechanism -> String
saslMechanismName mech =
    case mech of
        ScramSha256 ->
            "SCRAM-SHA-256"

        Plain ->
            "PLAIN"

        External ->
            "EXTERNAL"


{-| Oracle `MAX_CLIENT_SASL_MECHANISMS`: at most 16 advertised mechanisms. -}
maxClientSaslMechanisms : Int
maxClientSaslMechanisms =
    16


maxClientSaslMechanismLength : Int
maxClientSaslMechanismLength =
    64


{-| Parse the `sasl` capability value (`PLAIN,SCRAM-SHA-256,…`) into
usable mechanism names, mirroring `parseSaslMechanisms`: comma-split,
bounded, `[A-Za-z0-9_-]` only, deduplicated. -}
parseSaslMechanisms : String -> List String
parseSaslMechanisms value =
    List.foldl
        (\raw acc ->
            if List.length acc >= maxClientSaslMechanisms then
                acc

            else if String.isEmpty raw || String.length raw > maxClientSaslMechanismLength then
                acc

            else if not (String.all (\c -> Char.isAlphaNum c || c == '_' || c == '-') raw) then
                acc

            else if List.member raw acc then
                acc

            else
                acc ++ [ raw ]
        )
        []
        (String.split "," value)


{-| Oracle `SASL_CHUNK_BYTES`: one `AUTHENTICATE` parameter carries 400 bytes. -}
saslChunkBytes : Int
saslChunkBytes =
    400


{-| Split a SASL payload into 400-byte `AUTHENTICATE` chunks, mirroring
`_sendAuthenticatePayload`: an empty payload or an exact-multiple
final chunk needs a trailing `+` so the server can tell "finished"
from "more chunks follow". Base64 is ASCII, so `String.slice` is
byte-exact here. -}
chunkSaslPayload : String -> List String
chunkSaslPayload payload =
    let
        chunks =
            chunkSaslPayloadFrom 0 payload
    in
    if String.isEmpty payload || modBy saslChunkBytes (String.length payload) == 0 then
        chunks ++ [ "+" ]

    else
        chunks


chunkSaslPayloadFrom : Int -> String -> List String
chunkSaslPayloadFrom offset payload =
    if offset >= String.length payload then
        []

    else
        String.slice offset (offset + saslChunkBytes) payload :: chunkSaslPayloadFrom (offset + saslChunkBytes) payload


{-| Parse a NOTE / FAIL / WARN standard reply. Fail-closed on bounds. -}
parseStandardReply : IrcMessage -> Maybe StandardReply
parseStandardReply msg =
    if msg.command /= "NOTE" && msg.command /= "FAIL" && msg.command /= "WARN" then
        Nothing

    else if List.isEmpty msg.params || List.length msg.params > maxStandardReplyParams then
        Nothing

    else
        let
            command =
                List.head msg.params |> Maybe.withDefault ""

            code =
                msg.params |> List.drop 1 |> List.head |> Maybe.withDefault ""

            codeLimit =
                if msg.command == "NOTE" && String.toUpper command == "MEMO" && List.length msg.params == 2 then
                    maxStandardReplyMemoLength

                else
                    maxStandardReplyTokenLength
        in
        if
            String.isEmpty command
                || String.length command > maxStandardReplyTokenLength
                || String.length code > codeLimit
        then
            Nothing

        else
            let
                description =
                    if List.length msg.params > 2 then
                        msg.params |> List.reverse |> List.head |> Maybe.withDefault ""

                    else
                        ""

                context =
                    msg.params
                        |> List.drop 2
                        |> List.reverse
                        |> List.drop 1
                        |> List.reverse
            in
            if String.length description > maxStandardReplyTokenLength then
                Nothing

            else if List.any (\v -> String.length v > maxStandardReplyTokenLength) context then
                Nothing

            else
                Just
                    { kind =
                        if msg.command == "NOTE" then
                            Note

                        else if msg.command == "FAIL" then
                            Fail

                        else
                            Warn
                    , command = String.toUpper command
                    , code = String.toUpper code
                    , context = context
                    , description = description
                    }


{-| Fail-closed predicate for SESSION TOKEN / MTOKEN bearers. -}
isValidSessionCredential : Maybe String -> Bool
isValidSessionCredential token =
    case token of
        Just t ->
            not (String.isEmpty t)
                && String.length t
                <= maxSessionCredentialLength
                && not (String.any isWireBad t)

        Nothing ->
            False


maxSessionExpiresDigits : Int
maxSessionExpiresDigits =
    16


parseSessionCredentialAttrs : String -> Maybe (Dict String Int)
parseSessionCredentialAttrs rest =
    let
        trimmed =
            String.trim rest
    in
    if String.isEmpty trimmed then
        Just Dict.empty

    else
        parseAttrAtoms (String.words trimmed) Dict.empty


parseAttrAtoms : List String -> Dict String Int -> Maybe (Dict String Int)
parseAttrAtoms atoms acc =
    case atoms of
        [] ->
            Just acc

        atom :: rest ->
            case splitOnce "=" atom of
                Just ( key, value ) ->
                    if String.isEmpty key || String.isEmpty value then
                        Nothing

                    else if String.toLower key == "expires" then
                        if Dict.member "expiresAt" acc then
                            Nothing

                        else if not (Regex.contains (regex "^(?:0|[1-9][0-9]*)$") value) then
                            Nothing

                        else if String.length value > maxSessionExpiresDigits then
                            Nothing

                        else
                            case String.toInt value of
                                Just n ->
                                    if n < 0 then
                                        Nothing

                                    else
                                        parseAttrAtoms rest (Dict.insert "expiresAt" n acc)

                                Nothing ->
                                    Nothing

                    else
                        parseAttrAtoms rest acc

                Nothing ->
                    Nothing


parseSessionCredentialBody : String -> Maybe SessionCredential
parseSessionCredentialBody body =
    let
        trimmed =
            String.trim body
    in
    if String.isEmpty trimmed then
        Nothing

    else
        let
            token =
                String.words trimmed |> List.head |> Maybe.withDefault ""

            rest =
                String.words trimmed |> List.drop 1 |> String.join " "
        in
        if not (isValidSessionCredential (Just token)) then
            Nothing

        else
            case parseSessionCredentialAttrs rest of
                Just attrs ->
                    Just { token = token, expiresAt = Dict.get "expiresAt" attrs }

                Nothing ->
                    Nothing


parseSessionCredential : IrcMessage -> String -> Maybe SessionCredential
parseSessionCredential msg kind =
    case parseStandardReply msg of
        Just reply ->
            if reply.kind == Note && reply.command == "SESSION" && reply.code == kind then
                if not (List.isEmpty reply.context) then
                    let
                        token =
                            reply.context |> List.head |> Maybe.withDefault ""

                        attrParts =
                            List.drop 1 reply.context
                                ++ (if String.isEmpty reply.description then
                                        []

                                    else
                                        [ reply.description ]
                                   )
                    in
                    if not (isValidSessionCredential (Just token)) then
                        Nothing

                    else
                        case parseSessionCredentialAttrs (String.join " " attrParts) of
                            Just attrs ->
                                Just { token = token, expiresAt = Dict.get "expiresAt" attrs }

                            Nothing ->
                                Nothing

                else
                    parseSessionCredentialBody reply.description

            else
                Nothing

        Nothing ->
            if msg.command /= "NOTICE" then
                Nothing

            else
                let
                    body =
                        msg.params |> List.reverse |> List.head |> Maybe.withDefault "" |> String.trim
                in
                if String.length body > maxSessionCredentialLength + 512 then
                    Nothing

                else
                    case Regex.find (ciRegex "^SESSION\\s+(TOKEN|MTOKEN)\\s+(\\S+)((?:\\s+\\S+)*)$") body of
                        m :: _ ->
                            case m.submatches of
                                [ Just which, Just token, maybeAttrs ] ->
                                    if String.toUpper which /= kind then
                                        Nothing

                                    else if not (isValidSessionCredential (Just token)) then
                                        Nothing

                                    else
                                        -- Elm reports an empty trailer group as
                                        -- Nothing; the oracle's `match[3] ?? ''`
                                        -- treats it as no attributes.
                                        case parseSessionCredentialAttrs (Maybe.withDefault "" maybeAttrs) of
                                            Just attrMap ->
                                                Just { token = token, expiresAt = Dict.get "expiresAt" attrMap }

                                            Nothing ->
                                                Nothing

                                _ ->
                                    Nothing

                        [] ->
                            Nothing


parseSessionTokenNote : IrcMessage -> Maybe SessionCredential
parseSessionTokenNote msg =
    parseSessionCredential msg "TOKEN"


parseSessionMeshTokenNote : IrcMessage -> Maybe SessionCredential
parseSessionMeshTokenNote msg =
    parseSessionCredential msg "MTOKEN"


buildSessionResumeLine : String -> String
buildSessionResumeLine token =
    formatIrcLine "SESSION" [ "RESUME", token ]


maxMonitorNumericTargets : Int
maxMonitorNumericTargets =
    256


maxMonitorNumericTargetLength : Int
maxMonitorNumericTargetLength =
    512


parseMonitorTargets : String -> List String
parseMonitorTargets value =
    if String.isEmpty value then
        []

    else if String.length value > maxMonitorNumericTargets * (maxMonitorNumericTargetLength + 1) then
        []

    else
        let
            rawTargets =
                String.split "," value
        in
        if List.length rawTargets > maxMonitorNumericTargets then
            []

        else
            parseMonitorTargetsHelp rawTargets [] Set.empty


parseMonitorTargetsHelp : List String -> List String -> Set String -> List String
parseMonitorTargetsHelp raws acc seen =
    case raws of
        [] ->
            List.reverse acc

        raw :: rest ->
            let
                target =
                    String.trim raw
            in
            if
                String.isEmpty target
                    || String.length target
                    > maxMonitorNumericTargetLength
                    || String.any (\c -> c == ',' || isWireBad c) target
            then
                []

            else
                let
                    key =
                        String.toLower target
                in
                if Set.member key seen then
                    parseMonitorTargetsHelp rest acc seen

                else
                    parseMonitorTargetsHelp rest (target :: acc) (Set.insert key seen)


{-| Note: an invalid target poisons the whole list (returns `[]`), matching
the TypeScript fail-closed behavior of returning no partial results.
-}
parseMonitorNumeric : IrcMessage -> Maybe MonitorNumeric
parseMonitorNumeric msg =
    if msg.command == "730" || msg.command == "731" then
        let
            second =
                msg.params |> List.drop 1 |> List.head

            first =
                msg.params |> List.head |> Maybe.withDefault ""
        in
        Just
            { kind =
                if msg.command == "730" then
                    Online

                else
                    Offline
            , targets = parseMonitorTargets (Maybe.withDefault first second)
            , limit = Nothing
            , description = Nothing
            }

    else if msg.command == "734" then
        let
            rawLimit =
                msg.params |> List.drop 1 |> List.head |> Maybe.withDefault ""

            limit =
                if Regex.contains (regex "^(?:0|[1-9][0-9]*)$") rawLimit then
                    case String.toInt rawLimit of
                        Just n ->
                            if n <= 1000000 then
                                Just n

                            else
                                Nothing

                        Nothing ->
                            Nothing

                else
                    Nothing

            targetParam =
                if List.length msg.params >= 4 then
                    msg.params |> List.drop 2 |> List.head |> Maybe.withDefault ""

                else
                    ""

            description =
                msg.params |> List.reverse |> List.head |> Maybe.withDefault "" |> String.left 1024
        in
        Just
            { kind = Full
            , targets = parseMonitorTargets targetParam
            , limit = limit
            , description = Just description
            }

    else
        Nothing


maxAccountInfoTextLength : Int
maxAccountInfoTextLength =
    4 * 1024


validAccountInfoToken : String -> Int -> Bool
validAccountInfoToken value maxLength =
    not (String.isEmpty value)
        && String.length value
        <= maxLength
        && not (String.any (\c -> c == ',' || isWireBad c) value)


parseBoolToken : String -> Maybe Bool
parseBoolToken value =
    case String.toLower (String.trim value) of
        "on" ->
            Just True

        "true" ->
            Just True

        "yes" ->
            Just True

        "1" ->
            Just True

        "off" ->
            Just False

        "false" ->
            Just False

        "no" ->
            Just False

        "0" ->
            Just False

        _ ->
            Nothing


{-| Parse an ACCOUNTINFO body. Null when no recognised pair is found. -}
parseAccountInfo : String -> Maybe AccountInfoFields
parseAccountInfo text =
    if String.isEmpty text || String.length text > maxAccountInfoTextLength then
        Nothing

    else
        case
            Regex.find (regex "(\\w+)=([^\\s]+)") text
                |> List.foldl
                    (\m acc ->
                        case acc of
                            Nothing ->
                                Nothing

                            Just st ->
                                if st.pairs >= 64 then
                                    Nothing

                                else
                                    case m.submatches of
                                        [ Just rawKey, Just value ] ->
                                            addAccountField (String.toLower rawKey) value
                                                { st | pairs = st.pairs + 1 }

                                        _ ->
                                            Just st
                    )
                    (Just
                        { pairs = 0
                        , matched = False
                        , fields =
                            { account = Nothing
                            , flags = Nothing
                            , email = Nothing
                            , secure = Nothing
                            , enforce = Nothing
                            , registered = Nothing
                            }
                        , seen = Set.empty
                        }
                    )
        of
            Just st ->
                if st.matched then
                    Just st.fields

                else
                    Nothing

            Nothing ->
                Nothing


type alias AccountAcc =
    { pairs : Int
    , matched : Bool
    , fields : AccountInfoFields
    , seen : Set String
    }


addAccountField : String -> String -> AccountAcc -> Maybe AccountAcc
addAccountField key value st =
    let
        known =
            List.member key [ "account", "flags", "email", "secure", "enforce", "registered" ]
    in
    if known && Set.member key st.seen then
        Nothing

    else
        let
            seen =
                if known then
                    Set.insert key st.seen

                else
                    st.seen

            with f =
                Just { st | matched = True, seen = seen, fields = f st.fields }
        in
        case key of
            "account" ->
                if validAccountInfoToken value 128 then
                    with (\f -> { f | account = Just value })

                else
                    Nothing

            "flags" ->
                if Regex.contains (regex "^(?:0|[1-9][0-9]*)$") value then
                    case String.toInt value of
                        Just n ->
                            if n <= 0xFFFFFFFF then
                                with (\f -> { f | flags = Just n })

                            else
                                Nothing

                        Nothing ->
                            Nothing

                else
                    Nothing

            "email" ->
                if validAccountInfoToken value 320 then
                    with (\f -> { f | email = Just value })

                else
                    Nothing

            "secure" ->
                case parseBoolToken value of
                    Just b ->
                        with (\f -> { f | secure = Just b })

                    Nothing ->
                        Nothing

            "enforce" ->
                case parseBoolToken value of
                    Just b ->
                        with (\f -> { f | enforce = Just b })

                    Nothing ->
                        Nothing

            "registered" ->
                if validAccountInfoToken value 64 then
                    with (\f -> { f | registered = Just value })

                else
                    Nothing

            _ ->
                Just st


{-| Byte bound for the IRCv3 `time` message tag — mirrors the oracle's
`rawServerTime.length <= 64` gate in `store.ts`. -}
maxServerTimeBytes : Int
maxServerTimeBytes =
    64


{-| Exact-double ceiling for epoch-millisecond stamps: parsed timestamps
past 2^53-1 are fail-closed, never wrapped (same discipline as the
vault/Media epoch-ms gates). -}
maxServerTimeMs : Int
maxServerTimeMs =
    9007199254740991


{-| Strict IRCv3 `time`-tag → epoch milliseconds. Accepts only the
canonical `YYYY-MM-DDTHH:MM:SS[.frac]Z|±HH:MM` family (`Z`, `±HH:MM`,
`±HHMM`, `±HH`); everything else — empty, overlong, bad ranges,
non-digits, leap seconds — is `Nothing` so the fold stamps receipt time
instead. Deliberately stricter than `new Date`: the oracle yields
`Invalid Date` (NaN) for bounded-but-unparseable tags, which would poison
ordering; Elm falls back to fold time. -}
parseServerTime : String -> Maybe Int
parseServerTime raw =
    if String.isEmpty raw || String.length raw > maxServerTimeBytes then
        Nothing

    else
        case String.split "T" raw of
            [ datePart, timePart ] ->
                Maybe.map2 combineServerTime (parseServerDate datePart) (parseServerClock timePart)
                    |> Maybe.andThen clampServerTimeMs

            _ ->
                Nothing


parseServerDate : String -> Maybe { year : Int, month : Int, day : Int }
parseServerDate part =
    case String.split "-" part of
        [ yearPart, monthPart, dayPart ] ->
            if String.length yearPart == 4 && String.length monthPart == 2 && String.length dayPart == 2 then
                Maybe.map3 (\year month day -> { year = year, month = month, day = day })
                    (parseDigits yearPart)
                    (parseDigits monthPart)
                    (parseDigits dayPart)
                    |> Maybe.andThen validServerDate

            else
                Nothing

        _ ->
            Nothing


validServerDate : { year : Int, month : Int, day : Int } -> Maybe { year : Int, month : Int, day : Int }
validServerDate date =
    if date.year >= 1970 && date.year <= 9999 && date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= daysInServerMonth date.year date.month then
        Just date

    else
        Nothing


daysInServerMonth : Int -> Int -> Int
daysInServerMonth year month =
    if month == 2 then
        if modBy 400 year == 0 || (modBy 4 year == 0 && modBy 100 year /= 0) then
            29

        else
            28

    else if month == 4 || month == 6 || month == 9 || month == 11 then
        30

    else
        31


parseServerClock : String -> Maybe { seconds : Int, millis : Int, offsetMinutes : Int }
parseServerClock part =
    case splitServerOffset part of
        Just ( clockPart, offsetMinutes ) ->
            case String.split "." clockPart of
                [ hmsPart ] ->
                    Maybe.map2 (\seconds _ -> { seconds = seconds, millis = 0, offsetMinutes = offsetMinutes })
                        (parseHms hmsPart)
                        (Just ())

                [ hmsPart, fracPart ] ->
                    Maybe.map2 (\seconds millis -> { seconds = seconds, millis = millis, offsetMinutes = offsetMinutes })
                        (parseHms hmsPart)
                        (parseFracMillis fracPart)

                _ ->
                    Nothing

        Nothing ->
            Nothing


parseHms : String -> Maybe Int
parseHms part =
    case String.split ":" part of
        [ hourPart, minPart, secPart ] ->
            if String.length hourPart == 2 && String.length minPart == 2 && String.length secPart == 2 then
                Maybe.map3
                    (\hour minute second ->
                        if hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59 then
                            Just (hour * 3600 + minute * 60 + second)

                        else
                            Nothing
                    )
                    (parseDigits hourPart)
                    (parseDigits minPart)
                    (parseDigits secPart)
                    |> Maybe.andThen identity

            else
                Nothing

        _ ->
            Nothing


{-| Fractional seconds → whole milliseconds (first three digits,
right-padded; extra precision truncates — it cannot survive the ms
stamp anyway). -}
parseFracMillis : String -> Maybe Int
parseFracMillis part =
    if allDigits part then
        Just (millisOfDigits part)

    else
        Nothing


allDigits : String -> Bool
allDigits value =
    case String.toList value of
        [] ->
            False

        chars ->
            List.all Char.isDigit chars


millisOfDigits : String -> Int
millisOfDigits part =
    let
        padded =
            String.left 3 (part ++ "000")
    in
    Maybe.withDefault 0 (parseDigits padded)


splitServerOffset : String -> Maybe ( String, Int )
splitServerOffset part =
    if String.endsWith "Z" part || String.endsWith "z" part then
        Just ( String.dropRight 1 part, 0 )

    else
        let
            len =
                String.length part
        in
        if len > 3 then
            let
                tail3 =
                    String.right 3 part

                tail5 =
                    String.right 5 part

                tail6 =
                    String.right 6 part
            in
            case parseOffsetTail tail6 of
                Just offset ->
                    Just ( String.dropRight 6 part, offset )

                Nothing ->
                    case parseOffsetTail tail5 of
                        Just offset ->
                            Just ( String.dropRight 5 part, offset )

                        Nothing ->
                            case parseOffsetTailShort tail3 of
                                Just offset ->
                                    Just ( String.dropRight 3 part, offset )

                                Nothing ->
                                    Nothing

        else
            Nothing


parseOffsetTail : String -> Maybe Int
parseOffsetTail tail =
    case String.toList tail of
        sign :: a :: b :: ':' :: c :: d :: [] ->
            if (sign == '+' || sign == '-') && Char.isDigit a && Char.isDigit b && Char.isDigit c && Char.isDigit d then
                combineOffset sign [ a, b ] [ c, d ]

            else
                Nothing

        sign :: a :: b :: c :: d :: [] ->
            if (sign == '+' || sign == '-') && Char.isDigit a && Char.isDigit b && Char.isDigit c && Char.isDigit d then
                combineOffset sign [ a, b ] [ c, d ]

            else
                Nothing

        _ ->
            Nothing


parseOffsetTailShort : String -> Maybe Int
parseOffsetTailShort tail =
    case String.toList tail of
        sign :: a :: b :: [] ->
            if (sign == '+' || sign == '-') && Char.isDigit a && Char.isDigit b then
                combineOffset sign [ a, b ] [ '0', '0' ]

            else
                Nothing

        _ ->
            Nothing


combineOffset : Char -> List Char -> List Char -> Maybe Int
combineOffset sign hourChars minChars =
    case ( parseDigits (String.fromList hourChars), parseDigits (String.fromList minChars) ) of
        ( Just hour, Just minute ) ->
            if hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 then
                let
                    total =
                        hour * 60 + minute
                in
                if sign == '-' then
                    Just -total

                else
                    Just total

            else
                Nothing

        _ ->
            Nothing


parseDigits : String -> Maybe Int
parseDigits part =
    if allDigits part then
        List.foldl (\c acc -> acc * 10 + (Char.toCode c - Char.toCode '0')) 0 (String.toList part)
            |> Just

    else
        Nothing


combineServerTime : { year : Int, month : Int, day : Int } -> { seconds : Int, millis : Int, offsetMinutes : Int } -> Int
combineServerTime date clock =
    let
        y =
            if date.month <= 2 then
                date.year - 1

            else
                date.year

        era =
            y // 400

        yoe =
            y - era * 400

        mp =
            modBy 12 (date.month + 9)

        doy =
            (153 * mp + 2) // 5 + (date.day - 1)

        doe =
            yoe * 365 + yoe // 4 - yoe // 100 + doy

        days =
            era * 146097 + doe - 719468
    in
    (days * 86400 + clock.seconds) * 1000 + clock.millis - clock.offsetMinutes * 60000


clampServerTimeMs : Int -> Maybe Int
clampServerTimeMs ms =
    if ms >= 0 && ms <= maxServerTimeMs then
        Just ms

    else
        Nothing
