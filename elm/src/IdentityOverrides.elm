module IdentityOverrides exposing
    ( softIgnoreKey
    , nickColorsKey
    , displayNamesKey
    , maxOverrides
    , maxNickLength
    , maxDisplayNameLength
    , maxStorageChars
    , normalizeOverrideNick
    , normalizeNickColor
    , normalizeDisplayName
    , parseSoftIgnore
    , parseNickColors
    , parseDisplayNames
    , encodeSoftIgnore
    , encodeStringMap
    , scopedKey
    , stringsAt
    , pairsAt
    )

{-| Private per-account identity overrides (mirroring
`src/lib/identityOverrides.ts`: soft ignores, nick colors, and
local display names; owner-scoped storage mechanics stay
ports-side, like the report receipts). -}

import Dict exposing (Dict)
import Json.Decode as Decode
import PersonSafety
import Set exposing (Set)


softIgnoreKey : String
softIgnoreKey =
    "onyx:soft-ignore"


nickColorsKey : String
nickColorsKey =
    "onyx:nick-colors"


displayNamesKey : String
displayNamesKey =
    "onyx:display-names"


maxOverrides : Int
maxOverrides =
    512


maxNickLength : Int
maxNickLength =
    128


maxDisplayNameLength : Int
maxDisplayNameLength =
    128


maxStorageChars : Int
maxStorageChars =
    256 * 1024


{-| Canonical nickname key shared by the three override stores
(lowercased; whitespace, commas, and controls fail closed). -}
normalizeOverrideNick : String -> Maybe String
normalizeOverrideNick value =
    let
        nick =
            String.toLower (String.trim value)
    in
    if String.isEmpty nick then
        Nothing

    else if String.length nick > maxNickLength then
        Nothing

    else if String.any isInvalidNickChar nick then
        Nothing

    else
        Just nick


isInvalidNickChar : Char -> Bool
isInvalidNickChar c =
    let
        code =
            Char.toCode c
    in
    c == ' ' || c == ',' || code < 32 || code == 127 || List.member code unicodeSpaces


{-| Non-ASCII whitespace in the JS `\s` class (mirroring
`INVALID_NICK_CHARACTERS` exactly). -}
unicodeSpaces : List Int
unicodeSpaces =
    [ 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279 ]


{-| Persist only unambiguous CSS hex colors; arbitrary CSS
tokens fail closed. -}
normalizeNickColor : String -> Maybe String
normalizeNickColor value =
    let
        color =
            String.toLower (String.trim value)
    in
    if isHexColor color then
        Just color

    else
        Nothing


isHexColor : String -> Bool
isHexColor color =
    if String.startsWith "#" color then
        let
            digits =
                String.dropLeft 1 color

            len =
                String.length digits
        in
        (len == 3 || len == 4 || len == 6 || len == 8)
            && String.all isHexDigit digits

    else
        False


isHexDigit : Char -> Bool
isHexDigit c =
    (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')


{-| Bound local aliases and reject control characters that can
spoof surrounding UI. -}
normalizeDisplayName : String -> Maybe String
normalizeDisplayName value =
    let
        name =
            String.trim value
    in
    if String.isEmpty name then
        Nothing

    else if String.length name > maxDisplayNameLength then
        Nothing

    else if String.any isControlChar name then
        Nothing

    else
        Just name


isControlChar : Char -> Bool
isControlChar c =
    let
        code =
            Char.toCode c
    in
    code < 32 || code == 127


{-| Parse a soft-ignore journal (order-independent set, capped). -}
parseSoftIgnore : List String -> Set String
parseSoftIgnore values =
    List.foldl
        (\raw acc ->
            if Set.size acc >= maxOverrides then
                acc

            else
                case normalizeOverrideNick raw of
                    Just nick ->
                        Set.insert nick acc

                    Nothing ->
                        acc
        )
        Set.empty
        values


{-| Parse a nick-color journal (first win per nick, capped). -}
parseNickColors : List ( String, String ) -> Dict String String
parseNickColors pairs =
    List.foldl
        (\( rawNick, rawColor ) acc ->
            if Dict.size acc >= maxOverrides then
                acc

            else
                case ( normalizeOverrideNick rawNick, normalizeNickColor rawColor ) of
                    ( Just nick, Just color ) ->
                        if Dict.member nick acc then
                            acc

                        else
                            Dict.insert nick color acc

                    _ ->
                        acc
        )
        Dict.empty
        pairs


{-| Parse a display-name journal (first win per nick, capped). -}
parseDisplayNames : List ( String, String ) -> Dict String String
parseDisplayNames pairs =
    List.foldl
        (\( rawNick, rawName ) acc ->
            if Dict.size acc >= maxOverrides then
                acc

            else
                case ( normalizeOverrideNick rawNick, normalizeDisplayName rawName ) of
                    ( Just nick, Just name ) ->
                        if Dict.member nick acc then
                            acc

                        else
                            Dict.insert nick name acc

                    _ ->
                        acc
        )
        Dict.empty
        pairs


{-| Sorted-array JSON for a soft-ignore set (mirroring the
`[...normalized].sort()` serialization). -}
encodeSoftIgnore : Set String -> String
encodeSoftIgnore nicks =
    "[" ++ String.join "," (List.map PersonSafety.jsonString (List.sort (Set.toList nicks))) ++ "]"


{-| Sorted-record JSON for a nick-indexed map (mirroring the
`localeCompare`-sorted serialization; Elm compares by code
point, which orders ASCII identically). -}
encodeStringMap : Dict String String -> String
encodeStringMap overrides =
    "{"
        ++ String.join ","
            (List.map
                (\( nick, value ) -> PersonSafety.jsonString nick ++ ":" ++ PersonSafety.jsonString value)
                (List.sortBy Tuple.first (Dict.toList overrides))
            )
        ++ "}"


{-| Owner-scoped key for one override store (Nothing when the
owner is unusable, so ownerless journals are never claimed). -}
scopedKey : String -> { serverUrl : String, identity : String } -> Maybe String
scopedKey base owner =
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
        Just (base ++ ":owner:" ++ PersonSafety.percentEncode ("[" ++ PersonSafety.jsonString url ++ "," ++ PersonSafety.jsonString identity ++ "]"))


{-| Lenient string list at one payload field (non-string
elements drop, missing fields land empty). -}
stringsAt : String -> Decode.Value -> List String
stringsAt name raw =
    case Decode.decodeValue (Decode.field name (Decode.list Decode.value)) raw of
        Ok values ->
            List.filterMap (decodeStringValue) values

        Err _ ->
            []


{-| Lenient string pairs at one payload field. -}
pairsAt : String -> Decode.Value -> List ( String, String )
pairsAt name raw =
    case Decode.decodeValue (Decode.field name (Decode.dict Decode.value)) raw of
        Ok entries ->
            List.filterMap
                (\( key, value ) ->
                    case decodeStringValue value of
                        Just text ->
                            Just ( key, text )

                        Nothing ->
                            Nothing
                )
                (Dict.toList entries)

        Err _ ->
            []


decodeStringValue : Decode.Value -> Maybe String
decodeStringValue value =
    case Decode.decodeValue Decode.string value of
        Ok text ->
            Just text

        Err _ ->
            Nothing
