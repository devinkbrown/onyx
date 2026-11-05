module Isupport exposing
    ( ISupport
    , applyIsupportLine
    , applyIsupportToken
    , defaultSupport
    , firstChanLimit
    , maxTokenCount
    , maxTokenKeyLength
    , maxTokenValueLength
    , parsePositiveInt
    , parseStatusmsgSymbols
    , statusmsgChannel
    , isChannelTarget
    , unknownTokens
    )

{-| ISUPPORT (005) token table — Elm port of the `_parseISUPPORT` fold
and its helpers in `src/lib/irc/client.ts`
(`parseIsupportPositiveInt`, `parseIsupportChannelTypes`,
`parseIsupportChannelModes`, `parseCHANLIMIT`, `parsePREFIX`) plus the
`ISupport` defaults.

Envelope rules (fail closed): the nick param and trailing text are
skipped, at most 256 distinct tokens are retained, keys match
`[A-Z][A-Z0-9-]*` (≤64 chars), and values decode `\\xHH` byte escapes
with a 1024-character decoded limit. Valid unknown tokens remain in a
bounded diagnostic inventory and never enable behavior. Malformed input
keeps the last known-good projection.

Reuses `Modes` (CHANMODES groups, default prefix maps) and `Wire`
(CHANLIMIT parse, PREFIX parse).

-}

import Dict exposing (Dict)
import Modes
import Set
import Wire


maxTokenCount : Int
maxTokenCount =
    256


maxTokenKeyLength : Int
maxTokenKeyLength =
    64


maxTokenValueLength : Int
maxTokenValueLength =
    1024


maxSupportNumber : Int
maxSupportNumber =
    1000000


type alias ISupport =
    { modeToPrefix : Dict Char Char
    , prefixToMode : Dict Char Char
    , prefixOrder : List Char
    , chanGroups : Modes.ArgGroups
    , chantypes : String
    , chanlimits : Dict Char Int
    , network : String
    , casemapping : String
    , modesPerLine : Int
    , maxchannels : Int
    , nicklen : Int
    , topiclen : Int
    , ircx : Bool
    , silence : Int
    , vapid : String
    , attributionNode : Maybe String
    , statusmsg : String
    , tokens : Dict String (Maybe String)
    , tokenOrder : List String
    }


{-| Client defaults. Mirror `client.ts`: the prefix maps carry legacy
`~`/`&`/`%` fallbacks so a NAMES burst received before 005 still keeps
admin/halfop status; 005 `PREFIX` overwrites both maps verbatim.
-}
defaultSupport : ISupport
defaultSupport =
    { modeToPrefix =
        Dict.fromList
            [ ( 'Y', '*' )
            , ( 'Q', '!' )
            , ( 'q', '.' )
            , ( 'a', '&' )
            , ( 'o', '@' )
            , ( 'h', '%' )
            , ( 'v', '+' )
            ]
    , prefixToMode =
        Dict.fromList
            [ ( '*', 'Y' )
            , ( '!', 'Q' )
            , ( '.', 'q' )
            , ( '~', 'q' )
            , ( '&', 'a' )
            , ( '@', 'o' )
            , ( '%', 'h' )
            , ( '+', 'v' )
            ]
    , prefixOrder = [ 'Y', 'Q', 'q', 'a', 'o', 'h', 'v' ]
    , chanGroups = Modes.defaultChanGroups
    , chantypes = "#&"
    , chanlimits = Dict.empty
    , network = "Onyx"
    , casemapping = "ascii"
    , modesPerLine = 4
    , maxchannels = 50
    , nicklen = 64
    , topiclen = 390
    , ircx = False
    , silence = 0
    , vapid = ""
    , statusmsg = ""
    , attributionNode = Nothing
    , tokens = Dict.empty
    , tokenOrder = []
    }


{-| Strict positive integer: `[1-9][0-9]*`, at most 1,000,000.
Leading zeros are rejected (the regex requires a non-zero first digit).
-}
parsePositiveInt : String -> Maybe Int
parsePositiveInt value =
    case String.toList value of
        first :: rest ->
            let
                firstCode =
                    Char.toCode first
            in
            if firstCode < 0x31 || firstCode > 0x39 then
                Nothing

            else if not (List.all isAsciiDigit rest) then
                Nothing

            else
                case String.toInt value of
                    Just n ->
                        if n <= maxSupportNumber then
                            Just n

                        else
                            Nothing

                    Nothing ->
                        Nothing

        [] ->
            Nothing


