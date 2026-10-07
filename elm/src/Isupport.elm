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
    )

{-| ISUPPORT (005) token table — Elm port of the `_parseISUPPORT` fold
and its helpers in `src/lib/irc/client.ts`
(`parseIsupportPositiveInt`, `parseIsupportChannelTypes`,
`parseIsupportChannelModes`, `parseCHANLIMIT`, `parsePREFIX`) plus the
`ISupport` defaults.

Envelope rules (fail closed): the nick param and trailing text are
skipped, at most 256 tokens are honored, keys match `[A-Z][A-Z0-9-]*`
(≤64 chars), values carry no C0/space/DEL (≤1024 chars). Unknown tokens
are validated and ignored. Every branch keeps its last known-good value
on malformed input.

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


isTokenValue : String -> Bool
isTokenValue value =
    String.length value
        <= maxTokenValueLength
        && not (List.any isValueBad (String.toList value))


isValueBad : Char -> Bool
isValueBad c =
    let
        code =
            Char.toCode c
    in
    code <= 0x20 || code == 0x7F


splitToken : String -> Maybe ( String, String )
splitToken token =
    case String.indexes "=" token of
        [] ->
            Just ( token, "" )

        idx :: _ ->
            Just ( String.slice 0 idx token, String.dropLeft (idx + 1) token )


{-| Fold one validated `KEY[=value]` token into the table. -}
applyIsupportToken : ISupport -> String -> String -> ISupport
applyIsupportToken support key val =
    if String.isEmpty key || not (isTokenKey key) || not (isTokenValue val) then
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
            case splitToken token of
                Just ( key, val ) ->
                    applyIsupportToken acc key val

                Nothing ->
                    acc
        )
        support
        middle


dropTrailing : List String -> List String
dropTrailing params =
    List.reverse
        (case List.reverse params of
            [] ->
                []

            _ :: rest ->
                rest
        )