isAsciiDigit : Char -> Bool
isAsciiDigit c =
    let
        code =
            Char.toCode c
    in
    code >= 0x30 && code <= 0x39


{-| Channel-type sigils: non-empty, ≤16 chars, `[#&+!]` only,
duplicate-free. Foreign sigils would reclassify DMs as rooms.
-}
parseChannelTypes : String -> Maybe String
parseChannelTypes value =
    if String.isEmpty value || String.length value > 16 then
        Nothing

    else if not (List.all isChanType (String.toList value)) then
        Nothing

    else if Set.size (Set.fromList (String.toList value)) /= String.length value then
        Nothing

    else
        Just value


isChanType : Char -> Bool
isChanType c =
    c == '#' || c == '&' || c == '+' || c == '!'


{-| First class limit of a CHANLIMIT token (`"#&:50"` → 50), used for the
legacy `MAXCHANNELS` fallback. Insertion order matters here (unlike the
`Dict` from `Wire.parseChanLimit`), so it is read off the raw token.
-}
firstChanLimit : String -> Maybe Int
firstChanLimit value =
    case String.split "," value of
        [] ->
            Nothing

        first :: _ ->
            case String.split ":" first of
                [ _, digits ] ->
                    if String.isEmpty digits || not (List.all isAsciiDigit (String.toList digits)) then
                        Nothing

                    else
                        String.toInt digits

                _ ->
                    Nothing


{-| Attribution node id: exactly 16 hex chars, stored lowercase. -}
parseAttributionNode : String -> Maybe String
parseAttributionNode value =
    let
        lower =
            String.toLower value
    in
    if String.length lower == 16 && List.all isHexDigit (String.toList lower) then
        Just lower

    else
        Nothing


isHexDigit : Char -> Bool
isHexDigit c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x30 && code <= 0x39)
        || (code >= 0x41 && code <= 0x46)
        || (code >= 0x61 && code <= 0x66)


isTokenKey : String -> Bool
isTokenKey key =
    case String.toList key of
        [] ->
            False

        first :: rest ->
            let
                firstCode =
                    Char.toCode first
            in
            String.length key
                <= maxTokenKeyLength
                && firstCode
                >= 0x41
                && firstCode
                <= 0x5A
                && List.all isKeyChar rest


isKeyChar : Char -> Bool
isKeyChar c =
    let
        code =
            Char.toCode c
    in
    (code >= 0x41 && code <= 0x5A)
        || (code >= 0x30 && code <= 0x39)
        || code == 0x2D


splitToken : String -> Maybe ( String, String )
splitToken token =
    case String.indexes "=" token of
        [] ->
            Just ( token, "" )

        idx :: _ ->
            Just ( String.slice 0 idx token, String.dropLeft (idx + 1) token )


decodeTokenValue : String -> Maybe String
decodeTokenValue raw =
    if String.length raw > maxTokenValueLength * 4 then
        Nothing

    else
        raw
            |> String.toList
            |> decodeEscapedChars
            |> Maybe.andThen decodeUtf8
            |> Maybe.andThen
                (\value ->
                    if isDecodedTokenValue value then
                        Just value

                    else
                        Nothing
                )


decodeEscapedChars : List Char -> Maybe (List Int)
decodeEscapedChars chars =
    case chars of
        [] ->
            Just []

        '\\' :: 'x' :: high :: low :: rest ->
            Maybe.map2 Tuple.pair (hexValue high) (hexValue low)
                |> Maybe.andThen
                    (\( h, l ) ->
                        decodeEscapedChars rest
                            |> Maybe.map ((::) (h * 16 + l))
                    )

        '\\' :: _ ->
            Nothing

        char :: rest ->
            decodeEscapedChars rest
                |> Maybe.map (List.append (encodeUtf8Char (Char.toCode char)))


encodeUtf8Char : Int -> List Int
encodeUtf8Char code =
    if code <= 0x7F then
        [ code ]

    else if code <= 0x7FF then
        [ 0xC0 + code // 64, 0x80 + modBy 64 code ]

    else if code <= 0xFFFF then
        [ 0xE0 + code // 4096, 0x80 + modBy 64 (code // 64), 0x80 + modBy 64 code ]

    else
        [ 0xF0 + code // 262144
        , 0x80 + modBy 64 (code // 4096)
        , 0x80 + modBy 64 (code // 64)
        , 0x80 + modBy 64 code
        ]


decodeUtf8 : List Int -> Maybe String
decodeUtf8 bytes =
    decodeUtf8Chars bytes [] |> Maybe.map (String.fromList << List.reverse)


decodeUtf8Chars : List Int -> List Char -> Maybe (List Char)
decodeUtf8Chars bytes acc =
    case bytes of
        [] ->
            Just acc

        first :: rest ->
            if first <= 0x7F then
                decodeUtf8Chars rest (Char.fromCode first :: acc)

            else
                case rest of
                    second :: tail ->
                        if first >= 0xC2 && first <= 0xDF && isContinuation second then
                            decodeUtf8Chars tail (Char.fromCode ((first - 0xC0) * 64 + second - 0x80) :: acc)

                        else
                            case rest of
                                second3 :: third :: tail3 ->
                                    if first >= 0xE0 && first <= 0xEF && isContinuation second3 && isContinuation third && validThreeByte first second3 then
                                        decodeUtf8Chars tail3 (Char.fromCode ((first - 0xE0) * 4096 + (second3 - 0x80) * 64 + third - 0x80) :: acc)

                                    else
                                        decodeFourByte first rest acc

                                _ ->
                                    decodeFourByte first rest acc

                    _ ->
                        Nothing


decodeFourByte : Int -> List Int -> List Char -> Maybe (List Char)
decodeFourByte lead bytes acc =
    case bytes of
        second :: third :: fourth :: tail ->
            if lead >= 0xF0 && lead <= 0xF4 && isContinuation second && isContinuation third && isContinuation fourth && validFourByte lead second then
                decodeUtf8Chars tail (Char.fromCode ((lead - 0xF0) * 262144 + (second - 0x80) * 4096 + (third - 0x80) * 64 + fourth - 0x80) :: acc)

            else
                Nothing

        _ ->
            Nothing


isContinuation : Int -> Bool
isContinuation byte =
    byte >= 0x80 && byte <= 0xBF


validThreeByte : Int -> Int -> Bool
validThreeByte lead second =
    not ((lead == 0xE0 && second < 0xA0) || (lead == 0xED && second >= 0xA0))


validFourByte : Int -> Int -> Bool
validFourByte lead second =
    not ((lead == 0xF0 && second < 0x90) || (lead == 0xF4 && second >= 0x90))


hexValue : Char -> Maybe Int
hexValue char =
    let code = Char.toCode char in
    if code >= 0x30 && code <= 0x39 then
        Just (code - 0x30)

    else if code >= 0x41 && code <= 0x46 then
        Just (code - 0x41 + 10)

    else if code >= 0x61 && code <= 0x66 then
        Just (code - 0x61 + 10)

    else
        Nothing


{-| Diagnostic inventory for syntactically valid but unsupported keys.
Values are decoded and bounded by the same envelope as recognized tokens.
-}
unknownTokens : ISupport -> Dict String (Maybe String)
unknownTokens support =
    Dict.filter (\key _ -> not (isKnownKey key)) support.tokens


isKnownKey : String -> Bool
isKnownKey key =
    List.member key
        [ "PREFIX", "NETWORK", "CHANTYPES", "CASEMAPPING", "NICKLEN", "TOPICLEN"
        , "CHANLIMIT", "MAXCHANNELS", "MODES", "CHANMODES", "IRCX", "SILENCE"
        , "VAPID", "ACCOUNTRESIDENCE", "STATUSMSG"
        ]


{-| Fold one validated `KEY[=value]` token into the table. -}
applyIsupportToken : ISupport -> String -> String -> ISupport
applyIsupportToken support key val =
    if String.isEmpty key || not (isTokenKey key) || not (isDecodedTokenValue val) || not (isValidKnownAdvertisement key val) then
        support

    else
        storeAndProject support key (Just (Just val))


storeAndProject : ISupport -> String -> Maybe (Maybe String) -> ISupport
storeAndProject support key value =
    let
        isNew =
            not (Dict.member key support.tokens)

        withinCap =
            not isNew || Dict.size support.tokens < maxTokenCount

        nextTokens =
            case value of
                Just advertised ->
                    Dict.insert key advertised support.tokens

                Nothing ->
                    Dict.remove key support.tokens

        nextOrder =
            case value of
                Just _ ->
                    List.filter ((/=) key) support.tokenOrder ++ [ key ]

                Nothing ->
                    List.filter ((/=) key) support.tokenOrder
    in
    if not withinCap then
        support

    else if value == Nothing then
        let
            replayed =
                List.foldl
                    (\token acc ->
                        case Dict.get token nextTokens of
                            Just advertised ->
                                projectKnown acc token (Maybe.withDefault "" advertised)

                            Nothing ->
                                acc
                    )
                    defaultSupport
                    nextOrder
        in
        { replayed | tokens = nextTokens, tokenOrder = nextOrder }

    else
        case value of
            Just advertised ->
                let
                    projected =
                        projectKnown support key (Maybe.withDefault "" advertised)
                in
                { projected | tokens = nextTokens, tokenOrder = nextOrder }

            Nothing ->
                support


isDecodedTokenValue : String -> Bool
isDecodedTokenValue value =
    String.length value <= maxTokenValueLength
        && not (List.any (\c -> let n = Char.toCode c in n < 0x20 || n == 0x7F) (String.toList value))


isValidKnownAdvertisement : String -> String -> Bool
isValidKnownAdvertisement key val =
    if not (isKnownKey key) then
        True

    else if key == "PREFIX" then
        not (Dict.isEmpty (Wire.parsePrefix val).modeToPrefix)

    else if key == "NETWORK" then
        not (String.isEmpty val) && String.length val <= 256

    else if key == "CHANTYPES" then
        parseChannelTypes val /= Nothing

    else if key == "CASEMAPPING" then
        List.member (String.toLower val) [ "ascii", "rfc1459", "strict-rfc1459" ]

    else if List.member key [ "NICKLEN", "TOPICLEN", "MAXCHANNELS", "MODES" ] then
        parsePositiveInt val /= Nothing

    else if key == "CHANLIMIT" then
        not (Dict.isEmpty (Wire.parseChanLimit val))

    else if key == "CHANMODES" then
        Modes.parseChanGroups val /= Nothing

    else if key == "SILENCE" then
        String.isEmpty val || parsePositiveInt val /= Nothing

    else if key == "ACCOUNTRESIDENCE" then
        parseAttributionNode val /= Nothing

    else if key == "STATUSMSG" then
        parseStatusmsgSymbols val /= Nothing

    else
        True


projectKnown : ISupport -> String -> String -> ISupport
projectKnown support key val =
    if not (isKnownKey key) then
        support

    else if key == "PREFIX" then
        let
            parsed =
                Wire.parsePrefix val
        in
        if Dict.isEmpty parsed.modeToPrefix then
            support

        else
            { support
                | modeToPrefix = parsed.modeToPrefix
                , prefixToMode = parsed.prefixToMode
                , prefixOrder = parsed.modeOrder
            }

    else if key == "NETWORK" then
        if String.isEmpty val || String.length val > 256 then
            support

        else
            { support | network = val }

    else if key == "CHANTYPES" then
        case parseChannelTypes val of
            Just chantypes ->
                { support | chantypes = chantypes }

            Nothing ->
                support

    else if key == "CASEMAPPING" then
        case String.toLower val of
            "ascii" ->
                { support | casemapping = "ascii" }

            "rfc1459" ->
                { support | casemapping = "rfc1459" }

            "strict-rfc1459" ->
                { support | casemapping = "strict-rfc1459" }

            _ ->
                support

    else if key == "NICKLEN" then
        case parsePositiveInt val of
            Just n ->
                { support | nicklen = n }

            Nothing ->
                support

    else if key == "TOPICLEN" then
        case parsePositiveInt val of
            Just n ->
                { support | topiclen = n }

            Nothing ->
                support

    else if key == "CHANLIMIT" then
        let
            limits =
                Wire.parseChanLimit val
        in
        if Dict.isEmpty limits then
            support

        else
            { support
                | chanlimits = limits
                , maxchannels = Maybe.withDefault support.maxchannels (firstChanLimit val)
            }

    else if key == "MAXCHANNELS" then
        case parsePositiveInt val of
            Just n ->
                { support | maxchannels = n }

            Nothing ->
                support

    else if key == "MODES" then
        case parsePositiveInt val of
            Just n ->
                { support | modesPerLine = n }

            Nothing ->
                support

    else if key == "CHANMODES" then
        case Modes.parseChanGroups val of
            Just groups ->
                { support | chanGroups = groups }

            Nothing ->
                support

    else if key == "IRCX" then
        { support | ircx = True }

    else if key == "SILENCE" then
        if String.isEmpty val then
            { support | silence = 20 }

        else
            case parsePositiveInt val of
                Just n ->
                    { support | silence = n }

                Nothing ->
                    support

    else if key == "VAPID" then
        { support | vapid = val }

    else if key == "ACCOUNTRESIDENCE" then
        case parseAttributionNode val of
            Just node ->
                { support | attributionNode = Just node }

            Nothing ->
                support

    else if key == "STATUSMSG" then
        case parseStatusmsgSymbols val of
            Just symbols ->
                { support | statusmsg = symbols }

            Nothing ->
                support

    else
        support


{-| Validate an advertised `STATUSMSG` value: a short run of status
prefix symbols (`!.@+` on Onyx Server). Empty or smuggled values keep
the previous table — without an advertised set the client never
strips, so an unknown network's `@nick` can never misfile.
-}
parseStatusmsgSymbols : String -> Maybe String
parseStatusmsgSymbols val =
    if String.isEmpty val || String.length val > 8 then
        Nothing

    else if String.any (\c -> c == ' ' || Char.toCode c < 0x21 || Char.toCode c > 0x7E) val then
        Nothing

    else
        Just val


{-| Split a `STATUSMSG` target (`@#chan`) into its audience prefix
and bare channel. Returns `Nothing` unless the first character is an
advertised status prefix and the remainder is a channel — so nicks,
bare channels, lone prefixes, and unadvertised networks all pass
through untouched.
-}
statusmsgChannel : ISupport -> String -> Maybe { prefix : Char, channel : String }
statusmsgChannel support target =
    case String.uncons target of
        Just ( first, rest ) ->
            if String.contains (String.fromChar first) support.statusmsg && not (String.isEmpty rest) && isChannelTarget support rest then
                Just { prefix = first, channel = rest }

            else
                Nothing

        Nothing ->
            Nothing


{-| Whether `target` opens with a known channel type. -}
isChannelTarget : ISupport -> String -> Bool
isChannelTarget support target =
    case String.uncons target of
        Just ( first, _ ) ->
            String.contains (String.fromChar first) support.chantypes

        Nothing ->
            False


{-| Fold a full 005 param list (nick + tokens + trailing text) into the
table. Skips the nick and trailing params, honors at most 256 tokens.
-}
applyIsupportLine : ISupport -> List String -> ISupport
applyIsupportLine support params =
    let
        middle =
            params
                |> List.drop 1
                |> dropTrailing
                |> List.take maxTokenCount
    in
    List.foldl
        (\token acc ->
            applyRawToken acc token
        )
        support
        middle


applyRawToken : ISupport -> String -> ISupport
applyRawToken support token =
    if String.startsWith "-" token then
        let
            key =
                String.dropLeft 1 token
        in
        if String.contains "=" token || not (isTokenKey key) then
            support

        else
            storeAndProject support key Nothing

    else
        case splitToken token of
            Just ( key, rawValue ) ->
                if not (isTokenKey key) then
                    support

                else if String.contains "=" token then
                    case decodeTokenValue rawValue of
                        Just val ->
                            if not (isValidKnownAdvertisement key val) then
                                support

                            else
                                storeAndProject support key (Just (Just val))

                        Nothing ->
                            support

                else if isValidKnownAdvertisement key "" then
                    storeAndProject support key (Just Nothing)

                else
                    support

            Nothing ->
                support


dropTrailing : List String -> List String
dropTrailing params =
    List.reverse
        (case List.reverse params of
            [] ->
                []

            _ :: rest ->
                rest
        )
